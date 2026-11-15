"""Orquestador de ingesta: FHIR -> reglas -> persistencia -> alertas -> copiloto IA -> WS + cola Tierra."""
import asyncio
import logging
import time
from collections import defaultdict
from typing import Optional

from sqlalchemy import select, update

from app.core.db import utcnow
from app.models.telemetry import AlertRow, AstronautRow, ObservationRow
from app.schemas.fhir import (SPECS, CodeableConcept, Observation, indicator_of, to_bundle,
                              values_from_observation)
from app.services.ai_copilot import AICopilot
from app.services.rule_engine import COLOR, RANK, Evaluation, Level, RuleEngine, worst
from app.services.sync_queue import Priority, SyncQueue
from app.services.ws_hub import WSHub

log = logging.getLogger("telemetry")


class TelemetryService:
    def __init__(self, settings, session_factory, engine: RuleEngine, copilot: AICopilot,
                 sync: SyncQueue, hub: WSHub) -> None:
        self.s, self.sf, self.engine, self.copilot, self.sync, self.hub = \
            settings, session_factory, engine, copilot, sync, hub
        self.latest: dict[str, dict[str, dict]] = defaultdict(dict)  # aid -> indicator -> {values,...}
        self._active: dict[tuple[str, str], tuple[object, Level]] = {}  # (aid, metric) -> (alert_id, level)
        self._last_consult: dict[str, float] = {}
        self._inflight: set[str] = set()
        self._tasks: set[asyncio.Task] = set()
        self._astronauts: dict[str, dict] = {}

    # ------------------------------------------------------------ arranque
    async def bootstrap(self, crew: list[dict]) -> None:
        async with self.sf() as s:
            for c in crew:
                if not await s.get(AstronautRow, c["id"]):
                    s.add(AstronautRow(id=c["id"], name=c["name"], role=c["role"]))
            # alertas activas de una ejecución anterior: el motor arranca en frío
            await s.execute(update(AlertRow).where(AlertRow.is_active.is_(True))
                            .values(is_active=False, resolved_at=utcnow()))
            await s.commit()
            for a in (await s.scalars(select(AstronautRow))).all():
                self._astronauts[a.id] = {"id": a.id, "name": a.name, "role": a.role}

    async def shutdown(self) -> None:
        for t in list(self._tasks):
            t.cancel()
        await asyncio.gather(*self._tasks, return_exceptions=True)

    def astronaut(self, aid: str) -> Optional[dict]:
        return self._astronauts.get(aid)

    # ------------------------------------------------------------ ingesta
    async def ingest_observations(self, observations: list[Observation]) -> dict:
        by_astro: dict[str, list[Observation]] = defaultdict(list)
        for o in observations:
            by_astro[o.astronaut_id].append(o)

        summary = {}
        for aid, obs_list in by_astro.items():
            if aid not in self._astronauts:
                raise KeyError(f"Astronauta desconocido: {aid}")
            summary[aid] = await self._ingest_for_astronaut(aid, obs_list)
        return summary

    async def _ingest_for_astronaut(self, aid: str, obs_list: list[Observation]) -> dict:
        all_evals: list[Evaluation] = []
        rows, new_alerts, escalated = [], [], []
        resources = []

        async with self.sf() as s:
            for o in obs_list:
                ind = indicator_of(o)
                values = values_from_observation(o)
                evals = self.engine.process(aid, ind, values, o.effectiveDateTime, o.is_synthetic)
                all_evals += evals
                level = worst(e.level for e in evals)
                o.interpretation = [CodeableConcept(text=level.value)]
                res = o.model_dump(mode="json", exclude_none=True)
                resources.append(res)
                rows.append(ObservationRow(
                    id=_uuid(o.id), astronaut_id=aid, indicator=ind.value, effective_at=o.effectiveDateTime,
                    primary_value=float(values[SPECS[ind].primary]),
                    values=values, resource=res, danger_level=level.value, is_synthetic=o.is_synthetic))
                self.latest[aid][ind.value] = {"values": values, "effective_at": o.effectiveDateTime.isoformat(),
                                               "level": level.value, "is_synthetic": o.is_synthetic,
                                               "resource": res}
            s.add_all(rows)

            for ev in all_evals:
                key = (aid, ev.metric)
                if ev.level == Level.NOMINAL:
                    if key in self._active:
                        alert_id, _ = self._active.pop(key)
                        await s.execute(update(AlertRow).where(AlertRow.id == alert_id)
                                        .values(is_active=False, resolved_at=utcnow()))
                        await self.hub.publish({"type": "alert_resolved", "astronaut_id": aid,
                                                "metric": ev.metric, "alert_id": str(alert_id)}, aid)
                    continue
                if key not in self._active:
                    alert = AlertRow(
                        astronaut_id=aid, indicator=ev.indicator.value, metric=ev.metric, level=ev.level.value,
                        baseline_value=ev.baseline, current_value=ev.current, delta_value=ev.delta_value,
                        delta_pct=ev.delta_pct, duration_minutes=ev.duration_minutes,
                        minutes_to_actuar=ev.minutes_to_actuar, message=ev.reason, is_synthetic=ev.is_synthetic,
                        effective_at=ev.t)
                    s.add(alert)
                    await s.flush()
                    self._active[key] = (alert.id, ev.level)
                    new_alerts.append((alert, ev))
                else:
                    alert_id, prev_level = self._active[key]
                    self._active[key] = (alert_id, ev.level)
                    if RANK[ev.level] > RANK[prev_level]:
                        escalated.append((alert_id, ev))
                    await s.execute(update(AlertRow).where(AlertRow.id == alert_id).values(
                        level=ev.level.value, baseline_value=ev.baseline, current_value=ev.current,
                        delta_value=ev.delta_value, delta_pct=ev.delta_pct, duration_minutes=ev.duration_minutes,
                        minutes_to_actuar=ev.minutes_to_actuar, message=ev.reason, updated_at=utcnow()))
            await s.commit()

        status = self.engine.status(aid)
        synthetic = all(o.is_synthetic for o in obs_list)

        # --- cola Tierra-Espacio (bundle FHIR + alertas críticas)
        prio = {Level.ACTUAR: Priority.HIGH, Level.VIGILAR: Priority.ELEVATED}.get(status, Priority.NORMAL)
        await self.sync.enqueue("observation_bundle", to_bundle(resources), prio, aid, synthetic)
        for alert, ev in new_alerts:
            p = Priority.CRITICAL if ev.level == Level.ACTUAR else Priority.HIGH
            await self.sync.enqueue("alert", _alert_dict(alert, ev), p, aid, ev.is_synthetic)
        for alert_id, ev in escalated:
            if ev.level == Level.ACTUAR:
                await self.sync.enqueue("alert", {**ev.to_dict(), "alert_id": str(alert_id), "escalated": True},
                                        Priority.CRITICAL, aid, ev.is_synthetic)

        # --- tiempo real
        await self.hub.publish({
            "type": "telemetry", "astronaut_id": aid, "status": status.value, "color": COLOR[status],
            "observations": resources, "evaluations": [e.to_dict() for e in all_evals],
        }, aid)
        for alert, ev in new_alerts:
            await self.hub.publish({"type": "alert", "astronaut_id": aid, "alert_id": str(alert.id),
                                    **ev.to_dict()}, aid)

        # --- copiloto IA (en segundo plano, con enfriamiento)
        trigger_ids = [a.id for a, _ in new_alerts] + [i for i, _ in escalated]
        if trigger_ids:
            critical = any(e.level == Level.ACTUAR for _, e in new_alerts + escalated)
            self._schedule_consult(aid, critical)
        return {"status": status.value, "observations": len(obs_list), "new_alerts": len(new_alerts)}

    # ------------------------------------------------------------ copiloto
    def _schedule_consult(self, aid: str, critical: bool) -> None:
        if aid in self._inflight:
            return
        cooling = time.monotonic() - self._last_consult.get(aid, 0) < self.s.copilot_cooldown_seconds
        if cooling and not critical:
            return
        self._inflight.add(aid)
        task = asyncio.create_task(self._consult(aid))
        self._tasks.add(task)
        task.add_done_callback(self._tasks.discard)

    async def _consult(self, aid: str) -> None:
        try:
            evals = self.engine.active(aid)
            if not evals:
                return
            result = await self.copilot.analyze(self._astronauts[aid], evals, self.latest[aid])
            payload = result.to_dict()
            ids = [self._active[(aid, e.metric)][0] for e in evals if (aid, e.metric) in self._active]
            async with self.sf() as s:
                await s.execute(update(AlertRow).where(AlertRow.id.in_(ids))
                                .values(ai_response=payload, audio_url=result.audio_url))
                await s.commit()
            self._last_consult[aid] = time.monotonic()
            critical = any(e.level == Level.ACTUAR for e in evals)
            await self.sync.enqueue("copilot_advice", {"astronaut_id": aid, "alerts": [str(i) for i in ids],
                                                       "advice": payload},
                                    Priority.CRITICAL if critical else Priority.HIGH, aid,
                                    any(e.is_synthetic for e in evals))
            await self.hub.publish({"type": "copilot", "astronaut_id": aid, "alerts": [str(i) for i in ids],
                                    **payload}, aid)
        except Exception:
            log.exception("Consulta al copiloto falló para %s", aid)
        finally:
            self._inflight.discard(aid)

    async def consult_now(self, aid: str, transcript: Optional[str] = None) -> dict:
        """Consulta manual (endpoint /copilot/consult y /voice/command)."""
        evals = self.engine.active(aid)
        astro = self._astronauts[aid]
        if transcript:
            res = await self.copilot.converse(astro, transcript, evals, self.latest[aid])
        else:
            res = await self.copilot.analyze(astro, evals, self.latest[aid])
        return res.to_dict()


def _uuid(s: str):
    import uuid
    try:
        return uuid.UUID(s)
    except ValueError:
        return uuid.uuid4()


def _alert_dict(alert: AlertRow, ev: Evaluation) -> dict:
    return {**ev.to_dict(), "alert_id": str(alert.id)}
