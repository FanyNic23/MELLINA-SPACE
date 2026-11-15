"""Rutina diaria de salud y gamificación cooperativa (puntos, niveles, racha, insignias, meta de tripulación)."""
from fastapi import APIRouter, HTTPException, Request

router = APIRouter(prefix="/api/routine", tags=["Rutina y gamificación"])


def _ctx(request: Request, crew_id: str):
    st = request.app.state
    report = st.sews.report(crew_id)
    if report is None:
        raise HTTPException(404, f"Tripulante {crew_id} no encontrado")
    crew = {cid: st.sews.report(cid) for cid in st.sews.crew_ids()}
    return st.routine, report, crew


@router.get("/{crew_id}", summary="Rutina de hoy, puntos, nivel, racha, insignias y meta de la tripulación")
def get_routine(crew_id: str, request: Request):
    store, report, crew = _ctx(request, crew_id)
    return store.state(crew_id, report, crew)


@router.post("/{crew_id}/complete/{task_id}", summary="Marca una tarea de hoy como hecha")
def complete_task(crew_id: str, task_id: str, request: Request):
    store, report, crew = _ctx(request, crew_id)
    points = store.points_for(report, task_id)
    if points is None:
        raise HTTPException(404, f"La tarea {task_id} no está en la rutina de hoy")
    awarded = store.complete(crew_id, task_id, points)
    return {"awarded": points if awarded else 0, **store.state(crew_id, report, crew)}
