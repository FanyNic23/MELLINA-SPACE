"""API clínica SEWS (Space Early Warning Score) por días de misión.

La consumen el dashboard y el reloj del tripulante (frontend/, React) y el asistente Mellina.
"""
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from app.core.i18n import name as tr_name, role as tr_role, tr
from app.schemas.clinical import HealthStatusReport
from app.services.forecast import HealthForecast
from app.services.sews_dataset import SewsDataset
from app.services.sync_queue import LinkState, Priority

router = APIRouter(prefix="/api", tags=["Clínica SEWS"])


class PVTSubmission(BaseModel):
    crew_id: str
    mean_reaction_time_ms: float
    lapses_count: int


class MoodSubmission(BaseModel):
    crew_id: str
    quadrant: str  # "calm", "focused", "exhausted", "anxious"
    valence: float  # -1.0 a +1.0
    arousal: float  # -1.0 a +1.0


class CoherenceSubmission(BaseModel):
    crew_id: str
    duration_seconds: int
    coherence_pct: float


def _dataset(request: Request) -> SewsDataset:
    return request.app.state.sews


@router.get("/crew", summary="Estado SEWS más reciente de cada tripulante, con riesgos y contramedidas")
def get_crew_overview(request: Request):
    ds = _dataset(request)
    ids = ds.crew_ids()
    if not ids:
        raise HTTPException(status_code=404, detail="No hay datos de telemetría cargados.")
    return [{"crew_id": cid, "latest_record": _localized(ds.latest(cid)), "assessment": ds.report(cid)} for cid in ids]


def _localized(rec: dict) -> dict:
    return {**rec, "name": tr_name(rec.get("name", "")), "role": tr_role(rec.get("role", ""))}


@router.get("/crew/{crew_id}/assessment", response_model=HealthStatusReport,
            summary="Diagnóstico clínico detallado, riesgos y contramedidas prescritas")
def get_crew_assessment(crew_id: str, request: Request):
    report = _dataset(request).report(crew_id)
    if not report:
        raise HTTPException(status_code=404, detail=f"Tripulante {crew_id} no encontrado")
    return report


@router.get("/crew/{crew_id}/history", summary="Serie por días de misión para gráficas de tendencia")
def get_crew_history(crew_id: str, request: Request):
    rows = _dataset(request).history(crew_id)
    if rows is None:
        raise HTTPException(status_code=404, detail=f"Tripulante {crew_id} no encontrado")
    return rows


@router.get("/crew/{crew_id}/forecast", summary="Gemelo digital: proyección de salud a N días, sin y con contramedidas")
def get_crew_forecast(crew_id: str, request: Request, days: int = 30):
    if not 1 <= days <= 90:
        raise HTTPException(status_code=422, detail="days debe estar entre 1 y 90")
    result = HealthForecast(_dataset(request)).project(crew_id, days)
    if result is None:
        raise HTTPException(status_code=404, detail=f"Tripulante {crew_id} no encontrado")
    return result


@router.post("/cognitive/pvt-submit", summary="Registra un test PVT y lo encola hacia Tierra")
async def submit_pvt_test(test: PVTSubmission, request: Request):
    fatigue = test.lapses_count >= 2 or test.mean_reaction_time_ms > 350
    if fatigue:
        evaluation = tr("Fatiga severa detectada - Contramedida de descanso obligatoria prescrita.",
                        "Severe fatigue detected - mandatory rest countermeasure prescribed.")
    elif test.mean_reaction_time_ms > 280:
        evaluation = tr("Alerta leve de retardo psicomotor - Se aconseja fototerapia.",
                        "Mild psychomotor slowing - light therapy advised.")
    else:
        evaluation = tr("Óptimo", "Optimal")
    await request.app.state.sync.enqueue(
        "pvt_test", {**test.model_dump(), "evaluation": evaluation},
        Priority.HIGH if fatigue else Priority.NORMAL, test.crew_id)
    if request.app.state.sews.report(test.crew_id) is not None:
        request.app.state.routine.complete(test.crew_id, "pvt", 20)
    return {"status": "RECORDED_LOCAL_EDGE", "evaluation": evaluation,
            "reaction_time_ms": test.mean_reaction_time_ms, "lapses": test.lapses_count,
            "queued_for_earth_sync": True}


@router.post("/psych/checkin", summary="Check-in emocional de 1 toque (modelo de Russell) encolado hacia Tierra")
async def submit_mood_checkin(mood: MoodSubmission, request: Request):
    low_mood = mood.quadrant == "exhausted" or mood.valence < -0.4
    if low_mood:
        intervention = tr("Recomendada sesión de Terapia Inmersiva Terrestre (Earth VR) y ajuste circadiano.",
                          "Immersive Earth therapy (Earth VR) session and circadian adjustment recommended.")
    elif mood.quadrant == "anxious":
        intervention = tr("Recomendada sesión de 3 minutos de Coherencia Cardíaca 0.1Hz en smartwatch.",
                          "3-minute 0.1 Hz heart coherence session on the smartwatch recommended.")
    else:
        intervention = tr("Ninguna intervención requerida.", "No intervention required.")
    await request.app.state.sync.enqueue(
        "mood_checkin", {**mood.model_dump(), "intervention": intervention},
        Priority.HIGH if low_mood else Priority.NORMAL, mood.crew_id)
    return {"status": "RECORDED_LOCAL_EDGE", "mood_state": mood.quadrant, "intervention": intervention,
            "queued_for_earth_sync": True}


@router.post("/psych/coherence-submit", summary="Registra una sesión de biofeedback de coherencia cardíaca")
async def submit_coherence_session(coherence: CoherenceSubmission, request: Request):
    await request.app.state.sync.enqueue(
        "coherence_session", coherence.model_dump(), Priority.NORMAL, coherence.crew_id)
    return {"status": "COHERENCE_SESSION_LOGGED", "coherence_score": coherence.coherence_pct,
            "autonomic_balance": tr("Restaura tono parasimpático y modula respuesta de amígdala.",
                                   "Restores parasympathetic tone and modulates the amygdala response.")}


@router.get("/dtn/status", summary="Enlace Tierra-Espacio: estado, latencia y paquetes en cola")
async def get_dtn_status(request: Request):
    sync = request.app.state.sync
    return {
        "link": sync.link.value,
        "line_of_sight": sync.link == LinkState.AOS,
        "one_way_latency_minutes": request.app.state.settings.earth_one_way_latency_minutes,
        "pending_packets": await sync.pending(),
        "last_sync_at": (sync.last_drain or {}).get("at"),
    }
