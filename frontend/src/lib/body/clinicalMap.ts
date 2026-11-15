/*
 * A-HAMS · Mapa clínico del cuerpo: sistemas SEWS, porcentaje de daño por órgano y amenazas del espacio
 * profundo (riesgos del NASA Human Research Program) que los afectan.
 *
 * Los niveles de los sistemas usan los umbrales de backend/app/services/clinical_engine.py. El porcentaje de
 * daño (0-100) está calibrado para que ~35 % coincida con "vigilar" y ~70 % con "crítico".
 *
 * Los textos (nombres, órganos, resúmenes) son getters que leen el idioma activo (i18n) en cada lectura.
 */
import type { Astronaut, MissionEnvironment, SystemId } from '../../api/types'
import { tr } from '../../i18n'

export type Level = 0 | 1 | 2
type Metric = [string, string | number]

export interface SystemDef {
  id: SystemId
  readonly label: string
  readonly organ: string
  level: (a: Astronaut) => Level
  damage: (a: Astronaut) => number
  detail: (a: Astronaut) => string
  metrics: (a: Astronaut) => Metric[]
}

export interface HazardDef {
  id: string
  readonly name: string
  icon: string
  effect: 'radiation' | 'float' | 'isolation' | 'pulse' | 'haze'
  readonly summary: string
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
const M = () => tr().metric
const sys = (id: SystemId) => tr().systems[id]
const sensory = (a: Astronaut) => tr().sensory[a.psych.sensory] ?? a.psych.sensory

export const SYSTEMS: SystemDef[] = [
  {
    id: 'neuro', get label() { return sys('neuro').label }, get organ() { return sys('neuro').organ },
    level: a => (a.cognitive.rt > 350 || a.cognitive.lapses >= 3 || a.cognitive.sleep < 5) ? 2
      : (a.cognitive.rt > 280 || a.cognitive.lapses >= 1 || a.cognitive.sleep < 6) ? 1 : 0,
    damage: a => worst(a, ['reaction', 'lapses', 'sleep']),
    detail: a => tr().systems.neuro.detail(a.cognitive.rt, a.cognitive.lapses, a.cognitive.sleep),
    metrics: a => [[M().pvt, `${a.cognitive.rt} ms`], [M().lapses, a.cognitive.lapses], [M().sleep, `${a.cognitive.sleep} h`]],
  },
  {
    id: 'psych', get label() { return sys('psych').label }, get organ() { return sys('psych').organ },
    level: a => (a.psych.voice > 0.7 || a.psych.coherence < 60 || a.psych.sensory === 'SEVERO') ? 2
      : (a.psych.voice > 0.4 || a.psych.coherence < 75 || a.psych.sensory === 'MODERADO') ? 1 : 0,
    damage: a => worst(a, ['voice', 'coherence', 'sensory']),
    detail: a => tr().systems.psych.detail(a.psych.mood, a.psych.coherence, a.psych.voice),
    metrics: a => [[M().state, a.psych.mood], [M().coherence, `${a.psych.coherence}%`], [M().vocalStress, a.psych.voice], [M().sensory, sensory(a)]],
  },
  {
    id: 'heart', get label() { return sys('heart').label }, get organ() { return sys('heart').organ },
    level: a => (a.vitals.hrv < 20 || a.vitals.hr > 100 || a.vitals.hr < 45) ? 2 : a.vitals.hrv < 35 ? 1 : 0,
    damage: a => worst(a, ['hrv', 'hr']),
    detail: a => tr().systems.heart.detail(a.vitals.hrv, a.vitals.hr, a.vitals.bp),
    metrics: a => [[M().hrv, `${a.vitals.hrv} ms`], [M().pulse, `${a.vitals.hr} bpm`], [M().pressure, a.vitals.bp]],
  },
  {
    id: 'lungs', get label() { return sys('lungs').label }, get organ() { return sys('lungs').organ },
    level: a => (a.vitals.spo2 < 94 || a.environment.co2 > ENV.co2_max + 2) ? 2
      : (a.vitals.spo2 < 96 || a.environment.co2 > ENV.co2_max) ? 1 : 0,
    damage: a => worst(a, ['spo2', 'co2']),
    detail: a => tr().systems.lungs.detail(a.vitals.spo2, a.environment.co2),
    metrics: a => [[M().spo2, `${a.vitals.spo2}%`], [M().co2, `${a.environment.co2} mmHg`]],
  },
  {
    id: 'muscle', get label() { return sys('muscle').label }, get organ() { return sys('muscle').organ },
    level: a => (a.muscle.delta < -5 || a.muscle.exercise_pct < 50) ? 2
      : (a.muscle.delta < -2.5 || a.muscle.exercise_pct < 70) ? 1 : 0,
    damage: a => worst(a, ['atrophy', 'exercise']),
    detail: a => tr().systems.muscle.detail(a.muscle.delta, a.muscle.exercise_pct),
    metrics: a => [[M().muscle, `${a.muscle.delta}%`], [M().ared, `${a.muscle.exercise_pct}%`]],
  },
  {
    id: 'radiation', get label() { return sys('radiation').label }, get organ() { return sys('radiation').organ },
    level: a => a.environment.radiation > ENV.radiation_spe ? 2 : a.environment.radiation > ENV.radiation_watch ? 1 : 0,
    damage: a => worst(a, ['radiation']),
    detail: a => tr().systems.radiation.detail(a.environment.radiation),
    metrics: a => [[M().doseRate, `${a.environment.radiation} μSv/h`], [M().nominalThreshold, `${ENV.radiation_watch} μSv/h`]],
  },
];

// Amenazas del espacio profundo. `systems`: órganos que afecta (el primero es el principal).
// `effect`: animación del visor 3D.
export const HAZARDS: HazardDef[] = [
  {
    id: 'radiation', get name() { return tr().hazards.radiation.name }, icon: 'radioactive', effect: 'radiation',
    get summary() { return tr().hazards.radiation.summary },
    systems: ['radiation', 'neuro'],
    severity: a => worst(a, ['radiation']),
    metrics: a => [[M().doseRate, `${a.environment.radiation} μSv/h`]],
  },
  {
    id: 'microgravity', icon: 'planet', effect: 'float',
    // En la Luna o en Marte la amenaza pasa a ser gravedad parcial (la fija el entorno de misión).
    get name() { const h = tr().hazards; return ENV.gravity_g > 0 ? h.partialGravity.name(ENV.gravity_g) : h.microgravity.name },
    get summary() { const h = tr().hazards; return ENV.gravity_g > 0 ? h.partialGravity.summary(ENV.gravity_g) : h.microgravity.summary },
    systems: ['muscle', 'radiation', 'heart'],
    severity: a => worst(a, ['atrophy', 'exercise']),
    metrics: a => [[M().muscle, `${a.muscle.delta}%`], [M().ared, `${a.muscle.exercise_pct}%`]],
  },
  {
    id: 'isolation', get name() { return tr().hazards.isolation.name }, icon: 'user-focus', effect: 'isolation',
    get summary() { return tr().hazards.isolation.summary },
    systems: ['psych', 'neuro'],
    severity: a => worst(a, ['voice', 'coherence', 'sensory']),
    metrics: a => [[M().state, a.psych.mood], [M().sensory, sensory(a)]],
  },
  {
    id: 'circadian', get name() { return tr().hazards.circadian.name }, icon: 'moon-stars', effect: 'pulse',
    get summary() { return tr().hazards.circadian.summary },
    systems: ['neuro', 'psych'],
    severity: a => worst(a, ['sleep', 'lapses', 'reaction']),
    metrics: a => [[M().sleep, `${a.cognitive.sleep} h`], [M().pvt, `${a.cognitive.rt} ms`]],
  },
  {
    id: 'co2', get name() { return tr().hazards.co2.name }, icon: 'cloud-fog', effect: 'haze',
    get summary() { return tr().hazards.co2.summary },
    systems: ['lungs', 'neuro'],
    severity: a => worst(a, ['co2', 'spo2']),
    metrics: a => [[M().co2, `${a.environment.co2} mmHg`], [M().spo2, `${a.vitals.spo2}%`]],
  },
  {
    id: 'cardio', get name() { return tr().hazards.cardio.name }, icon: 'heartbeat', effect: 'pulse',
    get summary() { return tr().hazards.cardio.summary },
    systems: ['heart', 'lungs'],
    severity: a => worst(a, ['hrv', 'hr']),
    metrics: a => [[M().hrv, `${a.vitals.hrv} ms`], [M().pulse, `${a.vitals.hr} bpm`]],
  },
];

// Riesgo del diagnóstico (texto libre del motor clínico, en inglés o español) -> sistema. El orden importa.
const RISK_RULES: [SystemId, RegExp][] = [
  ['radiation', /radiaci|radiation|SPE|part[ií]culas solares|solar particle|dosis|dose/i],
  ['lungs', /CO2|CO₂|hipercapnia|hypercapnia|SpO|oxygen/i],
  ['muscle', /muscular|muscle|ARED|atrofia|atrophy|treadmill/i],
  ['heart', /HRV|card[ií]a|cardiac|cardiovascular|arritmia|arrhythmia|heart rate|neurovegetativo|auton[oó]mic|blood pressure|presi[oó]n|hiperten|hypertens|hipoten|hypotens/i],
  ['psych', /vocal|distr[eé]s|distress|afectiv|mood|emocional|emotional|privaci|deprivation|depresi|depress|burnout|coherencia|coherence|ánimo|prosod/i],
  ['neuro', /PVT|fatiga|fatigue|sueño|sleep|psicomotr|psychomotor|cognitiv|gluc/i],
];
export const systemForRisk = (text: string): SystemId | null => RISK_RULES.find(([, re]) => re.test(text))?.[0] ?? null

export function setEnvironment(env: MissionEnvironment) {
  Object.assign(ENV, { radiation_watch: env.radiation_watch, radiation_spe: env.radiation_spe, co2_max: env.co2_max, gravity_g: env.gravity_g })
}
