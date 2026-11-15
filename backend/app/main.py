"""
Autonomous Health Assessment & Monitoring System (A-HAMS) - Backend API
FastAPI local edge server for spacecraft habitat.
Includes Physical, Cognitive, Environmental, and Psychological Telemetry.
"""

import json
import os
from typing import List, Dict, Any
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from app.models import TelemetryRecord, HealthStatusReport, Countermeasure
from app.data_adapter import NASADataAdapter
from app.clinical_engine import SpaceClinicalEngine

app = FastAPI(
    title="NASA Deep Space Health & Autonomous Medical Engine",
    description="Edge clinical decision system for long-duration missions with delay-tolerant synchronization and psychological health.",
    version="1.1.0"
)

# Permitir CORS para desarrollo y UI local
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

DATA_PATH = os.path.join(os.path.dirname(__file__), "..", "..", "data", "crew_telemetry_sample.json")

def load_telemetry_data() -> List[Dict[str, Any]]:
    if not os.path.exists(DATA_PATH):
        return []
    with open(DATA_PATH, "r", encoding="utf-8") as f:
        return json.load(f)

# Mock de buffer de transmisión DTN (Store & Forward hacia Tierra)
dtn_buffer_queue = []

class PVTSubmission(BaseModel):
    crew_id: str
    mean_reaction_time_ms: float
    lapses_count: int

class MoodSubmission(BaseModel):
    crew_id: str
    quadrant: str  # "calm", "focused", "exhausted", "anxious"
    valence: float # -1.0 to +1.0
    arousal: float # -1.0 to +1.0

class CoherenceSubmission(BaseModel):
    crew_id: str
    duration_seconds: int
    coherence_pct: float


@app.get("/")
def root():
    return {
        "system": "A-HAMS Edge Medical Core",
        "mission": "Mars Transit Vehicle (MTV-1)",
        "mode": "AUTONOMOUS_OFFLINE_EDGE",
        "modules": ["Cardiovascular", "Musculoskeletal", "Neurocognitive", "Psychological", "DTN_Sync"],
        "status": "OPERATIONAL"
    }


@app.get("/api/crew")
def get_crew_overview():
    """
    Retorna el estado más reciente de cada miembro de la tripulación con su score SEWS.
    """
    raw_data = load_telemetry_data()
    if not raw_data:
        raise HTTPException(status_code=404, detail="No hay datos de telemetría cargados.")

    crew_map = {}
    for record in raw_data:
        cid = record["crew_id"]
        if cid not in crew_map or record["mission_day"] > crew_map[cid]["mission_day"]:
            crew_map[cid] = record

    results = []
    for cid, raw_rec in crew_map.items():
        telemetry = NASADataAdapter.from_hackathon_raw_dict(raw_rec)
        report = SpaceClinicalEngine.evaluate_crew_member(
            record=telemetry,
            name=raw_rec.get("name", cid),
            role=raw_rec.get("role", "Astronaut"),
            mission_day=raw_rec.get("mission_day", 1)
        )
        results.append({
            "crew_id": cid,
            "name": raw_rec.get("name", cid),
            "role": raw_rec.get("role", "Astronaut"),
            "mission_day": raw_rec.get("mission_day", 1),
            "sews_score": report.sews_score,
            "status": report.status_label,
            "risks_count": len(report.systemic_risks),
            "vitals": telemetry.vitals.dict(),
            "psychological": telemetry.psychological.dict() if telemetry.psychological else None,
            "latest_record": raw_rec
        })

    return results


@app.get("/api/crew/{crew_id}/assessment", response_model=HealthStatusReport)
def get_crew_assessment(crew_id: str):
    """
    Retorna el diagnóstico clínico detallado, riesgos y contramedidas prescritas.
    """
    raw_data = load_telemetry_data()
    member_records = [r for r in raw_data if r["crew_id"] == crew_id]
    if not member_records:
        raise HTTPException(status_code=404, detail=f"Tripulante {crew_id} no encontrado")

    latest = max(member_records, key=lambda x: x["mission_day"])
    telemetry = NASADataAdapter.from_hackathon_raw_dict(latest)

    return SpaceClinicalEngine.evaluate_crew_member(
        record=telemetry,
        name=latest.get("name", crew_id),
        role=latest.get("role", "Astronaut"),
        mission_day=latest.get("mission_day", 1)
    )


