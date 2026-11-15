import { useEffect, useRef, useState } from 'react'
import { api } from '../api/client'
import type { Astronaut, HealthReport, MissionEnvironment } from '../api/types'
import { CameraPulse } from '../lib/checkin/cameraPulse'
import '../lib/checkin/checkin.css'
import { STEPS, type Lvl, type Step } from '../lib/checkin/steps'
import { Icon } from './Icon'

const COLOR: Record<Lvl, string> = { ok: '#2dd4bf', watch: '#38bdf8', crit: '#ef4444' }
const LEVEL_TEXT: Record<Lvl, string> = { ok: 'En rango', watch: 'Vigilar', crit: 'Crítico' }
const PAYLOAD_KEYS = ['systolic_bp', 'diastolic_bp', 'heart_rate', 'spo2', 'glucose_mg_dl', 'core_temp', 'sleep_hours', 'mood_valence', 'mood_arousal', 'pulse_source']

type Values = Record<string, number | string>

/**
 * Chequeo diario guiado: el astronauta se mide (teclado, clic o cámara), entiende su resultado
 * (semáforo y SEWS explicado) y sabe qué hacer (contramedidas y cuándo avisar al cirujano de vuelo).
 */
export function CheckinWizard({ astro, environment, onClose, onDone }: {
  astro: Astronaut; environment: MissionEnvironment | null; onClose: () => void; onDone: () => void
}) {
  const [step, setStep] = useState(0)
  const [values, setValues] = useState<Values>({})
  const [result, setResult] = useState<HealthReport | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const submit = async () => {
    const payload = Object.fromEntries(Object.entries(values).filter(([k]) => PAYLOAD_KEYS.includes(k)))
    if (!Object.keys(payload).some(k => k !== 'pulse_source')) return setError('No registraste ningún valor.')
    setBusy(true)
    try {
      setResult(await api.checkin(astro.id, payload))
      onDone()
    } catch (err) {
      setError(`No se pudo guardar el chequeo: ${(err as Error).message}`)
    } finally {
      setBusy(false)
    }
  }

  const next = () => {
    setError('')
    if (step === STEPS.length - 1) void submit()
    setStep(s => s + 1)
  }

  const header = (sub: string) => (
    <>
      <header className="ck-head">
        <img src={astro.photo} alt="" />
        <div className="min-w-0">
          <div className="ck-kicker">CHEQUEO DIARIO · SOL {String(astro.missionDay).padStart(3, '0')}</div>
          <div className="ck-who">{astro.name}</div>
          <div className="ck-sub">{sub}</div>
        </div>
        <button type="button" className="ck-x" aria-label="Cerrar" onClick={onClose}><Icon name="x-circle" size={24} /></button>
      </header>
      <div className="ck-progress">
        {Array.from({ length: STEPS.length + 1 }, (_, i) => <i key={i} className={i < step ? 'done' : i === step ? 'now' : ''} />)}
      </div>
    </>
  )

  return (
    <div className="ck-overlay" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="ck-modal" role="dialog" aria-modal="true" aria-label="Chequeo diario">
        {step < STEPS.length ? (
          <>
            {header(`Paso ${step + 1} de ${STEPS.length}`)}
            <StepBody key={STEPS[step].id} step={STEPS[step]} values={values} setValues={setValues} error={error} setError={setError} onEnter={next} />
            <footer className="ck-foot">
              <button type="button" className="ck-ghost" disabled={step === 0} onClick={() => setStep(s => s - 1)}>Atrás</button>
              <button type="button" className="ck-ghost" onClick={next}>Omitir</button>
              <button type="button" className="ck-primary" onClick={() => { if (validate(STEPS[step], values, setError)) next() }}>
                {step === STEPS.length - 1 ? 'Ver mi evaluación' : 'Siguiente'} <Icon name="arrow-right" />
              </button>
            </footer>
          </>
        ) : (
          <>
            {header(result ? 'Tu evaluación' : busy ? 'Evaluando en el Edge Core…' : 'Sin mediciones')}
            {result ? <Summary result={result} values={values} environment={environment} />
              : <section className="ck-body ck-center">{busy ? 'Analizando tus mediciones…' : error || 'Vuelve cuando tengas tus mediciones.'}</section>}
            <footer className="ck-foot"><button type="button" className="ck-primary" onClick={onClose}>Listo <Icon name="check-circle" /></button></footer>
          </>
        )}
      </div>
    </div>
  )
}

function validate(s: Step, values: Values, setError: (e: string) => void): boolean {
  if (s.mood) {
    if (values.mood_key) return true
    setError('Elige una opción o pulsa Omitir.')
    return false
  }
  for (const f of s.fields ?? []) {
    const v = values[f.key]
    if (v === undefined || v === '') { setError(`Escribe ${f.label.toLowerCase()} o pulsa Omitir.`); return false }
    const n = Number(v)
    if (!Number.isFinite(n) || n < f.min || n > f.max) { setError(`${f.label}: el valor debe estar entre ${f.min} y ${f.max} ${s.unit}.`); return false }
  }
  return true
}

