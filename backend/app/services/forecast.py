"""Gemelo digital predictivo: proyecta la salud de cada tripulante en los próximos días de misión.

A partir del historial por días (y del chequeo o la simulación vigentes) se estima la tendencia de cada
indicador fisiológico con mínimos cuadrados y se proyecta en dos escenarios:

  · sin intervención   — la tendencia actual continúa (con límites fisiológicos).
  · con contramedidas  — los indicadores tratados por las contramedidas prescritas se recuperan hacia la
                         línea base personal del tripulante (recuperación exponencial, vida media ~4 días),
                         y la pérdida muscular se frena al ritmo que logra el ejercicio ARED.

Cada día proyectado se evalúa con el MISMO motor clínico SEWS que el día actual: la proyección es
auditable y coherente con la evaluación de hoy. Es una estimación de tendencia, no un diagnóstico.
"""
from typing import Any, Dict, List, Optional

from app.core.i18n import tr
from app.services.clinical_engine import SpaceClinicalEngine
from app.services.data_adapter import NASADataAdapter

# Indicadores que evolucionan con el tiempo: (límite inferior, límite superior, mejor dirección)
TRENDED = {
    "hrv": (12, 90, +1),
    "reaction_time": (180, 700, -1),
    "lapses": (0, 8, -1),
    "sleep_hours": (2.5, 9, +1),
    "voice_stress": (0.05, 0.98, -1),
    "coherence_pct": (20, 98, +1),
    "mood_valence": (-1, 1, +1),
    "muscle_delta_pct": (-25, 0, +1),
    "heart_rate": (45, 140, -1),
}
# Contramedida -> indicadores que recupera
TREATS = {
    "CM-COG-02": ["sleep_hours", "reaction_time", "lapses"],
    "CM-PSY-04": ["hrv", "voice_stress", "coherence_pct", "mood_valence", "heart_rate"],
    "CM-MUSC-03": ["muscle_delta_pct"],
    "CM-CV-08": ["heart_rate"],
}
HALF_LIFE_DAYS = 4.0
ARED_MUSCLE_SLOPE = -0.02          # %/día con ejercicio resistivo cumplido
MAX_MUSCLE_SLOPE = -0.35           # %/día: pérdida máxima sin contramedidas
ENVIRONMENT_RESET = {"radiation_rate": 24.0, "co2_mmhg": 3.0}  # el evento ambiental se resuelve al tratarlo


def _slope(days: List[float], values: List[float]) -> float:
    n = len(days)
    if n < 2:
        return 0.0
    mx, my = sum(days) / n, sum(values) / n
    den = sum((x - mx) ** 2 for x in days) or 1.0
    return sum((x - mx) * (y - my) for x, y in zip(days, values)) / den


def _clamp(v: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, v))