@app.get("/api/crew/{crew_id}/history")
def get_crew_history(crew_id: str):
    """
    Retorna la serie temporal de métricas a lo largo de la misión para gráficas de tendencia.
    """
    raw_data = load_telemetry_data()
    member_records = [r for r in raw_data if r["crew_id"] == crew_id]
    if not member_records:
        raise HTTPException(status_code=404, detail=f"Tripulante {crew_id} no encontrado")

    sorted_records = sorted(member_records, key=lambda x: x["mission_day"])
    return sorted_records


@app.post("/api/cognitive/pvt-submit")
def submit_pvt_test(test: PVTSubmission):
    """
    Recibe la prueba de reflejos psicomotrices realizada en vivo por el astronauta.
    """
    dtn_buffer_queue.append({
        "type": "COGNITIVE_PVT_EVENT",
        "crew_id": test.crew_id,
        "mean_rt": test.mean_reaction_time_ms,
        "lapses": test.lapses_count
    })
    
    evaluation = "Óptimo"
    if test.lapses_count >= 2 or test.mean_reaction_time_ms > 350:
        evaluation = "Fatiga severa detectada - Contramedida de descanso obligatoria prescrita."
    elif test.mean_reaction_time_ms > 280:
        evaluation = "Alerta leve de retardo psicomotor - Se aconseja fototerapia."

    return {
        "status": "RECORDED_LOCAL_EDGE",
        "evaluation": evaluation,
        "reaction_time_ms": test.mean_reaction_time_ms,
        "lapses": test.lapses_count,
        "queued_for_earth_sync": True
    }


@app.post("/api/psych/checkin")
def submit_mood_checkin(mood: MoodSubmission):
    """
    Registra el micro-checkin emocional de 1 toque (Modelo de Russell: Valencia y Arousal).
    """
    dtn_buffer_queue.append({
        "type": "MOOD_CHECKIN_EVENT",
        "crew_id": mood.crew_id,
        "quadrant": mood.quadrant,
        "valence": mood.valence,
        "arousal": mood.arousal
    })

    intervention = "Ninguna intervención requerida."
    if mood.quadrant == "exhausted" or mood.valence < -0.4:
        intervention = "Recomendada sesión de Terapia Inmersiva Terrestre (Earth VR) y ajuste circadiano."
    elif mood.quadrant == "anxious":
        intervention = "Recomendada sesión de 3 minutos de Coherencia Cardíaca 0.1Hz en smartwatch."

    return {
        "status": "RECORDED_LOCAL_EDGE",
        "mood_state": mood.quadrant,
        "intervention": intervention,
        "queued_for_earth_sync": True
    }


@app.post("/api/psych/coherence-submit")
def submit_coherence_session(coherence: CoherenceSubmission):
    """
    Registra la finalización de una sesión de biofeedback respiratorio en el smartwatch.
    """
    dtn_buffer_queue.append({
        "type": "BIOFEEDBACK_COHERENCE_EVENT",
        "crew_id": coherence.crew_id,
        "duration_sec": coherence.duration_seconds,
        "coherence_pct": coherence.coherence_pct
    })
    return {
        "status": "COHERENCE_SESSION_LOGGED",
        "coherence_score": coherence.coherence_pct,
        "autonomic_balance": "Restaura tono parasimpático y modula respuesta de amígdala."
    }


@app.get("/api/dtn/status")
def get_dtn_status():
    """
    Estado del protocolo de retardo tolerante (Store & Forward hacia Tierra).
    """
    return {
        "earth_mars_one_way_latency_minutes": 14.2,
        "uplink_window_status": "OFFLINE_LINE_OF_SIGHT_OCCLUSION",
        "pending_telemetry_packets_in_queue": len(dtn_buffer_queue) + 56,
        "local_edge_storage_used_mb": 1.4,
        "next_sync_window_utc": "2026-10-06T04:30:00Z"
    }
