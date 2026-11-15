/*
 * A-HAMS · Mapa clínico del cuerpo: sistemas SEWS, porcentaje de daño por órgano y amenazas
 * del espacio profundo (riesgos del NASA Human Research Program) que los afectan.
 *
 * Los niveles de los sistemas usan los umbrales de backend/app/services/clinical_engine.py.
 * El porcentaje de daño (0-100) está calibrado para que ~35 % coincida con "vigilar" y ~70 %
 * con "crítico" en esos mismos umbrales.
 *
 *   ClinicalMap.SYSTEMS   [{ id, label, organ, level(a), damage(a), detail(a), metrics(a) }]
 *   ClinicalMap.HAZARDS   [{ id, name, icon (nombre en icons.js), summary, systems, effect, severity(a), metrics(a) }]
 *   ClinicalMap.systemForRisk(texto) -> id de sistema para un riesgo del diagnóstico
 */
(function (global) {
  'use strict';

  const clamp = v => Math.max(0, Math.min(100, Math.round(v)));
  const levelOf = pct => (pct >= 70 ? 2 : pct >= 35 ? 1 : 0);
  const SENSORY = { BAJO: 10, MODERADO: 45, SEVERO: 80 };

  // Componentes de daño reutilizados por sistemas y amenazas.
  const D = {
    reaction: a => (a.cognitive.rt - 200) * (70 / 150),
    lapses: a => a.cognitive.lapses * 24,
    sleep: a => (8 - a.cognitive.sleep) * 23.3,
    voice: a => a.psych.voice * 100,
    coherence: a => (100 - a.psych.coherence) * 1.75,
    sensory: a => SENSORY[a.psych.sensory] ?? 0,
    hrv: a => (60 - a.vitals.hrv) * 1.75,
    hr: a => (a.vitals.hr > 100 || a.vitals.hr < 45 ? 75 : 0),
    spo2: a => (99 - a.vitals.spo2) * 14,
    co2: a => (a.environment.co2 - 1.5) * 14,
    atrophy: a => -a.muscle.delta * 14,
    exercise: a => (100 - a.muscle.exercise_pct) * 1.4,
    radiation: a => a.environment.radiation,
  };
  const worst = (a, keys) => clamp(Math.max(...keys.map(k => D[k](a))));

  const SYSTEMS = [
    {
      id: 'neuro', label: 'Cerebro · Neurocognitivo', organ: 'Corteza cerebral',
      level: a => (a.cognitive.rt > 350 || a.cognitive.lapses >= 3 || a.cognitive.sleep < 5) ? 2
        : (a.cognitive.rt > 280 || a.cognitive.lapses >= 1 || a.cognitive.sleep < 6) ? 1 : 0,
      damage: a => worst(a, ['reaction', 'lapses', 'sleep']),
      detail: a => `PVT ${a.cognitive.rt} ms · ${a.cognitive.lapses} lapsos · sueño ${a.cognitive.sleep} h`,
      metrics: a => [['Reacción PVT', `${a.cognitive.rt} ms`], ['Lapsos >500 ms', a.cognitive.lapses], ['Sueño', `${a.cognitive.sleep} h`]],
    },
    {
      id: 'psych', label: 'Mente · Sistema límbico', organ: 'Sistema límbico',
      level: a => (a.psych.voice > 0.7 || a.psych.coherence < 60 || a.psych.sensory === 'SEVERO') ? 2
        : (a.psych.voice > 0.4 || a.psych.coherence < 75 || a.psych.sensory === 'MODERADO') ? 1 : 0,
      damage: a => worst(a, ['voice', 'coherence', 'sensory']),
      detail: a => `${a.psych.mood} · coherencia ${a.psych.coherence}% · estrés vocal ${a.psych.voice}`,
      metrics: a => [['Estado', a.psych.mood], ['Coherencia', `${a.psych.coherence}%`], ['Estrés vocal', a.psych.voice], ['Privación sensorial', a.psych.sensory]],
    },
    {
      id: 'heart', label: 'Corazón · Cardiovascular', organ: 'Corazón',
      level: a => (a.vitals.hrv < 20 || a.vitals.hr > 100 || a.vitals.hr < 45) ? 2 : a.vitals.hrv < 35 ? 1 : 0,
      damage: a => worst(a, ['hrv', 'hr']),
      detail: a => `HRV ${a.vitals.hrv} ms · pulso ${a.vitals.hr} bpm · PA ${a.vitals.bp}`,
      metrics: a => [['HRV (RMSSD)', `${a.vitals.hrv} ms`], ['Pulso', `${a.vitals.hr} bpm`], ['Presión', a.vitals.bp]],
    },
    {
      id: 'lungs', label: 'Pulmones · Respiratorio', organ: 'Pulmones',
      level: a => (a.vitals.spo2 < 94 || a.environment.co2 > 6) ? 2
        : (a.vitals.spo2 < 96 || a.environment.co2 > 4) ? 1 : 0,
      damage: a => worst(a, ['spo2', 'co2']),
      detail: a => `SpO₂ ${a.vitals.spo2}% · CO₂ cabina ${a.environment.co2} mmHg`,
      metrics: a => [['SpO₂', `${a.vitals.spo2}%`], ['CO₂ cabina', `${a.environment.co2} mmHg`]],
    },
    {
      id: 'muscle', label: 'Músculo · Musculoesquelético', organ: 'Músculo esquelético',
      level: a => (a.muscle.delta < -5 || a.muscle.exercise_pct < 50) ? 2
        : (a.muscle.delta < -2.5 || a.muscle.exercise_pct < 70) ? 1 : 0,
      damage: a => worst(a, ['atrophy', 'exercise']),
      detail: a => `Masa muscular ${a.muscle.delta}% · ARED ${a.muscle.exercise_pct}%`,
      metrics: a => [['Masa muscular', `${a.muscle.delta}%`], ['Cumplimiento ARED', `${a.muscle.exercise_pct}%`]],
    },
    {
      id: 'radiation', label: 'Radiación · Hueso y médula', organ: 'Esqueleto y médula ósea',
      level: a => a.environment.radiation > 80 ? 2 : a.environment.radiation > 35 ? 1 : 0,
      damage: a => worst(a, ['radiation']),
      detail: a => `Dosis ${a.environment.radiation} μSv/h`,
      metrics: a => [['Tasa de dosis', `${a.environment.radiation} μSv/h`], ['Umbral nominal', '35 μSv/h']],
    },
  ];

  // Amenazas del espacio profundo. `systems`: órganos que afecta (el primero es el principal).
  // `effect`: animación del visor 3D.
  const HAZARDS = [
    {
      id: 'radiation', name: 'Radiación espacial', icon: 'radioactive', effect: 'radiation',
      summary: 'Rayos cósmicos galácticos y tormentas solares (SPE) dañan el ADN de la médula ósea y el sistema nervioso central.',
      systems: ['radiation', 'neuro'],
      severity: a => worst(a, ['radiation']),
      metrics: a => [['Tasa de dosis', `${a.environment.radiation} μSv/h`]],
    },
    {
      id: 'microgravity', name: 'Microgravedad', icon: 'planet', effect: 'float',
      summary: 'Sin carga gravitacional se pierde masa muscular y densidad ósea (~1-2 % al mes) si no se cumple el ejercicio.',
      systems: ['muscle', 'radiation', 'heart'],
      severity: a => worst(a, ['atrophy', 'exercise']),
      metrics: a => [['Masa muscular', `${a.muscle.delta}%`], ['Cumplimiento ARED', `${a.muscle.exercise_pct}%`]],
    },
    {
      id: 'isolation', name: 'Aislamiento y confinamiento', icon: 'user-focus', effect: 'isolation',
      summary: 'Meses en un hábitat cerrado y lejos de la Tierra elevan el estrés, la monotonía y el riesgo de depresión.',
      systems: ['psych', 'neuro'],
      severity: a => worst(a, ['voice', 'coherence', 'sensory']),
      metrics: a => [['Estado', a.psych.mood], ['Privación sensorial', a.psych.sensory]],
    },
    {
      id: 'circadian', name: 'Ritmo circadiano y sueño', icon: 'moon-stars', effect: 'pulse',
      summary: 'Sin ciclo día-noche natural el sueño se fragmenta y la fatiga degrada los reflejos y la toma de decisiones.',
      systems: ['neuro', 'psych'],
      severity: a => worst(a, ['sleep', 'lapses', 'reaction']),
      metrics: a => [['Sueño', `${a.cognitive.sleep} h`], ['Reacción PVT', `${a.cognitive.rt} ms`]],
    },
    {
      id: 'co2', name: 'Hipercapnia (CO₂ en cabina)', icon: 'cloud-fog', effect: 'haze',
      summary: 'El CO₂ se acumula en zonas sin convección; causa cefalea, fatiga y menor rendimiento cognitivo.',
      systems: ['lungs', 'neuro'],
      severity: a => worst(a, ['co2', 'spo2']),
      metrics: a => [['CO₂ cabina', `${a.environment.co2} mmHg`], ['SpO₂', `${a.vitals.spo2}%`]],
    },
    {
      id: 'cardio', name: 'Desacondicionamiento cardiovascular', icon: 'heartbeat', effect: 'pulse',
      summary: 'El desplazamiento de fluidos hacia la cabeza y la menor exigencia reducen la reserva cardíaca y el tono autonómico.',
      systems: ['heart', 'lungs'],
      severity: a => worst(a, ['hrv', 'hr']),
      metrics: a => [['HRV (RMSSD)', `${a.vitals.hrv} ms`], ['Pulso', `${a.vitals.hr} bpm`]],
    },
  ];

  // Riesgo del diagnóstico (texto libre del motor clínico) -> sistema. El orden importa.
  const RISK_RULES = [
    ['radiation', /radiaci|SPE|part[ií]culas solares|dosis/i],
    ['lungs', /CO2|CO₂|hipercapnia|SpO/i],
    ['muscle', /muscular|ARED|atrofia|treadmill/i],
    ['heart', /HRV|card[ií]a|cardiovascular|arritmia|neurovegetativo|auton[oó]mic/i],
    ['psych', /vocal|distr[eé]s|afectiv|emocional|privaci|depresi|burnout|coherencia|ánimo/i],
    ['neuro', /PVT|fatiga|sueño|psicomotr|cognitiv/i],
  ];
  const systemForRisk = text => (RISK_RULES.find(([, re]) => re.test(text)) || [null])[0];

  global.ClinicalMap = { SYSTEMS, HAZARDS, levelOf, systemForRisk };
})(window);
