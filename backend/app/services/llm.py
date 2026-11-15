"""Cliente único del modelo de lenguaje (OpenAI o servidor compatible vía OPENAI_BASE_URL).

Lo comparten el copiloto de alertas y el asistente del reloj. `ready()` responde rápido
(sin clave o sin conexión → False) para que los llamadores caigan al modo offline.
"""
import logging
from typing import Optional

import httpx
from openai import APIConnectionError, APITimeoutError, AsyncOpenAI

from app.core.config import Settings
from app.services.connectivity import Connectivity

OFFICIAL_URL = "https://api.openai.com/v1"

# Fallos de red: esperables sin internet, se registran en una línea (sin traza).
NETWORK_ERRORS = (APIConnectionError, APITimeoutError, httpx.TransportError)


def log_failure(log: logging.Logger, what: str, exc: Exception) -> None:
    if isinstance(exc, NETWORK_ERRORS):
        log.warning("%s sin conexión (%s); se usa el modo offline", what, type(exc).__name__)
    else:
        log.error("%s falló; se usa el modo offline", what, exc_info=exc)


class LLM:
    def __init__(self, settings: Settings, connectivity: Connectivity) -> None:
        self.model = settings.openai_model
        self.url = settings.openai_base_url or OFFICIAL_URL
        self.net = connectivity
        self.client: Optional[AsyncOpenAI] = (
            AsyncOpenAI(api_key=settings.openai_api_key, base_url=self.url, timeout=20, max_retries=0)
            if settings.openai_api_key else None)

    @property
    def configured(self) -> bool:
        return self.client is not None

    async def ready(self) -> bool:
        return self.configured and await self.net.reachable(self.url)

    def failed(self) -> None:
        self.net.report_failure(self.url)

    async def aclose(self) -> None:
        if self.client:
            await self.client.close()
