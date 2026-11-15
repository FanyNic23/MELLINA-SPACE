"""
NASA Data Adapter
Design Pattern: Adapter / Transformer

Este módulo es la clave para el día del Hackatón.
Cualquier archivo o formato que entregue la NASA (CSV, JSON, NetCDF, etc.)
se mapea aquí hacia el esquema estándar 'TelemetryRecord'.
El resto de tu sistema (UI, motor clínico, contramedidas) NO necesita modificarse.
"""

from typing import Dict, Any, List
from datetime import datetime, timezone
from app.schemas.clinical import (
    TelemetryRecord,
    VitalMetrics,
    EnvironmentalMetrics,
    CognitiveMetrics,
    PsychologicalMetrics,
    MusculoskeletalMetrics
)


class NASADataAdapter:
    """
    Convierte registros heterogéneos de la NASA en modelos TelemetryRecord normalizados.
    """

    @staticmethod
    def from_hackathon_raw_dict(raw: Dict[str, Any]) -> TelemetryRecord:
        """
        Adapta un diccionario genérico (o fila de CSV convertida a dict).
        Modifica este método el día del hackatón según los nombres de columna del dataset de la NASA.
        """
        return TelemetryRecord(
            timestamp=datetime.fromisoformat(raw.get("timestamp", datetime.now(timezone.utc).isoformat())),
            crew_member_id=str(raw.get("crew_id", raw.get("subject_id", "ASTRO-01"))),
            vitals=VitalMetrics(
                heart_rate_bpm=float(raw.get("heart_rate", raw.get("hr", 72.0))),
                hrv_rmssd_ms=float(raw.get("hrv", raw.get("rmssd", 42.0))),
                blood_oxygen_pct=float(raw.get("spo2", raw.get("o2_sat", 98.0))),
                systolic_bp=float(raw.get("systolic_bp", raw.get("bp_sys", 118.0))),
                diastolic_bp=float(raw.get("diastolic_bp", raw.get("bp_dia", 78.0))),
                core_temp_c=float(raw.get("temp", raw.get("core_temp", 36.7)))
            ),
            environment=EnvironmentalMetrics(
                ambient_radiation_usv_h=float(raw.get("radiation_rate", raw.get("rad_usv", 22.5))),
                cumulative_mission_radiation_msv=float(raw.get("total_radiation", raw.get("rad_total_msv", 85.0))),
                cabin_co2_mmhg=float(raw.get("co2_mmhg", raw.get("cabin_co2", 2.8))),
                cabin_pressure_psi=float(raw.get("cabin_psi", raw.get("pressure_psi", 14.7)))
            ),
            cognitive=CognitiveMetrics(
                pvt_mean_reaction_time_ms=float(raw.get("pvt_mean_rt", raw.get("reaction_time", 240.0))),
                pvt_lapses_count=int(raw.get("pvt_lapses", raw.get("lapses", 0))),
                voice_stress_index=float(raw.get("voice_stress", raw.get("stress_score", 0.25))),
                reported_sleep_hours=float(raw.get("sleep_hours", raw.get("total_sleep", 7.2)))
            ),
            psychological=PsychologicalMetrics(
                mood_valence=float(raw.get("mood_valence", raw.get("valence", 0.1))),
                mood_arousal=float(raw.get("mood_arousal", raw.get("arousal", 0.0))),
                voice_acoustic_stress=float(raw.get("voice_stress", raw.get("stress_score", 0.25))),
                coherence_score_pct=float(raw.get("coherence_pct", 82.0)),
                sensory_deprivation_risk=str(raw.get("sensory_risk", "BAJO"))
            ),
            musculoskeletal=MusculoskeletalMetrics(
                muscle_mass_delta_pct=float(raw.get("muscle_delta_pct", raw.get("lean_mass_diff", -1.2))),
                bone_mineral_density_est_t=float(raw.get("bmd_t_score", raw.get("bone_density", -0.4))),
                daily_exercise_completed_pct=float(raw.get("exercise_pct", raw.get("ared_compliance", 95.0)))
            )
        )

    @classmethod
    def parse_batch(cls, raw_list: List[Dict[str, Any]]) -> List[TelemetryRecord]:
        return [cls.from_hackathon_raw_dict(item) for item in raw_list]
