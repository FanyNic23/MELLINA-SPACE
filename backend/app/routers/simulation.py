"""Panel de simulación: el operador introduce datos simulados y el motor clínico los evalúa al instante.

Sirve para probar el sistema sin sensores reales (demostración y validación): cada valor se superpone
al último registro del tripulante; `/scenario/{id}` aplica una crisis predefinida y `/reset` vuelve a
los datos de misión. Todo ocurre en memoria, en la propia nave.
"""
from typing import Optional

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

from app.core.i18n import tr
from app.schemas.clinical import HealthStatusReport

router = APIRouter(prefix="/api/sim", tags=["Panel de simulación"])


class SimValues(BaseModel):
    """Campos del registro de telemetría (mismos nombres que data/crew_telemetry_sample.json)."""
    heart_rate: Optional[float] = Field(None, ge=30, le=200)
    hrv: Optional[float] = Field(None, ge=5, le=150)
    spo2: Optional[float] = Field(None, ge=70, le=100)
    radiation_rate: Optional[float] = Field(None, ge=0, le=500)
    co2_mmhg: Optional[float] = Field(None, ge=0, le=15)
    sleep_hours: Optional[float] = Field(None, ge=0, le=12)
    reaction_time: Optional[float] = Field(None, ge=150, le=800)
    lapses: Optional[int] = Field(None, ge=0, le=10)
    voice_stress: Optional[float] = Field(None, ge=0, le=1)
    coherence_pct: Optional[float] = Field(None, ge=0, le=100)
    mood_valence: Optional[float] = Field(None, ge=-1, le=1)
    muscle_delta_pct: Optional[float] = Field(None, ge=-20, le=5)
    exercise_pct: Optional[float] = Field(None, ge=0, le=100)


# Crisis predefinidas basadas en los riesgos del NASA Human Research Program.
SCENARIOS: dict[str, dict] = {
    "spe": {"name": ("Tormenta solar (SPE)", "Solar storm (SPE)"),
            "values": {"radiation_rate": 140, "heart_rate": 104, "voice_stress": 0.78}},
    "co2": {"name": ("Fuga de CO₂ en cabina", "Cabin CO₂ leak"),
            "values": {"co2_mmhg": 7.2, "spo2": 93.5, "reaction_time": 330, "lapses": 2, "sleep_hours": 4.6}},
    "fatigue": {"name": ("Fatiga extrema / insomnio", "Extreme fatigue / insomnia"),
                "values": {"sleep_hours": 3.4, "reaction_time": 430, "lapses": 4, "hrv": 17, "coherence_pct": 50}},
    "isolation": {"name": ("Crisis por aislamiento", "Isolation crisis"),
                  "values": {"mood_valence": -0.7, "voice_stress": 0.82, "coherence_pct": 42}},
    "atrophy": {"name": ("Atrofia por microgravedad", "Microgravity atrophy"),
                "values": {"muscle_delta_pct": -7.5, "exercise_pct": 35}},
}


def _check(request: Request, crew_id: str):
    sews = request.app.state.sews
    if crew_id not in sews.crew_ids():
        raise HTTPException(404, f"Tripulante {crew_id} no encontrado")
    return sews


@router.get("/scenarios", summary="Crisis predefinidas disponibles")
def list_scenarios():
    return [{"id": k, "name": tr(*v["name"]), "values": v["values"]} for k, v in SCENARIOS.items()]


@router.post("/{crew_id}", response_model=HealthStatusReport, summary="Aplica valores simulados y reevalúa el SEWS")
def simulate(crew_id: str, body: SimValues, request: Request):
    values = body.model_dump(exclude_none=True)
    if not values:
        raise HTTPException(422, "Indica al menos un valor.")
    return _check(request, crew_id).simulate(crew_id, values)


@router.post("/{crew_id}/scenario/{scenario}", response_model=HealthStatusReport, summary="Aplica una crisis predefinida")
def apply_scenario(crew_id: str, scenario: str, request: Request):
    if scenario not in SCENARIOS:
        raise HTTPException(404, f"Escenario desconocido: {scenario}")
    return _check(request, crew_id).simulate(crew_id, SCENARIOS[scenario]["values"])


@router.post("/{crew_id}/reset", response_model=HealthStatusReport, summary="Vuelve a los datos de misión")
def reset(crew_id: str, request: Request):
    sews = _check(request, crew_id)
    sews.reset(crew_id)
    return sews.report(crew_id)