function StepBody({ step: s, values, setValues, error, setError, onEnter }: {
  step: Step; values: Values; setValues: (fn: (v: Values) => Values) => void; error: string; setError: (e: string) => void; onEnter: () => void
}) {
  return (
    <section className="ck-body">
      <div className="ck-title"><span className="ck-ic"><Icon name={s.icon} size={24} /></span><h2>{s.title}</h2></div>
      <div className="ck-grid">
        <div className="ck-col">
          <div className="ck-label">CÓMO MEDIRLO</div>
          <ol className="ck-how">{s.how.map(h => <li key={h}>{h}</li>)}</ol>
          <div className="ck-label">POR QUÉ IMPORTA EN EL ESPACIO</div>
          <p className="ck-why">{s.why}</p>
          {s.range && <div className="ck-range">{s.range}</div>}
        </div>
        <div className="ck-col">
          {s.mood ? (
            <div className="ck-moods">
              {s.options!.map(o => (
                <button key={o.key} type="button" className={`ck-mood ${values.mood_key === o.key ? 'on' : ''}`}
                  onClick={() => setValues(v => ({ ...v, mood_key: o.key, mood_label: o.label, mood_valence: o.valence, mood_arousal: o.arousal }))}>
                  <Icon name={o.icon} size={28} /><span>{o.label}</span>
                </button>
              ))}
            </div>
          ) : (
            <div className="ck-fields">
              {s.fields!.map((f, i) => (
                <label key={f.key} className="ck-field">
                  <span>{f.label}</span>
                  <input type="number" inputMode="decimal" min={f.min} max={f.max} step={f.step} placeholder={f.ph} autoFocus={i === 0}
                    value={values[f.key] ?? ''} onChange={e => setValues(v => ({ ...v, [f.key]: e.target.value }))}
                    onKeyDown={e => { if (e.key === 'Enter' && validate(s, values, setError)) onEnter() }} />
                  <b>{s.unit}</b>
                </label>
              ))}
            </div>
          )}
          {s.camera && CameraPulse.supported && (
            <CameraMeasure onPulse={bpm => setValues(v => ({ ...v, heart_rate: bpm, pulse_source: 'camera' }))} onError={setError} />
          )}
          <div className="ck-error">{error}</div>
        </div>
      </div>
    </section>
  )
}

/** Pulso por cámara (rPPG): 15 s de video analizados en el navegador; el video no sale del equipo. */
function CameraMeasure({ onPulse, onError }: { onPulse: (bpm: number) => void; onError: (e: string) => void }) {
  const video = useRef<HTMLVideoElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const meter = useRef<CameraPulse | null>(null)
  const [live, setLive] = useState(false)
  const [progress, setProgress] = useState(0)
  const [roi, setRoi] = useState<React.CSSProperties>({})
  const [wave, setWave] = useState('')
  const [msg, setMsg] = useState('Centra tu cara en el recuadro y quédate quieto.')
  const [label, setLabel] = useState('Medir con la cámara (15 s)')

  useEffect(() => () => meter.current?.stop(), [])

  const start = async () => {
    setLive(true)
    const m = new CameraPulse(video.current!, canvas.current!, {
      seconds: 15,
      onProgress: k => setProgress(k),
      onSignal: (vals, r, w, h) => {
        setRoi({ left: `${r.x / w * 100}%`, top: `${r.y / h * 100}%`, width: `${r.w / w * 100}%`, height: `${r.h / h * 100}%` })
        if (vals.length < 3) return
        const lo = Math.min(...vals), hi = Math.max(...vals)
        setWave(vals.map((y, i) => `${i ? 'L' : 'M'}${(i / (vals.length - 1) * 300).toFixed(1)} ${(55 - (y - lo) / ((hi - lo) || 1) * 50).toFixed(1)}`).join(' '))
      },
    })
    meter.current = m
    try {
      await m.start()
      setMsg('Midiendo… no te muevas.')
      const { bpm, quality } = await m.measure()
      m.stop()
      if (!bpm || quality < 0.15) {
        setMsg('Señal débil: mejora la luz y quédate quieto, o escribe el pulso a mano.')
        setLabel('Repetir medición')
        setLive(false)
        return
      }
      onPulse(bpm)
      setMsg(`Pulso estimado: ${bpm} lpm · calidad de señal ${Math.round(quality * 100)} %`)
    } catch (err) {
      m.stop()
      setLive(false)
      onError((err as Error).name === 'NotAllowedError' ? 'Sin permiso para la cámara: escribe el pulso a mano.' : 'No se pudo usar la cámara: escribe el pulso a mano.')
    }
  }

  return (
    <div className="ck-cam">
      {!live && <button type="button" className="ck-cam-btn" onClick={() => void start()}><Icon name="camera" size={20} /> {label}</button>}
      <div className="ck-cam-live" hidden={!live}>
        <div className="ck-video"><video ref={video} playsInline muted /><span className="ck-roi" style={roi} /></div>
        <canvas ref={canvas} hidden />
        <svg className="ck-wave" viewBox="0 0 300 60" preserveAspectRatio="none"><path d={wave} /></svg>
        <div className="ck-cam-bar"><i style={{ width: `${Math.round(progress * 100)}%` }} /></div>
      </div>
      <div className="ck-cam-msg">{msg}</div>
    </div>
  )
}

