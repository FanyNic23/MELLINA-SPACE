import { useEffect, useRef, useState, type PointerEvent as RPointerEvent } from 'react'
import { api } from '../../api/client'
import type { Astronaut, Countermeasure, Urgency } from '../../api/types'
import { useI18n } from '../../i18n'
import { beep, haptic } from '../../lib/feedback'
import { STATUS_COLOR } from '../../lib/levels'
import { Icon } from '../Icon'
import { FACES } from './faces'
import type { AssistantApi } from './useAssistant'
import './watch.css'


const URGENCY_RANK: Record<Urgency, number> = { INMEDIATA: 0, ALTA: 1, MODERADA: 2, PREVENTIVA: 3 }
const MOODS = [
  { key: 'calm', valence: 0.6, arousal: 0 },
  { key: 'focused', valence: 0.4, arousal: 0.5 },
  { key: 'anxious', valence: -0.45, arousal: 0.6 },
  { key: 'exhausted', valence: -0.65, arousal: -0.5 },
] as const

/** Cuadrante emocional actual (Russell) para resaltar el check-in de 1 toque. */
function moodKey(a: Astronaut) {
  const { mood_valence: v, mood_arousal: ar } = a.raw
  if (v < -0.4 && ar < 0) return 'exhausted'
  if (v < -0.1) return 'anxious'
  if (ar >= 0.3) return 'focused'
  return 'calm'
}

