import logging

import httpx

from app.core.config import Settings

log = logging.getLogger("stt")


class SpeechToText:
    """Comandos de voz del astronauta: Whisper (OpenAI) o Deepgram, vía REST."""

    def __init__(self, settings: Settings) -> None:
        self.s = settings
        self._http = httpx.AsyncClient(timeout=30)

    async def aclose(self) -> None:
        await self._http.aclose()

    async def transcribe(self, audio: bytes, filename: str, content_type: str) -> str:
        if self.s.stt_provider == "deepgram":
            return await self._deepgram(audio, content_type)
        return await self._whisper(audio, filename, content_type)

    async def _whisper(self, audio: bytes, filename: str, content_type: str) -> str:
        if not self.s.openai_api_key:
            raise RuntimeError("OPENAI_API_KEY no configurada (STT Whisper)")
        r = await self._http.post(
            "https://api.openai.com/v1/audio/transcriptions",
            headers={"Authorization": f"Bearer {self.s.openai_api_key}"},
            data={"model": self.s.openai_whisper_model, "language": "es"},
            files={"file": (filename or "voice.webm", audio, content_type or "audio/webm")},
        )
        r.raise_for_status()
        return r.json().get("text", "").strip()

    async def _deepgram(self, audio: bytes, content_type: str) -> str:
        if not self.s.deepgram_api_key:
            raise RuntimeError("DEEPGRAM_API_KEY no configurada")
        r = await self._http.post(
            "https://api.deepgram.com/v1/listen",
            params={"model": self.s.deepgram_model, "language": self.s.deepgram_language,
                    "smart_format": "true"},
            headers={"Authorization": f"Token {self.s.deepgram_api_key}",
                     "Content-Type": content_type or "audio/webm"},
            content=audio,
        )
        r.raise_for_status()
        alt = r.json()["results"]["channels"][0]["alternatives"][0]
        return alt.get("transcript", "").strip()
