// Pasos del chequeo diario: rangos, semáforo y forma de captura de cada indicador.
// Los textos (título, unidad, cómo medirlo, por qué importa) están en i18n: `checkin.steps[id]`.
export type Lvl = 'ok' | 'watch' | 'crit'
export type Values = Record<string, number | string | undefined>

export interface Field { key: string; min: number; max: number; step: number; ph: string }
export interface MoodOption { key: string; icon: string; valence: number; arousal: number }
export interface Step {
  id: string
  icon: string
  camera?: boolean
  mood?: boolean
  fields?: Field[]
  options?: MoodOption[]
  status: (v: Record<string, any>) => Lvl
  show: (v: Record<string, any>) => string | number
}

export const STEPS: Step[] = [
  {
    id: 'bp', icon: 'gauge',
    fields: [
      { key: 'systolic_bp', min: 60, max: 250, step: 1, ph: '120' },
      { key: 'diastolic_bp', min: 30, max: 150, step: 1, ph: '80' },
    ],
    status: v => (v.systolic_bp >= 180 || v.diastolic_bp >= 110) ? 'crit'
      : (v.systolic_bp >= 140 || v.diastolic_bp >= 90 || v.systolic_bp < 90) ? 'watch' : 'ok',
    show: v => `${v.systolic_bp}/${v.diastolic_bp}`,
  },
  {
    id: 'hr', icon: 'heartbeat', camera: true,
    fields: [{ key: 'heart_rate', min: 30, max: 220, step: 1, ph: '68' }],
    status: v => (v.heart_rate > 130 || v.heart_rate < 40) ? 'crit' : (v.heart_rate > 100 || v.heart_rate < 50) ? 'watch' : 'ok',
    show: v => v.heart_rate,
  },
  {
    id: 'spo2', icon: 'drop',
    fields: [{ key: 'spo2', min: 70, max: 100, step: 0.1, ph: '98' }],
    status: v => v.spo2 < 92 ? 'crit' : v.spo2 < 95 ? 'watch' : 'ok',
    show: v => v.spo2,
  },
  {
    id: 'glucose', icon: 'drop',
    fields: [{ key: 'glucose_mg_dl', min: 20, max: 600, step: 1, ph: '92' }],
    status: v => (v.glucose_mg_dl < 60 || v.glucose_mg_dl > 250) ? 'crit' : (v.glucose_mg_dl < 70 || v.glucose_mg_dl >= 126) ? 'watch' : 'ok',
    show: v => v.glucose_mg_dl,
  },
  {
    id: 'temp', icon: 'thermometer',
    fields: [{ key: 'core_temp', min: 32, max: 43, step: 0.1, ph: '36.7' }],
    status: v => (v.core_temp >= 38.5 || v.core_temp < 35) ? 'crit' : (v.core_temp >= 38 || v.core_temp < 35.5) ? 'watch' : 'ok',
    show: v => v.core_temp,
  },
  {
    id: 'sleep', icon: 'bed',
    fields: [{ key: 'sleep_hours', min: 0, max: 16, step: 0.1, ph: '7.5' }],
    status: v => v.sleep_hours < 5 ? 'crit' : v.sleep_hours < 6.5 ? 'watch' : 'ok',
    show: v => v.sleep_hours,
  },
  {
    id: 'mood', icon: 'smiley', mood: true,
    options: [
      { key: 'calm', icon: 'smiley', valence: 0.6, arousal: 0 },
      { key: 'focused', icon: 'smiley', valence: 0.4, arousal: 0.5 },
      { key: 'meh', icon: 'smiley-meh', valence: -0.1, arousal: 0 },
      { key: 'anxious', icon: 'smiley-nervous', valence: -0.45, arousal: 0.6 },
      { key: 'exhausted', icon: 'smiley-sad', valence: -0.65, arousal: -0.5 },
    ],
    status: v => v.mood_valence < -0.4 ? 'watch' : 'ok',
    show: v => v.mood_key,
  },
];
