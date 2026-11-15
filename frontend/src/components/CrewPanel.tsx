import type { Astronaut } from '../api/types'
import { firstName, STATUS_COLOR, STATUS_LABEL } from '../lib/levels'
import { useMission } from '../state/mission'
import { TrendChart } from './TrendChart'

/** Columna izquierda: los otros 4 tripulantes (2×2), ficha grande del seleccionado, métricas y tendencia. */
export function CrewPanel() {
  const { crew, current, select } = useMission()
  if (!current) return null
  const others = crew.filter(a => a.id !== current.id)

  return (
    <div className="flex min-h-0 flex-col gap-3 lg:overflow-y-auto">
      <section>
        <h2 className="panel-title mb-2">Tripulación · Transit-1</h2>
        <div className="grid grid-cols-2 gap-2">
          {others.map(a => <CrewTile key={a.id} astro={a} onSelect={() => select(a.id)} />)}
        </div>
      </section>
      <Hero astro={current} />
      <Metrics astro={current} />
      <section className="card px-3 py-2.5">
        <div className="flex items-center justify-between">
          <h3 className="panel-title">Tendencia · Sol 1-{current.missionDay}</h3>
          <span className="font-mono text-[10px]"><span className="text-cyan-400">HRV ms</span> <span className="text-slate-600">/</span> <span className="text-white">Δ MASA %</span></span>
        </div>
        <div className="relative mt-1 h-20"><TrendChart astro={current} /></div>
      </section>
    </div>
  )
}

export function CrewTile({ astro, onSelect }: { astro: Astronaut; onSelect: () => void }) {
  const critical = astro.status === 'ALERTA_CRITICA'
  return (
    <button type="button" onClick={onSelect}
      className={`group flex flex-col overflow-hidden rounded-xl bg-space-800 text-left transition ${critical ? 'is-danger' : ''}`}>
      <span className="danger-photo relative aspect-square max-h-[max(84px,calc(14vh-26px))] w-full overflow-hidden bg-black">
        <img src={astro.photo} alt={astro.name} className="absolute inset-0 size-full scale-[1.22] object-cover object-[50%_30%] opacity-70 transition group-hover:opacity-100 [transform-origin:50%_38%]" />
        <span className="absolute right-1.5 top-1.5 rounded-[5px] bg-space-950/80 px-1.5 py-0.5 font-mono text-[9px] font-bold" style={{ color: STATUS_COLOR[astro.status] }}>{astro.sews}</span>
      </span>
      <span className="truncate px-2 pb-1.5 pt-1 text-[11px] font-bold text-white">{firstName(astro.name)}</span>
    </button>
  )
}

export function Hero({ astro }: { astro: Astronaut }) {
  const color = STATUS_COLOR[astro.status]
  const critical = astro.status === 'ALERTA_CRITICA'
  const parts = astro.name.split(' ')
  return (
    <section className={`flex h-[236px] flex-col overflow-hidden rounded-2xl bg-space-800 lg:h-auto lg:min-h-[180px] lg:flex-1 ${critical ? 'is-danger' : ''}`}>
      <div className="danger-photo min-h-0 flex-1">
        <img key={astro.id} src={astro.photo} alt={astro.name} className="absolute inset-0 size-full animate-[hero-in_0.5s_ease_both] object-cover object-[50%_22%]" />
      </div>
      <div className="flex items-end justify-between gap-2.5 px-3.5 pb-3 pt-2.5">
        <div className="min-w-0 flex-1">
          <div className="h-[3px] rounded transition-[width] duration-500" style={{ width: `${Math.max(8, astro.sews / 15 * 100)}%`, background: color, boxShadow: `0 0 12px ${color}` }} />
          <div className="mt-2 text-[11px] font-light uppercase tracking-[0.3em] text-slate-400">{parts.slice(0, -1).join(' ')}</div>
          <h1 className="mt-0.5 truncate text-2xl font-black uppercase text-white">{parts.at(-1)}</h1>
          <p className="mt-1 truncate font-mono text-[9px] font-semibold uppercase tracking-[0.14em] text-accent">{astro.role}</p>
        </div>
        <div className={`text-right ${critical ? 'is-critical' : ''}`} style={{ color }}>
          <b className="block font-mono text-[30px] font-extrabold leading-none">{String(astro.sews).padStart(2, '0')}</b>
          <span className="mt-1 block font-mono text-[9px] font-bold tracking-[0.14em]">SEWS · {STATUS_LABEL[astro.status]}</span>
          <span className="mt-0.5 block font-mono text-[9px] font-bold tracking-[0.16em] text-slate-500">
            {astro.id}{astro.simulated && <span className="ml-1.5 rounded bg-accent px-1.5 py-px text-[8px] text-black">SIM</span>}
          </span>
        </div>
      </div>
    </section>
  )
}

function Metrics({ astro }: { astro: Astronaut }) {
  const items = [
    { label: 'HRV (RMSSD)', value: `${astro.vitals.hrv} ms`, sub: `Pulso: ${astro.vitals.hr} bpm`, accent: true },
    { label: 'Reflejos (PVT)', value: `${astro.cognitive.rt} ms`, sub: `Lapsos (>500ms): ${astro.cognitive.lapses}` },
    { label: 'Masa muscular', value: `${astro.muscle.delta}%`, sub: `ARED: ${astro.muscle.exercise_pct}% comp.`, good: true },
    { label: 'Dosis radiación', value: `${astro.environment.radiation} μSv/h`, sub: `CO2: ${astro.environment.co2} mmHg` },
  ]
  return (
    <section className="grid grid-cols-2 gap-2">
      {items.map(m => (
        <div key={m.label} className="card px-3 py-2.5">
          <div className="panel-title">{m.label}</div>
          <div className={`mt-1 text-lg font-bold ${m.accent ? 'text-cyan-300' : 'text-slate-100'}`}>{m.value}</div>
          <div className={`mt-0.5 text-[11px] ${m.accent || m.good ? 'text-nominal' : 'text-slate-400'}`}>{m.sub}</div>
        </div>
      ))}
    </section>
  )
}
