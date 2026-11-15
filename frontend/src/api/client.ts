// Cliente del Edge Core local (mismo origen: FastAPI sirve esta app). Sin servicios externos.
// Cada petición lleva el idioma activo (X-Lang): el motor clínico responde en ese idioma.
import { getLang, tr } from '../i18n'
import type {
  Astronaut, CrewOverviewItem, DtnStatus, Forecast, HealthReport, MissionEnvironment, Routine, SimScenario,
  TelemetryRecord,
} from './types'

export class OfflineError extends Error {}

async function request<T>(path: string, init?: RequestInit, timeoutMs = 4000): Promise<T> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetch(path, { ...init, headers: { ...init?.headers, 'X-Lang': getLang() }, signal: ctrl.signal })
    if (!res.ok) throw new Error(`HTTP ${res.status} en ${path}`)
    return (await res.json()) as T
  } catch (err) {
    if (err instanceof DOMException || err instanceof TypeError) throw new OfflineError('Edge Core unreachable')
    throw err
  } finally {
    clearTimeout(timer)
  }
}

const post = <T>(path: string, body?: unknown) =>
  request<T>(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })

// Identidad visual de cada tripulante (no clínica).
const PROFILE: Record<string, { photo: string; initials: string }> = {
  'ASTRO-01': { photo: '/photos/astro-01.jpg', initials: 'ER' },
  'ASTRO-02': { photo: '/photos/astro-02.jpg', initials: 'MV' },
  'ASTRO-03': { photo: '/photos/astro-03.jpg', initials: 'KS' },
  'ASTRO-04': { photo: '/photos/astro-04.jpg', initials: 'SM' },
  'ASTRO-05': { photo: '/photos/astro-05.jpg', initials: 'DH' },
}

/** Cuadrante emocional de Russell a partir de valencia y activación. */
function moodLabel(valence: number, arousal: number): string {
  const m = tr().mood
  if (valence < -0.4 && arousal < 0) return m.exhausted
  if (valence < -0.1 && arousal >= 0.3) return m.anxious
  if (valence < -0.1) return m.tense
  if (arousal >= 0.3) return m.alert
  return m.calm
}

function voiceNote(stress: number): string {
  const v = tr().voice
  if (stress > 0.7) return v.high
  if (stress > 0.4) return v.mid
  return v.low
}

const round1 = (n: number) => Math.round(n * 10) / 10

/** Registro + evaluación del motor + historial → tripulante listo para pintar. */
export function toAstronaut(rec: TelemetryRecord, a: HealthReport, history: TelemetryRecord[] = []): Astronaut {
  const days = history.filter((_, i) => i % 2 === 0 || i === history.length - 1)
  return {
    id: a.crew_member_id,
    ...(PROFILE[a.crew_member_id] ?? { photo: '', initials: '' }),
    name: a.crew_member_name,
    role: a.role,
    missionDay: a.mission_day,
    simulated: Boolean(rec.is_simulated),
    checkinAt: rec.checkin_at ?? null,
    status: a.status_label,
    sews: a.sews_score,
    vitals: {
      hr: Math.round(rec.heart_rate), hrv: Math.round(rec.hrv), spo2: rec.spo2,
      bp: `${Math.round(rec.systolic_bp)}/${Math.round(rec.diastolic_bp)}`, temp: rec.core_temp,
      glucose: rec.glucose_mg_dl ?? null,
    },
    cognitive: { rt: Math.round(rec.reaction_time), lapses: rec.lapses, sleep: rec.sleep_hours, voice_stress: rec.voice_stress },
    muscle: { delta: round1(rec.muscle_delta_pct), exercise_pct: Math.round(rec.exercise_pct) },
    environment: { radiation: Math.round(rec.radiation_rate), co2: round1(rec.co2_mmhg) },
    psych: {
      voice: rec.voice_stress, coherence: Math.round(rec.coherence_pct), mood: moodLabel(rec.mood_valence, rec.mood_arousal),
      sensory: rec.sensory_risk, desc: voiceNote(rec.voice_stress),
    },
    risks: a.systemic_risks,
    breakdown: a.score_breakdown ?? [],
    escalate: a.escalate_to_surgeon,
    escalationReasons: a.escalation_reasons ?? [],
    countermeasures: a.active_countermeasures,
    summary: a.summary_clinical,
    history: {
      days: days.map(h => h.mission_day), hrv: days.map(h => h.hrv),
      rt: days.map(h => h.reaction_time), muscle: days.map(h => h.muscle_delta_pct),
    },
    raw: rec,
  }
}

export const api = {
  async loadCrew(): Promise<Astronaut[]> {
    const overview = await request<CrewOverviewItem[]>('/api/crew')
    const histories = await Promise.all(overview.map(o => request<TelemetryRecord[]>(`/api/crew/${o.crew_id}/history`)))
    return overview.map((o, i) => toAstronaut(o.latest_record, o.assessment, histories[i]))
  },
  forecast: (id: string, days = 30) => request<Forecast>(`/api/crew/${id}/forecast?days=${days}`),
  checkin: (id: string, values: Record<string, number | string>) => post<HealthReport>(`/api/checkin/${id}`, values),
  scenarios: () => request<SimScenario[]>('/api/sim/scenarios'),
  simulate: (id: string, values: Record<string, number>) => post<HealthReport>(`/api/sim/${id}`, values),
  scenario: (id: string, key: string) => post<HealthReport>(`/api/sim/${id}/scenario/${key}`),
  resetSim: (id: string) => post<HealthReport>(`/api/sim/${id}/reset`),
  routine: (id: string) => request<Routine>(`/api/routine/${id}`),
  completeTask: (id: string, task: string) => post<Routine>(`/api/routine/${id}/complete/${encodeURIComponent(task)}`),
  submitPVT: (id: string, rt: number) =>
    post('/api/cognitive/pvt-submit', { crew_id: id, mean_reaction_time_ms: rt, lapses_count: rt > 500 ? 1 : 0 }),
  psychCheckin: (id: string, quadrant: string, valence: number, arousal: number) =>
    post('/api/psych/checkin', { crew_id: id, quadrant, valence, arousal }),
  dtn: () => request<DtnStatus>('/api/dtn/status'),
  setLink: (state: 'AOS' | 'LOS') => post('/link', { state }),
  environment: () => request<{ active: MissionEnvironment; available: MissionEnvironment[] }>('/api/mission/environment'),
  setEnvironment: (id: string) => post<{ active: MissionEnvironment }>(`/api/mission/environment/${id}`),
}
