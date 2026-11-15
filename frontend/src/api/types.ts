// Tipos del Edge Core (backend/app/schemas/clinical.py y routers). Fuente única de datos del frontend.

export type StatusLabel = 'NOMINAL' | 'ALERTA_MODERADA' | 'ALERTA_CRITICA'
export type Urgency = 'INMEDIATA' | 'ALTA' | 'MODERADA' | 'PREVENTIVA'
export type SystemId = 'neuro' | 'psych' | 'heart' | 'lungs' | 'muscle' | 'radiation'

export interface ScoreFactor {
  points: number
  risk: string
  indicator: string
  value: string
  system: SystemId
}

export interface Countermeasure {
  id: string
  category: string
  title: string
  urgency: Urgency
  description: string
  action_protocol: string
  prescribed_dosage_duration: string
}

export interface HealthReport {
  crew_member_id: string
  crew_member_name: string
  role: string
  mission_day: number
  sews_score: number
  status_label: StatusLabel
  systemic_risks: string[]
  active_countermeasures: Countermeasure[]
  summary_clinical: string
  score_breakdown: ScoreFactor[]
  escalate_to_surgeon: boolean
  escalation_reasons: string[]
}

/** Registro de telemetría de un día (data/crew_telemetry_sample.json + chequeo + simulación). */
export interface TelemetryRecord {
  crew_id: string
  name: string
  role: string
  mission_day: number
  heart_rate: number
  hrv: number
  spo2: number
  systolic_bp: number
  diastolic_bp: number
  core_temp: number
  glucose_mg_dl?: number | null
  radiation_rate: number
  total_radiation: number
  co2_mmhg: number
  reaction_time: number
  lapses: number
  voice_stress: number
  sleep_hours: number
  muscle_delta_pct: number
  exercise_pct: number
  mood_valence: number
  mood_arousal: number
  coherence_pct: number
  sensory_risk: 'BAJO' | 'MODERADO' | 'SEVERO'
  is_simulated?: boolean
  checkin_at?: string
}

export interface CrewOverviewItem {
  crew_id: string
  latest_record: TelemetryRecord
  assessment: HealthReport
}

export interface ForecastPoint {
  day: number
  mission_day: number
  record: TelemetryRecord
  report: HealthReport
}

export type ForecastScenario = 'untreated' | 'with_countermeasures'

export interface Forecast {
  crew_id: string
  days: number
  from_mission_day: number
  days_to_critical: Record<'untreated' | 'with_countermeasures', number | null>
  headline: string
  trajectories: Record<ForecastScenario, ForecastPoint[]>
}

export interface RoutineTask {
  id: string
  title: string
  points: number
  icon: string
  kind: 'auto' | 'manual'
  hint: string
  done: boolean
  urgency?: Urgency
}

export interface Routine {
  date: string
  tasks: RoutineTask[]
  done: number
  total: number
  points: number
  level: string
  level_floor: number
  next_level: { name: string; points: number } | null
  streak: number
  checkin_today: boolean
  badges: { id: string; name: string; icon: string; earned: boolean }[]
  team: { members: { crew_id: string; name: string; pct: number }[]; pct: number }
  awarded?: number
}

export interface MissionEnvironment {
  id: string
  name: string
  short: string
  icon: string
  latency_min: number
  latency_text: string
  realtime_surgeon: boolean
  gravity_g: number
  gravity_text: string
  radiation_watch: number
  radiation_spe: number
  co2_max: number
  evacuation: string
}

export interface DtnStatus {
  link: 'AOS' | 'LOS'
  line_of_sight: boolean
  one_way_latency_minutes: number
  pending_packets: number
  last_sync_at: string | null
}

export interface SimScenario {
  id: string
  name: string
  values: Record<string, number>
}

/** Tripulante normalizado tal como lo pintan las pantallas. */
export interface Astronaut {
  id: string
  photo: string
  initials: string
  name: string
  role: string
  missionDay: number
  simulated: boolean
  checkinAt: string | null
  status: StatusLabel
  sews: number
  vitals: { hr: number; hrv: number; spo2: number; bp: string; temp: number; glucose: number | null }
  cognitive: { rt: number; lapses: number; sleep: number; voice_stress: number }
  muscle: { delta: number; exercise_pct: number }
  environment: { radiation: number; co2: number }
  psych: { voice: number; coherence: number; mood: string; sensory: string; desc: string }
  risks: string[]
  breakdown: ScoreFactor[]
  escalate: boolean
  escalationReasons: string[]
  countermeasures: Countermeasure[]
  summary: string
  history: { days: number[]; hrv: number[]; rt: number[]; muscle: number[] }
  raw: TelemetryRecord
}
