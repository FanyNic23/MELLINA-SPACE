import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import markRaw from '../assets/brand/ahams-mark.svg?raw'
import wordRaw from '../assets/brand/ahams-word.svg?raw'
import { useI18n } from '../i18n'
import { loadAnatomy } from '../lib/body/BodyModel'
import { useMission } from '../state/mission'
import { Icon } from './Icon'
import { SegBar } from './SegBar'
import './splash.css'

type CheckId = 'core' | 'sews' | 'anatomy' | 'voice' | 'link' | 'env'
const ORDER: CheckId[] = ['core', 'sews', 'anatomy', 'voice', 'link', 'env']
const MIN_MS = 3200       // duración mínima de la secuencia (para que se lea)
const MAX_MS = 9000       // nunca bloquea más de esto
const STAGGER_MS = 330    // aparición escalonada de cada línea
const EXIT_MS = 900

/** Extrae viewBox y trazado de un SVG de una sola ruta (la marca vectorizada). */
function vector(raw: string) {
  return { viewBox: /viewBox="([^"]+)"/.exec(raw)![1], d: /\sd="([^"]+)"/.exec(raw)![1] }
}

/**
 * Arranque del sistema: la marca se dibuja con un trazo, se enciende y una secuencia de verificación
 * real (Edge Core, motor SEWS, anatomía 3D, voz local, enlace y entorno) llena la barra. Al terminar,
 * la pantalla se abre hacia el dashboard. Se salta con un clic o una tecla.
 */
export function Splash({ onDone }: { onDone: () => void }) {
  const { crew, environment, offline } = useMission()
  const { t } = useI18n()
  const s = t.splash
  const mark = useMemo(() => vector(markRaw), [])
  const word = useMemo(() => vector(wordRaw), [])
  const [anatomy, setAnatomy] = useState(false)
  const [health, setHealth] = useState<{ voice: boolean; link: string } | null>(null)
  const [shown, setShown] = useState(0)
  const [minDone, setMinDone] = useState(false)
  const [exiting, setExiting] = useState(false)
  const finished = useRef(false)

  // Trabajo real del arranque: precarga la anatomía y consulta el estado del Edge Core.
  useEffect(() => {
    void loadAnatomy().then(() => setAnatomy(true)).catch(() => setAnatomy(true))
    fetch('/health').then(r => r.json())
      .then(h => setHealth({ voice: Boolean(h.stt?.available), link: h.link }))
      .catch(() => setHealth({ voice: false, link: 'LOS' }))
    const tick = window.setInterval(() => setShown(n => Math.min(n + 1, ORDER.length)), STAGGER_MS)
    const min = window.setTimeout(() => setMinDone(true), MIN_MS)
    const max = window.setTimeout(() => setMinDone(true), MAX_MS)
    return () => { window.clearInterval(tick); window.clearTimeout(min); window.clearTimeout(max) }
  }, [])

  const values: Record<CheckId, string | null> = {
    core: crew.length ? s.online : null,
    sews: crew.length ? s.assessed(crew.length) : null,
    anatomy: anatomy ? s.ready : null,
    voice: health ? (health.voice ? s.ready : s.textOnly) : null,
    link: health ? (health.link === 'AOS' ? s.aos : s.los) : null,
    env: environment ? environment.short.toUpperCase() : null,
  }
  const done = ORDER.filter((id, i) => i < shown && values[id] !== null).length
  const complete = done === ORDER.length

  const finish = useCallback(() => {
    if (finished.current) return
    finished.current = true
    setExiting(true)
    window.setTimeout(onDone, EXIT_MS)
  }, [onDone])

  useEffect(() => {
    if (offline) onDone() // sin Edge Core manda el aviso de conexión, no la intro
    else if (complete && minDone) finish()
  }, [complete, minDone, offline, onDone, finish])

  useEffect(() => {
    window.addEventListener('keydown', finish)
    return () => window.removeEventListener('keydown', finish)
  }, [finish])

  return (
    <div className={`splash ${exiting ? 'is-exiting' : ''}`} onClick={finish} role="status" aria-live="polite" aria-label="A-HAMS">
      <div className="splash-scan" />
      <div className="splash-corners" aria-hidden="true"><i /><i /><i /><i /></div>

      <div className="splash-core">
        <div className="splash-emblem">
          <svg className="splash-rings" viewBox="0 0 200 200" aria-hidden="true">
            <circle className="ring ring-1" cx="100" cy="100" r="60" />
            <circle className="ring ring-2" cx="100" cy="100" r="60" />
            <circle className="orbit" cx="100" cy="100" r="92" />
            <path className="orbit-arc" d="M100 8 a92 92 0 0 1 64 26" />
          </svg>
          <svg className="splash-mark" viewBox={mark.viewBox} aria-hidden="true">
            <path className="mark-fill" d={mark.d} fillRule="evenodd" />
            <path className="mark-stroke" d={mark.d} fillRule="evenodd" pathLength={1} />
          </svg>
        </div>

        <svg className="splash-word" viewBox={word.viewBox} aria-hidden="true"><path d={word.d} fillRule="evenodd" /></svg>
        <div className="splash-tagline">{t.header.tagline}</div>

        <div className="splash-boot">
          {ORDER.map((id, i) => {
            const value = i < shown ? values[id] : null
            return (
              <div key={id} className={`boot-line ${i < shown ? 'is-on' : ''} ${value ? 'is-ok' : ''}`}>
                <span className="boot-icon"><Icon name={value ? 'check-circle' : 'circle-notch'} size={14} /></span>
                <span className="boot-label">{s.checks[id]}</span>
                <span className="boot-value">{value}</span>
              </div>
            )
          })}
        </div>

        <div className="splash-progress">
          <SegBar pct={(done / ORDER.length) * 100} color="#22d3ee" variant="slant" segments={32} alarm={false} />
          <div className="splash-progress-meta">
            <span>{complete ? s.online : s.initializing}</span>
            <b>{Math.round((done / ORDER.length) * 100)}%</b>
          </div>
        </div>
      </div>

      <div className="splash-skip">{s.skip}</div>
    </div>
  )
}
