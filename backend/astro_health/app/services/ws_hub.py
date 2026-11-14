import json
from collections import defaultdict
from typing import Optional

from fastapi import WebSocket


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
        for ws in targets:
            try:
                await ws.send_text(text)
            except Exception:
                for subs in self._subs.values():
                    subs.discard(ws)
