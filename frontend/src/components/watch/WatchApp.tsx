import { useEffect, useState } from 'react'
import { STATUS_COLOR, STATUS_LABEL } from '../../lib/levels'
import { useMission } from '../../state/mission'
import { BrandMark, BrandWord } from '../Brand'
import { CrewTile, Hero } from '../CrewPanel'
import { Icon } from '../Icon'
import { useAssistant, type Topic } from './useAssistant'
import { FACES } from './faces'
import { WatchDevice } from './WatchDevice'

const QUERIES: [Topic, string, string][] = [
  ['health', 'heartbeat', 'Salud'], ['ship', 'rocket-launch', 'Nave'],
  ['environment', 'radioactive', 'Ambiente'], ['full', 'stethoscope', 'Diagnóstico'],
]

/** Reloj del tripulante: tripulación | reloj con 5 carátulas | carátulas, asistente Mellina, forma y estado. */
export function WatchApp({ crewParam }: { crewParam: string | null }) {
  const { crew, current, select, refresh } = useMission()
  const [panel, setPanel] = useState(0)
  const [round, setRound] = useState(true)
  const assistant = useAssistant(current, select)

  useEffect(() => { if (crewParam) select(crewParam) }, [crewParam, select])
  if (!current) return null
  const others = crew.filter(a => a.id !== current.id)
  const color = STATUS_COLOR[current.status]

  const ask = (topic: Topic) => { setPanel(FACES.length - 1); void assistant.answer(topic) }

  return (
    <div className="flex h-full flex-col lg:overflow-hidden">
      <header className="flex-none bg-space-800 px-4 py-3">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <BrandMark className="h-[34px] text-white drop-shadow-[0_0_8px_rgba(255,255,255,0.25)]" />
            <span className="h-8 w-px bg-space-600" />
            <div><BrandWord className="h-[13px] text-slate-50" /><p className="mt-1.5 text-[11px] text-slate-400">Reloj del tripulante</p></div>
          </div>
          <a href="#/" className="flex items-center gap-1.5 rounded-lg bg-space-700 px-3.5 py-2 font-mono text-xs font-bold text-slate-200 transition hover:bg-space-600">
            <Icon name="arrow-right" className="rotate-180" /> ESTACIÓN HÁBITAT
          </a>
        </div>
      </header>

      <main className="gap-3 space-y-3 p-3 lg:grid lg:min-h-0 lg:flex-1 lg:grid-cols-[320px_minmax(0,1fr)_320px] lg:space-y-0">
        <section className="flex flex-col gap-2 lg:min-h-0">
          <h2 className="panel-title">Tripulación · Transit-1</h2>
          <div className="grid grid-cols-2 gap-2">{others.map(a => <CrewTile key={a.id} astro={a} onSelect={() => select(a.id)} />)}</div>
          <Hero astro={current} />
        </section>

        <section className="card flex items-center justify-center overflow-hidden py-20 lg:min-h-0 lg:py-0">
          <WatchDevice astro={current} panel={panel} setPanel={setPanel} round={round} assistant={assistant} onChanged={() => void refresh()} />
        </section>

        <aside className="card space-y-4 p-3 lg:min-h-0 lg:overflow-y-auto">
          <div className="space-y-2">
            <h2 className="panel-title">Carátulas</h2>
            <div className="space-y-1.5">
              {FACES.map((f, i) => (
                <button key={f.name} type="button" onClick={() => setPanel(i)} className={`face-btn ${i === panel ? 'is-active' : ''}`}>
                  <span className="face-icon"><Icon name={f.icon} /></span>
                  <span className="min-w-0"><span className="block text-sm font-semibold text-white">{f.name}</span>
                    <span className="block truncate text-[11px] text-slate-400">{f.desc}</span></span>
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <h2 className="panel-title">Asistente Mellina</h2>
            <div className="grid grid-cols-2 gap-1.5">
              {QUERIES.map(([t, icon, label]) => (
                <button key={t} type="button" onClick={() => ask(t)} className="query-btn"><Icon name={icon} /> {label}</button>
              ))}
            </div>
            <button type="button" onClick={assistant.stop} className="query-btn w-full justify-center text-slate-400"><Icon name="stop" /> Detener voz</button>
            <div className="assist-log max-h-64 space-y-1.5 overflow-y-auto">
              {assistant.log.map((l, i) => <p key={i} className={l.user ? 'user' : ''}><b>{l.who}</b>{l.text}</p>)}
            </div>
          </div>

          <div className="space-y-2">
            <h2 className="panel-title">Forma del reloj</h2>
            <div className="grid grid-cols-2 gap-1 rounded-lg bg-space-950 p-1 font-mono text-[11px]">
              {[[true, 'CIRCULAR'], [false, 'CUADRADA']].map(([r, label]) => (
                <button key={String(label)} type="button" onClick={() => setRound(r as boolean)}
                  className={`rounded-md py-1.5 transition ${round === r ? 'bg-accent font-bold text-black' : 'text-slate-400 hover:text-white'}`}>{label}</button>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <h2 className="panel-title">Estado del tripulante</h2>
            <div className="w-tile space-y-1 p-3">
              <div className={`text-sm font-bold ${current.status === 'ALERTA_CRITICA' ? 'is-critical' : ''}`} style={{ color }}>{current.name} · {STATUS_LABEL[current.status]}</div>
              <div className="text-xs leading-relaxed text-slate-400">{current.psych.mood}. {current.risks[0] ?? 'Sin riesgos sistémicos detectados.'}</div>
            </div>
          </div>
        </aside>
      </main>
    </div>
  )
}
