"""
Clinical Decision Support Engine (CDSS) for Space Medicine
Implements Space Early Warning Score (SEWS) and Autonomous Countermeasure Prescriptions
Includes Multi-Modal Psychological & Cognitive Health Evaluation
"""

from typing import List, Tuple
from app.schemas.clinical import TelemetryRecord, HealthStatusReport, Countermeasure


class SpaceClinicalEngine:
    @staticmethod
    def calculate_sews(record: TelemetryRecord) -> Tuple[int, List[str], str]:
        """
        Calcula el Space Early Warning Score (SEWS).
        Escala: 0 a 4 (Nominal), 5 a 8 (Alerta Moderada), >= 9 (Alerta Crítica).
        """
        score = 0
        risks = []

        v = record.vitals
        e = record.environment
        c = record.cognitive
        m = record.musculoskeletal
        p = record.psychological

        # 1. Cardiovascular y Estrés Autónomo (HRV)
        if v.hrv_rmssd_ms < 20:
            score += 3
            risks.append("Agotamiento neurovegetativo severo (HRV crítico < 20ms)")
        elif v.hrv_rmssd_ms < 35:
            score += 1
            risks.append("Estrés autonómico elevado (HRV reducido)")

        if v.heart_rate_bpm > 100 or v.heart_rate_bpm < 45:
            score += 2
            risks.append("Arritmia o frecuencia cardíaca anormal en microgravedad")

        # 2. Neurocognitivo & Fatiga (PVT y Sueño)
        if c.pvt_mean_reaction_time_ms > 350 or c.pvt_lapses_count >= 3:
            score += 3
            risks.append("Riesgo elevado de fallo operacional por fatiga psicomotriz severa (PVT Lapses)")
        elif c.pvt_mean_reaction_time_ms > 280 or c.pvt_lapses_count >= 1:
            score += 1
            risks.append("Fatiga cognitiva leve a moderada")

        if c.reported_sleep_hours < 5.0:
            score += 2
            risks.append("Deprivación aguda de sueño (< 5h)")

        if c.voice_stress_index > 0.75:
            score += 2
            risks.append("Indicador de distrés psicológico agudo por biomarcador vocal")

        # 3. Salud Mental, Afecto y Privación Sensorial
        if p:
            if p.mood_valence < -0.4:
                score += 2
                risks.append("Estado afectivo decaído o desánimo sostenido (Valencia negativa < -0.4)")
            if p.voice_acoustic_stress > 0.70:
                score += 2
                risks.append("Aplanamiento prosódico vocal / Distrés emocional")
            if p.coherence_score_pct < 60.0:
                score += 1
                risks.append("Disincronía autonómica psicofisiológica (<60% coherencia)")

        # 4. Musculoesquelético & Desacondicionamiento
        if m.muscle_mass_delta_pct < -5.0:
            score += 3
            risks.append(f"Atrofia muscular acelerada ({m.muscle_mass_delta_pct:.1f}% vs baseline)")
        elif m.muscle_mass_delta_pct < -2.5:
            score += 1
            risks.append("Pérdida moderada de masa muscular")

        if m.daily_exercise_completed_pct < 50.0:
            score += 2
            risks.append("Incumplimiento crítico de protocolo de contramedidas ARED/Treadmill")

        # 5. Ambiental y Radiación Espacial
        if e.ambient_radiation_usv_h > 80.0:
            score += 4
            risks.append(f"Evento de Partículas Solares (SPE) o anomalía de radiación: {e.ambient_radiation_usv_h} uSv/h")
        elif e.ambient_radiation_usv_h > 35.0:
            score += 2
            risks.append("Tasa de radiación cósmica galáctica por encima del umbral nominal")

        if e.cabin_co2_mmhg > 4.0:
            score += 2
            risks.append("Hipercapnia inducida por acumulación local de CO2 en cabina")

        # Clasificación
        if score >= 9:
            status = "ALERTA_CRITICA"
        elif score >= 5:
            status = "ALERTA_MODERADA"
        else:
            status = "NOMINAL"

        return score, risks, status

    @staticmethod
    def prescribe_countermeasures(record: TelemetryRecord, risks: List[str]) -> List[Countermeasure]:
        """
        Determina las contramedidas prescritas basadas en las directrices médicas de la NASA.
        """
        prescriptions: List[Countermeasure] = []
        p = record.psychological

        # Contramedida para Radiación
        if record.environment.ambient_radiation_usv_h > 50.0:
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
        score, risks, status = cls.calculate_sews(record)
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
            summary_clinical=summary
        )
