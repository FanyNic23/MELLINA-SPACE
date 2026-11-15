"""Chequeo diario del astronauta: él mismo registra sus mediciones y recibe su evaluación al instante.

Los valores entran por teclado, clic o cámara (pulso por video en el navegador) y el motor clínico los
evalúa en la propia nave. Si aparece una bandera roja, el resultado se encola con prioridad crítica hacia
el cirujano de vuelo; se transmitirá en la próxima ventana de enlace (DTN).
"""
from typing import Optional

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

from app.schemas.clinical import HealthStatusReport
from app.services.sync_queue import Priority

router = APIRouter(prefix="/api/checkin", tags=["Chequeo diario"])


class CheckinValues(BaseModel):
    systolic_bp: Optional[float] = Field(None, ge=60, le=250, description="Presión sistólica (mmHg)")
    diastolic_bp: Optional[float] = Field(None, ge=30, le=150, description="Presión diastólica (mmHg)")
    heart_rate: Optional[float] = Field(None, ge=30, le=220, description="Pulso en reposo (bpm)")
    pulse_source: Optional[str] = Field(None, max_length=20, description="manual | camera")
    spo2: Optional[float] = Field(None, ge=70, le=100, description="Saturación de oxígeno (%)")
    glucose_mg_dl: Optional[float] = Field(None, ge=20, le=600, description="Glucosa capilar (mg/dL)")
    core_temp: Optional[float] = Field(None, ge=32, le=43, description="Temperatura corporal (°C)")
    sleep_hours: Optional[float] = Field(None, ge=0, le=16, description="Horas de sueño")
    mood_valence: Optional[float] = Field(None, ge=-1, le=1, description="Ánimo: -1 muy mal a +1 muy bien")
    mood_arousal: Optional[float] = Field(None, ge=-1, le=1, description="Energía: -1 agotado a +1 agitado")


@router.post("/{crew_id}", response_model=HealthStatusReport, summary="Registra el chequeo y devuelve la evaluación")
async def submit_checkin(crew_id: str, body: CheckinValues, request: Request):
    st = request.app.state
    values = body.model_dump(exclude_none=True)
    if not {k for k in values if k != "pulse_source"}:
        raise HTTPException(422, "Registra al menos una medición.")
    report = st.sews.checkin(crew_id, values)
    if report is None:
        raise HTTPException(404, f"Tripulante {crew_id} no encontrado")
    st.routine.complete(crew_id, "checkin", 30)  # la rutina del día se marca sola
    priority = Priority.CRITICAL if report.escalate_to_surgeon else Priority.NORMAL
    await st.sync.enqueue("daily_checkin", {
        "crew_id": crew_id, "values": values, "sews": report.sews_score, "status": report.status_label,
        "escalate_to_surgeon": report.escalate_to_surgeon, "reasons": report.escalation_reasons,
    }, priority, crew_id)
    return report
