import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import markRaw from '../assets/brand/ahams-mark.svg?raw'
import wordRaw from '../assets/brand/ahams-word.svg?raw'
import { loadAnatomy } from '../lib/body/BodyModel'
import { useMission } from '../state/mission'
import { SegBar } from './SegBar'
import './splash.css'

const MIN_MS = 3200       // duración mínima: deja ver la marca dibujándose
const MAX_MS = 9000       // nunca bloquea más de esto
const STAGGER_MS = 330    // la barra avanza de a un paso aunque el sistema responda al instante
const EXIT_MS = 900
const STEPS = 4

/** Extrae viewBox y trazado de un SVG de una sola ruta (la marca vectorizada). */
function vector(raw: string) {
  return { viewBox: /viewBox="([^"]+)"/.exec(raw)![1], d: /\sd="([^"]+)"/.exec(raw)![1] }
}

/**
 * Arranque del sistema, solo con la marca: se dibuja con un trazo, se enciende y la barra se llena con
 * lo que de verdad está listo (tripulación evaluada, anatomía 3D, Edge Core y entorno). Al terminar,
 * la pantalla se abre hacia el dashboard. Se salta con un clic o una tecla.
 */
export function Splash({ onDone }: { onDone: () => void }) {
  const { crew, environment, offline } = useMission()
  const mark = useMemo(() => vector(markRaw), [])
  const word = useMemo(() => vector(wordRaw), [])
  const [anatomy, setAnatomy] = useState(false)
  const [core, setCore] = useState(false)
  const [shown, setShown] = useState(0)
  const [minDone, setMinDone] = useState(false)
  const [exiting, setExiting] = useState(false)
  const finished = useRef(false)

  // Trabajo real del arranque: precarga la anatomía y consulta el estado del Edge Core.
  useEffect(() => {
    void loadAnatomy().then(() => setAnatomy(true)).catch(() => setAnatomy(true))
    fetch('/health').finally(() => setCore(true))
    const tick = window.setInterval(() => setShown(n => Math.min(n + 1, STEPS)), STAGGER_MS)
    const min = window.setTimeout(() => setMinDone(true), MIN_MS)
    const max = window.setTimeout(() => setMinDone(true), MAX_MS)
    return () => { window.clearInterval(tick); window.clearTimeout(min); window.clearTimeout(max) }
  }, [])

  const ready = [crew.length > 0, anatomy, core, Boolean(environment)]
  const done = Math.min(shown, ready.filter(Boolean).length)
  const complete = done === STEPS

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

        <div className="splash-progress">
          <SegBar pct={(done / STEPS) * 100} color="#22d3ee" variant="slant" segments={32} alarm={false} />
        </div>
      </div>
    </div>
  )
}
