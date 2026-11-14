"""Prueba de humo de extremo a extremo (sin claves externas):  python -m tests.smoke_test"""
import os
import time

os.environ.update(DATABASE_URL="sqlite+aiosqlite:///./smoke.db", SIM_TICK_SECONDS="0.05",
                  AUDIO_DIR="./audio_smoke")
if os.path.exists("smoke.db"):
    os.remove("smoke.db")

from fastapi.testclient import TestClient  # noqa: E402

from app.main import app  # noqa: E402


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
    c.post("/simulator/start")
    time.sleep(1)
    ov = c.get("/crew").json()
    print("estado inicial:", ov["crew_status"], ov["counts"])

    for kind in ("eva", "spe", "insomnia"):
        assert c.post(f"/simulator/scenarios/{kind}", json={"astronaut_ids": ["AST-0" + str(["eva", "spe", "insomnia"].index(kind) + 1)]}).status_code == 200
    alerts = wait(lambda: c.get("/alerts", params={"active": True}).json())
    time.sleep(2)
    alerts = c.get("/alerts", params={"active": True}).json()
    for a in alerts[:6]:
        print(f"  {a['astronaut_id']} {a['level']:8} {a['metric']:34} Δ={a['delta_value']:+.1f} ({a['delta_pct']:+.0f}%) {a['duration_minutes']:.0f}min -> ACTUAR en {a['minutes_to_actuar']}")
    assert any(a["level"] == "ACTUAR" for a in alerts)
    ai = wait(lambda: [a for a in c.get("/alerts", params={"active": True}).json() if a["ai_response"]])
    print("copiloto:", ai[0]["ai_response"]["source"], "|", ai[0]["ai_response"]["spoken_message"])
    print("tarjetas:", [x["title"] for x in ai[0]["ai_response"]["action_cards"]])

    d = c.get("/crew/AST-01").json()
    print("AST-01:", d["status"], "| contramedidas:", len(d["active_countermeasures"]))
    ts = c.get("/crew/AST-01/timeseries", params={"indicator": "heart_rate", "limit": 5}).json()
    assert ts["heart_rate"]
    assert c.get("/crew/AST-01/psych-history").status_code == 200

    # --- LOS / AOS
    before = c.get("/sync/status").json()
    c.post("/link", json={"state": "LOS"})
    time.sleep(1.5)
    los = c.get("/sync/status").json()
    print("LOS: pendientes", los["pending_total"], los["pending_by_priority"])
    assert los["pending_total"] > before["pending_total"]
    assert los["sent_total"] == before["sent_total"] or los["sent_total"] <= before["sent_total"] + 5
    c.post("/simulator/stop")
    r = c.post("/link", json={"state": "AOS"}).json()
    s = wait(lambda: (lambda x: x if x["pending_total"] == 0 else None)(c.get("/sync/status").json()))
    print("AOS: drenado ->", s["last_drain"], "| latencia media", s["avg_delivery_latency_s"])
    assert s["last_drain"]["packets_synced"] > 0

    # --- ingesta FHIR real
    from datetime import datetime, timezone
    from app.schemas.fhir import Indicator, build_observation
    o = build_observation("AST-02", Indicator.HEART_RATE, {"value": 71}, datetime.now(timezone.utc), False)
    r = c.post("/telemetry/observations", json=[o.model_dump(mode="json")])
    assert r.status_code == 202, r.text
    with c.websocket_connect("/ws/telemetry") as ws:
        c.post("/simulator/start")
        msg = ws.receive_json()
        print("WS:", msg["type"])
    print("OK")
