import { useEffect, useRef, useState } from 'react'
import { api } from '../../api/client'
import type { SimScenario, TelemetryRecord } from '../../api/types'
import { useI18n } from '../../i18n'
import { useMission } from '../../state/mission'
import { Icon } from '../Icon'

type Field = { key: keyof TelemetryRecord; unit: string; min: number; max: number; step: number }

const FIELDS: Field[] = [
  { key: 'radiation_rate', unit: 'μSv/h', min: 0, max: 200, step: 1 },
  { key: 'co2_mmhg', unit: 'mmHg', min: 1, max: 10, step: 0.1 },
  { key: 'spo2', unit: '%', min: 85, max: 100, step: 0.1 },
  { key: 'heart_rate', unit: 'bpm', min: 40, max: 160, step: 1 },
  { key: 'hrv', unit: 'ms', min: 10, max: 90, step: 1 },
  { key: 'sleep_hours', unit: 'h', min: 2, max: 10, step: 0.1 },
  { key: 'reaction_time', unit: 'ms', min: 180, max: 600, step: 1 },
  { key: 'voice_stress', unit: '', min: 0, max: 1, step: 0.01 },
  { key: 'coherence_pct', unit: '%', min: 20, max: 100, step: 1 },
  { key: 'muscle_delta_pct', unit: '%', min: -12, max: 0, step: 0.1 },
  { key: 'exercise_pct', unit: '%', min: 0, max: 100, step: 1 },
]
const SCENARIO_ICON: Record<string, string> = { spe: 'radioactive', co2: 'cloud-fog', fatigue: 'moon-stars', isolation: 'user-focus', atrophy: 'planet' }
const fmt = (f: Field, v: number) => `${v.toFixed(f.step < 1 ? (f.step < 0.1 ? 2 : 1) : 0)} ${f.unit}`

/** Panel de simulación: crisis predefinidas y ajuste manual; el motor clínico reevalúa al instante. */
export function SimTab() {
  const { current, refresh } = useMission()
  const { t } = useI18n()
  const [scenarios, setScenarios] = useState<SimScenario[]>([])
  // Parte del valor actual; RightPanel lo monta con key = tripulante + versión de datos.
  const [values, setValues] = useState<Record<string, number>>(() =>
    current ? Object.fromEntries(FIELDS.map(f => [f.key, Number(current.raw[f.key])])) : {})
  const timer = useRef<number | undefined>(undefined)

  useEffect(() => { api.scenarios().then(setScenarios).catch(() => {}) }, [])  // RightPanel lo remonta al cambiar de idioma
  if (!current) return null

  const run = async (action: () => Promise<unknown>) => {
    await action()
    await refresh()
  }
  const change = (f: Field, v: number) => {
    setValues(s => ({ ...s, [f.key]: v }))
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => void run(() => api.simulate(current.id, { [f.key]: v })), 180)
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="flex items-center gap-2 text-sm font-bold text-white"><Icon name="sliders-horizontal" className="text-accent" /> {t.sim.title}</h3>
        <button type="button" onClick={() => void run(() => api.resetSim(current.id))}
          className="flex items-center gap-1.5 rounded-lg bg-space-800 px-3 py-1.5 font-mono text-[11px] text-slate-300 hover:bg-space-700">
          <Icon name="arrow-counter-clockwise" size={14} /> {t.sim.reset}
        </button>
      </div>
      <div className="space-y-2">
        <div className="panel-title">{t.sim.presets}</div>
        {scenarios.map(sc => (
          <button key={sc.id} type="button" onClick={() => void run(() => api.scenario(current.id, sc.id))}
            className="flex w-full items-center gap-2.5 rounded-[10px] bg-space-800 px-3 py-2 text-left text-xs font-semibold text-slate-200 transition hover:bg-red-500/15">
            <Icon name={SCENARIO_ICON[sc.id] ?? 'warning'} className="text-critical" /> {sc.name}
          </button>
        ))}
      </div>
      <div className="space-y-2.5">
        <div className="panel-title">{t.sim.manual}</div>
        {FIELDS.map(f => (
          <label key={f.key} className="block">
            <span className="flex justify-between text-[11px]">
              <span className="font-semibold text-slate-300">{t.sim.fields[f.key]}</span>
              <span className="font-mono text-cyan-300">{fmt(f, values[f.key] ?? 0)}</span>
            </span>
            <input type="range" min={f.min} max={f.max} step={f.step} value={values[f.key] ?? 0}
              onChange={e => change(f, +e.target.value)} className="fc-range mt-1 w-full" />
          </label>
        ))}
      </div>
    </div>
  )
}
