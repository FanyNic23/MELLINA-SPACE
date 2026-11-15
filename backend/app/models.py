"""
Data Models for Autonomous Health Assessment & Monitoring System (A-HAMS)
Designed for deep-space long-duration missions (NASA Space Apps Challenge)
"""

from typing import List, Optional, Dict
from pydantic import BaseModel, Field
from datetime import datetime


class VitalMetrics(BaseModel):
    heart_rate_bpm: float = Field(..., description="Frecuencia cardíaca en reposo (bpm)")
    hrv_rmssd_ms: float = Field(..., description="Variabilidad de frecuencia cardíaca (RMSSD en ms, indicador de estrés autónomo)")
    blood_oxygen_pct: float = Field(..., description="Saturación de oxígeno SpO2 (%)")
    systolic_bp: float = Field(..., description="Presión arterial sistólica (mmHg)")
    diastolic_bp: float = Field(..., description="Presión arterial diastólica (mmHg)")
    core_temp_c: float = Field(..., description="Temperatura corporal (°C)")


class EnvironmentalMetrics(BaseModel):
    ambient_radiation_usv_h: float = Field(..., description="Tasa de dosis de radiación ambiental (μSv/h)")
    cumulative_mission_radiation_msv: float = Field(..., description="Dosis acumulada en la misión (mSv)")
    cabin_co2_mmhg: float = Field(..., description="Nivel de CO2 en cabina (mmHg)")
    cabin_pressure_psi: float = Field(..., description="Presión de cabina (psi)")


class CognitiveMetrics(BaseModel):
    pvt_mean_reaction_time_ms: float = Field(..., description="Tiempo medio de reacción en test PVT (ms)")
    pvt_lapses_count: int = Field(..., description="Número de lapsos (>500ms sin respuesta, fatiga extrema)")
    voice_stress_index: float = Field(..., description="Índice de estrés acústico de voz (0.0 normal - 1.0 crítico)")
    reported_sleep_hours: float = Field(..., description="Horas de sueño registradas en las últimas 24h")


class PsychologicalMetrics(BaseModel):
    mood_valence: float = Field(0.0, description="Valencia emocional (-1.0 negativo/triste a +1.0 positivo/motivado)")
    mood_arousal: float = Field(0.0, description="Activación psicomotora (-1.0 letárgico a +1.0 agitado/ansioso)")
    voice_acoustic_stress: float = Field(0.2, description="Biomarcador de aplanamiento o distrés vocal (0.0 a 1.0)")
    coherence_score_pct: float = Field(85.0, description="Índice de coherencia cardíaca y biofeedback respiratorio (%)")
    sensory_deprivation_risk: str = Field("BAJO", description="Nivel de privación sensorial: BAJO, MODERADO, SEVERO")


class MusculoskeletalMetrics(BaseModel):
    muscle_mass_delta_pct: float = Field(..., description="Variación porcentual de masa muscular desde baseline misión")
    bone_mineral_density_est_t: float = Field(..., description="Estimación T-score densidad ósea")
    daily_exercise_completed_pct: float = Field(..., description="Porcentaje de protocolo ARED/Treadmill completado hoy")


class TelemetryRecord(BaseModel):
    timestamp: datetime
    crew_member_id: str
    vitals: VitalMetrics
    environment: EnvironmentalMetrics
    cognitive: CognitiveMetrics
    psychological: Optional[PsychologicalMetrics] = None
    musculoskeletal: MusculoskeletalMetrics


class Countermeasure(BaseModel):
    id: str
    category: str  # "Cardiovascular", "Musculoesquelético", "Neurocognitivo", "Salud Mental / Psicológica", "Inmunológico/Radiación"
    title: str
    urgency: str   # "INMEDIATA", "ALTA", "MODERADA", "PREVENTIVA"
    description: str
    action_protocol: str
    prescribed_dosage_duration: str


class HealthStatusReport(BaseModel):
    crew_member_id: str
    crew_member_name: str
    role: str
    mission_day: int
    sews_score: int = Field(..., description="Space Early Warning Score (0 a 15)")
    status_label: str = Field(..., description="NOMINAL, ALERTA_MODERADA, ALERTA_CRITICA")
    systemic_risks: List[str]
    active_countermeasures: List[Countermeasure]
    summary_clinical: str