class HealthForecast:
    def __init__(self, sews) -> None:
        self.sews = sews

    def project(self, crew_id: str, days: int = 30) -> Optional[Dict[str, Any]]:
        history = self.sews.history(crew_id)
        current = self.sews.latest(crew_id)
        if not history or current is None:
            return None
        recent = history[-10:]
        x = [r["mission_day"] for r in recent]
        slopes = {k: _slope(x, [float(r[k]) for r in recent]) for k in TRENDED}
        slopes["muscle_delta_pct"] = max(MAX_MUSCLE_SLOPE, min(0.0, slopes["muscle_delta_pct"]))
        # La gravedad parcial (Luna 0.16 g, Marte 0.38 g) frena la pérdida muscular respecto a la microgravedad.
        gravity = SpaceClinicalEngine.ENV["gravity_g"]
        slopes["muscle_delta_pct"] *= max(0.3, 1 - 1.5 * gravity)
        # Línea base personal: promedio de los primeros 5 días de misión.
        baseline = {k: sum(float(r[k]) for r in history[:5]) / min(5, len(history)) for k in TRENDED}
        today = self.sews.report(crew_id)
        treated = {ind for cm in today.active_countermeasures for ind in TREATS.get(cm.id, [])}
        env_treated = any(cm.id in ("CM-RAD-01", "CM-ENV-05") for cm in today.active_countermeasures)

        def record_at(k: int, with_care: bool) -> Dict[str, Any]:
            rec = dict(current)
            rec["mission_day"] = current["mission_day"] + k
            recovery = 1 - 0.5 ** (k / HALF_LIFE_DAYS)
            for ind, (lo, hi, _) in TRENDED.items():
                now = float(current[ind])
                if with_care and ind == "muscle_delta_pct":
                    value = now + ARED_MUSCLE_SLOPE * k
                elif with_care and ind in treated:
                    value = now + (baseline[ind] - now) * recovery
                else:
                    value = now + slopes[ind] * k
                rec[ind] = round(_clamp(value, lo, hi), 2)
            rec["lapses"] = int(round(rec["lapses"]))
            if with_care:
                if env_treated:
                    for ind, safe in ENVIRONMENT_RESET.items():
                        rec[ind] = round(float(current[ind]) + (safe - float(current[ind])) * recovery, 2)
                if rec.get("exercise_pct", 100) < 85:
                    rec["exercise_pct"] = 90.0
            return rec

        def trajectory(with_care: bool) -> List[Dict[str, Any]]:
            out = []
            for k in range(days + 1):
                rec = record_at(k, with_care)
                report = SpaceClinicalEngine.evaluate_crew_member(
                    record=NASADataAdapter.from_hackathon_raw_dict(rec), name=rec.get("name", crew_id),
                    role=rec.get("role", ""), mission_day=rec["mission_day"])
                out.append({"day": k, "mission_day": rec["mission_day"], "record": rec,
                            "report": report.model_dump(mode="json")})
            return out

        untreated, care = trajectory(False), trajectory(True)

        def first_critical(traj):
            return next((t["day"] for t in traj if t["report"]["status_label"] == "ALERTA_CRITICA"), None)

        crit_untreated, crit_care = first_critical(untreated), first_critical(care)
        sews_end_u, sews_end_c = untreated[-1]["report"]["sews_score"], care[-1]["report"]["sews_score"]
        if crit_untreated == 0:
            headline = tr(f"Ya está en nivel crítico. Sin intervención llega a SEWS {sews_end_u} en {days} días; "
                          f"con las contramedidas baja a {sews_end_c}.",
                          f"Already critical. Without intervention SEWS reaches {sews_end_u} in {days} days; "
                          f"with countermeasures it drops to {sews_end_c}.")
        elif crit_untreated is not None:
            headline = tr(f"Sin intervención alcanzaría nivel crítico en {crit_untreated} días. "
                          f"Con las contramedidas: SEWS {sews_end_c} al día +{days}.",
                          f"Without intervention it would turn critical in {crit_untreated} days. "
                          f"With countermeasures: SEWS {sews_end_c} on day +{days}.")
        else:
            headline = tr(f"Sin riesgo crítico proyectado en {days} días (SEWS {sews_end_u}). "
                          f"Con las contramedidas: {sews_end_c}.",
                          f"No critical risk projected within {days} days (SEWS {sews_end_u}). "
                          f"With countermeasures: {sews_end_c}.")
        return {
            "crew_id": crew_id, "days": days, "from_mission_day": current["mission_day"],
            "days_to_critical": {"untreated": crit_untreated, "with_countermeasures": crit_care},
            "headline": headline,
            "trajectories": {"untreated": untreated, "with_countermeasures": care},
            "method": tr("Tendencia por mínimos cuadrados (últimos 10 días) evaluada día a día con el motor SEWS; "
                         "recuperación exponencial (vida media 4 días) hacia la línea base personal con contramedidas.",
                         "Least-squares trend (last 10 days) evaluated day by day with the SEWS engine; "
                         "exponential recovery (4-day half-life) toward the personal baseline with countermeasures."),
        }
