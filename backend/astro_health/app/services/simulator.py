"""Simulador de telemetría del traje/hábitat y de eventos espaciales (todo `is_synthetic=True`)."""
import asyncio
import logging
import random
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from enum import StrEnum
from typing import Optional

from app.core.config import Settings
from app.core.db import utcnow
from app.schemas.fhir import Indicator, build_observation

log = logging.getLogger("simulator")

CREW = [
    {"id": "AST-01", "name": "Cmdr. Elena Vargas", "role": "Comandante", "hr": 62, "sys": 116, "dia": 74},
    {"id": "AST-02", "name": "Dr. Kenji Mori", "role": "Oficial médico", "hr": 66, "sys": 118, "dia": 76},
    {"id": "AST-03", "name": "Ing. Amara Okafor", "role": "Ingeniera de vuelo", "hr": 70, "sys": 120, "dia": 78},
    {"id": "AST-04", "name": "Esp. Lucas Meyer", "role": "Especialista EVA", "hr": 64, "sys": 114, "dia": 72},
]


class ScenarioKind(StrEnum):
    SPE = "spe"                  # Tormenta de partículas solares
    INSOMNIA = "insomnia"        # Fatiga crítica / aislamiento
    EVA_OVEREXERTION = "eva"     # Deshidratación / sobreesfuerzo en EVA


@dataclass
class ScenarioRun:
    kind: ScenarioKind
    total: float      # minutos de misión
    remaining: float
    intensity: float = 1.0

    def factor(self) -> float:
        frac = 1 - self.remaining / self.total
        ramp_in, ramp_out = 0.15, 0.2
        f = frac / ramp_in if frac < ramp_in else (1 - frac) / ramp_out if frac > 1 - ramp_out else 1.0
        return max(0.0, min(1.0, f)) * self.intensity


@dataclass
class _Actor:
    profile: dict
    v: dict = field(default_factory=dict)
    scenarios: list = field(default_factory=list)

    def __post_init__(self) -> None:
        p = self.profile
        self.v = dict(hr=p["hr"], spo2=98.0, sys=p["sys"], dia=p["dia"], temp=36.8, rr=15.0,
                      sleep=7.2, deep=1.4, rem=1.7, eff=90.0, rate=20.0,
                      cum=random.uniform(30, 42), rt=250.0, stress=25.0, sent=0.4)


def _targets(a: _Actor) -> dict:
    p = a.profile
    t = dict(hr=p["hr"], spo2=98.0, sys=p["sys"], dia=p["dia"], temp=36.8, rr=15.0, sleep=7.2, eff=90.0,
             rate=20.0, rt=250.0, stress=25.0, sent=0.4)
    for s in a.scenarios:
        f = s.factor()
        if s.kind == ScenarioKind.SPE:
            t["rate"] += 6000 * f; t["stress"] += 40 * f; t["hr"] += 14 * f
            t["rt"] += 90 * f; t["sent"] -= 0.4 * f
        elif s.kind == ScenarioKind.INSOMNIA:
            t["sleep"] -= 4.4 * f; t["eff"] -= 35 * f; t["rt"] += 200 * f
            t["stress"] += 42 * f; t["sent"] -= 1.0 * f; t["hr"] += 6 * f
        elif s.kind == ScenarioKind.EVA_OVEREXERTION:
            t["hr"] += 72 * f; t["temp"] += 1.7 * f; t["rr"] += 12 * f; t["sys"] += 40 * f
            t["dia"] += 14 * f; t["spo2"] -= 5 * f; t["stress"] += 22 * f
    return t


