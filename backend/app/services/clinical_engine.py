"""
Clinical Decision Support Engine (CDSS) for Space Medicine
Implements Space Early Warning Score (SEWS) and Autonomous Countermeasure Prescriptions
Includes Multi-Modal Psychological & Cognitive Health Evaluation
"""

from typing import List, Tuple
from app.core.environments import DEFAULT_ENVIRONMENT, ENVIRONMENTS
from app.core.i18n import name as tr_name, role as tr_role, tr
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
            add(3, tr("Agotamiento neurovegetativo severo (HRV crítico < 20ms)", "Severe autonomic exhaustion (critical HRV < 20 ms)"), "HRV", f"{v.hrv_rmssd_ms:.0f} ms", "heart")
        elif v.hrv_rmssd_ms < 35:
            add(1, tr("Estrés autonómico elevado (HRV reducido)", "Elevated autonomic stress (reduced HRV)"), "HRV", f"{v.hrv_rmssd_ms:.0f} ms", "heart")
        if v.heart_rate_bpm > 100 or v.heart_rate_bpm < 45:
            add(2, tr("Arritmia o frecuencia cardíaca anormal en microgravedad", "Arrhythmia or abnormal heart rate in microgravity"), tr("Pulso", "Pulse"), f"{v.heart_rate_bpm:.0f} bpm", "heart")
        if v.systolic_bp >= 140 or v.diastolic_bp >= 90:
            add(2, tr("Hipertensión arterial (redistribución de fluidos hacia la cabeza)", "High blood pressure (headward fluid shift)"), tr("Presión arterial", "Blood pressure"),
                f"{v.systolic_bp:.0f}/{v.diastolic_bp:.0f} mmHg", "heart")
        elif v.systolic_bp < 90:
            add(2, tr("Hipotensión: riesgo de intolerancia ortostática", "Hypotension: risk of orthostatic intolerance"), tr("Presión arterial", "Blood pressure"),
                f"{v.systolic_bp:.0f}/{v.diastolic_bp:.0f} mmHg", "heart")
        if v.blood_oxygen_pct < 94:
            add(2, tr("Desaturación de oxígeno (SpO2 < 94%)", "Oxygen desaturation (SpO2 < 94%)"), "SpO2", f"{v.blood_oxygen_pct:.1f} %", "lungs")

        # 2. Metabólico e Inmunológico
        if v.glucose_mg_dl is not None:
            if v.glucose_mg_dl < 70:
                add(3, tr("Hipoglucemia (glucosa < 70 mg/dL)", "Hypoglycemia (glucose < 70 mg/dL)"), tr("Glucosa", "Glucose"), f"{v.glucose_mg_dl:.0f} mg/dL", "neuro")
            elif v.glucose_mg_dl > 180:
                add(2, tr("Hiperglucemia (glucosa > 180 mg/dL)", "Hyperglycemia (glucose > 180 mg/dL)"), tr("Glucosa", "Glucose"), f"{v.glucose_mg_dl:.0f} mg/dL", "neuro")
            elif v.glucose_mg_dl >= 126:
                add(1, tr("Glucosa elevada: resistencia a la insulina por inactividad", "High glucose: inactivity-driven insulin resistance"), tr("Glucosa", "Glucose"), f"{v.glucose_mg_dl:.0f} mg/dL", "neuro")
        if v.core_temp_c >= 38.0:
            add(2, tr("Fiebre: posible infección (sistema inmune alterado en el espacio)", "Fever: possible infection (immune system altered in space)"), tr("Temperatura", "Temperature"), f"{v.core_temp_c:.1f} °C", "radiation")
        elif v.core_temp_c < 35.5:
            add(2, tr("Hipotermia", "Hypothermia"), tr("Temperatura", "Temperature"), f"{v.core_temp_c:.1f} °C", "radiation")

        # 3. Neurocognitivo & Fatiga (PVT y Sueño)
        if c.pvt_mean_reaction_time_ms > 350 or c.pvt_lapses_count >= 3:
            add(3, tr("Riesgo elevado de fallo operacional por fatiga psicomotriz severa (PVT Lapses)", "High risk of operational error from severe psychomotor fatigue (PVT lapses)"),
                tr("Reflejos PVT", "PVT reflexes"), f"{c.pvt_mean_reaction_time_ms:.0f} ms · {c.pvt_lapses_count} {tr('lapsos', 'lapses')}", "neuro")
        elif c.pvt_mean_reaction_time_ms > 280 or c.pvt_lapses_count >= 1:
            add(1, tr("Fatiga cognitiva leve a moderada", "Mild to moderate cognitive fatigue"), tr("Reflejos PVT", "PVT reflexes"),
                f"{c.pvt_mean_reaction_time_ms:.0f} ms · {c.pvt_lapses_count} {tr('lapsos', 'lapses')}", "neuro")
        if c.reported_sleep_hours < 5.0:
            add(2, tr("Deprivación aguda de sueño (< 5h)", "Acute sleep deprivation (< 5 h)"), tr("Sueño", "Sleep"), f"{c.reported_sleep_hours:.1f} h", "neuro")
        if c.voice_stress_index > 0.75:
            add(2, tr("Indicador de distrés psicológico agudo por biomarcador vocal", "Acute psychological distress flagged by vocal biomarker"), tr("Estrés vocal", "Vocal stress"), f"{c.voice_stress_index:.2f}", "psych")

        # 4. Salud Mental, Afecto y Privación Sensorial
        if p:
            if p.mood_valence < -0.4:
                add(2, tr("Estado afectivo decaído o desánimo sostenido (Valencia negativa < -0.4)", "Low or persistently depressed mood (negative valence < -0.4)"), tr("Ánimo", "Mood"), f"{p.mood_valence:+.2f}", "psych")
            if p.voice_acoustic_stress > 0.70:
                add(2, tr("Aplanamiento prosódico vocal / Distrés emocional", "Flattened vocal prosody / emotional distress"), tr("Prosodia", "Prosody"), f"{p.voice_acoustic_stress:.2f}", "psych")
            if p.coherence_score_pct < 60.0:
                add(1, tr("Disincronía autonómica psicofisiológica (<60% coherencia)", "Psychophysiological autonomic desynchrony (< 60% coherence)"), tr("Coherencia", "Coherence"), f"{p.coherence_score_pct:.0f} %", "psych")

        # 5. Musculoesquelético & Desacondicionamiento
        if m.muscle_mass_delta_pct < -5.0:
            add(3, tr(f"Atrofia muscular acelerada ({m.muscle_mass_delta_pct:.1f}% vs baseline)", f"Accelerated muscle atrophy ({m.muscle_mass_delta_pct:.1f}% vs baseline)"), tr("Masa muscular", "Muscle mass"),
                f"{m.muscle_mass_delta_pct:.1f} %", "muscle")
        elif m.muscle_mass_delta_pct < -2.5:
            add(1, tr("Pérdida moderada de masa muscular", "Moderate muscle mass loss"), tr("Masa muscular", "Muscle mass"), f"{m.muscle_mass_delta_pct:.1f} %", "muscle")
        if m.daily_exercise_completed_pct < 50.0:
            add(2, tr("Incumplimiento crítico de protocolo de contramedidas ARED/Treadmill", "Critical non-compliance with ARED/treadmill countermeasures"), tr("Ejercicio ARED", "ARED exercise"),
                f"{m.daily_exercise_completed_pct:.0f} %", "muscle")

        # 6. Ambiental y Radiación Espacial
        env = SpaceClinicalEngine.ENV
        if e.ambient_radiation_usv_h > env["radiation_spe"]:
            add(4, tr(f"Evento de Partículas Solares (SPE) o anomalía de radiación: {e.ambient_radiation_usv_h} uSv/h",
                       f"Solar Particle Event (SPE) or radiation anomaly: {e.ambient_radiation_usv_h} uSv/h"), tr("Radiación", "Radiation"),
                f"{e.ambient_radiation_usv_h:.0f} μSv/h", "radiation")
        elif e.ambient_radiation_usv_h > env["radiation_watch"]:
            add(2, tr("Tasa de radiación cósmica galáctica por encima del umbral nominal", "Galactic cosmic radiation rate above nominal threshold"), tr("Radiación", "Radiation"),
                f"{e.ambient_radiation_usv_h:.0f} μSv/h", "radiation")
        if e.cabin_co2_mmhg > env["co2_max"]:
            add(2, tr("Hipercapnia inducida por acumulación local de CO2 en cabina", "Hypercapnia from local CO2 build-up in the cabin"), tr("CO2 cabina", "Cabin CO2"), f"{e.cabin_co2_mmhg:.1f} mmHg", "lungs")

        score = sum(f.points for f in factors)
        status = "ALERTA_CRITICA" if score >= 9 else "ALERTA_MODERADA" if score >= 5 else "NOMINAL"
        return score, [f.risk for f in factors], status, factors

    @staticmethod
    def escalation(record: TelemetryRecord, status: str) -> List[str]:
        """Banderas rojas que el astronauta no debe manejar solo: avisar al cirujano de vuelo (vía DTN)."""
        v, e = record.vitals, record.environment
        reasons = []
        if status == "ALERTA_CRITICA":
            reasons.append(tr("SEWS en nivel crítico", "SEWS at critical level"))
        if v.blood_oxygen_pct < 92:
            reasons.append(f"SpO2 {v.blood_oxygen_pct:.0f}% (< 92%)")
        if v.glucose_mg_dl is not None and (v.glucose_mg_dl < 60 or v.glucose_mg_dl > 250):
            reasons.append(tr(f"Glucosa {v.glucose_mg_dl:.0f} mg/dL fuera de rango seguro", f"Glucose {v.glucose_mg_dl:.0f} mg/dL outside safe range"))
        if v.core_temp_c >= 38.5:
            reasons.append(tr(f"Fiebre de {v.core_temp_c:.1f} °C", f"Fever of {v.core_temp_c:.1f} °C"))
        if v.systolic_bp >= 180 or v.diastolic_bp >= 110:
            reasons.append(tr(f"Crisis hipertensiva {v.systolic_bp:.0f}/{v.diastolic_bp:.0f} mmHg", f"Hypertensive crisis {v.systolic_bp:.0f}/{v.diastolic_bp:.0f} mmHg"))
        if v.heart_rate_bpm > 130 or v.heart_rate_bpm < 40:
            reasons.append(tr(f"Pulso {v.heart_rate_bpm:.0f} bpm", f"Pulse {v.heart_rate_bpm:.0f} bpm"))
        if e.ambient_radiation_usv_h > SpaceClinicalEngine.ENV["radiation_spe"]:
            reasons.append(tr("Evento de partículas solares en curso", "Solar particle event in progress"))
        return reasons

    @staticmethod
    def prescribe_countermeasures(record: TelemetryRecord, risks: List[str]) -> List[Countermeasure]:
        """
        Determina las contramedidas prescritas basadas en las directrices médicas de la NASA.
        `urgency` es un código estable (INMEDIATA, ALTA, MODERADA, PREVENTIVA); la interfaz lo traduce.
        """
        prescriptions: List[Countermeasure] = []
        p = record.psychological

        def cm(id: str, category: Tuple[str, str], title: Tuple[str, str], urgency: str, description: Tuple[str, str],
               protocol: Tuple[str, str], dosage: Tuple[str, str]) -> None:
            prescriptions.append(Countermeasure(
                id=id, category=tr(*category), title=tr(*title), urgency=urgency, description=tr(*description),
                action_protocol=tr(*protocol), prescribed_dosage_duration=tr(*dosage)))

        # Contramedida para Radiación
        env = SpaceClinicalEngine.ENV
        if record.environment.ambient_radiation_usv_h > (env["radiation_watch"] + env["radiation_spe"]) / 2:
            cm("CM-RAD-01", ("Inmunológico / Radiación", "Immune / Radiation"),
               ("Protocolo de Refugio contra Tormenta de Radiación (SPE)", "Radiation Storm Shelter Protocol (SPE)"),
               "INMEDIATA",
               ("Evacuar a la bahía de tormenta (Storm Shelter con blindaje de agua/polietileno).",
                "Evacuate to the storm shelter (water/polyethylene shielded bay)."),
               ("Desplazarse a módulo blindado central. Iniciar monitorización de dosimetría personal.",
                "Move to the central shielded module. Start personal dosimetry monitoring."),
               ("Permanecer en refugio hasta que tasa < 25 uSv/h durante 6 horas continuas.",
                "Stay sheltered until the rate is < 25 uSv/h for 6 continuous hours."))

        # Contramedida para Fatiga / PVT Lapses
        if record.cognitive.pvt_lapses_count >= 2 or record.cognitive.reported_sleep_hours < 5.5:
            cm("CM-COG-02", ("Neurocognitivo", "Neurocognitive"),
               ("Higiene Circadiana y Terapia Lumínica Dinámica", "Circadian Hygiene and Dynamic Light Therapy"),
               "ALTA",
               ("Desfase circadiano y fatiga psicomotora detectada con impacto en reflejos.",
                "Circadian misalignment and psychomotor fatigue detected, affecting reflexes."),
               ("1. Ajustar LED de cabina a 460nm (enriquecida en azul) durante horario operativo.\n"
                "2. Iniciar descanso programado de 90 min (Power Nap) previo a maniobras críticas.",
                "1. Set cabin LEDs to 460 nm (blue-enriched) during working hours.\n"
                "2. Schedule a 90-min rest (power nap) before critical maneuvers."),
               ("45 min de fototerapia matutina + ventana de sueño obligatoria de 8h.",
                "45 min of morning light therapy + mandatory 8 h sleep window."))

        # Contramedida para Salud Mental / Privación Sensorial / Distrés Emocional
        if record.vitals.hrv_rmssd_ms < 30.0 or record.cognitive.voice_stress_index > 0.70 or (p and p.mood_valence < -0.3):
            cm("CM-PSY-04", ("Salud Mental / Psicológica", "Mental Health / Psychological"),
               ("Descompresión Psico-Respiratoria y Terapia Inmersiva Terrestre (Earth VR)",
                "Breathing Decompression and Immersive Earth Therapy (Earth VR)"),
               "ALTA" if record.vitals.hrv_rmssd_ms < 22.0 else "MODERADA",
               ("Detección de sobrecarga emocional, tono simpático sostenido y privación sensorial.",
                "Emotional overload, sustained sympathetic tone and sensory deprivation detected."),
               ("1. Sesión de 3 min de Coherencia Cardíaca (0.1 Hz) guiada en el smartwatch.\n"
                "2. Inmersión de 15 min en visor VR simulando bosque templado terrestre con sonidos biofílicos.\n"
                "3. Priorización en cola DTN de paquete de audio familiar.",
                "1. 3-min guided heart coherence session (0.1 Hz) on the smartwatch.\n"
                "2. 15-min VR immersion in a temperate Earth forest with biophilic sounds.\n"
                "3. Prioritize a family audio package in the DTN queue."),
               ("1 sesión previa al período de sueño durante 3 días consecutivos.",
                "1 session before sleep for 3 consecutive days."))

        # Contramedida para Desacondicionamiento Muscular
        if record.musculoskeletal.muscle_mass_delta_pct < -3.0 or record.musculoskeletal.daily_exercise_completed_pct < 70.0:
            cm("CM-MUSC-03", ("Musculoesquelético", "Musculoskeletal"),
               ("Intensificación de Protocolo ARED (Carga Excéntrica)", "Intensified ARED Protocol (Eccentric Loading)"),
               "ALTA",
               ("Pérdida de masa en extremidades inferiores y desacondicionamiento neuromuscular.",
                "Lower-limb mass loss and neuromuscular deconditioning."),
               ("Incorporar 3 series adicionales de sentadillas y elevación de talones en ARED al 85% 1RM con enfoque excéntrico.",
                "Add 3 extra sets of squats and heel raises on ARED at 85% 1RM with an eccentric focus."),
               ("Sesión de 60 min hoy + suplemento proteico de 30g post-ejercicio.",
                "60-min session today + 30 g protein supplement after exercise."))

        # Contramedida ambiental (CO2 en cabina)
        if record.environment.cabin_co2_mmhg > SpaceClinicalEngine.ENV["co2_max"]:
            cm("CM-ENV-05", ("Ambiental / Respiratorio", "Environmental / Respiratory"),
               ("Ventilación dirigida y control del CO2 en cabina", "Targeted ventilation and cabin CO2 control"),
               "INMEDIATA" if record.environment.cabin_co2_mmhg > 6.0 else "ALTA",
               ("El CO2 se acumula en zonas sin convección natural: provoca cefalea, fatiga y menor rendimiento cognitivo.",
                "CO2 pools where there is no natural convection: it causes headache, fatigue and lower cognitive performance."),
               ("1. Activar ventiladores portátiles hacia el puesto de trabajo.\n"
                "2. Verificar el lecho de absorción de CO2 del soporte vital.\n"
                "3. Rotar turnos fuera del módulo cada 2 h.",
                "1. Point portable fans at the workstation.\n"
                "2. Check the life-support CO2 scrubber bed.\n"
                "3. Rotate shifts out of the module every 2 h."),
               ("Hasta que el CO2 local sea < 4 mmHg en dos lecturas consecutivas.",
                "Until local CO2 is < 4 mmHg on two consecutive readings."))

        v = record.vitals
        # Contramedida metabólica (glucosa)
        if v.glucose_mg_dl is not None and v.glucose_mg_dl < 70:
            cm("CM-MET-06", ("Metabólico", "Metabolic"),
               ("Corrección de hipoglucemia (regla 15-15)", "Hypoglycemia correction (15-15 rule)"),
               "INMEDIATA" if v.glucose_mg_dl < 60 else "ALTA",
               ("Glucosa capilar por debajo de 70 mg/dL: riesgo de confusión y pérdida de reflejos.",
                "Capillary glucose below 70 mg/dL: risk of confusion and slowed reflexes."),
               ("1. Tomar 15 g de carbohidrato rápido (gel de glucosa del kit médico).\n"
                "2. Repetir la medición a los 15 min.\n"
                "3. Si sigue < 70 mg/dL, repetir y avisar al oficial médico.",
                "1. Take 15 g of fast carbohydrate (glucose gel from the medical kit).\n"
                "2. Measure again after 15 min.\n"
                "3. If still < 70 mg/dL, repeat and notify the medical officer."),
               ("Ciclos de 15 min hasta glucosa ≥ 70 mg/dL; luego comida completa.",
                "15-min cycles until glucose is ≥ 70 mg/dL; then a full meal."))
        elif v.glucose_mg_dl is not None and v.glucose_mg_dl >= 126:
            cm("CM-MET-06", ("Metabólico", "Metabolic"),
               ("Control glucémico por inactividad", "Glycemic control for inactivity"),
               "ALTA" if v.glucose_mg_dl > 180 else "MODERADA",
               ("La microgravedad y la menor actividad reducen la sensibilidad a la insulina.",
                "Microgravity and lower activity reduce insulin sensitivity."),
               ("1. Completar la sesión aeróbica del día (cicloergómetro 30 min).\n"
                "2. Reducir carbohidratos simples en la próxima comida.\n"
                "3. Repetir la glucosa en ayunas mañana.",
                "1. Complete today's aerobic session (30-min cycle ergometer).\n"
                "2. Cut simple carbohydrates at the next meal.\n"
                "3. Repeat fasting glucose tomorrow."),
               ("Seguimiento diario durante 7 días.", "Daily follow-up for 7 days."))
        # Contramedida inmunológica (fiebre)
        if v.core_temp_c >= 38.0:
            cm("CM-IMM-07", ("Inmunológico", "Immune"),
               ("Protocolo de fiebre y aislamiento preventivo", "Fever protocol and preventive isolation"),
               "INMEDIATA" if v.core_temp_c >= 38.5 else "ALTA",
               ("El sistema inmune se debilita en vuelo: la fiebre puede indicar infección o reactivación viral.",
                "The immune system weakens in flight: fever may signal infection or viral reactivation."),
               ("1. Hidratación de 500 ml y antipirético del kit médico.\n"
                "2. Usar mascarilla y limitar contacto con la tripulación.\n"
                "3. Medir temperatura cada 4 h.",
                "1. Drink 500 ml and take an antipyretic from the medical kit.\n"
                "2. Wear a mask and limit contact with the crew.\n"
                "3. Check temperature every 4 h."),
               ("Hasta 24 h sin fiebre.", "Until 24 h without fever."))
        # Contramedida cardiovascular (presión arterial)
        if v.systolic_bp >= 140 or v.diastolic_bp >= 90:
            cm("CM-CV-08", ("Cardiovascular", "Cardiovascular"),
               ("Manejo de presión arterial elevada", "High blood pressure management"),
               "INMEDIATA" if v.systolic_bp >= 180 or v.diastolic_bp >= 110 else "MODERADA",
               ("El desplazamiento de fluidos hacia la cabeza eleva la presión y la carga cardíaca.",
                "The headward fluid shift raises blood pressure and cardiac load."),
               ("1. Reposo 10 min y repetir la medición.\n"
                "2. Respiración guiada 0.1 Hz durante 5 min.\n"
                "3. Reducir sodio en las próximas comidas.",
                "1. Rest 10 min and measure again.\n"
                "2. Guided 0.1 Hz breathing for 5 min.\n"
                "3. Reduce sodium at the next meals."),
               ("Dos mediciones diarias durante 3 días.", "Two readings a day for 3 days."))

        # Protocolo Nominal
        if not prescriptions:
            cm("CM-NOM-00", ("Mantenimiento", "Maintenance"),
               ("Protocolo Nominal de Vuelo Espacial", "Nominal Spaceflight Protocol"),
               "PREVENTIVA",
               ("Todos los biomarcadores fisiológicos y psicológicos se encuentran dentro de las tolerancias.",
                "All physiological and psychological biomarkers are within tolerances."),
               ("Mantener rutina estándar de 2.5 horas de ejercicio resistivo y cardiovascular. Check-in anímico regular.",
                "Keep the standard 2.5 h of resistive and cardiovascular exercise. Regular mood check-ins."),
               ("Ciclo continuo de misión.", "Ongoing for the mission."))

        return prescriptions

    @classmethod
    def evaluate_crew_member(cls, record: TelemetryRecord, name: str, role: str, mission_day: int) -> HealthStatusReport:
        score, risks, status, factors = cls.calculate_sews(record)
        escalation = cls.escalation(record, status)
        countermeasures = cls.prescribe_countermeasures(record, risks)

        if status == "NOMINAL":
            summary = tr("Estado fisiológico, cognitivo y psicológico óptimo. No se requieren intervenciones clínicas extraordinarias.",
                         "Optimal physiological, cognitive and psychological state. No extra clinical intervention needed.")
        elif status == "ALERTA_MODERADA":
            summary = tr(f"Detectados biomarcadores fuera de rango ({len(risks)} anomalías). Se requiere ejecución de contramedidas preventivas para evitar deterioro operacional.",
                         f"Out-of-range biomarkers detected ({len(risks)} anomalies). Preventive countermeasures are required to avoid operational decline.")
        else:
            summary = tr(f"CONDICIÓN CRÍTICA. El astronauta presenta descompensación multidimensional ({len(risks)} factores de riesgo). Intervención clínica y reajuste operacional inmediato.",
                         f"CRITICAL CONDITION. The astronaut shows multi-system decompensation ({len(risks)} risk factors). Immediate clinical intervention and operational adjustment.")

        return HealthStatusReport(
            crew_member_id=record.crew_member_id,
            crew_member_name=tr_name(name),
            role=tr_role(role),
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