function Summary({ result: r, values, environment }: { result: HealthReport; values: Values; environment: MissionEnvironment | null }) {
  const level: Lvl = r.status_label === 'ALERTA_CRITICA' ? 'crit' : r.status_label === 'ALERTA_MODERADA' ? 'watch' : 'ok'
  const measured = STEPS.filter(s => (s.mood ? values.mood_key : (s.fields ?? []).every(f => values[f.key] !== undefined)))
  const numeric = Object.fromEntries(Object.entries(values).map(([k, v]) => [k, typeof v === 'string' && v !== '' && !Number.isNaN(+v) ? +v : v]))

  return (
    <section className="ck-body">
      <div className="ck-score" style={{ ['--c' as string]: COLOR[level] }}>
        <div className={`ck-score-n ${level === 'crit' ? 'is-critical' : ''}`}>{String(r.sews_score).padStart(2, '0')}<small>/15</small></div>
        <div><div className="ck-label">SEWS · {LEVEL_TEXT[level].toUpperCase()}</div><p className="ck-why">{r.summary_clinical}</p></div>
      </div>

      {r.escalate_to_surgeon ? (
        <div className="ck-alert is-critical-bg">
          <Icon name="warning-octagon" size={28} />
          <div>
            <b>Avisa al cirujano de vuelo</b>
            <span>{r.escalation_reasons.join(' · ')}</span>
            <small><Icon name="paper-plane-tilt" size={14} />
              {environment?.realtime_surgeon
                ? 'Enlace en tiempo real con la Tierra: llama ahora al cirujano de vuelo. Tu chequeo ya le llegó.'
                : 'Tu chequeo ya está en la cola prioritaria hacia la Tierra y sale en la próxima ventana de enlace.'}
            </small>
            {environment && <small><Icon name="rocket-launch" size={14} /> {environment.evacuation}</small>}
          </div>
        </div>
      ) : (
        <div className="ck-ok"><Icon name="check-circle" size={24} /><div><b>No necesitas avisar a la Tierra</b><span>Sigue las acciones de abajo y repite el chequeo mañana.</span></div></div>
      )}

      <div className="ck-grid">
        <div className="ck-col">
          <div className="ck-label">TUS MEDICIONES</div>
          {measured.map(s => {
            const st = s.status(numeric)
            return (
              <div key={s.id} className="ck-row">
                <span className="ck-ic sm" style={{ color: COLOR[st] }}><Icon name={s.icon} /></span>
                <span className="flex-1">{s.title}</span>
                <b>{s.show(numeric)} {s.unit}</b>
                <em className={st === 'crit' ? 'is-critical' : ''} style={{ color: COLOR[st] }}>{LEVEL_TEXT[st]}</em>
              </div>
            )
          })}
        </div>
        <div className="ck-col">
          <div className="ck-label">POR QUÉ ESTE SEWS</div>
          {r.score_breakdown.length
            ? r.score_breakdown.map(f => <div key={f.risk} className="ck-factor"><b>+{f.points}</b><span>{f.risk}</span><em>{f.value}</em></div>)
            : <div className="ck-why">Ningún indicador suma puntos: todo en rango.</div>}
        </div>
      </div>

      <div className="ck-label">QUÉ HACER AHORA</div>
      <div className="ck-actions">
        {r.active_countermeasures.slice(0, 3).map(c => (
          <div key={c.id} className="ck-action">
            <div className="flex justify-between gap-2">
              <b>{c.title}</b>
              <em className={c.urgency === 'INMEDIATA' ? 'is-critical' : ''}
                style={{ color: c.urgency === 'INMEDIATA' ? COLOR.crit : c.urgency === 'ALTA' ? COLOR.watch : COLOR.ok }}>{c.urgency}</em>
            </div>
            <p>{c.action_protocol.split('\n')[0].replace(/^1\.\s*/, '')}</p>
          </div>
        ))}
      </div>
    </section>
  )
}
