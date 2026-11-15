import { useEffect, useState } from 'react'
import { shortName, STATUS_COLOR, STATUS_LABEL } from '../lib/levels'
import { useMission } from '../state/mission'
import { Icon } from './Icon'

const C = 2 * Math.PI * 42

/** Mini reloj flotante: datos en vivo del tripulante y acceso a su reloj. */
export function WatchDock() {
  const { current } = useMission()
  const [time, setTime] = useState(() => clock())
  useEffect(() => { const t = window.setInterval(() => setTime(clock()), 10_000); return () => window.clearInterval(t) }, [])
  if (!current) return null
  const color = STATUS_COLOR[current.status]
  const critical = current.status === 'ALERTA_CRITICA'

  return (
    <a href={`#/reloj?crew=${current.id}`} aria-label="Abrir el reloj del tripulante"
      className="mx-2 mt-2 flex items-center gap-5 rounded-2xl bg-space-800 px-[18px] py-6 shadow-[0_10px_30px_rgba(0,0,0,0.45),0_0_34px_rgba(34,211,238,0.10)] transition hover:-translate-y-[3px]">
      <div className="relative size-[150px] flex-none animate-[dock-float_4s_ease-in-out_infinite]">
        <span className="absolute -top-5 left-1/2 h-[34px] w-[44%] -translate-x-1/2 rounded-t-[10px] bg-space-700" />
        <span className="absolute -bottom-5 left-1/2 h-[34px] w-[44%] -translate-x-1/2 rounded-b-[10px] bg-space-700" />
        <span className="absolute -right-1.5 top-[40%] h-6 w-2 rounded bg-space-600" />
        <div className="absolute inset-0 rounded-full bg-space-600 p-2 shadow-[0_0_22px_rgba(34,211,238,0.25)]">
          <div className="relative size-full overflow-hidden rounded-full bg-black">
            <svg className="absolute inset-0 -rotate-90" viewBox="0 0 100 100" aria-hidden="true">
              <circle cx="50" cy="50" r="42" fill="none" stroke="#121820" strokeWidth="5" />
              <circle cx="50" cy="50" r="42" fill="none" stroke={color} strokeWidth="5" strokeLinecap="round"
                strokeDasharray={C} strokeDashoffset={C * (1 - Math.min(current.sews / 15, 1))}
                style={{ transition: 'stroke-dashoffset .7s, stroke .4s', filter: `drop-shadow(0 0 4px ${color})` }} />
              <g className="origin-center animate-[spin_8s_linear_infinite]">
                <path d="M50 2 a48 48 0 0 1 20 4.4" fill="none" stroke="#22d3ee" strokeWidth="1.2" strokeLinecap="round" opacity="0.8" />
              </g>
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span className="font-mono text-[11px] text-slate-400">{time}</span>
              <span className={`my-0.5 font-mono text-4xl font-black leading-none ${critical ? 'is-critical' : ''}`} style={{ color }}>
                {String(current.sews).padStart(2, '0')}
              </span>
              <span className="font-mono text-[11px] text-cyan-300">{current.vitals.hr} bpm</span>
            </div>
          </div>
        </div>
      </div>
      <div className="min-w-0 flex-1">
        <div className="panel-title">Reloj del tripulante</div>
        <div className="mt-2 text-lg font-bold leading-tight text-white">{shortName(current.name)}</div>
        <div className="mt-1 font-mono text-xs" style={{ color }}>SEWS · {STATUS_LABEL[current.status]}</div>
        <div className="mt-3 inline-flex items-center gap-2 rounded-full bg-accent px-4 py-2 font-mono text-[11px] font-black tracking-widest text-black shadow-lg shadow-cyan-500/30">
          <Icon name="watch" /> ABRIR RELOJ
        </div>
      </div>
    </a>
  )
}

function clock() {
  const d = new Date()
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}
