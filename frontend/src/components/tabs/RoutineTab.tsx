import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../../api/client'
import type { DtnStatus, Routine } from '../../api/types'
import { firstName } from '../../lib/levels'
import { useMission } from '../../state/mission'
import { useToast } from '../../state/toast'
import { Icon } from '../Icon'

/** Rutina del día con gamificación cooperativa, test PVT, salud mental (Earth VR) y enlace DTN. */
export function RoutineTab({ onCheckin }: { onCheckin: () => void }) {
  const { current, version, refresh } = useMission()
  const toast = useToast()
  const [routine, setRoutine] = useState<Routine | null>(null)
  const pvtRef = useRef<HTMLDivElement>(null)
  const crewId = current?.id

  const load = useCallback(() => { if (crewId) api.routine(crewId).then(setRoutine).catch(() => {}) }, [crewId])
  useEffect(load, [load, version])

  if (!current || !routine) return null
  const r = routine

  const complete = async (taskId: string) => {
    if (taskId === 'checkin') return onCheckin()
    if (taskId === 'pvt') return pvtRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    const res = await api.completeTask(current.id, taskId)
    if (res.awarded) toast(`+${res.awarded} pts`)
    setRoutine(res)
  }

  const xp = r.next_level ? Math.round((r.points - r.level_floor) / (r.next_level.points - r.level_floor) * 100) : 100

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 rounded-xl bg-space-800 p-3">
        <div className="grid size-11 flex-none place-items-center rounded-xl bg-cyan-400/15 text-accent shadow-[0_0_18px_rgba(34,211,238,0.2)]"><Icon name="trophy" size={24} /></div>
        <div className="min-w-0 flex-1">
          <div className="panel-title">Nivel</div>
          <div className="mt-1 text-base font-bold text-white">{r.level}</div>
          <Progress pct={xp} />
          <div className="mt-1 font-mono text-[10px] text-slate-400">
            {r.next_level ? `${r.points} pts · ${r.next_level.points - r.points} para ${r.next_level.name}` : `${r.points} pts · nivel máximo`}
          </div>
        </div>
        <div className="flex flex-none flex-col items-center rounded-[10px] bg-space-700 px-2.5 py-1.5 text-accent">
          <Icon name="fire" size={20} />
          <b className="mt-0.5 font-mono text-xl font-extrabold leading-none text-white">{r.streak}</b>
          <span className="mt-0.5 font-mono text-[8px] font-bold tracking-[0.14em] text-slate-500">DÍAS</span>
        </div>
      </div>

      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <h3 className="panel-title">Rutina de hoy</h3>
          <span className="font-mono text-[10px] text-cyan-300">{r.done}/{r.total} HECHAS</span>
        </div>
        {r.tasks.map(t => (
          <button key={t.id} type="button" disabled={t.done} onClick={() => void complete(t.id)}
            className={`flex w-full items-center gap-2.5 rounded-[10px] bg-space-800 px-2.5 py-2 text-left transition enabled:hover:bg-space-700 ${t.done ? 'opacity-60' : ''}`}>
            <span className={`grid size-7 flex-none place-items-center rounded-lg ${t.done ? 'bg-teal-400/15 text-nominal' : 'bg-space-700 text-accent'}`}>
              <Icon name={t.done ? 'check-circle' : t.icon} />
            </span>
            <span className="min-w-0 flex-1">
              <b className="block truncate text-xs text-slate-200">{t.title}</b>
              <small className="mt-px block truncate text-[10px] text-slate-500">
                {t.done ? 'Completada' : t.kind === 'auto' ? `Se marca al hacerla · ${t.hint}` : t.hint}
              </small>
            </span>
            <em className={`flex-none font-mono text-[11px] font-extrabold not-italic ${t.done ? 'text-nominal' : 'text-accent'}`}>+{t.points}</em>
          </button>
        ))}
      </div>

      <div className="space-y-1.5">
        <h3 className="panel-title flex items-center gap-1.5"><Icon name="users-three" size={14} /> Meta de la tripulación</h3>
        <div className="flex items-center gap-3 rounded-xl bg-space-800 px-3 py-2.5">
          <b className="font-mono text-[22px] font-extrabold text-nominal">{r.team.pct}%</b>
          <div className="flex-1">
            <Progress pct={r.team.pct} />
            <div className="mt-1.5 font-mono text-[10px] leading-relaxed text-slate-400">
              {r.team.members.map(m => `${firstName(m.name)} ${m.pct}%`).join(' · ')}
            </div>
          </div>
        </div>
      </div>

      <div className="space-y-1.5">
        <h3 className="panel-title">Insignias</h3>
        <div className="grid grid-cols-5 gap-1.5">
          {r.badges.map(b => (
            <div key={b.id} title={b.earned ? b.name : `${b.name} (bloqueada)`}
              className={`flex flex-col items-center gap-1 rounded-[10px] px-0.5 py-2 text-center ${b.earned ? 'bg-cyan-400/10 text-accent shadow-[0_0_14px_rgba(34,211,238,0.15)]' : 'bg-space-800 text-slate-700'}`}>
              <Icon name={b.icon} size={20} />
              <span className={`text-[8px] leading-tight ${b.earned ? 'text-slate-300' : 'text-slate-600'}`}>{b.name}</span>
            </div>
          ))}
        </div>
      </div>

      <div ref={pvtRef}><PvtTest crewId={current.id} onDone={() => { load(); void refresh() }} /></div>
      <MentalHealth />
      <DtnLink />
    </div>
  )
}

