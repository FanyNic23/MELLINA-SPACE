"""API FastAPI — Monitoreo de salud biométrica y conductual de astronautas.

Ejecutar:  uvicorn app.main:app --reload      ->  http://localhost:8000/docs
"""
import logging
from contextlib import asynccontextmanager
from datetime import datetime
from typing import Optional

from fastapi import (Depends, FastAPI, File, Form, HTTPException, Query, Request, UploadFile, WebSocket,
                     WebSocketDisconnect)
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.db import SessionFactory, get_session, init_models
from app.models.telemetry import AlertRow, AstronautRow, ObservationRow
from app.schemas.api import (AlertOut, ConsultRequest, CrewItem, CrewOverview, LinkRequest, ScenarioInfo,
                             ScenarioRequest)
from app.schemas.fhir import SPECS, Indicator, Observation
from app.services.ai_copilot import AICopilot
from app.services.rule_engine import COLOR, Level, RuleEngine
from app.services.simulator import CREW, ScenarioKind, TelemetrySimulator
from app.services.sync_queue import (AwsGroundStation, GroundStation, LinkState, Priority,
                                     SimulatedGroundStation, SyncQueue)
from app.services.storage import ObjectStore
from app.services.stt import SpeechToText
from app.services.telemetry_service import TelemetryService
from app.services.ws_hub import WSHub

