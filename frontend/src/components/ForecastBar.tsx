import { useEffect, useRef, useState } from 'react'
import { api, toAstronaut } from '../api/client'
import type { Forecast, ForecastScenario } from '../api/types'
import { useI18n } from '../i18n'
import { STATUS_COLOR } from '../lib/levels'
import { useBody } from '../state/body'
import { useMission } from '../state/mission'
import { Icon } from './Icon'

const DAYS = 30
const COLORS: Record<ForecastScenario, string> = { untreated: '#ef4444', with_countermeasures: '#2dd4bf' }
const y = (v: number) => 42 - Math.min(v, 15) / 15 * 38

/** ANTICIPA · gemelo digital: proyección diaria (mismo motor SEWS) mostrada sobre el cuerpo 3D. */
export function ForecastBar() {
  const { current, version } = useMission()
  const crewId = current?.id
  const { setProjection } = useBody()
  const { t } = useI18n()
  const [forecast, setForecast] = useState<Forecast | null>(null)
  const [scenario, setScenario] = useState<ForecastScenario>('untreated')
  const [day, setDay] = useState(0)
  const [playing, setPlaying] = useState(false)
  const timer = useRef<number | undefined>(undefined)

  // Nueva proyección al cambiar de tripulante o de datos (chequeo, simulación, entorno).
  // El componente se monta con key = tripulante + versión, así día y reproducción vuelven a HOY.
  useEffect(() => {
    if (!crewId) return
    let alive = true
    api.forecast(crewId, DAYS).then(f => alive && setForecast(f)).catch(() => alive && setForecast(null))
    return () => { alive = false }
  }, [crewId, version])

  // Día 0 = estado real; días futuros: el cuerpo, las amenazas y los sistemas muestran la proyección.
  useEffect(() => {
    if (!forecast || day === 0) return setProjection(null)
    const t = forecast.trajectories[scenario][day]
    setProjection(toAstronaut(t.record, t.report))
  }, [forecast, scenario, day, setProjection])
  useEffect(() => () => setProjection(null), [setProjection])

  useEffect(() => {
    if (!playing) return
    timer.current = window.setInterval(() => setDay(d => {
      if (d >= DAYS) { setPlaying(false); return d }
      return d + 1
    }), 220)
    return () => window.clearInterval(timer.current)
  }, [playing])

  if (!forecast) return null
  const point = forecast.trajectories[scenario][day]
  const r = point.report
  const color = STATUS_COLOR[r.status_label]
  const path = (k: ForecastScenario) => forecast.trajectories[k]
    .map((t, i) => `${i ? 'L' : 'M'}${(i / DAYS * 300).toFixed(1)} ${y(t.report.sews_score).toFixed(1)}`).join(' ')

  return (
    <div className={`absolute bottom-3.5 left-1/2 z-[5] w-[min(560px,calc(100%-28px))] -translate-x-1/2 rounded-2xl bg-space-900/95 px-3.5 py-2.5 shadow-[0_16px_40px_rgba(0,0,0,0.55)] ${day > 0 ? 'ring-2 ring-accent/45' : ''}`}>
      <div className="flex items-center gap-2">
        <button type="button" aria-label={playing ? t.forecast.stop : t.forecast.play}
          onClick={() => { if (!playing && day >= DAYS) setDay(0); setPlaying(p => !p) }}
          className="grid size-8 flex-none place-items-center rounded-[10px] bg-accent text-black">
          <Icon name={playing ? 'stop' : 'play'} />
        </button>
        <div className="min-w-0 flex-1">
          <div className="panel-title">{t.forecast.title}</div>
          <div className="mt-1 truncate font-mono text-xs font-bold text-slate-200">
            {day === 0 ? t.forecast.today : `SOL ${String(point.mission_day).padStart(3, '0')} (+${day})`}
            {day === 0 && ` · SOL ${String(point.mission_day).padStart(3, '0')}`} · SEWS{' '}
            <b style={{ color }} className={r.status_label === 'ALERTA_CRITICA' ? 'is-critical' : ''}>{r.sews_score} {t.status[r.status_label]}</b>
          </div>
        </div>
        <div className="flex flex-none gap-0.5 rounded-lg bg-space-950 p-0.5" role="group" aria-label={t.forecast.scenario}>
          {(['untreated', 'with_countermeasures'] as const).map(k => (
            <button key={k} type="button" onClick={() => setScenario(k)}
              className={`rounded-md px-2 py-1 font-mono text-[9px] font-bold tracking-wide ${scenario === k ? 'bg-space-700 text-white' : 'text-slate-500'}`}>
              {k === 'untreated' ? t.forecast.untreated : t.forecast.withCm}
            </button>
          ))}
        </div>
      </div>
      <svg className="mt-1.5 block h-11 w-full" viewBox="0 0 300 44" preserveAspectRatio="none" aria-hidden="true">
        <rect x="0" y="0" width="300" height={y(9)} fill="rgba(239,68,68,0.07)" />
        <line x1="0" x2="300" y1={y(9)} y2={y(9)} stroke="rgba(239,68,68,0.35)" strokeDasharray="3 3" />
        <line x1="0" x2="300" y1={y(5)} y2={y(5)} stroke="rgba(56,189,248,0.25)" strokeDasharray="3 3" />
        {(['untreated', 'with_countermeasures'] as const).map(k => (
          <path key={k} d={path(k)} fill="none" stroke={COLORS[k]} strokeWidth={k === scenario ? 2.4 : 1.2} opacity={k === scenario ? 1 : 0.35}
            style={{ filter: `drop-shadow(0 0 4px ${COLORS[k]})` }} />
        ))}
        <line x1={day / DAYS * 300} x2={day / DAYS * 300} y1="0" y2="44" stroke="#22d3ee" strokeWidth="1.5" />
      </svg>
      <input type="range" min={0} max={DAYS} value={day} aria-label={t.forecast.daysAhead}
        onChange={e => { setPlaying(false); setDay(+e.target.value) }} className="fc-range mt-0.5 w-full" />
      <div className="mt-1 flex justify-between font-mono text-[8px] font-semibold tracking-widest text-slate-600">
        <span>{t.forecast.today}</span><span>+7</span><span>+14</span><span>+21</span><span>{t.forecast.endLabel}</span>
      </div>
      <div className="mt-1.5 text-[11px] leading-snug text-slate-300">{forecast.headline}</div>
    </div>
  )
}
