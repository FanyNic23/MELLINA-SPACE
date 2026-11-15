"""Prueba de humo de extremo a extremo (sin claves externas). Desde backend/:  python -m tests.smoke_test"""
import os
import time
from pathlib import Path

RUNTIME = Path(__file__).resolve().parents[1] / "runtime"
SMOKE_DB = RUNTIME / "smoke.db"
os.environ.update(DATABASE_URL=f"sqlite+aiosqlite:///{SMOKE_DB}", SIM_TICK_SECONDS="0.05",
                  AUDIO_DIR=str(RUNTIME / "audio_smoke"), LOG_LEVEL="WARNING",
                  AI_MODE="offline")  # sin red: no depende de claves ni de internet
SMOKE_DB.unlink(missing_ok=True)

from fastapi.testclient import TestClient  # noqa: E402

from app.core.crew import CREW  # noqa: E402
from app.main import app  # noqa: E402

IDS = [c["id"] for c in CREW]
# Más largo que toda la prueba: la crisis sigue activa cuando se revisan las alertas.
CRISIS = {"duration_minutes": 1440}


def wait(fn, timeout=15):
    t0 = time.time()
    while time.time() - t0 < timeout:
        r = fn()
        if r:
            return r
        time.sleep(0.2)
    raise AssertionError("timeout")


with TestClient(app) as c:
    assert c.get("/health").json()["ok"]

    # --- motor clínico SEWS (una sola llamada trae evaluación completa)
    crew = c.get("/api/crew").json()
    assert [m["crew_id"] for m in crew] == IDS
    assert all(m["assessment"]["status_label"] for m in crew)
    print("SEWS:", {m["crew_id"]: m["assessment"]["sews_score"] for m in crew})
    assert c.get(f"/api/crew/{IDS[2]}/assessment").json()["crew_member_name"] == CREW[2]["name"]
    assert len(c.get(f"/api/crew/{IDS[0]}/history").json()) > 1
    assert c.get("/api/crew/NADIE/assessment").status_code == 404

    # --- misma tripulación en el motor de tiempo real
    c.post("/simulator/start")
    time.sleep(1)
    ov = c.get("/crew").json()
    assert sorted(x["id"] for x in ov["crew"]) == IDS
    print("estado inicial:", ov["crew_status"], ov["counts"])

    for aid, kind in zip(IDS, ("eva", "spe", "insomnia")):
        assert c.post(f"/simulator/scenarios/{kind}", json={"astronaut_ids": [aid], **CRISIS}).status_code == 200
    alerts = wait(lambda: [a for a in c.get("/alerts", params={"active": True}).json() if a["level"] == "ACTUAR"])
    for a in alerts[:6]:
        print(f"  {a['astronaut_id']} {a['level']:8} {a['metric']:34} Δ={a['delta_value']:+.1f} "
              f"({a['delta_pct']:+.0f}%) {a['duration_minutes']:.0f}min -> ACTUAR en {a['minutes_to_actuar']}")
    ai = wait(lambda: [a for a in c.get("/alerts", params={"active": True}).json() if a["ai_response"]])
    print("copiloto:", ai[0]["ai_response"]["source"], "|", ai[0]["ai_response"]["spoken_message"])
    print("tarjetas:", [x["title"] for x in ai[0]["ai_response"]["action_cards"]])

    d = c.get(f"/crew/{IDS[0]}").json()
    print(f"{IDS[0]}:", d["status"], "| contramedidas:", len(d["active_countermeasures"]))
    ts = c.get(f"/crew/{IDS[0]}/timeseries", params={"indicator": "heart_rate", "limit": 5}).json()
    assert ts["heart_rate"]
    assert c.get(f"/crew/{IDS[0]}/psych-history").status_code == 200

    # --- PVT encolado hacia Tierra
    pvt = c.post("/api/cognitive/pvt-submit", json={"crew_id": IDS[2], "mean_reaction_time_ms": 410, "lapses_count": 3})
    assert pvt.json()["queued_for_earth_sync"]

    # --- LOS / AOS: el buffer crece sin señal y se vacía (y se borra) al recuperarla
    before = c.get("/sync/status").json()
    c.post("/link", json={"state": "LOS"})
    time.sleep(1.5)
    los = c.get("/sync/status").json()
    dtn = c.get("/api/dtn/status").json()
    print("LOS: pendientes", los["pending_total"], los["pending_by_priority"], "| dtn:", dtn)
    assert los["pending_total"] > before["pending_total"]
    assert dtn["link"] == "LOS" and not dtn["line_of_sight"] and dtn["pending_packets"] >= los["pending_total"]
    c.post("/simulator/stop")
    c.post("/link", json={"state": "AOS"})
    s = wait(lambda: (lambda x: x if x["pending_total"] == 0 else None)(c.get("/sync/status").json()))
    print("AOS: drenado ->", s["last_drain"], "| latencia media", s["avg_delivery_latency_s"])
    assert s["last_drain"]["packets_synced"] > 0
    assert sum(s["pending_by_priority"].values()) == 0 and s["failed_in_db"] == 0  # lo entregado ya no ocupa la tabla

    # --- ingesta FHIR real
    from datetime import datetime, timezone
    from app.schemas.fhir import Indicator, build_observation
    o = build_observation(IDS[1], Indicator.HEART_RATE, {"value": 71}, datetime.now(timezone.utc), False)
    r = c.post("/telemetry/observations", json=[o.model_dump(mode="json")])
    assert r.status_code == 202, r.text

    # --- asistente sin claves: modo offline (el reloj responde con sus plantillas locales)
    st = c.get("/api/assistant/status").json()
    print("asistente:", st["mode"], "| stt:", st["stt"]["provider"], "| tts:", st["tts"]["available"])
    assert st["mode"] == "offline" and st["stt"]["provider"] == "local" and st["tts"]["available"] is False
    assert c.post("/api/assistant/ask", json={"crew_id": IDS[0], "topic": "health"}).status_code == 503
    assert c.post("/api/assistant/ask", json={"crew_id": "NADIE", "topic": "health"}).status_code == 404
    assert c.post("/api/assistant/ask", json={"crew_id": IDS[0]}).status_code == 422

    # --- voz
    assert c.post("/api/voice/tts", json={"text": "hola"}).status_code == 503  # sin clave: el reloj usa voz del sistema
    assert c.post("/api/voice/stt", files={"audio": ("x.webm", b"", "audio/webm")}).status_code == 400
    assert c.post("/api/voice/stt", files={"audio": ("x.webm", b"basura", "audio/webm")}).status_code == 422
    sample = os.environ.get("SMOKE_AUDIO")  # opcional: un wav/webm con voz para probar Whisper local
    if sample and st["stt"]["available"]:
        with open(sample, "rb") as f:
            t = c.post("/api/voice/stt", files={"audio": (Path(sample).name, f.read(), "audio/wav")}).json()
        print("whisper:", t)
        assert t["text"]

    with c.websocket_connect("/ws/telemetry") as ws:
        c.post("/simulator/start")
        msg = ws.receive_json()
        print("WS:", msg["type"])
    print("OK")

SMOKE_DB.unlink(missing_ok=True)