function Progress({ pct }: { pct: number }) {
  return (
    <div className="mt-1.5 h-[5px] overflow-hidden rounded bg-space-600">
      <i className="block h-full bg-accent shadow-[0_0_8px_#22d3ee] transition-[width] duration-500" style={{ width: `${pct}%` }} />
    </div>
  )
}

type PvtState = 'idle' | 'waiting' | 'ready' | 'done' | 'early'

/** Test de vigilancia psicomotora (NASA PVT): el resultado se guarda y marca la tarea del día. */
function PvtTest({ crewId, onDone }: { crewId: string; onDone: () => void }) {
  const [state, setState] = useState<PvtState>('idle')
  const [rt, setRt] = useState(0)
  const start = useRef(0)
  const timeout = useRef<number | undefined>(undefined)
  useEffect(() => () => window.clearTimeout(timeout.current), [])

  const begin = () => {
    setState('waiting')
    timeout.current = window.setTimeout(() => { start.current = performance.now(); setState('ready') }, 1500 + Math.random() * 2500)
  }
  const tap = () => {
    if (state === 'waiting') { window.clearTimeout(timeout.current); setState('early'); return }
    if (state !== 'ready') return
    const ms = Math.round(performance.now() - start.current)
    setRt(ms)
    setState('done')
    api.submitPVT(crewId, ms).then(onDone).catch(() => {})
  }

  const box = {
    idle: 'bg-space-950', waiting: 'bg-sky-950', ready: 'bg-slate-100', early: 'bg-space-800',
    done: rt < 260 ? 'bg-teal-950' : rt < 340 ? 'bg-sky-950' : 'bg-red-950',
  }[state]
  const verdict = rt < 260 ? 'Óptimo: alerta psicomotora excelente.' : rt < 340 ? 'Moderado: indicios leves de fatiga.' : 'Crítico: fatiga severa, descanso requerido.'

  return (
    <div className="space-y-2">
      <h3 className="flex items-center gap-2 text-sm font-bold text-white"><Icon name="pulse" className="text-accent" /> Test de vigilancia (NASA PVT)</h3>
      <div className="space-y-3 rounded-lg bg-space-950 p-4 text-center">
        <button type="button" onClick={tap} className={`flex h-28 w-full flex-col items-center justify-center rounded-lg transition-colors ${box}`}>
          {state === 'idle' && <span className="font-mono text-sm text-slate-400">Pulsa "Iniciar" y toca cuando el recuadro se encienda</span>}
          {state === 'waiting' && <span className="font-mono text-sm font-bold text-sky-400">Espera el estímulo…</span>}
          {state === 'ready' && <span className="font-mono text-base font-black tracking-widest text-black">¡¡ PULSA AHORA !!</span>}
          {state === 'early' && <span className="font-mono text-sm text-white">Antes de tiempo · repite</span>}
          {state === 'done' && <span className={`font-mono text-3xl font-black ${rt >= 340 ? 'is-critical text-red-400' : 'text-white'}`}>{rt} ms</span>}
        </button>
        <div className="flex justify-center gap-3">
          <button type="button" onClick={begin} disabled={state === 'waiting' || state === 'ready'}
            className="rounded-lg bg-accent px-5 py-2 text-xs font-bold uppercase tracking-wide text-black shadow-lg shadow-cyan-500/20 transition hover:bg-cyan-300 disabled:opacity-40">
            Iniciar test PVT
          </button>
        </div>
        {state === 'done' && <div className="font-mono text-xs text-cyan-400">Resultado: {verdict} Guardado y en cola hacia la Tierra.</div>}
      </div>
    </div>
  )
}

