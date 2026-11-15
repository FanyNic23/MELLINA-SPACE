"""
Clinical Decision Support Engine (CDSS) for Space Medicine
Implements Space Early Warning Score (SEWS) and Autonomous Countermeasure Prescriptions
Includes Multi-Modal Psychological & Cognitive Health Evaluation
"""

from typing import List, Tuple
from app.core.environments import DEFAULT_ENVIRONMENT, ENVIRONMENTS
from app.schemas.clinical import TelemetryRecord, HealthStatusReport, Countermeasure, ScoreFactor


class SpaceClinicalEngine:
    # Entorno de misión activo (app/core/environments.py): fija los umbrales de radiación y CO2.
    ENV = ENVIRONMENTS[DEFAULT_ENVIRONMENT]

    @staticmethod
    def calculate_sews(record: TelemetryRecord) -> Tuple[int, List[str], str, List[ScoreFactor]]:
        """
        Calcula el Space Early Warning Score (SEWS) y su desglose auditable.
        Escala: 0 a 4 (Nominal), 5 a 8 (Alerta Moderada), >= 9 (Alerta Crítica).
        Cada punto queda registrado con su motivo, el valor medido y el sistema afectado.
        """
        factors: List[ScoreFactor] = []

        def add(points: int, risk: str, indicator: str, value: str, system: str) -> None:
            factors.append(ScoreFactor(points=points, risk=risk, indicator=indicator, value=value, system=system))

        v = record.vitals
        e = record.environment
        c = record.cognitive
        m = record.musculoskeletal
        p = record.psychological

        # 1. Cardiovascular y Estrés Autónomo
        if v.hrv_rmssd_ms < 20:
            add(3, "Agotamiento neurovegetativo severo (HRV crítico < 20ms)", "HRV", f"{v.hrv_rmssd_ms:.0f} ms", "heart")
        elif v.hrv_rmssd_ms < 35:
            add(1, "Estrés autonómico elevado (HRV reducido)", "HRV", f"{v.hrv_rmssd_ms:.0f} ms", "heart")
        if v.heart_rate_bpm > 100 or v.heart_rate_bpm < 45:
            add(2, "Arritmia o frecuencia cardíaca anormal en microgravedad", "Pulso", f"{v.heart_rate_bpm:.0f} bpm", "heart")
        if v.systolic_bp >= 140 or v.diastolic_bp >= 90:
            add(2, "Hipertensión arterial (redistribución de fluidos hacia la cabeza)", "Presión arterial",
                f"{v.systolic_bp:.0f}/{v.diastolic_bp:.0f} mmHg", "heart")
        elif v.systolic_bp < 90:
            add(2, "Hipotensión: riesgo de intolerancia ortostática", "Presión arterial",
                f"{v.systolic_bp:.0f}/{v.diastolic_bp:.0f} mmHg", "heart")
        if v.blood_oxygen_pct < 94:
            add(2, "Desaturación de oxígeno (SpO2 < 94%)", "SpO2", f"{v.blood_oxygen_pct:.1f} %", "lungs")

        # 2. Metabólico e Inmunológico
        if v.glucose_mg_dl is not None:
            if v.glucose_mg_dl < 70:
                add(3, "Hipoglucemia (glucosa < 70 mg/dL)", "Glucosa", f"{v.glucose_mg_dl:.0f} mg/dL", "neuro")
            elif v.glucose_mg_dl > 180:
                add(2, "Hiperglucemia (glucosa > 180 mg/dL)", "Glucosa", f"{v.glucose_mg_dl:.0f} mg/dL", "neuro")
            elif v.glucose_mg_dl >= 126:
                add(1, "Glucosa elevada: resistencia a la insulina por inactividad", "Glucosa", f"{v.glucose_mg_dl:.0f} mg/dL", "neuro")
        if v.core_temp_c >= 38.0:
            add(2, "Fiebre: posible infección (sistema inmune alterado en el espacio)", "Temperatura", f"{v.core_temp_c:.1f} °C", "radiation")
        elif v.core_temp_c < 35.5:
            add(2, "Hipotermia", "Temperatura", f"{v.core_temp_c:.1f} °C", "radiation")

        # 3. Neurocognitivo & Fatiga (PVT y Sueño)
        if c.pvt_mean_reaction_time_ms > 350 or c.pvt_lapses_count >= 3:
            add(3, "Riesgo elevado de fallo operacional por fatiga psicomotriz severa (PVT Lapses)", "Reflejos PVT",
                f"{c.pvt_mean_reaction_time_ms:.0f} ms · {c.pvt_lapses_count} lapsos", "neuro")
        elif c.pvt_mean_reaction_time_ms > 280 or c.pvt_lapses_count >= 1:
            add(1, "Fatiga cognitiva leve a moderada", "Reflejos PVT",
                f"{c.pvt_mean_reaction_time_ms:.0f} ms · {c.pvt_lapses_count} lapsos", "neuro")
        if c.reported_sleep_hours < 5.0:
            add(2, "Deprivación aguda de sueño (< 5h)", "Sueño", f"{c.reported_sleep_hours:.1f} h", "neuro")
        if c.voice_stress_index > 0.75:
            add(2, "Indicador de distrés psicológico agudo por biomarcador vocal", "Estrés vocal", f"{c.voice_stress_index:.2f}", "psych")

        # 4. Salud Mental, Afecto y Privación Sensorial
        if p:
            if p.mood_valence < -0.4:
                add(2, "Estado afectivo decaído o desánimo sostenido (Valencia negativa < -0.4)", "Ánimo", f"{p.mood_valence:+.2f}", "psych")
            if p.voice_acoustic_stress > 0.70:
                add(2, "Aplanamiento prosódico vocal / Distrés emocional", "Prosodia", f"{p.voice_acoustic_stress:.2f}", "psych")
            if p.coherence_score_pct < 60.0:
                add(1, "Disincronía autonómica psicofisiológica (<60% coherencia)", "Coherencia", f"{p.coherence_score_pct:.0f} %", "psych")

        # 5. Musculoesquelético & Desacondicionamiento
        if m.muscle_mass_delta_pct < -5.0:
            add(3, f"Atrofia muscular acelerada ({m.muscle_mass_delta_pct:.1f}% vs baseline)", "Masa muscular",
                f"{m.muscle_mass_delta_pct:.1f} %", "muscle")
        elif m.muscle_mass_delta_pct < -2.5:
            add(1, "Pérdida moderada de masa muscular", "Masa muscular", f"{m.muscle_mass_delta_pct:.1f} %", "muscle")
        if m.daily_exercise_completed_pct < 50.0:
            add(2, "Incumplimiento crítico de protocolo de contramedidas ARED/Treadmill", "Ejercicio ARED",
                f"{m.daily_exercise_completed_pct:.0f} %", "muscle")

        # 6. Ambiental y Radiación Espacial
        env = SpaceClinicalEngine.ENV
        if e.ambient_radiation_usv_h > env["radiation_spe"]:
            add(4, f"Evento de Partículas Solares (SPE) o anomalía de radiación: {e.ambient_radiation_usv_h} uSv/h", "Radiación",
                f"{e.ambient_radiation_usv_h:.0f} μSv/h", "radiation")
        elif e.ambient_radiation_usv_h > env["radiation_watch"]:
            add(2, "Tasa de radiación cósmica galáctica por encima del umbral nominal", "Radiación",
                f"{e.ambient_radiation_usv_h:.0f} μSv/h", "radiation")
        if e.cabin_co2_mmhg > env["co2_max"]:
            add(2, "Hipercapnia inducida por acumulación local de CO2 en cabina", "CO2 cabina", f"{e.cabin_co2_mmhg:.1f} mmHg", "lungs")

        score = sum(f.points for f in factors)
        status = "ALERTA_CRITICA" if score >= 9 else "ALERTA_MODERADA" if score >= 5 else "NOMINAL"
        return score, [f.risk for f in factors], status, factors

    @staticmethod
    def escalation(record: TelemetryRecord, status: str) -> List[str]:
        """Banderas rojas que el astronauta no debe manejar solo: avisar al cirujano de vuelo (vía DTN)."""
        v, e = record.vitals, record.environment
        reasons = []
        if status == "ALERTA_CRITICA":
            reasons.append("SEWS en nivel crítico")
        if v.blood_oxygen_pct < 92:
            reasons.append(f"SpO2 {v.blood_oxygen_pct:.0f}% (< 92%)")
        if v.glucose_mg_dl is not None and (v.glucose_mg_dl < 60 or v.glucose_mg_dl > 250):
            reasons.append(f"Glucosa {v.glucose_mg_dl:.0f} mg/dL fuera de rango seguro")
        if v.core_temp_c >= 38.5:
            reasons.append(f"Fiebre de {v.core_temp_c:.1f} °C")
        if v.systolic_bp >= 180 or v.diastolic_bp >= 110:
            reasons.append(f"Crisis hipertensiva {v.systolic_bp:.0f}/{v.diastolic_bp:.0f} mmHg")
        if v.heart_rate_bpm > 130 or v.heart_rate_bpm < 40:
            reasons.append(f"Pulso {v.heart_rate_bpm:.0f} bpm")
        if e.ambient_radiation_usv_h > SpaceClinicalEngine.ENV["radiation_spe"]:
            reasons.append("Evento de partículas solares en curso")
        return reasons

    @staticmethod
    def prescribe_countermeasures(record: TelemetryRecord, risks: List[str]) -> List[Countermeasure]:
        """
        Determina las contramedidas prescritas basadas en las directrices médicas de la NASA.
        """
        prescriptions: List[Countermeasure] = []
        p = record.psychological

        # Contramedida para Radiación
        env = SpaceClinicalEngine.ENV
        if record.environment.ambient_radiation_usv_h > (env["radiation_watch"] + env["radiation_spe"]) / 2:
            prescriptions.append(
                Countermeasure(
                    id="CM-RAD-01",
                    category="Inmunológico / Radiación",
                    title="Protocolo de Refugio contra Tormenta de Radiación (SPE)",
                    urgency="INMEDIATA",
                    description="Evacuar a la bahía de tormenta (Storm Shelter con blindaje de agua/polietileno).",
                    action_protocol="Desplazarse a módulo blindado central. Iniciar monitorización de dosimetría personal.",
                    prescribed_dosage_duration="Permanecer en refugio hasta que tasa < 25 uSv/h durante 6 horas continuas."
                )
            )

        # Contramedida para Fatiga / PVT Lapses
        if record.cognitive.pvt_lapses_count >= 2 or record.cognitive.reported_sleep_hours < 5.5:
            prescriptions.append(
                Countermeasure(
                    id="CM-COG-02",
                    category="Neurocognitivo",
                    title="Higiene Circadiana y Terapia Lumínica Dinámica",
                    urgency="ALTA",
                    description="Desfase circadiano y fatiga psicomotora detectada con impacto en reflejos.",
                    action_protocol="1. Ajustar LED de cabina a 460nm (enriquecida en azul) durante horario operativo.\n2. Iniciar descanso programado de 90 min (Power Nap) previo a maniobras críticas.",
                    prescribed_dosage_duration="45 min de fototerapia matutina + ventana de sueño obligatoria de 8h."
                )
            )

        # Contramedida para Salud Mental / Privación Sensorial / Distrés Emocional
        if record.vitals.hrv_rmssd_ms < 30.0 or record.cognitive.voice_stress_index > 0.70 or (p and p.mood_valence < -0.3):
            prescriptions.append(
                Countermeasure(
                    id="CM-PSY-04",
                    category="Salud Mental / Psicológica",
                    title="Descompresión Psico-Respiratoria y Terapia Inmersiva Terrestre (Earth VR)",
                    urgency="ALTA" if record.vitals.hrv_rmssd_ms < 22.0 else "MODERADA",
                    description="Detección de sobrecarga emocional, tono simpático sostenido y privación sensorial.",
                    action_protocol="1. Sesión de 3 min de Coherencia Cardíaca (0.1 Hz) guiada en el smartwatch.\n2. Inmersión de 15 min en visor VR simulando bosque templado terrestre con sonidos biofílicos.\n3. Priorización en cola DTN de paquete de audio familiar.",
                    prescribed_dosage_duration="1 sesión previa al período de sueño durante 3 días consecutivos."
                )
            )

        # Contramedida para Desacondicionamiento Muscular
        if record.musculoskeletal.muscle_mass_delta_pct < -3.0 or record.musculoskeletal.daily_exercise_completed_pct < 70.0:
            prescriptions.append(
                Countermeasure(
                    id="CM-MUSC-03",
                    category="Musculoesquelético",
                    title="Intensificación de Protocolo ARED (Carga Excéntrica)",
                    urgency="ALTA",
                    description="Pérdida de masa en extremidades inferiores y desacondicionamiento neuromuscular.",
                    action_protocol="Incorporar 3 series adicionales de sentadillas y elevación de talones en ARED al 85% 1RM con enfoque excéntrico.",
                    prescribed_dosage_duration="Sesión de 60 min hoy + suplemento proteico de 30g post-ejercicio."
                )
            )

        # Contramedida ambiental (CO2 en cabina)
        if record.environment.cabin_co2_mmhg > SpaceClinicalEngine.ENV["co2_max"]:
            prescriptions.append(Countermeasure(
                id="CM-ENV-05", category="Ambiental / Respiratorio",
                title="Ventilación dirigida y control del CO2 en cabina",
                urgency="INMEDIATA" if record.environment.cabin_co2_mmhg > 6.0 else "ALTA",
                description="El CO2 se acumula en zonas sin convección natural: provoca cefalea, fatiga y menor rendimiento cognitivo.",
                action_protocol="1. Activar ventiladores portátiles hacia el puesto de trabajo.\n2. Verificar el lecho de absorción de CO2 del soporte vital.\n3. Rotar turnos fuera del módulo cada 2 h.",
                prescribed_dosage_duration="Hasta que el CO2 local sea < 4 mmHg en dos lecturas consecutivas."))

        v = record.vitals
        # Contramedida metabólica (glucosa)
        if v.glucose_mg_dl is not None and v.glucose_mg_dl < 70:
            prescriptions.append(Countermeasure(
                id="CM-MET-06", category="Metabólico", title="Corrección de hipoglucemia (regla 15-15)",
                urgency="INMEDIATA" if v.glucose_mg_dl < 60 else "ALTA",
                description="Glucosa capilar por debajo de 70 mg/dL: riesgo de confusión y pérdida de reflejos.",
                action_protocol="1. Tomar 15 g de carbohidrato rápido (gel de glucosa del kit médico).\n2. Repetir la medición a los 15 min.\n3. Si sigue < 70 mg/dL, repetir y avisar al oficial médico.",
                prescribed_dosage_duration="Ciclos de 15 min hasta glucosa ≥ 70 mg/dL; luego comida completa."))
        elif v.glucose_mg_dl is not None and v.glucose_mg_dl >= 126:
            prescriptions.append(Countermeasure(
                id="CM-MET-06", category="Metabólico", title="Control glucémico por inactividad",
                urgency="ALTA" if v.glucose_mg_dl > 180 else "MODERADA",
                description="La microgravedad y la menor actividad reducen la sensibilidad a la insulina.",
                action_protocol="1. Completar la sesión aeróbica del día (cicloergómetro 30 min).\n2. Reducir carbohidratos simples en la próxima comida.\n3. Repetir la glucosa en ayunas mañana.",
                prescribed_dosage_duration="Seguimiento diario durante 7 días."))
        # Contramedida inmunológica (fiebre)
        if v.core_temp_c >= 38.0:
            prescriptions.append(Countermeasure(
                id="CM-IMM-07", category="Inmunológico", title="Protocolo de fiebre y aislamiento preventivo",
                urgency="INMEDIATA" if v.core_temp_c >= 38.5 else "ALTA",
                description="El sistema inmune se debilita en vuelo: la fiebre puede indicar infección o reactivación viral.",
                action_protocol="1. Hidratación de 500 ml y antipirético del kit médico.\n2. Usar mascarilla y limitar contacto con la tripulación.\n3. Medir temperatura cada 4 h.",
                prescribed_dosage_duration="Hasta 24 h sin fiebre."))
        # Contramedida cardiovascular (presión arterial)
        if v.systolic_bp >= 140 or v.diastolic_bp >= 90:
            prescriptions.append(Countermeasure(
                id="CM-CV-08", category="Cardiovascular", title="Manejo de presión arterial elevada",
                urgency="INMEDIATA" if v.systolic_bp >= 180 or v.diastolic_bp >= 110 else "MODERADA",
                description="El desplazamiento de fluidos hacia la cabeza eleva la presión y la carga cardíaca.",
                action_protocol="1. Reposo 10 min y repetir la medición.\n2. Respiración guiada 0.1 Hz durante 5 min.\n3. Reducir sodio en las próximas comidas.",
                prescribed_dosage_duration="Dos mediciones diarias durante 3 días."))

        # Protocolo Nominal
        if not prescriptions:
            prescriptions.append(
                Countermeasure(
                    id="CM-NOM-00",
                    category="Mantenimiento",
                    title="Protocolo Nominal de Vuelo Espacial",
                    urgency="PREVENTIVA",
                    description="Todos los biomarcadores fisiológicos y psicológicos se encuentran dentro de las tolerancias.",
                    action_protocol="Mantener rutina estándar de 2.5 horas de ejercicio resistivo y cardiovascular. Check-in anímico regular.",
                    prescribed_dosage_duration="Ciclo continuo de misión."
                )
            )

        return prescriptions

    @classmethod
    def evaluate_crew_member(cls, record: TelemetryRecord, name: str, role: str, mission_day: int) -> HealthStatusReport:
        score, risks, status, factors = cls.calculate_sews(record)
        escalation = cls.escalation(record, status)
        countermeasures = cls.prescribe_countermeasures(record, risks)

        if status == "NOMINAL":
            summary = "Estado fisiológico, cognitivo y psicológico óptimo. No se requieren intervenciones clínicas extraordinarias."
        elif status == "ALERTA_MODERADA":
            summary = f"Detectados biomarcadores fuera de rango ({len(risks)} anomalías). Se requiere ejecución de contramedidas preventivas para evitar deterioro operacional."
        else:
            summary = f"CONDICIÓN CRÍTICA. El astronauta presenta descompensación multidimensional ({len(risks)} factores de riesgo). Intervención clínica y reajuste operacional inmediato."

        return HealthStatusReport(
            crew_member_id=record.crew_member_id,
            crew_member_name=name,
            role=role,
            mission_day=mission_day,
            sews_score=score,
            status_label=status,
            systemic_risks=risks,
            active_countermeasures=countermeasures,
            summary_clinical=summary,
            score_breakdown=factors,
            escalate_to_surgeon=bool(escalation),
            escalation_reasons=escalation,
        )
