"""Motor híbrido de reglas: umbrales absolutos + cambio relativo a una línea base adaptativa.

Por cada métrica se mantiene un estado (baseline, nivel, inicio de la desviación, histórico corto)
para devolver, además del semáforo, la trazabilidad exigida:
  qué cambió (metric), cuánto (delta_value / delta_pct) y desde cuándo (duration_minutes),
  más una proyección lineal de "minutos hasta ACTUAR".
"""
from collections import deque
from dataclasses import dataclass, field
from datetime import datetime
from enum import StrEnum
from typing import Optional

from app.schemas.fhir import Indicator


class Level(StrEnum):
    NOMINAL = "NOMINAL"  # verde
    VIGILAR = "VIGILAR"  # ámbar
    ACTUAR = "ACTUAR"    # rojo


RANK = {Level.NOMINAL: 0, Level.VIGILAR: 1, Level.ACTUAR: 2}
COLOR = {Level.NOMINAL: "verde", Level.VIGILAR: "ambar", Level.ACTUAR: "rojo"}


def worst(levels) -> Level:
    return max(levels, key=lambda l: RANK[l], default=Level.NOMINAL)


@dataclass(frozen=True)
class Rule:
    indicator: Indicator
    value_key: str
    metric: str
    label: str
    unit: str
    low_watch: Optional[float] = None
    low_act: Optional[float] = None
    high_watch: Optional[float] = None
    high_act: Optional[float] = None
    pct_watch: Optional[float] = None  # |cambio %| vs baseline
    pct_act: Optional[float] = None


I = Indicator
RULES: list[Rule] = [
    Rule(I.HEART_RATE, "value", "heart_rate", "Frecuencia cardíaca", "bpm",
         low_watch=50, low_act=40, high_watch=100, high_act=130, pct_watch=20, pct_act=50),
    Rule(I.SPO2, "value", "spo2", "Saturación de oxígeno", "%",
         low_watch=94, low_act=90, pct_watch=3, pct_act=6),
    Rule(I.BLOOD_PRESSURE, "systolic", "blood_pressure.systolic", "Presión sistólica", "mmHg",
         low_watch=95, low_act=85, high_watch=135, high_act=160, pct_watch=12, pct_act=25),
    Rule(I.BLOOD_PRESSURE, "diastolic", "blood_pressure.diastolic", "Presión diastólica", "mmHg",
         low_watch=55, low_act=50, high_watch=88, high_act=100, pct_watch=15, pct_act=30),
    Rule(I.BODY_TEMP, "value", "body_temp", "Temperatura corporal", "°C",
         low_watch=35.5, low_act=34.5, high_watch=37.8, high_act=38.5, pct_watch=1.5, pct_act=4),
    Rule(I.RESPIRATORY_RATE, "value", "respiratory_rate", "Frecuencia respiratoria", "rpm",
         low_watch=10, low_act=8, high_watch=20, high_act=26, pct_watch=30, pct_act=60),
    Rule(I.SLEEP_METRICS, "hours", "sleep_metrics.hours", "Horas de sueño", "h",
         low_watch=6, low_act=4, pct_watch=25, pct_act=45),
    Rule(I.RADIATION_DOSE, "rate_usv_h", "radiation_dose.rate_usv_h", "Tasa de radiación", "µSv/h",
         high_watch=60, high_act=150, pct_watch=150, pct_act=400),
    Rule(I.RADIATION_DOSE, "cumulative_msv", "radiation_dose.cumulative_msv", "Dosis acumulada", "mSv",
         high_watch=50, high_act=100),
    Rule(I.BEHAVIORAL_HEALTH, "stress_score", "behavioral_health.stress_score", "Estrés (0-100)", "pts",
         high_watch=60, high_act=80, pct_watch=80, pct_act=160),
    Rule(I.BEHAVIORAL_HEALTH, "reaction_time_ms", "behavioral_health.reaction_time_ms",
         "Tiempo de reacción psicomotor", "ms",
         high_watch=350, high_act=450, pct_watch=30, pct_act=60),
]
RULES_BY_INDICATOR: dict[Indicator, list[Rule]] = {}
for _r in RULES:
    RULES_BY_INDICATOR.setdefault(_r.indicator, []).append(_r)

CALM_TICKS = 3        # evaluaciones consecutivas mejores antes de bajar de nivel (histéresis)
BASELINE_ALPHA = 0.05
MAX_PROJECTION_MIN = 7 * 24 * 60


@dataclass
class Evaluation:
    astronaut_id: str
    indicator: Indicator
    metric: str
    label: str
    unit: str
    level: Level
    previous_level: Level
    current: float
    baseline: float
    delta_value: float
    delta_pct: float
    duration_minutes: float
    minutes_to_actuar: Optional[float]
    reason: str
    t: datetime
    is_synthetic: bool = False

    @property
    def changed(self) -> bool:
        return self.level != self.previous_level

    @property
    def escalated(self) -> bool:
        return RANK[self.level] > RANK[self.previous_level]

    def to_dict(self) -> dict:
        return {
            "astronaut_id": self.astronaut_id,
            "indicator": self.indicator.value,
            "metric": self.metric,
            "label": self.label,
            "unit": self.unit,
            "level": self.level.value,
            "color": COLOR[self.level],
            "current": round(self.current, 2),
            "baseline": round(self.baseline, 2),
            "delta_value": round(self.delta_value, 2),
            "delta_pct": round(self.delta_pct, 1),
            "duration_minutes": round(self.duration_minutes, 1),
            "minutes_to_actuar": None if self.minutes_to_actuar is None else round(self.minutes_to_actuar, 1),
            "reason": self.reason,
            "effective_at": self.t.isoformat(),
            "is_synthetic": self.is_synthetic,
        }


