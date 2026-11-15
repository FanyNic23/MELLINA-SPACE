import { useEffect, useRef, useState } from 'react'
import { api } from '../api/client'
import type { Astronaut, HealthReport, MissionEnvironment } from '../api/types'
import { useI18n, type Dict } from '../i18n'
import { CameraPulse } from '../lib/checkin/cameraPulse'
import '../lib/checkin/checkin.css'
import { STEPS, type Lvl, type Step } from '../lib/checkin/steps'
import { Icon } from './Icon'

const COLOR: Record<Lvl, string> = { ok: '#2dd4bf', watch: '#38bdf8', crit: '#ef4444' }
const PAYLOAD_KEYS = ['systolic_bp', 'diastolic_bp', 'heart_rate', 'spo2', 'glucose_mg_dl', 'core_temp', 'sleep_hours', 'mood_valence', 'mood_arousal', 'pulse_source']

type Values = Record<string, number | string>
type CheckinText = Dict['checkin']

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
  const { t: { checkin: t } } = useI18n()

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const submit = async () => {
    const payload = Object.fromEntries(Object.entries(values).filter(([k]) => PAYLOAD_KEYS.includes(k)))
    if (!Object.keys(payload).some(k => k !== 'pulse_source')) return setError(t.nothing)
    setBusy(true)
    try {
      setResult(await api.checkin(astro.id, payload))
      onDone()
    } catch (err) {
      setError(t.saveFailed((err as Error).message))
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
          <div className="ck-kicker">{t.kicker(String(astro.missionDay).padStart(3, '0'))}</div>
          <div className="ck-who">{astro.name}</div>
          <div className="ck-sub">{sub}</div>
        </div>
        <button type="button" className="ck-x" aria-label={t.close} onClick={onClose}><Icon name="x-circle" size={24} /></button>
      </header>
      <div className="ck-progress">
        {Array.from({ length: STEPS.length + 1 }, (_, i) => <i key={i} className={i < step ? 'done' : i === step ? 'now' : ''} />)}
      </div>
    </>
  )

  return (
    <div className="ck-overlay" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="ck-modal" role="dialog" aria-modal="true" aria-label={t.dialog}>
        {step < STEPS.length ? (
          <>
            {header(t.step(step + 1, STEPS.length))}
            <StepBody key={STEPS[step].id} t={t} step={STEPS[step]} values={values} setValues={setValues} error={error} setError={setError} onEnter={next} />
            <footer className="ck-foot">
              <button type="button" className="ck-ghost" disabled={step === 0} onClick={() => setStep(s => s - 1)}>{t.back}</button>
              <button type="button" className="ck-ghost" onClick={next}>{t.skip}</button>
              <button type="button" className="ck-primary" onClick={() => { if (validate(t, STEPS[step], values, setError)) next() }}>
                {step === STEPS.length - 1 ? t.seeResult : t.next} <Icon name="arrow-right" />
              </button>
            </footer>
          </>
        ) : (
          <>
            {header(result ? t.result : busy ? t.evaluating : t.noValues)}
            {result ? <Summary t={t} result={result} values={values} environment={environment} />
              : <section className="ck-body ck-center">{busy ? t.analyzing : error || t.comeBack}</section>}
            <footer className="ck-foot"><button type="button" className="ck-primary" onClick={onClose}>{t.doneBtn} <Icon name="check-circle" /></button></footer>
          </>
        )}
      </div>
    </div>
  )
}

function validate(t: CheckinText, s: Step, values: Values, setError: (e: string) => void): boolean {
  if (s.mood) {
    if (values.mood_key) return true
    setError(t.pickOption)
    return false
  }
  const text = t.steps[s.id]
  for (const f of s.fields ?? []) {
    const v = values[f.key]
    const label = text.fields[f.key]
    if (v === undefined || v === '') { setError(t.typeValue(label)); return false }
    const n = Number(v)
    if (!Number.isFinite(n) || n < f.min || n > f.max) { setError(t.outOfRange(label, f.min, f.max, text.unit)); return false }
  }
  return true
}

function StepBody({ t, step: s, values, setValues, error, setError, onEnter }: {
  t: CheckinText; step: Step; values: Values; setValues: (fn: (v: Values) => Values) => void; error: string; setError: (e: string) => void; onEnter: () => void
}) {
  const text = t.steps[s.id]
  return (
    <section className="ck-body">
      <div className="ck-title"><span className="ck-ic"><Icon name={s.icon} size={24} /></span><h2>{text.title}</h2></div>
      <div className="ck-grid">
        <div className="ck-col">
          <div className="ck-label">{t.how}</div>
          <ol className="ck-how">{text.how.map(h => <li key={h}>{h}</li>)}</ol>
          <div className="ck-label">{t.why}</div>
          <p className="ck-why">{text.why}</p>
          {text.range && <div className="ck-range">{text.range}</div>}
        </div>
        <div className="ck-col">
          {s.mood ? (
            <div className="ck-moods">
              {s.options!.map(o => (
                <button key={o.key} type="button" className={`ck-mood ${values.mood_key === o.key ? 'on' : ''}`}
                  onClick={() => setValues(v => ({ ...v, mood_key: o.key, mood_valence: o.valence, mood_arousal: o.arousal }))}>
                  <Icon name={o.icon} size={28} /><span>{t.moods[o.key]}</span>
                </button>
              ))}
            </div>
          ) : (
            <div className="ck-fields">
              {s.fields!.map((f, i) => (
                <label key={f.key} className="ck-field">
                  <span>{text.fields[f.key]}</span>
                  <input type="number" inputMode="decimal" min={f.min} max={f.max} step={f.step} placeholder={f.ph} autoFocus={i === 0}
                    value={values[f.key] ?? ''} onChange={e => setValues(v => ({ ...v, [f.key]: e.target.value }))}
                    onKeyDown={e => { if (e.key === 'Enter' && validate(t, s, values, setError)) onEnter() }} />
                  <b>{text.unit}</b>
                </label>
              ))}
            </div>
          )}
          {s.camera && CameraPulse.supported && (
            <CameraMeasure t={t} onPulse={bpm => setValues(v => ({ ...v, heart_rate: bpm, pulse_source: 'camera' }))} onError={setError} />
          )}
          <div className="ck-error">{error}</div>
        </div>
      </div>
    </section>
  )
}

