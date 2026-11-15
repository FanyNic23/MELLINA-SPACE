"""
Synthetic Telemetry Generator for Deep Space Mission Simulator
Generates a realistic 14-day timeline for 5 crew members aboard a Mars Transit Vehicle.
Includes Physical, Cognitive, Environmental, and Psychological Data.
"""

import json
import random
import os
import sys
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from app.core.crew import CREW  # noqa: E402

IDENTITY = {c["id"]: c for c in CREW}

# Arquetipo clínico de cada tripulante; nombre y rol salen de app/core/crew.py.
CREW_PROFILES = [
    {
        "id": "ASTRO-01",
        "archetype": "nominal",
        "base_hr": 64,
        "base_hrv": 55,
        "base_rt": 235,
        "muscle_loss": -1.1,
        "base_valence": 0.6,
        "base_arousal": 0.2,
        "base_coherence": 92.0,
        "sensory_risk": "BAJO"
    },
    {
        "id": "ASTRO-02",
        "archetype": "musculoskeletal_atrophy",
        "base_hr": 78,
        "base_hrv": 32,
        "base_rt": 260,
        "muscle_loss": -6.2,
        "base_valence": -0.2,
        "base_arousal": 0.5,
        "base_coherence": 68.0,
        "sensory_risk": "MODERADO"
    },
    {
        "id": "ASTRO-03",
        "archetype": "cognitive_fatigue",
        "base_hr": 72,
        "base_hrv": 24,
        "base_rt": 375,
        "muscle_loss": -2.0,
        "base_valence": -0.7,
        "base_arousal": -0.4,
        "base_coherence": 45.0,
        "sensory_risk": "SEVERO"
    },
    {
        "id": "ASTRO-04",
        "archetype": "radiation_event",
        "base_hr": 84,
        "base_hrv": 38,
        "base_rt": 250,
        "muscle_loss": -1.8,
        "base_valence": -0.1,
        "base_arousal": 0.3,
        "base_coherence": 72.0,
        "sensory_risk": "MODERADO"
    },
    {
        "id": "ASTRO-05",
        "archetype": "hypercapnia",
        "base_hr": 72,
        "base_hrv": 42,
        "base_rt": 255,
        "muscle_loss": -2.2,
        "base_valence": 0.1,
        "base_arousal": 0.1,
        "base_coherence": 80.0,
        "sensory_risk": "BAJO"
    }
]

def generate_mission_dataset(days: int = 14):
    start_time = datetime.now(timezone.utc) - timedelta(days=days)
    dataset = []

    for day in range(days):
        day_time = start_time + timedelta(days=day)

        for crew in CREW_PROFILES:
            hr = crew["base_hr"] + random.gauss(0, 3)
            hrv = max(15, crew["base_hrv"] + random.gauss(0, 4))
            rt = max(180, crew["base_rt"] + random.gauss(0, 15))
            lapses = 0
            sleep = 7.0 + random.gauss(0, 0.6)
            voice_stress = 0.2 + random.uniform(0, 0.1)
            radiation = 24.0 + random.uniform(-2, 3)
            exercise_pct = 95.0 + random.uniform(-5, 5)
            muscle_delta = crew["muscle_loss"] + (day * -0.05)
            valence = crew["base_valence"] + random.uniform(-0.05, 0.05)
            coherence = crew["base_coherence"] + random.uniform(-3, 3)
            sensory = crew["sensory_risk"]
            spo2 = random.uniform(97.0, 99.2)
            co2 = 3.1 + random.uniform(-0.3, 0.4)

            if crew["archetype"] == "musculoskeletal_atrophy":
                exercise_pct = max(30.0, 55.0 - (day * 1.5))
                muscle_delta = -4.5 - (day * 0.25)
            elif crew["archetype"] == "cognitive_fatigue" and day >= 8:
                sleep = 4.2 + random.uniform(-0.5, 0.5)
                rt = 380 + (day * 8)
                lapses = random.randint(2, 4)
                voice_stress = 0.78 + random.uniform(0, 0.12)
                hrv = 18.0 + random.uniform(0, 4)
                valence = -0.75 + random.uniform(-0.1, 0.05)
                coherence = 42.0 + random.uniform(-4, 4)
            elif crew["archetype"] == "radiation_event" and day >= 10:
                radiation = 88.5 + random.uniform(-4, 12)
            elif crew["archetype"] == "hypercapnia" and day >= 8:
                # Acumulación de CO2 en su zona de trabajo (soporte vital): cefalea, mal sueño y reflejos lentos.
                co2 = 5.0 + (day - 8) * 0.12 + random.uniform(0, 0.3)
                spo2 = 95.4 + random.uniform(-0.4, 0.4)
                sleep = 4.6 + random.uniform(-0.2, 0.2)
                rt = 290 + (day - 8) * 4 + random.uniform(-6, 6)
                lapses = random.randint(0, 1)

            record = {
                "timestamp": day_time.isoformat(),
                "mission_day": day + 1,
                "crew_id": crew["id"],
                "name": IDENTITY[crew["id"]]["name"],
                "role": IDENTITY[crew["id"]]["role"],
                "heart_rate": round(hr, 1),
                "hrv": round(hrv, 1),
                "spo2": round(spo2, 1),
                "systolic_bp": round(115 + random.gauss(0, 5), 1),
                "diastolic_bp": round(75 + random.gauss(0, 3), 1),
                "core_temp": round(36.6 + random.uniform(-0.2, 0.3), 1),
                "radiation_rate": round(radiation, 1),
                "total_radiation": round(45.0 + (day * 1.2) + (35.0 if day >= 10 and crew["archetype"] == "radiation_event" else 0), 1),
                "co2_mmhg": round(co2, 2),
                "cabin_psi": 14.7,
                "reaction_time": round(rt, 1),
                "lapses": lapses,
                "voice_stress": round(voice_stress, 2),
                "sleep_hours": round(sleep, 1),
                "muscle_delta_pct": round(muscle_delta, 2),
                "bmd_t_score": round(-0.4 - (day * 0.02), 2),
                "exercise_pct": round(exercise_pct, 1),
                "mood_valence": round(valence, 2),
                "mood_arousal": round(crew["base_arousal"], 2),
                "coherence_pct": round(coherence, 1),
                "sensory_risk": sensory
            }
            dataset.append(record)

    output_dir = os.path.join(os.path.dirname(__file__), "..", "..", "data")
    os.makedirs(output_dir, exist_ok=True)
    output_file = os.path.join(output_dir, "crew_telemetry_sample.json")

    with open(output_file, "w", encoding="utf-8") as f:
        json.dump(dataset, f, indent=2, ensure_ascii=False)

    print(f"Successfully generated {len(dataset)} telemetry records in {output_file}")
    return output_file

if __name__ == "__main__":
    generate_mission_dataset()
