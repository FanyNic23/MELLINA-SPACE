"""API clínica SEWS (Space Early Warning Score) por días de misión.

La consumen el dashboard (frontend/index.html) y el asistente del reloj (frontend/asistente.html).
"""
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from app.schemas.clinical import HealthStatusReport
from app.services.sews_dataset import SewsDataset
from app.services.sync_queue import LinkState, Priority

router = APIRouter(prefix="/api", tags=["Clínica SEWS"])


class PVTSubmission(BaseModel):
    crew_id: str
    mean_reaction_time_ms: float
    lapses_count: int


def _dataset(request: Request) -> SewsDataset:
    return request.app.state.sews


@router.get("/crew", summary="Estado SEWS más reciente de cada tripulante, con riesgos y contramedidas")
def get_crew_overview(request: Request):
    ds = _dataset(request)
    ids = ds.crew_ids()
    if not ids:
        raise HTTPException(status_code=404, detail="No hay datos de telemetría cargados.")
    return [{"crew_id": cid, "latest_record": ds.latest(cid), "assessment": ds.report(cid)} for cid in ids]


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


@router.post("/cognitive/pvt-submit", summary="Registra un test PVT y lo encola hacia Tierra")
async def submit_pvt_test(test: PVTSubmission, request: Request):
    fatigue = test.lapses_count >= 2 or test.mean_reaction_time_ms > 350
    if fatigue:
        evaluation = "Fatiga severa detectada - Contramedida de descanso obligatoria prescrita."
    elif test.mean_reaction_time_ms > 280:
        evaluation = "Alerta leve de retardo psicomotor - Se aconseja fototerapia."
    else:
        evaluation = "Óptimo"
    await request.app.state.sync.enqueue(
        "pvt_test", {**test.model_dump(), "evaluation": evaluation},
        Priority.HIGH if fatigue else Priority.NORMAL, test.crew_id)
    return {"status": "RECORDED_LOCAL_EDGE", "evaluation": evaluation,
            "reaction_time_ms": test.mean_reaction_time_ms, "lapses": test.lapses_count,
            "queued_for_earth_sync": True}


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
