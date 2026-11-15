"""Decide si los servicios en línea son alcanzables, sin frenar al sistema cuando no lo son.

- AI_MODE=offline: nunca se intenta salir de la nave.
- AI_MODE=online: siempre se intenta (los fallos igual caen al modo offline).
- AI_MODE=auto: sondeo TCP corto al host del servicio, cacheado; tras un fallo real de una API
  el host se marca caído y no se reintenta hasta que vence la caché. Así, sin internet, cada
  consulta va directo al modo offline en lugar de esperar un timeout.
"""
import asyncio
import logging
import time
from urllib.parse import urlparse

from app.core.config import Settings

log = logging.getLogger("connectivity")

PROBE_TIMEOUT_S = 1.5
ONLINE_TTL_S = 60.0   # con conexión, se re-sondea cada minuto
OFFLINE_TTL_S = 20.0  # sin conexión, se re-sondea antes para volver pronto al modo en línea


class Connectivity:
    def __init__(self, settings: Settings) -> None:
        self.mode = settings.ai_mode
        self._state: dict[tuple[str, int], tuple[bool, float]] = {}
        self._probes: dict[tuple[str, int], asyncio.Task] = {}

    @staticmethod
    def _endpoint(url: str) -> tuple[str, int]:
        u = urlparse(url)
        return u.hostname or "", u.port or (443 if u.scheme == "https" else 80)

    async def reachable(self, url: str) -> bool:
        if self.mode == "offline":
            return False
        if self.mode == "online":
            return True
        key = self._endpoint(url)
        cached = self._state.get(key)
        if cached and time.monotonic() - cached[1] < (ONLINE_TTL_S if cached[0] else OFFLINE_TTL_S):
            return cached[0]
        # peticiones simultáneas comparten un único sondeo
        probe = self._probes.get(key)
        if probe is None:
            probe = self._probes[key] = asyncio.create_task(self._probe(*key))
            probe.add_done_callback(lambda _: self._probes.pop(key, None))
        return await asyncio.shield(probe)

    async def _probe(self, host: str, port: int) -> bool:
        try:
            _, writer = await asyncio.wait_for(asyncio.open_connection(host, port), PROBE_TIMEOUT_S)
            writer.close()
            ok = True
        except Exception:
            ok = False
        self._state[(host, port)] = (ok, time.monotonic())
        return ok

    def report_failure(self, url: str) -> None:
        """Una llamada real falló: el host queda como caído hasta el próximo sondeo."""
        if self.mode == "auto":
            self._state[self._endpoint(url)] = (False, time.monotonic())
            log.warning("%s no responde; modo offline durante %.0f s", url, OFFLINE_TTL_S)
