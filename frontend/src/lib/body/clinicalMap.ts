/*
 * A-HAMS · Mapa clínico del cuerpo: sistemas SEWS, porcentaje de daño por órgano y amenazas del espacio
 * profundo (riesgos del NASA Human Research Program) que los afectan.
 *
 * Los niveles de los sistemas usan los umbrales de backend/app/services/clinical_engine.py. El porcentaje de
 * daño (0-100) está calibrado para que ~35 % coincida con "vigilar" y ~70 % con "crítico".
 */
import type { Astronaut, MissionEnvironment, SystemId } from '../../api/types'

export type Level = 0 | 1 | 2
type Metric = [string, string | number]

export interface SystemDef {
  id: SystemId
  label: string
  organ: string
  level: (a: Astronaut) => Level
  damage: (a: Astronaut) => number
  detail: (a: Astronaut) => string
  metrics: (a: Astronaut) => Metric[]
}

export interface HazardDef {
  id: string
  name: string
  icon: string
  effect: 'radiation' | 'float' | 'isolation' | 'pulse' | 'haze'
  summary: string
  systems: SystemId[]
  severity: (a: Astronaut) => number
  metrics: (a: Astronaut) => Metric[]
}

const clamp = (v: number) => Math.max(0, Math.min(100, Math.round(v)));
// Entorno de misión activo (lo fija el dashboard con setEnvironment): umbrales de radiación y CO2.
export const ENV = { radiation_watch: 35, radiation_spe: 80, co2_max: 4, gravity_g: 0 }
export const levelOf = (pct: number): Level => (pct >= 70 ? 2 : pct >= 35 ? 1 : 0);
const SENSORY: Record<string, number> = { BAJO: 10, MODERADO: 45, SEVERO: 80 }

// Componentes de daño reutilizados por sistemas y amenazas.
const D = {
  reaction: (a: Astronaut) => (a.cognitive.rt - 200) * (70 / 150),
  lapses: (a: Astronaut) => a.cognitive.lapses * 24,
  sleep: (a: Astronaut) => (8 - a.cognitive.sleep) * 23.3,
  voice: (a: Astronaut) => a.psych.voice * 100,
  coherence: (a: Astronaut) => (100 - a.psych.coherence) * 1.75,
  sensory: (a: Astronaut) => SENSORY[a.psych.sensory] ?? 0,
  hrv: (a: Astronaut) => (60 - a.vitals.hrv) * 1.75,
  hr: (a: Astronaut) => (a.vitals.hr > 100 || a.vitals.hr < 45 ? 75 : 0),
  spo2: (a: Astronaut) => (99 - a.vitals.spo2) * 14,
  co2: (a: Astronaut) => (a.environment.co2 - 1.5) * (35 / (ENV.co2_max - 1.5)),
  atrophy: (a: Astronaut) => -a.muscle.delta * 14,
  exercise: (a: Astronaut) => (100 - a.muscle.exercise_pct) * 1.4,
  radiation: (a: Astronaut) => a.environment.radiation / ENV.radiation_spe * 72,
};
const worst = (a: Astronaut, keys: (keyof typeof D)[]) => clamp(Math.max(...keys.map(k => D[k](a))));

export const SYSTEMS: SystemDef[] = [
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
    level: a => (a.vitals.spo2 < 94 || a.environment.co2 > ENV.co2_max + 2) ? 2
      : (a.vitals.spo2 < 96 || a.environment.co2 > ENV.co2_max) ? 1 : 0,
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
    level: a => a.environment.radiation > ENV.radiation_spe ? 2 : a.environment.radiation > ENV.radiation_watch ? 1 : 0,
    damage: a => worst(a, ['radiation']),
    detail: a => `Dosis ${a.environment.radiation} μSv/h`,
    metrics: a => [['Tasa de dosis', `${a.environment.radiation} μSv/h`], ['Umbral nominal', '35 μSv/h']],
  },
];

// Amenazas del espacio profundo. `systems`: órganos que afecta (el primero es el principal).
// `effect`: animación del visor 3D.
export const HAZARDS: HazardDef[] = [
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
const RISK_RULES: [SystemId, RegExp][] = [
  ['radiation', /radiaci|SPE|part[ií]culas solares|dosis/i],
  ['lungs', /CO2|CO₂|hipercapnia|SpO/i],
  ['muscle', /muscular|ARED|atrofia|treadmill/i],
  ['heart', /HRV|card[ií]a|cardiovascular|arritmia|neurovegetativo|auton[oó]mic/i],
  ['psych', /vocal|distr[eé]s|afectiv|emocional|privaci|depresi|burnout|coherencia|ánimo/i],
  ['neuro', /PVT|fatiga|sueño|psicomotr|cognitiv/i],
];
export const systemForRisk = (text: string): SystemId | null => RISK_RULES.find(([, re]) => re.test(text))?.[0] ?? null

export function setEnvironment(env: MissionEnvironment) {
  Object.assign(ENV, { radiation_watch: env.radiation_watch, radiation_spe: env.radiation_spe, co2_max: env.co2_max, gravity_g: env.gravity_g })
  const g = HAZARDS.find(h => h.id === 'microgravity')!
  g.name = env.gravity_g > 0 ? `Gravedad parcial (${env.gravity_g} g)` : 'Microgravedad';
  g.summary = env.gravity_g > 0
    ? `Con ${env.gravity_g} g la pérdida muscular y ósea es más lenta que en órbita, pero sigue ocurriendo sin ejercicio.`
    : 'Sin carga gravitacional se pierde masa muscular y densidad ósea (~1-2 % al mes) si no se cumple el ejercicio.';
}
