"""Reconocimiento de voz del astronauta (Speech-to-Text).

Proveedores (STT_PROVIDER):
  auto     → en línea usa la nube (OpenAI o Deepgram, según la clave); offline, Whisper local (por defecto).
  local    → siempre Whisper vía faster-whisper en el propio Edge, sin internet.
  openai   → API de OpenAI; deepgram → API de Deepgram (ambos caen a Whisper local si fallan).

La transcripción local es CPU intensiva: corre en un hilo aparte para no bloquear el event loop
que comparten el simulador, la ingesta de telemetría y la cola Tierra-Espacio.
"""
import asyncio
import importlib.util
import io
import logging
import threading
import time
from dataclasses import asdict, dataclass
from typing import Optional

import httpx

from app.core.config import Settings
from app.services.connectivity import Connectivity
from app.services.llm import LLM, log_failure

log = logging.getLogger("stt")

# Vocabulario de la misión: orienta a Whisper hacia nombres y términos que el asistente espera.
MISSION_PROMPTS = {
    "es": "Mellina, diagnóstico completo, salud, nave, cabina, ambiente, radiación, "
          "dióxido de carbono, Elena, Marcus, Kenji, Sarah, tripulante.",
    "en": "Mellina, full diagnosis, health, ship, cabin, environment, radiation, "
          "carbon dioxide, Elena, Marcus, Kenji, Sarah, crew.",
}


class SpeechUnavailable(RuntimeError):
    """El proveedor configurado no puede atender (falta modelo, clave o dependencia)."""


class InvalidAudio(ValueError):
    """El audio recibido no se puede decodificar (error del cliente, no del servidor)."""


@dataclass
class Transcript:
    text: str
    language: str
    provider: str
    model: str
    audio_duration_s: Optional[float] = None
    processing_ms: Optional[int] = None

    def to_dict(self) -> dict:
        return asdict(self)


def decode_audio(audio: bytes, sampling_rate: int = 16000):
    """Decodifica cualquier contenedor (webm/ogg/mp4/wav...) a PCM mono float32 a 16 kHz.

    Se hace aquí en lugar de usar faster_whisper.decode_audio porque esa función usa un
    parámetro de PyAV que ya no existe en sus versiones recientes.
    """
    import av
    import numpy as np

    resampler = av.AudioResampler(format="s16", layout="mono", rate=sampling_rate)
    chunks = []
    try:
        with av.open(io.BytesIO(audio), mode="r") as container:
            for frame in container.decode(audio=0):
                frame.pts = None
                for out in resampler.resample(frame):
                    chunks.append(out.to_ndarray().reshape(-1))
            for out in resampler.resample(None):
                chunks.append(out.to_ndarray().reshape(-1))
    except av.error.FFmpegError as exc:
        raise InvalidAudio(f"Audio no válido: {exc}") from exc
    if not chunks:
        return np.zeros(0, dtype=np.float32)
    return np.concatenate(chunks).astype(np.float32) / 32768.0


class LocalWhisper:
    """Modelo Whisper cargado una sola vez y compartido entre peticiones."""

    def __init__(self, s: Settings) -> None:
        self.s = s
        self._model = None
        self._lock = threading.Lock()
        self.last_error: Optional[str] = None
        self.installed = importlib.util.find_spec("faster_whisper") is not None

    @property
    def loaded(self) -> bool:
        return self._model is not None

    def _load(self, local_only: bool):
        if self._model is not None:
            return self._model
        if not self.installed:
            raise SpeechUnavailable("faster-whisper no está instalado (pip install -r backend/requirements.txt).")
        from faster_whisper import WhisperModel

        with self._lock:
            if self._model is None:
                try:
                    self._model = WhisperModel(
                        self.s.whisper_model, device=self.s.whisper_device,
                        compute_type=self.s.whisper_compute_type, download_root=self.s.whisper_model_dir,
                        local_files_only=local_only)
                    self.last_error = None
                except Exception as exc:
                    self.last_error = str(exc)
                    raise SpeechUnavailable(f"No se pudo cargar Whisper '{self.s.whisper_model}': {exc}") from exc
        return self._model

    async def warm_up(self) -> None:
        """Carga el modelo en segundo plano si ya está en disco (nunca descarga al arrancar)."""
        if not self.installed:
            return
        try:
            await asyncio.to_thread(self._load, True)
        except SpeechUnavailable:
            pass  # aún no descargado: se cargará (o descargará) en la primera petición

    def _transcribe(self, audio: bytes, language: str) -> Transcript:
        model = self._load(not self.s.whisper_allow_download)
        started = time.perf_counter()
        segments, info = model.transcribe(
            decode_audio(audio), language=language, beam_size=5, vad_filter=True,
            vad_parameters={"min_silence_duration_ms": 400},
            initial_prompt=MISSION_PROMPTS.get(language), condition_on_previous_text=False)
        text = " ".join(seg.text.strip() for seg in segments).strip()
        return Transcript(text, info.language, "local", self.s.whisper_model, round(info.duration, 2),
                          round((time.perf_counter() - started) * 1000))

    async def transcribe(self, audio: bytes, language: str) -> Transcript:
        return await asyncio.to_thread(self._transcribe, audio, language)


