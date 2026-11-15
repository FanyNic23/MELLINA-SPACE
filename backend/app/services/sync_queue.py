"""Store-and-forward Tierra-Espacio.

Todo paquete (bundle FHIR, alerta, consejo del copiloto, log de voz, test PVT) se persiste primero en la
base local. Con enlace LOS no se transmite nada; con AOS un worker vacía la cola por prioridad (0 = crítica)
y antigüedad, hacia la "Estación en Tierra" simulada (todo ocurre en la nave, sin servicios externos).
Un paquete entregado se borra del buffer: la tabla sólo contiene lo pendiente o fallido y no crece sin límite.
"""
import asyncio
import logging
import time
from collections import deque
from enum import IntEnum, StrEnum
from typing import Optional, Protocol

from sqlalchemy import delete, func, select

from app.core.db import as_utc, utcnow
from app.models.telemetry import SyncPacketRow

log = logging.getLogger("sync")
MAX_ATTEMPTS = 5


class LinkState(StrEnum):
    AOS = "AOS"  # Acquisition of Signal
    LOS = "LOS"  # Loss of Signal


class Priority(IntEnum):
    CRITICAL = 0
    HIGH = 1
    ELEVATED = 3
    NORMAL = 5
    LOW = 8


class GroundStation(Protocol):
    name: str

    async def deliver(self, packets: list[dict]) -> None: ...


class SimulatedGroundStation:
    name = "simulated"

    def __init__(self) -> None:
        self.received = 0
        self.last: deque = deque(maxlen=10)

    async def deliver(self, packets: list[dict]) -> None:
        await asyncio.sleep(0.005)
        self.received += len(packets)
        self.last.extend(p["id"] for p in packets)


class SyncQueue:
    def __init__(self, session_factory, ground: GroundStation, batch_size: int = 50) -> None:
        self.sf, self.ground, self.batch = session_factory, ground, batch_size
        self.link = LinkState.AOS
        self._wake = asyncio.Event()
        self._task: Optional[asyncio.Task] = None
        # métricas
        self.sent_total = 0
        self.failed_total = 0
        self._lat_sum = 0.0
        self.last_drain: Optional[dict] = None
        self.last_los: Optional[dict] = None
        self._los_started = None
        self.drains: deque = deque(maxlen=10)

    # ------------------------------------------------------------ ciclo de vida
    async def start(self) -> None:
        self._task = asyncio.create_task(self._worker(), name="sync-worker")

    async def stop(self) -> None:
        if self._task:
            self._task.cancel()
            await asyncio.gather(self._task, return_exceptions=True)

    # ------------------------------------------------------------ API
    async def enqueue(self, kind: str, payload: dict, priority: int,
                      astronaut_id: Optional[str] = None, is_synthetic: bool = False) -> None:
        async with self.sf() as s:
            s.add(SyncPacketRow(kind=kind, priority=int(priority), payload=payload,
                                astronaut_id=astronaut_id, is_synthetic=is_synthetic))
            await s.commit()
        if self.link == LinkState.AOS:
            self._wake.set()

    async def set_link(self, state: LinkState) -> dict:
        if state == self.link:
            return {"link": self.link.value, "changed": False}
        prev, self.link = self.link, state
        if state == LinkState.LOS:
            self._los_started = time.monotonic()
        else:
            async with self.sf() as s:
                buffered = await s.scalar(select(func.count()).select_from(SyncPacketRow)
                                          .where(SyncPacketRow.status == "pending"))
            self.last_los = {"duration_s": round(time.monotonic() - (self._los_started or time.monotonic()), 1),
                             "packets_buffered": buffered}
            self._wake.set()
        log.info("Enlace %s -> %s", prev, state)
        return {"link": state.value, "changed": True, "previous": prev.value, "last_los": self.last_los}

    async def pending(self) -> int:
        """Paquetes aún no entregados (consulta liviana sobre el índice de la cola)."""
        async with self.sf() as s:
            return await s.scalar(select(func.count()).select_from(SyncPacketRow)
                                  .where(SyncPacketRow.status == "pending")) or 0

    async def status(self) -> dict:
        async with self.sf() as s:
            rows = (await s.execute(select(SyncPacketRow.status, SyncPacketRow.priority, func.count())
                                    .group_by(SyncPacketRow.status, SyncPacketRow.priority))).all()
            oldest = await s.scalar(select(func.min(SyncPacketRow.created_at))
                                    .where(SyncPacketRow.status == "pending"))
        pending = {str(p): n for st, p, n in rows if st == "pending"}
        return {
            "link": self.link.value,
            "ground_station": self.ground.name,
            "pending_total": sum(pending.values()),
            "pending_by_priority": dict(sorted(pending.items(), key=lambda kv: int(kv[0]))),
            "failed_in_db": sum(n for st, _, n in rows if st == "failed"),
            "sent_total": self.sent_total,
            "failed_attempts_total": self.failed_total,
            "avg_delivery_latency_s": round(self._lat_sum / self.sent_total, 2) if self.sent_total else None,
            "oldest_pending_age_s": round((utcnow() - as_utc(oldest)).total_seconds(), 1) if oldest else None,
            "last_drain": self.last_drain,
            "last_los": self.last_los,
            "recent_drains": list(self.drains),
        }

    # ------------------------------------------------------------ worker
    async def _worker(self) -> None:
        while True:
            await self._wake.wait()
            self._wake.clear()
            if self.link != LinkState.AOS:
                continue
            try:
                await self._drain()
            except asyncio.CancelledError:
                raise
            except Exception:
                log.exception("Fallo en drain; reintento en 3 s")
                await asyncio.sleep(3)
                self._wake.set()

    async def _drain(self) -> None:
        t0, sent, by_prio = time.monotonic(), 0, {}
        while self.link == LinkState.AOS:
            async with self.sf() as s:
                rows = (await s.scalars(
                    select(SyncPacketRow).where(SyncPacketRow.status == "pending")
                    .order_by(SyncPacketRow.priority, SyncPacketRow.created_at).limit(self.batch))).all()
                if not rows:
                    break
                wire = [{"id": str(r.id), "kind": r.kind, "priority": r.priority, "astronaut_id": r.astronaut_id,
                         "is_synthetic": r.is_synthetic, "created_at": as_utc(r.created_at).isoformat(),
                         "payload": r.payload} for r in rows]
                try:
                    await self.ground.deliver(wire)
                except Exception:
                    log.exception("Entrega a Tierra falló (%d paquetes)", len(rows))
                    self.failed_total += len(rows)
                    for r in rows:
                        r.attempts += 1
                        if r.attempts >= MAX_ATTEMPTS:
                            r.status = "failed"
                    await s.commit()
                    await asyncio.sleep(2)
                    continue
                now = utcnow()
                for r in rows:
                    self._lat_sum += (now - as_utc(r.created_at)).total_seconds()
                    by_prio[r.priority] = by_prio.get(r.priority, 0) + 1
                await s.execute(delete(SyncPacketRow).where(SyncPacketRow.id.in_([r.id for r in rows])))
                await s.commit()
                sent += len(rows)
                self.sent_total += len(rows)
        if sent:
            self.last_drain = {"packets_synced": sent, "by_priority": dict(sorted(by_prio.items())),
                               "duration_s": round(time.monotonic() - t0, 3), "at": utcnow().isoformat()}
            self.drains.append(self.last_drain)
            log.info("Sincronizados %d paquetes con Tierra", sent)