/** Reloj del tripulante: 5 carátulas deslizables (arrastre 1:1) con el asistente Mellina en la última. */
export function WatchDevice({ astro, panel, setPanel, round, assistant, onChanged }: {
  astro: Astronaut; panel: number; setPanel: (i: number) => void; round: boolean; assistant: AssistantApi; onChanged: () => void
}) {
  const [drag, setDrag] = useState<{ x: number; dx: number; t: number } | null>(null)
  const moved = useRef(0)
  const [toast, setToast] = useState(false)
  const { t } = useI18n()
  const n = FACES.length

  const down = (e: RPointerEvent) => {
    if ((e.target as HTMLElement).closest('button, input')) return
    setDrag({ x: e.clientX, dx: 0, t: performance.now() })
    moved.current = 0
  }
  useEffect(() => {
    if (!drag) return
    const move = (e: PointerEvent) => {
      let dx = e.clientX - drag.x
      moved.current = Math.abs(dx)
      if ((panel === 0 && dx > 0) || (panel === n - 1 && dx < 0)) dx *= 0.25 // resistencia elástica en los extremos
      setDrag(d => (d ? { ...d, dx } : d))
    }
    const up = () => {
      const v = Math.abs(drag.dx) / Math.max(performance.now() - drag.t, 1)
      if ((Math.abs(drag.dx) > 40 || v > 0.3) && moved.current > 12) {
        if (drag.dx < 0 && panel < n - 1) setPanel(panel + 1)
        else if (drag.dx > 0 && panel > 0) setPanel(panel - 1)
        beep(1000, 0.04)
        haptic([40])
      }
      setDrag(null)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    return () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up) }
  }, [drag, panel, n, setPanel])

  const cm = [...astro.countermeasures].sort((x, y) => URGENCY_RANK[x.urgency] - URGENCY_RANK[y.urgency])[0]
  const confirm = async () => {
    beep(1400, 0.15)
    haptic([80, 50, 80])
    if (cm) await api.completeTask(astro.id, `cm:${cm.id}`).catch(() => {})
    setToast(true)
    onChanged()
    window.setTimeout(() => { setToast(false); setPanel(0) }, 1800)
  }

  const translate = `translateX(calc(${-panel * 100 / n}% + ${drag?.dx ?? 0}px))`

  return (
    <div className={`watch ${round ? '' : 'is-square'}`}>
      <div className="watch-band top" />
      <div className="watch-band bottom" />
      <div className="watch-case">
        <div className="watch-crown" />
        <div className={`watch-screen ${drag ? 'drag-active' : ''}`} onPointerDown={down}>
          <TopBar astro={astro} />
          <div className="relative w-full flex-1 overflow-hidden">
            <div className="carousel-track" style={{ transform: translate, transition: drag ? 'none' : 'transform .35s cubic-bezier(.2,.9,.4,1.1)' }}>
              <VitalsFace astro={astro} />
              <CountermeasureFace cm={cm} color={STATUS_COLOR[astro.status]} onConfirm={() => void confirm()} />
              <MindFace key={`${astro.id}-${astro.raw.mood_valence}`} astro={astro} onChanged={onChanged} />
              <PvtFace astro={astro} onChanged={onChanged} />
              <AssistantFace assistant={assistant} moved={moved} />
            </div>
          </div>
          <div className="flex items-center justify-center gap-1.5 pb-[10%] pt-1">
            {FACES.map((f, i) => (
              <button key={f.icon} type="button" aria-label={t.watch.faceList[i].name} onClick={() => setPanel(i)}
                className={`h-1 rounded-full transition-all ${i === panel ? 'w-6 bg-accent' : 'w-3 bg-space-600'}`} />
            ))}
          </div>
          <div className={`watch-toast ${toast ? 'is-on' : ''}`}>
            <div className="px-[18%] text-center">
              <Icon name="check-circle" size={40} className="mx-auto text-nominal" />
              <div className="mt-2 text-sm font-bold text-white">{t.watch.protocolSaved}</div>
              <div className="mt-1 text-[10px] text-slate-400">{t.watch.protocolSavedSub}</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function TopBar({ astro }: { astro: Astronaut }) {
  const [time, setTime] = useState(clock)
  useEffect(() => { const t = window.setInterval(() => setTime(clock()), 1000); return () => window.clearInterval(t) }, [])
  return (
    <div className="pointer-events-none flex items-center justify-between px-[26%] pt-[11%] font-mono text-[11px] text-slate-400">
      <span className="font-bold">{time}</span>
      <span style={{ color: STATUS_COLOR[astro.status] }}><Icon name="pulse" size={14} /></span>
      <img src={astro.photo} alt="" className="size-5 rounded-full object-cover" />
    </div>
  )
}

function clock() {
  const d = new Date()
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

function VitalsFace({ astro }: { astro: Astronaut }) {
  const { t } = useI18n()
  const color = STATUS_COLOR[astro.status]
  const critical = astro.status === 'ALERTA_CRITICA'
  return (
    <div className="carousel-panel gap-2.5">
      <div className="pointer-events-none relative flex aspect-square w-[46%] items-center justify-center">
        <svg className="size-full -rotate-90" viewBox="0 0 100 100">
          <circle cx="50" cy="50" r="42" stroke="#121820" strokeWidth="7" fill="none" />
          <circle cx="50" cy="50" r="42" stroke={color} strokeWidth="7" fill="none" strokeLinecap="round" strokeDasharray="264"
            strokeDashoffset={264 - 264 * Math.min(astro.sews / 15, 1)}
            style={{ transition: 'stroke-dashoffset .7s, stroke .4s', filter: `drop-shadow(0 0 5px ${color})` }} />
        </svg>
        <div className="absolute flex flex-col items-center">
          <span className="w-label">SEWS</span>
          <span className={`mt-1 text-3xl font-black leading-none ${critical ? 'is-critical' : ''}`} style={{ color }}>{String(astro.sews).padStart(2, '0')}</span>
          <span className={`mt-1 text-[9px] font-bold tracking-wider ${critical ? 'is-critical' : ''}`} style={{ color }}>{t.status[astro.status]}</span>
        </div>
      </div>
      <div className="pointer-events-none grid w-full grid-cols-3 gap-1.5">
        {[[t.watch.pulse, `${astro.vitals.hr} bpm`, 'text-cyan-300'], ['HRV', `${astro.vitals.hrv} ms`, 'text-slate-100'], ['RAD', `${astro.environment.radiation} μSv`, 'text-slate-100']].map(([k, v, c]) => (
          <div key={k} className="w-tile py-1.5 text-center"><div className="w-label">{k}</div><div className={`mt-1 text-xs font-bold ${c}`}>{v}</div></div>
        ))}
      </div>
    </div>
  )
}

function CountermeasureFace({ cm, color, onConfirm }: { cm?: Countermeasure; color: string; onConfirm: () => void }) {
  const { t } = useI18n()
  return (
    <div className="carousel-panel gap-2 text-center">
      <span className="w-label" style={{ color: cm?.urgency === 'INMEDIATA' ? color : undefined }}>{t.watch.countermeasure(t.urgency[cm?.urgency ?? 'PREVENTIVA'])}</span>
      <h3 className="text-sm font-bold leading-tight text-white">{cm?.title ?? t.watch.noCountermeasures}</h3>
      <p className="line-clamp-3 text-[10px] leading-snug text-slate-300">{cm ? cm.action_protocol.split('\n')[0].replace(/^1\.\s*/, '') : t.watch.inRange}</p>
      <button type="button" onClick={onConfirm}
        className="w-full rounded-full bg-accent py-2 font-mono text-[11px] font-black uppercase tracking-wide text-black shadow-lg shadow-cyan-500/20 transition active:scale-95 hover:bg-cyan-300">
        {t.watch.confirm}
      </button>
    </div>
  )
}

function MindFace({ astro, onChanged }: { astro: Astronaut; onChanged: () => void }) {
  const { watch: t } = useI18n().t
  const [mood, setMood] = useState(() => moodKey(astro))
  const [breathing, setBreathing] = useState(false)
  const [phase, setPhase] = useState(0)
  useEffect(() => {
    if (!breathing) return
    const t = window.setInterval(() => {
      setPhase(p => { const next = (p + 1) % 2; beep(next === 0 ? 528 : 396, 0.3); haptic(next === 0 ? [70] : [50, 40]); return next })
    }, 5000)
    return () => window.clearInterval(t)
  }, [breathing])

  const pick = (m: typeof MOODS[number]) => {
    setMood(m.key)
    beep(m.key === 'exhausted' ? 440 : 1000, 0.08)
    haptic([60])
    void api.psychCheckin(astro.id, m.key, m.valence, m.arousal).catch(() => {})
  }
  const toggle = () => {
    if (breathing) void api.completeTask(astro.id, 'breathing').then(onChanged).catch(() => {}) // sesión hecha: cuenta en la rutina
    else beep(528, 0.4)
    setBreathing(b => !b)
  }

  return (
    <div className="carousel-panel gap-2">
      <div className="w-label flex items-center gap-1"><Icon name="brain" size={12} className="text-accent" /> {t.moodCheckin}</div>
      <div className="grid w-full grid-cols-2 gap-1">
        {MOODS.map(m => (
          <button key={m.key} type="button" onClick={() => pick(m)}
            className={`rounded-lg py-1.5 text-[10px] font-semibold transition ${mood === m.key ? 'bg-accent text-black' : 'bg-space-800 text-slate-300 hover:bg-space-700'}`}>
            {t.moods[m.key]}
          </button>
        ))}
      </div>
      <div className="w-tile flex w-full items-center gap-2 p-2">
        <div className={`flex size-11 flex-shrink-0 items-center justify-center rounded-full bg-accent text-[8px] font-bold text-black ${breathing ? 'orb-breathing' : ''}`}>0.1Hz</div>
        <div className="min-w-0 flex-1 text-left">
          <div className="truncate text-[10px] font-bold text-white">{breathing ? (phase === 0 ? t.inhale : t.exhale) : t.coherenceTitle}</div>
          <div className="truncate text-[9px] text-slate-400">{breathing ? (phase === 0 ? t.inhaleSub : t.exhaleSub) : t.coherenceSub}</div>
          <div className="font-mono text-[9px] text-cyan-300">{t.coherence(astro.psych.coherence)}</div>
        </div>
        <button type="button" onClick={toggle} aria-label={breathing ? t.breathStop : t.breathStart}
          className={`grid size-8 flex-none place-items-center rounded-full text-black active:scale-95 ${breathing ? 'bg-slate-100' : 'bg-accent'}`}>
          <Icon name={breathing ? 'stop' : 'play'} />
        </button>
      </div>
    </div>
  )
}

function PvtFace({ astro, onChanged }: { astro: Astronaut; onChanged: () => void }) {
  const { watch: t } = useI18n().t
  const [state, setState] = useState<'idle' | 'waiting' | 'ready' | 'done' | 'early'>('idle')
  const [rt, setRt] = useState(0)
  const start = useRef(0)
  const timeout = useRef<number | undefined>(undefined)
  useEffect(() => () => window.clearTimeout(timeout.current), [])

  const begin = () => {
    setState('waiting')
    timeout.current = window.setTimeout(() => {
      start.current = performance.now()
      setState('ready')
      beep(1600, 0.1, 'sawtooth')
      haptic([150])
    }, 1200 + Math.random() * 2000)
  }
  const tap = () => {
    if (state === 'waiting') { window.clearTimeout(timeout.current); setState('early'); beep(250, 0.15, 'sawtooth'); return }
    if (state !== 'ready') return
    const ms = Math.round(performance.now() - start.current)
    setRt(ms)
    setState('done')
    beep(ms < 280 ? 1200 : 400, 0.1)
    haptic([80, 50, 80])
    void api.submitPVT(astro.id, ms).then(onChanged).catch(() => {})
  }
  const ok = rt < 280
  const bg = { idle: 'bg-space-800', waiting: 'bg-sky-950', ready: 'bg-slate-100', early: 'bg-space-800', done: ok ? 'bg-teal-950' : 'bg-red-950' }[state]

  return (
    <div className="carousel-panel gap-2">
      <div className="w-label flex items-center gap-1"><Icon name="scan" size={12} className="text-accent" /> {t.pvtTitle}</div>
      <button type="button" onClick={tap} className={`flex h-24 w-full flex-col items-center justify-center rounded-2xl transition-colors ${bg}`}>
        {state === 'idle' && <span className="px-2 text-center font-mono text-[11px] text-slate-400">{t.pvtIdle}</span>}
        {state === 'waiting' && <span className="font-mono text-[11px] font-bold text-sky-400">{t.pvtWaiting}</span>}
        {state === 'ready' && <span className="font-mono text-base font-black text-black">{t.pvtReady}</span>}
        {state === 'early' && <span className="font-mono text-[10px] text-white">{t.pvtEarly}</span>}
        {state === 'done' && <>
          <span className={`font-mono text-[10px] ${ok ? 'text-nominal' : 'text-red-400'}`}>{ok ? t.pvtOk : t.pvtFatigue}</span>
          <span className={`font-mono text-2xl font-black ${ok ? 'text-nominal' : 'is-critical text-red-400'}`}>{rt} ms</span>
        </>}
      </button>
      {(state === 'idle' || state === 'done' || state === 'early') && (
        <button type="button" onClick={begin} className="w-full rounded-full bg-space-700 py-1.5 font-mono text-[10px] font-bold uppercase text-cyan-300 active:scale-95 hover:bg-space-600">
          {t.pvtStart}
        </button>
      )}
    </div>
  )
}

function AssistantFace({ assistant, moved }: { assistant: AssistantApi; moved: React.RefObject<number> }) {
  const { attachCanvas, caption, micReady, listening, speaking, tap, talk, lookAt } = assistant
  const { watch: t } = useI18n().t
  return (
    <div className="carousel-panel" role="button" tabIndex={0} aria-label={t.talk}
      onClick={e => { if (moved.current < 10 && !(e.target as HTMLElement).closest('.assist-mic')) tap() }}
      onPointerMove={e => {
        const r = e.currentTarget.getBoundingClientRect()
        lookAt(((e.clientX - r.left) / r.width - 0.5) * 2, -((e.clientY - r.top) / r.height - 0.4) * 2)
      }}
      onPointerLeave={() => lookAt(0, 0)}>
      <canvas ref={attachCanvas} className="assist-canvas" />
      <div className="assist-caption" aria-live="polite">{caption}</div>
      <button type="button" aria-label={t.mic} disabled={!micReady}
        title={micReady ? '' : t.micOff}
        className={`assist-mic ${listening ? 'listening' : ''} ${speaking ? 'speaking' : ''}`}
        onClick={e => { e.stopPropagation(); void talk() }}>
        <Icon name="microphone" size={20} />
      </button>
    </div>
  )
}