@dataclass
class _Series:
    baseline: Optional[float] = None
    level: Level = Level.NOMINAL
    calm: int = 0
    dev_since: Optional[datetime] = None
    history: deque = field(default_factory=lambda: deque(maxlen=20))
    last: Optional[Evaluation] = None


def _abs_level(r: Rule, v: float) -> Level:
    if (r.high_act is not None and v >= r.high_act) or (r.low_act is not None and v <= r.low_act):
        return Level.ACTUAR
    if (r.high_watch is not None and v >= r.high_watch) or (r.low_watch is not None and v <= r.low_watch):
        return Level.VIGILAR
    return Level.NOMINAL


def _pct_level(r: Rule, pct: float) -> Level:
    a = abs(pct)
    if r.pct_act is not None and a >= r.pct_act:
        return Level.ACTUAR
    if r.pct_watch is not None and a >= r.pct_watch:
        return Level.VIGILAR
    return Level.NOMINAL


def _project(r: Rule, hist: deque, current: float) -> Optional[float]:
    """Regresión lineal sobre los últimos puntos -> minutos hasta el umbral ACTUAR."""
    if len(hist) < 4:
        return None
    t0 = hist[0][0]
    xs = [(t - t0).total_seconds() / 60 for t, _ in hist]
    ys = [v for _, v in hist]
    n = len(xs)
    mx, my = sum(xs) / n, sum(ys) / n
    var = sum((x - mx) ** 2 for x in xs)
    if var == 0:
        return None
    slope = sum((x - mx) * (y - my) for x, y in zip(xs, ys)) / var  # unidades / minuto
    if abs(slope) < 1e-9:
        return None
    target = r.high_act if slope > 0 else r.low_act
    if target is None or (slope > 0 and current >= target) or (slope < 0 and current <= target):
        return None
    minutes = (target - current) / slope
    return minutes if 0 < minutes <= MAX_PROJECTION_MIN else None


class RuleEngine:
    def __init__(self) -> None:
        self._series: dict[tuple[str, str], _Series] = {}

    def process(self, astronaut_id: str, indicator: Indicator, values: dict[str, float],
                t: datetime, is_synthetic: bool = False) -> list[Evaluation]:
        out = []
        for rule in RULES_BY_INDICATOR.get(indicator, []):
            if rule.value_key in values:
                out.append(self._update(astronaut_id, rule, float(values[rule.value_key]), t, is_synthetic))
        return out

    def _update(self, aid: str, r: Rule, value: float, t: datetime, synth: bool) -> Evaluation:
        st = self._series.setdefault((aid, r.metric), _Series())
        if st.baseline is None:
            st.baseline = value

        delta = value - st.baseline
        pct = delta / abs(st.baseline) * 100 if st.baseline else 0.0
        raw = max(_abs_level(r, value), _pct_level(r, pct), key=lambda l: RANK[l])

        # histéresis: subir es inmediato, bajar requiere CALM_TICKS evaluaciones mejores
        prev = st.level
        if RANK[raw] >= RANK[prev]:
            level, st.calm = raw, 0
        else:
            st.calm += 1
            if st.calm >= CALM_TICKS:
                level, st.calm = raw, 0
            else:
                level = prev

        # ¿desde cuándo se desvía? (umbral de inicio = mitad del umbral "watch" relativo)
        start_pct = (r.pct_watch or 0) * 0.5
        deviating = raw != Level.NOMINAL or (start_pct > 0 and abs(pct) >= start_pct)
        if deviating:
            st.dev_since = st.dev_since or t
        elif level == Level.NOMINAL:
            st.dev_since = None
        duration = (t - st.dev_since).total_seconds() / 60 if st.dev_since else 0.0

        st.history.append((t, value))
        projection = _project(r, st.history, value) if (deviating or level != Level.NOMINAL) else None

        base_snapshot = st.baseline
        if not deviating and level == Level.NOMINAL:  # la línea base sólo aprende en calma
            st.baseline += BASELINE_ALPHA * (value - st.baseline)

        reason = (f"{r.label} {value:.1f} {r.unit} ({delta:+.1f} / {pct:+.0f}% vs base {base_snapshot:.1f}) "
                  f"desde hace {duration:.0f} min")
        ev = Evaluation(aid, r.indicator, r.metric, r.label, r.unit, level, prev, value, base_snapshot,
                        delta, pct, duration, projection, reason, t, synth)
        st.level, st.last = level, ev
        return ev

    # ------------------------------------------------------------------ consultas
    def status(self, astronaut_id: str) -> Level:
        return worst(s.level for (a, _), s in self._series.items() if a == astronaut_id)

    def snapshot(self, astronaut_id: str) -> list[Evaluation]:
        return [s.last for (a, _), s in self._series.items() if a == astronaut_id and s.last]

    def active(self, astronaut_id: str) -> list[Evaluation]:
        evs = [e for e in self.snapshot(astronaut_id) if e.level != Level.NOMINAL]
        return sorted(evs, key=lambda e: (-RANK[e.level], -abs(e.delta_pct)))