DEEPGRAM_URL = "https://api.deepgram.com/v1/listen"


class SpeechToText:
    def __init__(self, settings: Settings, llm: LLM, connectivity: Connectivity) -> None:
        self.s = settings
        self.llm = llm
        self.net = connectivity
        self.local = LocalWhisper(settings)
        self._http = httpx.AsyncClient(timeout=15)

    async def aclose(self) -> None:
        await self._http.aclose()

    async def warm_up(self) -> None:
        """Whisper local se precarga siempre: es el respaldo de cualquier proveedor en la nube."""
        await self.local.warm_up()

    async def _online_provider(self) -> Optional[str]:
        """Proveedor en la nube utilizable ahora mismo, o None (→ Whisper local)."""
        wanted = self.s.stt_provider
        if wanted == "local":
            return None
        for provider in ([wanted] if wanted != "auto" else ["openai", "deepgram"]):
            if provider == "openai" and await self.llm.ready():
                return "openai"
            if provider == "deepgram" and self.s.deepgram_api_key and await self.net.reachable(DEEPGRAM_URL):
                return "deepgram"
        return None

    async def status(self) -> dict:
        provider = await self._online_provider() or ("local" if self.local.installed else None)
        model = {"openai": self.s.openai_whisper_model, "deepgram": self.s.deepgram_model,
                 "local": self.s.whisper_model}.get(provider)
        return {"provider": provider, "available": provider is not None, "offline": provider == "local",
                "model": model, "local_loaded": self.local.loaded, "last_error": self.local.last_error}

    async def transcribe(self, audio: bytes, filename: str = "voice.webm", content_type: str = "",
                         language: Optional[str] = None) -> Transcript:
        """En línea usa la nube; si no hay conexión o la nube falla, Whisper local."""
        language = language or self.s.stt_language
        provider = await self._online_provider()
        if provider:
            try:
                if provider == "openai":
                    return await self._openai(audio, filename, content_type, language)
                return await self._deepgram(audio, content_type, language)
            except Exception as exc:
                log_failure(log, f"STT {provider}", exc)
                if provider == "openai":
                    self.llm.failed()
                else:
                    self.net.report_failure(DEEPGRAM_URL)
        if not self.local.installed:
            raise SpeechUnavailable("Sin conexión y sin Whisper local (pip install -r backend/requirements.txt).")
        return await self.local.transcribe(audio, language)

    async def _openai(self, audio: bytes, filename: str, content_type: str, language: str) -> Transcript:
        started = time.perf_counter()
        r = await self.llm.client.audio.transcriptions.create(
            model=self.s.openai_whisper_model, language=language,
            file=(filename or "voice.webm", audio, content_type or "audio/webm"))
        return Transcript(r.text.strip(), language, "openai", self.s.openai_whisper_model,
                          processing_ms=round((time.perf_counter() - started) * 1000))

    async def _deepgram(self, audio: bytes, content_type: str, language: str) -> Transcript:
        started = time.perf_counter()
        r = await self._http.post(
            DEEPGRAM_URL,
            params={"model": self.s.deepgram_model, "language": language, "smart_format": "true"},
            headers={"Authorization": f"Token {self.s.deepgram_api_key}",
                     "Content-Type": content_type or "audio/webm"},
            content=audio,
        )
        r.raise_for_status()
        alt = r.json()["results"]["channels"][0]["alternatives"][0]
        return Transcript(alt.get("transcript", "").strip(), language, "deepgram", self.s.deepgram_model,
                          processing_ms=round((time.perf_counter() - started) * 1000))
