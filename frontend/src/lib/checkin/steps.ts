// Pasos del chequeo diario: cómo medir cada indicador en el espacio, por qué importa y su semáforo.
export type Lvl = 'ok' | 'watch' | 'crit'
export type Values = Record<string, number | string | undefined>

export interface Field { key: string; label: string; min: number; max: number; step: number; ph: string }
export interface MoodOption { key: string; label: string; icon: string; valence: number; arousal: number }
export interface Step {
  id: string
  icon: string
  title: string
  unit: string
  camera?: boolean
  mood?: boolean
  how: string[]
  why: string
  range: string
  fields?: Field[]
  options?: MoodOption[]
  status: (v: Record<string, any>) => Lvl
  show: (v: Record<string, any>) => string | number
}

export const STEPS: Step[] = [
  {
    id: 'bp', icon: 'gauge', title: 'Presión arterial', unit: 'mmHg',
    how: ['Sujétate al asiento con las piernas fijas y reposa 5 minutos.', 'Coloca el brazalete en el brazo izquierdo, a la altura del corazón.', 'No hables ni te muevas durante la medición.'],
    why: 'Sin gravedad, los fluidos suben hacia la cabeza y el corazón trabaja distinto. Al volver a la gravedad la presión puede caer y provocar mareos.',
    range: 'Normal: 90–139 / 60–89 mmHg',
    fields: [
      { key: 'systolic_bp', label: 'Sistólica', min: 60, max: 250, step: 1, ph: '120' },
      { key: 'diastolic_bp', label: 'Diastólica', min: 30, max: 150, step: 1, ph: '80' },
    ],
    status: v => (v.systolic_bp >= 180 || v.diastolic_bp >= 110) ? 'crit'
      : (v.systolic_bp >= 140 || v.diastolic_bp >= 90 || v.systolic_bp < 90) ? 'watch' : 'ok',
    show: v => `${v.systolic_bp}/${v.diastolic_bp}`,
  },
  {
    id: 'hr', icon: 'heartbeat', title: 'Pulso en reposo', unit: 'lpm', camera: true,
    how: ['Usa la cámara: centra tu cara, buena luz y quédate quieto 15 segundos.', 'O manual: dos dedos en la muñeca, cuenta 30 segundos y multiplica por 2.'],
    why: 'El corazón se desacondiciona en microgravedad. Un pulso en reposo alto puede indicar estrés, fatiga o deshidratación.',
    range: 'Normal: 50–100 lpm',
    fields: [{ key: 'heart_rate', label: 'Pulso', min: 30, max: 220, step: 1, ph: '68' }],
    status: v => (v.heart_rate > 130 || v.heart_rate < 40) ? 'crit' : (v.heart_rate > 100 || v.heart_rate < 50) ? 'watch' : 'ok',
    show: v => v.heart_rate,
  },
  {
    id: 'spo2', icon: 'drop', title: 'Oxígeno en sangre (SpO₂)', unit: '%',
    how: ['Coloca el oxímetro en el dedo índice, sin esmalte.', 'Mantén la mano quieta y a la altura del pecho 30 segundos.'],
    why: 'El CO₂ se acumula en zonas sin ventilación de la nave y reduce la oxigenación: aparecen dolor de cabeza y fatiga.',
    range: 'Normal: 95–100 %',
    fields: [{ key: 'spo2', label: 'SpO₂', min: 70, max: 100, step: 0.1, ph: '98' }],
    status: v => v.spo2 < 92 ? 'crit' : v.spo2 < 95 ? 'watch' : 'ok',
    show: v => v.spo2,
  },
  {
    id: 'glucose', icon: 'drop', title: 'Glucosa en sangre', unit: 'mg/dL',
    how: ['Lávate y seca el dedo; pincha el costado de la yema con la lanceta.', 'Descarta la primera gota y aplica la segunda a la tira del glucómetro.', 'Idealmente en ayunas, antes del desayuno.'],
    why: 'La inactividad y la microgravedad reducen la sensibilidad a la insulina. Una glucosa baja afecta los reflejos en tareas críticas.',
    range: 'Normal en ayunas: 70–125 mg/dL',
    fields: [{ key: 'glucose_mg_dl', label: 'Glucosa', min: 20, max: 600, step: 1, ph: '92' }],
    status: v => (v.glucose_mg_dl < 60 || v.glucose_mg_dl > 250) ? 'crit' : (v.glucose_mg_dl < 70 || v.glucose_mg_dl >= 126) ? 'watch' : 'ok',
    show: v => v.glucose_mg_dl,
  },
  {
    id: 'temp', icon: 'thermometer', title: 'Temperatura corporal', unit: '°C',
    how: ['Termómetro bajo la lengua, boca cerrada, 1 minuto.', 'No midas justo después de hacer ejercicio ni de beber.'],
    why: 'El sistema inmune se debilita en vuelo y pueden reactivarse virus latentes. La fiebre en un espacio cerrado afecta a toda la tripulación.',
    range: 'Normal: 36.0–37.9 °C',
    fields: [{ key: 'core_temp', label: 'Temperatura', min: 32, max: 43, step: 0.1, ph: '36.7' }],
    status: v => (v.core_temp >= 38.5 || v.core_temp < 35) ? 'crit' : (v.core_temp >= 38 || v.core_temp < 35.5) ? 'watch' : 'ok',
    show: v => v.core_temp,
  },
  {
    id: 'sleep', icon: 'bed', title: 'Horas de sueño', unit: 'h',
    how: ['Indica cuántas horas dormiste en las últimas 24 h (o el dato del actígrafo).'],
    why: 'En órbita hay hasta 16 amaneceres al día: el reloj biológico se desajusta y la falta de sueño degrada reflejos y decisiones.',
    range: 'Recomendado: 7–9 h',
    fields: [{ key: 'sleep_hours', label: 'Sueño', min: 0, max: 16, step: 0.1, ph: '7.5' }],
    status: v => v.sleep_hours < 5 ? 'crit' : v.sleep_hours < 6.5 ? 'watch' : 'ok',
    show: v => v.sleep_hours,
  },
  {
    id: 'mood', icon: 'smiley', title: '¿Cómo te sientes hoy?', unit: '', mood: true,
    how: ['Elige la opción que mejor describe tu estado ahora mismo. Es confidencial y solo tú y el oficial médico la ven.'],
    why: 'El aislamiento y el confinamiento elevan el estrés y el riesgo de depresión. Registrar el ánimo a diario permite detectarlo a tiempo.',
    range: '',
    options: [
      { key: 'calm', label: 'Bien y tranquilo', icon: 'smiley', valence: 0.6, arousal: 0 },
      { key: 'focused', label: 'Con energía', icon: 'smiley', valence: 0.4, arousal: 0.5 },
      { key: 'meh', label: 'Regular', icon: 'smiley-meh', valence: -0.1, arousal: 0 },
      { key: 'anxious', label: 'Tenso o ansioso', icon: 'smiley-nervous', valence: -0.45, arousal: 0.6 },
      { key: 'exhausted', label: 'Agotado o triste', icon: 'smiley-sad', valence: -0.65, arousal: -0.5 },
    ],
    status: v => v.mood_valence < -0.4 ? 'watch' : 'ok',
    show: v => v.mood_label,
  },
];