class TelemetrySimulator:
    def __init__(self, settings: Settings, service, crew: Optional[list[dict]] = None) -> None:
        self.s, self.service = settings, service
        self.crew = crew or CREW
        self.actors = {c["id"]: _Actor(c) for c in self.crew}
        self.vt: datetime = utcnow()  # reloj de misión (virtual)
        self.ticks = 0
        self._task: Optional[asyncio.Task] = None

    # ------------------------------------------------------------ control
    @property
    def running(self) -> bool:
        return bool(self._task and not self._task.done())

    def start(self) -> bool:
        if self.running:
            return False
        self._task = asyncio.create_task(self._loop(), name="telemetry-simulator")
        return True

    async def stop(self) -> None:
        if self._task:
            self._task.cancel()
            await asyncio.gather(self._task, return_exceptions=True)
            self._task = None

    def trigger(self, kind: ScenarioKind, astronaut_ids: Optional[list[str]] = None,
                duration_minutes: float = 120, intensity: float = 1.0) -> list[str]:
        ids = astronaut_ids or list(self.actors)
        unknown = [i for i in ids if i not in self.actors]
        if unknown:
            raise KeyError(unknown)
        for i in ids:
            self.actors[i].scenarios.append(ScenarioRun(kind, duration_minutes, duration_minutes, intensity))
        log.warning("Escenario %s disparado para %s (%.0f min de misión)", kind, ids, duration_minutes)
        return ids

    def clear(self) -> None:
        for a in self.actors.values():
            a.scenarios.clear()

    def status(self) -> dict:
        return {
            "running": self.running, "ticks": self.ticks, "mission_clock": self.vt.isoformat(),
            "tick_seconds": self.s.sim_tick_seconds, "minutes_per_tick": self.s.sim_minutes_per_tick,
            "active_scenarios": {i: [{"kind": s.kind.value, "remaining_min": round(s.remaining, 1),
                                      "intensity": s.intensity} for s in a.scenarios]
                                 for i, a in self.actors.items() if a.scenarios},
        }

    # ------------------------------------------------------------ bucle
    async def _loop(self) -> None:
        while True:
            try:
                await self.tick()
            except asyncio.CancelledError:
                raise
            except Exception:
                log.exception("Error en tick del simulador")
            await asyncio.sleep(self.s.sim_tick_seconds)

    async def tick(self) -> None:
        dt = self.s.sim_minutes_per_tick
        self.vt += timedelta(minutes=dt)
        self.ticks += 1
        emit_sleep = self.ticks % 3 == 1
        for aid, a in self.actors.items():
            tg, v, g = _targets(a), a.v, random.gauss
            for k, target, noise in [("hr", tg["hr"], 1.2), ("spo2", tg["spo2"], 0.15), ("sys", tg["sys"], 1.5),
                                     ("dia", tg["dia"], 1.0), ("temp", tg["temp"], 0.03), ("rr", tg["rr"], 0.4),
                                     ("sleep", tg["sleep"], 0.05), ("eff", tg["eff"], 0.5),
                                     ("rate", tg["rate"], 1.0), ("rt", tg["rt"], 4.0),
                                     ("stress", tg["stress"], 1.0), ("sent", tg["sent"], 0.02)]:
                v[k] += 0.45 * (target - v[k]) + g(0, noise)
            v["spo2"] = min(v["spo2"], 100.0)
            v["rate"] = max(v["rate"], 5.0)
            v["cum"] += v["rate"] * dt / 60 / 1000  # µSv/h * h -> mSv
            v["deep"], v["rem"] = v["sleep"] * 0.2, v["sleep"] * 0.24
            for sc in a.scenarios:
                sc.remaining -= dt
            a.scenarios = [sc for sc in a.scenarios if sc.remaining > 0]

            r = lambda x: round(float(x), 2)  # noqa: E731
            readings = [
                (Indicator.HEART_RATE, {"value": r(v["hr"])}),
                (Indicator.SPO2, {"value": r(v["spo2"])}),
                (Indicator.BLOOD_PRESSURE, {"systolic": r(v["sys"]), "diastolic": r(v["dia"])}),
                (Indicator.BODY_TEMP, {"value": r(v["temp"])}),
                (Indicator.RESPIRATORY_RATE, {"value": r(v["rr"])}),
                (Indicator.RADIATION_DOSE, {"cumulative_msv": r(v["cum"]), "rate_usv_h": r(v["rate"])}),
                (Indicator.BEHAVIORAL_HEALTH, {"stress_score": r(min(max(v["stress"], 0), 100)),
                                               "reaction_time_ms": r(v["rt"]),
                                               "sentiment": r(max(-1, min(1, v["sent"])))}),
            ]
            if emit_sleep:
                readings.append((Indicator.SLEEP_METRICS, {
                    "hours": r(max(v["sleep"], 0)), "deep_hours": r(v["deep"]), "rem_hours": r(v["rem"]),
                    "light_hours": r(max(v["sleep"] - v["deep"] - v["rem"], 0)),
                    "efficiency_pct": r(min(v["eff"], 100))}))
            obs = [build_observation(aid, ind, vals, self.vt, is_synthetic=True) for ind, vals in readings]
            await self.service.ingest_observations(obs)
