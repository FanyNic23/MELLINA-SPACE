import asyncio
import json
from collections import defaultdict
from typing import Optional

from fastapi import WebSocket

# Un cliente que no recibe en este tiempo se desconecta: no puede frenar la ingesta de telemetría.
SEND_TIMEOUT_S = 2.0


class WSHub:
    """Canales: 'all' (toda la tripulación) y '<astronaut_id>' (vista individual)."""

    def __init__(self) -> None:
        self._subs: dict[str, set[WebSocket]] = defaultdict(set)

    async def connect(self, ws: WebSocket, channel: str = "all") -> None:
        await ws.accept()
        self._subs[channel].add(ws)

    def disconnect(self, ws: WebSocket, channel: str = "all") -> None:
        self._subs[channel].discard(ws)

    async def publish(self, event: dict, astronaut_id: Optional[str] = None) -> None:
        targets = set(self._subs["all"])
        if astronaut_id:
            targets |= self._subs[astronaut_id]
        if not targets:
            return
        text = json.dumps(event, default=str, ensure_ascii=False)
        await asyncio.gather(*(self._send(ws, text) for ws in targets))

    async def _send(self, ws: WebSocket, text: str) -> None:
        try:
            await asyncio.wait_for(ws.send_text(text), SEND_TIMEOUT_S)
        except Exception:
            for subs in self._subs.values():
                subs.discard(ws)