/** Salud mental: estrés vocal, coherencia y privación sensorial; Earth VR genera sonido biofílico localmente. */
function MentalHealth() {
  const { current: a } = useMission()
  const toast = useToast()
  const [vr, setVr] = useState(false)
  const audio = useRef<{ ctx: AudioContext; src: AudioBufferSourceNode } | null>(null)
  useEffect(() => () => { try { audio.current?.src.stop() } catch { /* ya detenido */ } }, [])
  if (!a) return null

  const toggleVr = () => {
    if (vr) {
      try { audio.current?.src.stop() } catch { /* ya detenido */ }
      audio.current = null
      setVr(false)
      return
    }
    const ctx = audio.current?.ctx ?? new AudioContext()
    const buf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate)
    const data = buf.getChannelData(0)
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1
    const src = ctx.createBufferSource()
    src.buffer = buf
    src.loop = true
    const filter = ctx.createBiquadFilter()
    filter.type = 'lowpass'
    filter.frequency.value = 450
    const gain = ctx.createGain()
    gain.gain.value = 0.06
    src.connect(filter).connect(gain).connect(ctx.destination)
    src.start()
    audio.current = { ctx, src }
    setVr(true)
    toast('Earth VR activo: bosque y lluvia suave · luz de cabina a 2200 K')
  }

  const voiceColor = a.psych.voice > 0.7 ? '#ef4444' : a.psych.voice > 0.4 ? '#38bdf8' : '#2dd4bf'
  const cohColor = a.psych.coherence < 60 ? '#ef4444' : '#22d3ee'
  const sensColor = a.psych.sensory === 'SEVERO' ? '#ef4444' : a.psych.sensory === 'MODERADO' ? '#38bdf8' : '#2dd4bf'

  return (
    <div className="space-y-2">
      <h3 className="flex items-center gap-2 text-sm font-bold text-white"><Icon name="brain" className="text-accent" /> Salud mental y privación sensorial</h3>
      <MiniMeter label="ESTRÉS VOCAL" value={String(a.psych.voice)} pct={a.psych.voice * 100} color={voiceColor} note={a.psych.desc} critical={a.psych.voice > 0.7} />
      <MiniMeter label="COHERENCIA (0.1Hz)" value={`${a.psych.coherence}%`} pct={a.psych.coherence} color={cohColor}
        note={a.psych.coherence < 60 ? 'Desbalance autonómico simpático (estrés).' : 'Sincronía respiratoria-cardíaca alta.'} critical={a.psych.coherence < 60} />
      <div className="rounded-lg bg-space-950 p-3">
        <div className="flex items-center justify-between font-mono text-[11px] text-slate-400">
          <span>PRIVACIÓN SENSORIAL</span><b style={{ color: sensColor }}>{a.psych.sensory}</b>
        </div>
        <div className="mt-1 text-xs font-bold text-white">{a.psych.mood}</div>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-space-950/80 p-3">
        <div className="flex items-center gap-3">
          <div className="grid size-10 place-items-center rounded-lg bg-teal-950 text-nominal"><Icon name="tree-evergreen" size={20} /></div>
          <div>
            <div className="text-xs font-bold text-white">Descompresión sensorial (Earth VR)</div>
            <div className="text-[11px] text-slate-400">Sonido biofílico generado en el equipo.</div>
          </div>
        </div>
        <button type="button" onClick={toggleVr}
          className={`flex items-center gap-1.5 rounded-lg px-4 py-2 font-mono text-xs font-bold uppercase text-black transition ${vr ? 'bg-slate-100 hover:bg-white' : 'bg-teal-500 hover:bg-teal-400'}`}>
          <Icon name={vr ? 'stop' : 'play'} /> {vr ? 'Detener' : 'Iniciar Earth VR'}
        </button>
      </div>
    </div>
  )
}

