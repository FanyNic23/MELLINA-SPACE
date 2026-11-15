"""Prueba de humo de extremo a extremo (100% local, sin internet). Desde backend/:  python -m tests.smoke_test"""
import os
import time
from pathlib import Path

RUNTIME = Path(__file__).resolve().parents[1] / "runtime"
SMOKE_DB = RUNTIME / "smoke.db"
SMOKE_CHECKINS = RUNTIME / "smoke_checkins.json"
SMOKE_ROUTINE = RUNTIME / "smoke_routine.json"
SMOKE_MISSION = RUNTIME / "smoke_mission.json"
os.environ.update(DATABASE_URL=f"sqlite+aiosqlite:///{SMOKE_DB}", SIM_TICK_SECONDS="0.05",
                  CHECKINS_PATH=str(SMOKE_CHECKINS), ROUTINE_PATH=str(SMOKE_ROUTINE),
                  MISSION_PATH=str(SMOKE_MISSION), LOG_LEVEL="WARNING")
SMOKE_DB.unlink(missing_ok=True)
SMOKE_CHECKINS.unlink(missing_ok=True)
SMOKE_ROUTINE.unlink(missing_ok=True)
SMOKE_MISSION.unlink(missing_ok=True)

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


with TestClient(app, headers={"X-Lang": "es"}) as c:  # las comprobaciones de texto usan el español
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

    # --- sistema 100% local: sin servicios externos
    h = c.get("/health").json()
    print("health:", h)
    assert h["offline"] is True and h["stt"]["provider"] == "local"
    assert c.get("/api/assistant/status").status_code == 404  # ya no existe la IA en la nube

    # --- idioma: inglés por defecto, español con X-Lang (o ?lang=)
    en = c.get(f"/api/crew/{IDS[2]}/assessment", headers={"X-Lang": "en"}).json()
    es = c.get(f"/api/crew/{IDS[2]}/assessment").json()
    print("idioma:", en["role"], "|", es["role"], "|", en["active_countermeasures"][0]["title"])
    assert en["sews_score"] == es["sews_score"] and en["role"] != es["role"]
    assert c.get("/api/mission/environment?lang=en", headers={"X-Lang": ""}).json()["active"]["short"] != \
        c.get("/api/mission/environment").json()["active"]["short"]

    # --- panel de simulación: datos simulados -> motor clínico al instante
    base = c.get(f"/api/crew/{IDS[0]}/assessment").json()
    r = c.post(f"/api/sim/{IDS[0]}/scenario/spe").json()
    print("simulación SPE:", base["sews_score"], "->", r["sews_score"], r["status_label"])
    assert r["sews_score"] > base["sews_score"] and any("radiaci" in x.lower() for x in r["systemic_risks"])
    assert c.get("/api/crew").json()[0]["latest_record"]["is_simulated"] is True
    r = c.post(f"/api/sim/{IDS[0]}", json={"co2_mmhg": 7.5}).json()
    assert any("CO2" in x for x in r["systemic_risks"])
    assert c.post(f"/api/sim/{IDS[0]}", json={}).status_code == 422
    assert c.post(f"/api/sim/{IDS[0]}", json={"spo2": 300}).status_code == 422
    assert c.post(f"/api/sim/NADIE/scenario/spe").status_code == 404
    assert c.post(f"/api/sim/{IDS[0]}/reset").json()["sews_score"] == base["sews_score"]
    assert len(c.get("/api/sim/scenarios").json()) == 5

    # --- gemelo digital: proyección sin y con contramedidas (mismo motor SEWS)
    fc = c.get(f"/api/crew/{IDS[4]}/forecast?days=30").json()
    u, w = fc["trajectories"]["untreated"], fc["trajectories"]["with_countermeasures"]
    print("gemelo:", fc["headline"])
    assert len(u) == 31 and u[0]["report"]["sews_score"] == w[0]["report"]["sews_score"]
    assert w[-1]["report"]["sews_score"] <= u[-1]["report"]["sews_score"]
    assert c.get(f"/api/crew/{IDS[0]}/forecast?days=500").status_code == 422
    assert c.get("/api/crew/NADIE/forecast").status_code == 404

    # --- chequeo diario del astronauta + explicabilidad + aviso al cirujano de vuelo
    r = c.post(f"/api/checkin/{IDS[0]}", json={"glucose_mg_dl": 55, "core_temp": 38.9, "systolic_bp": 124,
                                                 "diastolic_bp": 80, "heart_rate": 88, "pulse_source": "camera"}).json()
    print("chequeo:", r["sews_score"], r["status_label"], "| cirujano:", r["escalation_reasons"])
    assert r["escalate_to_surgeon"] and sum(f["points"] for f in r["score_breakdown"]) == r["sews_score"]
    assert {"Glucosa", "Temperatura"} <= {f["indicator"] for f in r["score_breakdown"]}
    assert any(cm["id"] == "CM-MET-06" for cm in r["active_countermeasures"])
    assert SMOKE_CHECKINS.exists()
    assert c.post(f"/api/checkin/{IDS[0]}", json={}).status_code == 422

    # --- entorno de misión: cambia umbrales, latencia y proyección
    env = c.get("/api/mission/environment").json()
    assert env["active"]["id"] == "mars_transit" and len(env["available"]) == 5
    c.post(f"/api/sim/{IDS[1]}", json={"radiation_rate": 50})
    transit = c.get(f"/api/crew/{IDS[1]}/assessment").json()
    c.post("/api/mission/environment/lunar_base")
    lunar = c.get(f"/api/crew/{IDS[1]}/assessment").json()
    dtn = c.get("/api/dtn/status").json()
    print("entorno: radiación 50 μSv/h -> tránsito", transit["sews_score"], "· base lunar", lunar["sews_score"],
          "· latencia", dtn["one_way_latency_minutes"], "min")
    assert lunar["sews_score"] < transit["sews_score"] and dtn["one_way_latency_minutes"] < 0.1
    c.post("/api/mission/environment/mars_transit")
    c.post(f"/api/sim/{IDS[1]}/reset")
    assert c.post("/api/mission/environment/jupiter").status_code == 404

    # --- rutina y gamificación: el chequeo marcó su tarea; puntos una sola vez por día
    rt = c.get(f"/api/routine/{IDS[0]}").json()
    assert next(t for t in rt["tasks"] if t["id"] == "checkin")["done"] and rt["points"] == 30 and rt["streak"] == 1
    r1 = c.post(f"/api/routine/{IDS[0]}/complete/exercise").json()
    r2 = c.post(f"/api/routine/{IDS[0]}/complete/exercise").json()
    print("rutina:", r1["points"], "pts ·", r1["level"], "· racha", r1["streak"], "· tripulación", r1["team"]["pct"], "%")
    assert r1["awarded"] == 25 and r2["awarded"] == 0 and r2["points"] == 55
    assert c.post(f"/api/routine/{IDS[0]}/complete/inventada").status_code == 404
    assert any(b["earned"] for b in r1["badges"] if b["id"] == "first_checkin")
    assert c.post(f"/api/checkin/{IDS[0]}", json={"glucose_mg_dl": 5000}).status_code == 422

    # --- voz
    assert c.post("/api/voice/tts", json={"text": "hola"}).status_code in (404, 405)  # sin ruta (la interfaz servida en / responde 405 a POST); la voz la sintetiza el reloj localmente
    assert c.post("/api/voice/stt", files={"audio": ("x.webm", b"", "audio/webm")}).status_code == 400
    assert c.post("/api/voice/stt", files={"audio": ("x.webm", b"basura", "audio/webm")}).status_code == 422
    sample = os.environ.get("SMOKE_AUDIO")  # opcional: un wav/webm con voz para probar Whisper local
    if sample and h["stt"]["available"]:
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
