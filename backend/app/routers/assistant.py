"""Asistente del reloj: estado del modo (en línea / offline) y respuestas con IA.

En línea, el modelo de lenguaje responde con todo el contexto de la misión. Offline (o si la IA
falla) /ask responde 503 y el reloj usa sus respuestas locales; nunca queda sin respuesta.
"""
from typing import Literal, Optional

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

router = APIRouter(prefix="/api/assistant", tags=["Asistente del reloj"])

MAX_LIVE_ALERTS = 5


class Turn(BaseModel):
    role: Literal["user", "assistant"]
    text: str = Field(..., max_length=2000)


class AskRequest(BaseModel):
    crew_id: str
    lang: Literal["es", "en"] = "es"
    question: Optional[str] = Field(None, max_length=1000, description="Pregunta libre (voz o texto)")
    topic: Optional[Literal["health", "environment", "ship", "full"]] = Field(None, description="Consulta de botón")
    history: list[Turn] = Field(default_factory=list, max_length=20)


async def mission_context(request: Request, crew_id: str) -> dict:
    """Todo lo que el asistente sabe del tripulante, la nave y el enlace, en un solo dict."""
    st = request.app.state
    report, rec = st.sews.report(crew_id), st.sews.latest(crew_id)
    if not report:
        raise HTTPException(404, f"Tripulante {crew_id} no encontrado")
    live = st.service.latest.get(crew_id, {})
    return {
        "tripulante": {"id": crew_id, "nombre": report.crew_member_name, "rol": report.role},
        "sews_dia_mision": {
            "dia": report.mission_day, "indice": report.sews_score, "maximo": 15, "estado": report.status_label,
            "riesgos": report.systemic_risks,
            "contramedidas": [{"titulo": c.title, "urgencia": c.urgency, "protocolo": c.action_protocol}
                              for c in report.active_countermeasures],
            "registro": {k: rec.get(k) for k in (
                "heart_rate", "hrv", "spo2", "systolic_bp", "diastolic_bp", "core_temp", "reaction_time", "lapses",
                "sleep_hours", "voice_stress", "muscle_delta_pct", "exercise_pct", "radiation_rate", "total_radiation")},
        },
        "telemetria_en_vivo": {ind: {"valores": d["values"], "nivel": d["level"], "hora": d["effective_at"]}
                               for ind, d in live.items()},
        "alertas_en_vivo": [
            {k: e[k] for k in ("label", "level", "current", "unit", "baseline", "delta_pct", "duration_minutes",
                               "minutes_to_actuar")}
            for e in (ev.to_dict() for ev in st.rules.active(crew_id)[:MAX_LIVE_ALERTS])],
        "nave": {"presion_cabina_psi": rec.get("cabin_psi"), "co2_mmhg": rec.get("co2_mmhg")},
        "enlace_tierra": {"estado": st.sync.link.value,
                          "latencia_un_sentido_min": st.settings.earth_one_way_latency_minutes,
                          "paquetes_pendientes": await st.sync.pending()},
    }


@router.get("/status", summary="Modo actual (en línea / offline) y proveedores de IA y voz")
async def assistant_status(request: Request):
    st = request.app.state
    llm_ready = await st.llm.ready()
    return {
        "mode": "online" if llm_ready else "offline",
        "ai_mode": st.settings.ai_mode,
        "llm": {"configured": st.llm.configured, "available": llm_ready, "model": st.llm.model},
        "stt": await st.stt.status(),
        "tts": await st.tts.status(),
    }


@router.post("/ask", summary="Respuesta hablada con IA (en línea); 503 = usar respuesta local")
async def ask(body: AskRequest, request: Request):
    if not body.question and not body.topic:
        raise HTTPException(422, "Falta question o topic.")
    context = await mission_context(request, body.crew_id)
    reply = await request.app.state.assistant.ask(
        context, body.lang, body.question, body.topic, [t.model_dump() for t in body.history])
    if reply is None:
        raise HTTPException(503, "IA en línea no disponible; responde el modo offline.")
    return {"reply": reply, "source": "online", "model": request.app.state.llm.model}
