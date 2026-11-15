"""Síntesis de voz (Text-to-Speech) en línea con ElevenLabs.

La usan el copiloto (audio de cada alerta para el casco) y el asistente del reloj (/api/voice/tts).
Sin clave o sin conexión no está disponible y los clientes caen a la voz del sistema (offline).
"""
import logging
from typing import Optional

import httpx

from app.core.config import Settings
from app.services.connectivity import Connectivity
from app.services.llm import log_failure

log = logging.getLogger("tts")


class TextToSpeech:
    def __init__(self, settings: Settings, connectivity: Connectivity) -> None:
        self.s = settings
        self.net = connectivity
        self.url = settings.elevenlabs_base_url.rstrip("/")
        self._http = httpx.AsyncClient(timeout=10)

    @property
    def configured(self) -> bool:
        return bool(self.s.elevenlabs_api_key)

    async def ready(self) -> bool:
        return self.configured and await self.net.reachable(self.url)

    async def status(self) -> dict:
        return {"provider": "elevenlabs", "configured": self.configured, "available": await self.ready(),
                "offline": False, "model": self.s.elevenlabs_model}

    async def aclose(self) -> None:
        await self._http.aclose()

    async def synthesize(self, text: str) -> Optional[bytes]:
        """Devuelve mp3, o None si no está disponible o falla (el sistema nunca queda mudo)."""
        if not text or not await self.ready():
            return None
        try:
            r = await self._http.post(
                f"{self.url}/v1/text-to-speech/{self.s.elevenlabs_voice_id}",
                params={"output_format": "mp3_44100_64"},
                headers={"xi-api-key": self.s.elevenlabs_api_key},
                json={"text": text, "model_id": self.s.elevenlabs_model,
                      "voice_settings": {"stability": 0.7, "similarity_boost": 0.75,
                                         "style": 0.0, "use_speaker_boost": True}},
            )
            r.raise_for_status()
            return r.content
        except Exception as exc:
            log_failure(log, "ElevenLabs", exc)
            self.net.report_failure(self.url)
            return None