settings = get_settings()
logging.basicConfig(level=settings.log_level, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("main")


@asynccontextmanager
async def lifespan(app: FastAPI):
    if settings.auto_create_tables:
        await init_models()
    store = ObjectStore(settings)
    copilot, stt, hub, rules = AICopilot(settings, store), SpeechToText(settings), WSHub(), RuleEngine()
    ground: GroundStation = (AwsGroundStation(settings.sqs_queue_url, store)
                             if (settings.sqs_queue_url or settings.s3_bucket) else SimulatedGroundStation())
    sync = SyncQueue(SessionFactory, ground)
    service = TelemetryService(settings, SessionFactory, rules, copilot, sync, hub)
    await service.bootstrap(CREW)
    sim = TelemetrySimulator(settings, service, CREW)
    await sync.start()
    if settings.sim_autostart:
        sim.start()
    app.state.__dict__.update(store=store, copilot=copilot, stt=stt, hub=hub, rules=rules, sync=sync,
                              service=service, sim=sim)
    log.info("Sistema listo (ground=%s, openai=%s, elevenlabs=%s)", ground.name,
             bool(settings.openai_api_key), bool(settings.elevenlabs_api_key))
    yield
    await sim.stop()
    await service.shutdown()
    await sync.stop()
    await copilot.aclose()
    await stt.aclose()


app = FastAPI(
    title=settings.app_name,
    version="1.0.0",
    description="Backend de monitoreo biométrico/conductual de astronautas: FHIR, reglas + IA, "
                "simulador de crisis y sincronización diferida Tierra-Espacio.",
    lifespan=lifespan,
)
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


def svc(request: Request) -> TelemetryService:
    return request.app.state.service


def _crew_or_404(service: TelemetryService, astronaut_id: str) -> dict:
    a = service.astronaut(astronaut_id)
    if not a:
        raise HTTPException(404, f"Astronauta {astronaut_id} no existe")
    return a


# =================================================================== sistema
@app.get("/health", tags=["Sistema"])
async def health(request: Request):
    st = request.app.state
    return {"ok": True, "link": st.sync.link.value, "simulator_running": st.sim.running,
            "openai": bool(settings.openai_api_key), "elevenlabs": bool(settings.elevenlabs_api_key),
            "stt_provider": settings.stt_provider, "s3": st.store.s3_enabled}


@app.get("/audio/{filename}", tags=["Sistema"], summary="Audio generado para el casco (mp3)")
async def get_audio(filename: str, request: Request):
    p = request.app.state.store.path_of(filename)
    if not p:
        raise HTTPException(404, "Audio no encontrado")
    return FileResponse(p, media_type="audio/mpeg")


# =================================================================== Módulo A: ingesta FHIR real
@app.post("/telemetry/observations", tags=["Telemetría"], status_code=202,
          summary="Ingesta de Observations FHIR (sensores reales; is_synthetic=false por defecto)")
async def ingest_observations(observations: list[Observation], request: Request):
    try:
        result = await svc(request).ingest_observations(observations)
    except KeyError as e:
        raise HTTPException(404, str(e))
    except ValueError as e:
        raise HTTPException(422, str(e))
    return {"accepted": len(observations), "per_astronaut": result}


@app.get("/fhir/indicators", tags=["Telemetría"], summary="Los 8 indicadores y sus códigos FHIR")
async def indicators():
    return {k.value: v.model_dump() for k, v in SPECS.items()}


# =================================================================== Módulo D: dashboard
@app.get("/crew", response_model=CrewOverview, tags=["Dashboard"], summary="Vista general de la tripulación")
async def crew_overview(request: Request, session: AsyncSession = Depends(get_session)):
    st = request.app.state
    alerts = (await session.scalars(select(AlertRow).where(AlertRow.is_active.is_(True))
                                    .order_by(AlertRow.created_at.desc()))).all()
    by_astro: dict[str, list[AlertRow]] = {}
    for a in alerts:
        by_astro.setdefault(a.astronaut_id, []).append(a)
    crew, counts = [], {l.value: 0 for l in Level}
    for aid, info in st.service._astronauts.items():
        level = st.rules.status(aid)
        counts[level.value] += 1
        latest = {ind: {"values": d["values"], "level": d["level"], "effective_at": d["effective_at"],
                        "is_synthetic": d["is_synthetic"]} for ind, d in st.service.latest[aid].items()}
        crew.append(CrewItem(**info, status=level.value, color=COLOR[level],
                             active_alerts=[AlertOut.model_validate(a) for a in by_astro.get(aid, [])],
                             latest=latest))
    from app.services.rule_engine import worst
    return CrewOverview(link=st.sync.link.value, crew_status=worst(Level(c.status) for c in crew).value,
                        counts=counts, crew=crew)


@app.get("/crew/{astronaut_id}", tags=["Dashboard"], summary="Vista individual detallada")
async def crew_detail(astronaut_id: str, request: Request, session: AsyncSession = Depends(get_session)):
    st = request.app.state
    info = _crew_or_404(st.service, astronaut_id)
    level = st.rules.status(astronaut_id)
    active = (await session.scalars(select(AlertRow).where(AlertRow.astronaut_id == astronaut_id,
                                                           AlertRow.is_active.is_(True))
                                    .order_by(AlertRow.created_at.desc()))).all()
    countermeasures, seen = [], set()
    for a in active:  # varias alertas comparten el mismo consejo: se deduplica por título
        for card in (a.ai_response or {}).get("action_cards", []):
            if card["title"] not in seen:
                seen.add(card["title"])
                countermeasures.append({**card, "alert_id": str(a.id), "metric": a.metric})
    return {
        **info, "status": level.value, "color": COLOR[level],
        "latest_fhir": {k: v["resource"] for k, v in st.service.latest[astronaut_id].items()},
        "evaluations": [e.to_dict() for e in st.rules.snapshot(astronaut_id)],
        "active_alerts": [AlertOut.model_validate(a).model_dump(mode="json") for a in active],
        "active_countermeasures": countermeasures,
    }


@app.get("/crew/{astronaut_id}/timeseries", tags=["Dashboard"],
         summary="Serie temporal de un indicador (o de los 8 si se omite)")
async def timeseries(astronaut_id: str, request: Request, indicator: Optional[Indicator] = None,
                     limit: int = Query(200, ge=1, le=5000), since: Optional[datetime] = None,
                     fhir: bool = Query(False, description="Devolver recursos FHIR completos"),
                     session: AsyncSession = Depends(get_session)):
    _crew_or_404(svc(request), astronaut_id)
    inds = [indicator] if indicator else list(Indicator)
    out = {}
    for ind in inds:
        q = select(ObservationRow).where(ObservationRow.astronaut_id == astronaut_id,
                                         ObservationRow.indicator == ind.value)
        if since:
            q = q.where(ObservationRow.effective_at >= since)
        rows = (await session.scalars(q.order_by(ObservationRow.effective_at.desc()).limit(limit))).all()[::-1]
        out[ind.value] = [r.resource if fhir else
                          {"t": r.effective_at, "values": r.values, "level": r.danger_level,
                           "is_synthetic": r.is_synthetic} for r in rows]
    return out


@app.get("/crew/{astronaut_id}/psych-history", tags=["Dashboard"],
         summary="Historial psicológico: estrés/ánimo + intervenciones del copiloto")
async def psych_history(astronaut_id: str, request: Request, limit: int = Query(50, ge=1, le=500),
                        session: AsyncSession = Depends(get_session)):
    _crew_or_404(svc(request), astronaut_id)
    beh = (await session.scalars(select(ObservationRow).where(
        ObservationRow.astronaut_id == astronaut_id, ObservationRow.indicator == Indicator.BEHAVIORAL_HEALTH.value)
        .order_by(ObservationRow.effective_at.desc()).limit(limit))).all()[::-1]
    interventions = (await session.scalars(select(AlertRow).where(
        AlertRow.astronaut_id == astronaut_id, AlertRow.ai_response.is_not(None))
        .order_by(AlertRow.created_at.desc()).limit(limit))).all()
    return {
        "behavioral": [{"t": r.effective_at, **r.values, "level": r.danger_level} for r in beh],
        "interventions": [{"alert_id": str(a.id), "at": a.created_at, "level": a.level, "metric": a.metric,
                           "psychological_support": a.ai_response.get("psychological_support"),
                           "spoken_message": a.ai_response.get("spoken_message"), "audio_url": a.audio_url}
                          for a in interventions],
    }


@app.get("/alerts", response_model=list[AlertOut], tags=["Dashboard"])
async def list_alerts(active: Optional[bool] = None, astronaut_id: Optional[str] = None,
                      level: Optional[Level] = None, limit: int = Query(100, ge=1, le=1000),
                      session: AsyncSession = Depends(get_session)):
    q = select(AlertRow)
    if active is not None:
        q = q.where(AlertRow.is_active.is_(active))
    if astronaut_id:
        q = q.where(AlertRow.astronaut_id == astronaut_id)
    if level:
        q = q.where(AlertRow.level == level.value)
    return (await session.scalars(q.order_by(AlertRow.created_at.desc()).limit(limit))).all()


@app.websocket("/ws/telemetry")
async def ws_crew(ws: WebSocket):
    """Eventos de toda la tripulación: telemetry | alert | copilot | alert_resolved | link."""
    hub: WSHub = ws.app.state.hub
    await hub.connect(ws, "all")
    try:
        while True:
            await ws.receive_text()
    except WebSocketDisconnect:
        hub.disconnect(ws, "all")


@app.websocket("/ws/crew/{astronaut_id}")
async def ws_astronaut(ws: WebSocket, astronaut_id: str):
    hub: WSHub = ws.app.state.hub
    await hub.connect(ws, astronaut_id)
    try:
        while True:
            await ws.receive_text()
    except WebSocketDisconnect:
        hub.disconnect(ws, astronaut_id)


# =================================================================== Módulo C: copiloto / voz
@app.post("/copilot/consult", tags=["Copiloto IA"],
          summary="Consulta manual al copiloto (análisis + audio ElevenLabs + tarjetas)")
async def consult(body: ConsultRequest, request: Request):
    service = svc(request)
    _crew_or_404(service, body.astronaut_id)
    return await service.consult_now(body.astronaut_id, body.text)


@app.post("/voice/command", tags=["Copiloto IA"],
          summary="Comando de voz del astronauta: STT -> copiloto -> TTS")
async def voice_command(request: Request, astronaut_id: str = Form(...), audio: UploadFile = File(...)):
    st = request.app.state
    _crew_or_404(st.service, astronaut_id)
    data = await audio.read()
    if not data:
        raise HTTPException(400, "Audio vacío")
    try:
        transcript = await st.stt.transcribe(data, audio.filename or "voice.webm", audio.content_type or "")
    except Exception as e:
        log.exception("STT falló")
        raise HTTPException(502, f"STT no disponible: {e}")
    if not transcript:
        raise HTTPException(422, "No se detectó voz")
    reply = await st.service.consult_now(astronaut_id, transcript)
    await st.sync.enqueue("voice_log", {"astronaut_id": astronaut_id, "transcript": transcript, "reply": reply},
                          Priority.LOW, astronaut_id, False)
    return {"transcript": transcript, "reply": reply}


# =================================================================== Módulo B: simulador
@app.post("/simulator/start", tags=["Simulador"])
async def sim_start(request: Request):
    return {"started": request.app.state.sim.start(), **request.app.state.sim.status()}


@app.post("/simulator/stop", tags=["Simulador"])
async def sim_stop(request: Request):
    await request.app.state.sim.stop()
    return request.app.state.sim.status()


@app.get("/simulator/status", tags=["Simulador"])
async def sim_status(request: Request):
    return request.app.state.sim.status()


@app.post("/simulator/scenarios/{kind}", response_model=ScenarioInfo, tags=["Simulador"],
          summary="Detona una crisis: spe | insomnia | eva")
async def sim_scenario(kind: ScenarioKind, request: Request, body: ScenarioRequest = ScenarioRequest()):
    sim: TelemetrySimulator = request.app.state.sim
    try:
        ids = sim.trigger(kind, body.astronaut_ids, body.duration_minutes, body.intensity)
    except KeyError as e:
        raise HTTPException(404, f"Astronautas desconocidos: {e.args[0]}")
    if not sim.running:
        sim.start()  # una crisis necesita telemetría fluyendo
    return ScenarioInfo(kind=kind, triggered_for=ids)


@app.delete("/simulator/scenarios", tags=["Simulador"], summary="Cancela todos los escenarios activos")
async def sim_clear(request: Request):
    request.app.state.sim.clear()
    return request.app.state.sim.status()


# =================================================================== Módulo E: enlace Tierra-Espacio
@app.get("/link", tags=["Sincronización Tierra-Espacio"])
async def link_state(request: Request):
    return {"link": request.app.state.sync.link.value}


@app.post("/link", tags=["Sincronización Tierra-Espacio"],
          summary="Alterna AOS (señal) / LOS (pérdida de señal)")
async def set_link(body: LinkRequest, request: Request):
    st = request.app.state
    result = await st.sync.set_link(body.state)
    await st.hub.publish({"type": "link", "state": body.state.value})
    return result


@app.get("/sync/status", tags=["Sincronización Tierra-Espacio"],
         summary="Métricas de la cola: pendientes, sincronizados, latencia, último drenado")
async def sync_status(request: Request):
    return await request.app.state.sync.status()