/** Pulso por cámara (rPPG): 15 s de video analizados en el navegador; el video no sale del equipo. */
function CameraMeasure({ t, onPulse, onError }: { t: CheckinText; onPulse: (bpm: number) => void; onError: (e: string) => void }) {
  const video = useRef<HTMLVideoElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const meter = useRef<CameraPulse | null>(null)
  const [live, setLive] = useState(false)
  const [progress, setProgress] = useState(0)
  const [roi, setRoi] = useState<React.CSSProperties>({})
  const [wave, setWave] = useState('')
  const [msg, setMsg] = useState(t.camIdle)
  const [label, setLabel] = useState(t.camStart)

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
      setMsg(t.camMeasuring)
      const { bpm, quality } = await m.measure()
      m.stop()
      if (!bpm || quality < 0.15) {
        setMsg(t.camWeak)
        setLabel(t.camRetry)
        setLive(false)
        return
      }
      onPulse(bpm)
      setMsg(t.camResult(bpm, Math.round(quality * 100)))
    } catch (err) {
      m.stop()
      setLive(false)
      onError((err as Error).name === 'NotAllowedError' ? t.camDenied : t.camFailed)
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

function Summary({ t, result: r, values, environment }: { t: CheckinText; result: HealthReport; values: Values; environment: MissionEnvironment | null }) {
  const { urgency } = useI18n().t
  const level: Lvl = r.status_label === 'ALERTA_CRITICA' ? 'crit' : r.status_label === 'ALERTA_MODERADA' ? 'watch' : 'ok'
  const measured = STEPS.filter(s => (s.mood ? values.mood_key : (s.fields ?? []).every(f => values[f.key] !== undefined)))
  const numeric = Object.fromEntries(Object.entries(values).map(([k, v]) => [k, typeof v === 'string' && v !== '' && !Number.isNaN(+v) ? +v : v]))

  return (
    <section className="ck-body">
      <div className="ck-score" style={{ ['--c' as string]: COLOR[level] }}>
        <div className={`ck-score-n ${level === 'crit' ? 'is-critical' : ''}`}>{String(r.sews_score).padStart(2, '0')}<small>/15</small></div>
        <div><div className="ck-label">SEWS · {t.level[level].toUpperCase()}</div><p className="ck-why">{r.summary_clinical}</p></div>
      </div>

      {r.escalate_to_surgeon ? (
        <div className="ck-alert is-critical-bg">
          <Icon name="warning-octagon" size={28} />
          <div>
            <b>{t.notifySurgeon}</b>
            <span>{r.escalation_reasons.join(' · ')}</span>
            <small><Icon name="paper-plane-tilt" size={14} />
              {environment?.realtime_surgeon ? t.realtime : t.queued}
            </small>
            {environment && <small><Icon name="rocket-launch" size={14} /> {environment.evacuation}</small>}
          </div>
        </div>
      ) : (
        <div className="ck-ok"><Icon name="check-circle" size={24} /><div><b>{t.noNotify}</b><span>{t.noNotifySub}</span></div></div>
      )}

      <div className="ck-grid">
        <div className="ck-col">
          <div className="ck-label">{t.yourReadings}</div>
          {measured.map(s => {
            const st = s.status(numeric)
            return (
              <div key={s.id} className="ck-row">
                <span className="ck-ic sm" style={{ color: COLOR[st] }}><Icon name={s.icon} /></span>
                <span className="flex-1">{t.steps[s.id].title}</span>
                <b>{s.mood ? t.moods[String(values.mood_key)] : `${s.show(numeric)} ${t.steps[s.id].unit}`}</b>
                <em className={st === 'crit' ? 'is-critical' : ''} style={{ color: COLOR[st] }}>{t.level[st]}</em>
              </div>
            )
          })}
        </div>
        <div className="ck-col">
          <div className="ck-label">{t.whyScore}</div>
          {r.score_breakdown.length
            ? r.score_breakdown.map(f => <div key={f.risk} className="ck-factor"><b>+{f.points}</b><span>{f.risk}</span><em>{f.value}</em></div>)
            : <div className="ck-why">{t.allInRange}</div>}
        </div>
      </div>

      <div className="ck-label">{t.whatNow}</div>
      <div className="ck-actions">
        {r.active_countermeasures.slice(0, 3).map(c => (
          <div key={c.id} className="ck-action">
            <div className="flex justify-between gap-2">
              <b>{c.title}</b>
              <em className={c.urgency === 'INMEDIATA' ? 'is-critical' : ''}
                style={{ color: c.urgency === 'INMEDIATA' ? COLOR.crit : c.urgency === 'ALTA' ? COLOR.watch : COLOR.ok }}>{urgency[c.urgency]}</em>
            </div>
            <p>{c.action_protocol.split('\n')[0].replace(/^1\.\s*/, '')}</p>
          </div>
        ))}
      </div>
    </section>
  )
}
