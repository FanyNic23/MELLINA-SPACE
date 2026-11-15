"""Reconocimiento de voz del astronauta (Speech-to-Text) 100% local: Whisper (faster-whisper) en el Edge.

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

from app.core.config import Settings

log = logging.getLogger("stt")

# Vocabulario de la misión: orienta a Whisper hacia nombres y términos que el asistente espera.
MISSION_PROMPTS = {
    "es": "Mellina, diagnóstico completo, salud, nave, cabina, ambiente, radiación, "
          "dióxido de carbono, Elena, Marcus, Kenji, Samuel, Diego, tripulante.",
    "en": "Mellina, full diagnosis, health, ship, cabin, environment, radiation, "
          "carbon dioxide, Elena, Marcus, Kenji, Samuel, Diego, crew.",
}


class SpeechUnavailable(RuntimeError):
    """Whisper local no puede atender (falta el modelo o la dependencia)."""


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
                        cpu_threads=self.s.whisper_cpu_threads, local_files_only=local_only)
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
            decode_audio(audio), language=language, beam_size=self.s.whisper_beam_size, vad_filter=True,
            vad_parameters={"min_silence_duration_ms": 400},
            initial_prompt=MISSION_PROMPTS.get(language), condition_on_previous_text=False)
        text = " ".join(seg.text.strip() for seg in segments).strip()
        return Transcript(text, info.language, "local", self.s.whisper_model, round(info.duration, 2),
                          round((time.perf_counter() - started) * 1000))

    async def transcribe(self, audio: bytes, language: str) -> Transcript:
        return await asyncio.to_thread(self._transcribe, audio, language)


class SpeechToText:
    """Fachada del reconocimiento de voz: siempre Whisper local, sin salir de la nave."""

    def __init__(self, settings: Settings) -> None:
        self.s = settings
        self.local = LocalWhisper(settings)

    async def warm_up(self) -> None:
        await self.local.warm_up()

    async def status(self) -> dict:
        return {"provider": "local" if self.local.installed else None, "available": self.local.installed,
                "offline": True, "model": self.s.whisper_model, "local_loaded": self.local.loaded,
                "last_error": self.local.last_error}

    async def transcribe(self, audio: bytes, language: Optional[str] = None) -> Transcript:
        if not self.local.installed:
            raise SpeechUnavailable("Whisper local no está instalado (pip install -r backend/requirements.txt).")
        return await self.local.transcribe(audio, language or self.s.stt_language)