function MiniMeter({ label, value, pct, color, note, critical }: { label: string; value: string; pct: number; color: string; note: string; critical: boolean }) {
  return (
    <div className="rounded-lg bg-space-950 p-3">
      <div className="flex items-center justify-between font-mono text-[11px] text-slate-400">
        <span>{label}</span><b className={critical ? 'is-critical' : ''} style={{ color }}>{value}</b>
      </div>
      <div className="mt-2 h-2 overflow-hidden rounded-full bg-space-800">
        <div className={`h-full transition-all ${critical ? 'is-critical' : ''}`} style={{ width: `${pct}%`, background: color }} />
      </div>
      <div className="mt-2 text-[10px] text-slate-400">{note}</div>
    </div>
  )
}

/** Enlace con la Tierra: estado real de la cola store-and-forward; alterna LOS (sin señal) y AOS (ventana). */
function DtnLink() {
  const toast = useToast()
  const [d, setD] = useState<DtnStatus | null>(null)
  const load = useCallback(() => { api.dtn().then(setD).catch(() => {}) }, [])
  useEffect(load, [load])

  const toggle = async () => {
    if (!d) return
    await api.setLink(d.link === 'AOS' ? 'LOS' : 'AOS')
    toast(d.link === 'AOS' ? 'Señal perdida (LOS): todo queda en cola local' : 'Ventana de enlace (AOS): transmitiendo la cola por prioridad')
    window.setTimeout(load, 600)
  }

  return (
    <div className="space-y-2">
      <h3 className="panel-title">Enlace DTN con la Tierra</h3>
      <div className="space-y-1 font-mono text-xs text-slate-300">
        <Row k="Enlace" v={d ? (d.link === 'AOS' ? <span className="text-nominal">AOS · con señal</span> : <span className="is-critical text-red-400">LOS · sin señal</span>) : '—'} />
        <Row k="Paquetes en cola" v={d ? `${d.pending_packets} paquetes` : '—'} />
        <Row k="Latencia a la Tierra" v={d ? `${d.one_way_latency_minutes} min una vía` : '—'} />
        <Row k="Última sincronización" v={d?.last_sync_at ? new Date(d.last_sync_at).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' }) : '—'} />
      </div>
      <button type="button" onClick={() => void toggle()} className="mt-2 w-full rounded bg-space-800 py-2 text-center font-mono text-xs text-slate-300 transition hover:bg-space-700">
        {d?.link === 'LOS' ? 'Abrir ventana de enlace (AOS)' : 'Simular pérdida de señal (LOS)'}
      </button>
    </div>
  )
}

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return <div className="flex justify-between"><span className="text-slate-400">{k}:</span><span className="text-white">{v}</span></div>
}
