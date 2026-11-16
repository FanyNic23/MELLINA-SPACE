import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import markRaw from '../assets/brand/ahams-mark.svg?raw'
import wordRaw from '../assets/brand/ahams-word.svg?raw'
import { loadAnatomy } from '../lib/body/BodyModel'
import { useMission } from '../state/mission'
import './splash.css'

const MIN_MS = 3600       // duración mínima: la marca termina de componerse
const MAX_MS = 9000       // nunca bloquea más de esto
const EXIT_MS = 800

/** Extrae viewBox y trazado de un SVG de una sola ruta (la marca vectorizada). */
function vector(raw: string) {
  return { viewBox: /viewBox="([^"]+)"/.exec(raw)![1], d: /\sd="([^"]+)"/.exec(raw)![1] }
}

/** Separa la marca en sus dos piezas: la A (subtrazos 0 y 2) y la órbita que la rodea (1 y 3). */
function markParts(d: string) {
  const sub = d.split(/(?=M )/).map(p => p.trim()).filter(Boolean)
  return { a: `${sub[0]} ${sub[2]}`, orbit: `${sub[1]} ${sub[3]}` }
}

/**
 * Arranque del sistema: la A se levanta desde su base, la órbita la rodea de izquierda a derecha y el
 * nombre aparece a su lado. Mientras tanto se precarga lo que necesita el dashboard (tripulación evaluada,
 * anatomía 3D, Edge Core y entorno); al estar listo, el logo se disuelve hacia el dashboard.
 * Se salta con un clic o una tecla.
 */
export function Splash({ onDone }: { onDone: () => void }) {
  const { crew, environment, offline } = useMission()
  const mark = useMemo(() => vector(markRaw), [])
  const word = useMemo(() => vector(wordRaw), [])
  const parts = useMemo(() => markParts(mark.d), [mark.d])
  const maskId = `splash-orbit-${useId().replace(/:/g, '')}`
  const [anatomy, setAnatomy] = useState(false)
  const [core, setCore] = useState(false)
  const [minDone, setMinDone] = useState(false)
  const [exiting, setExiting] = useState(false)
  const finished = useRef(false)

  // Trabajo real del arranque: precarga la anatomía y consulta el estado del Edge Core.
  useEffect(() => {
    void loadAnatomy().then(() => setAnatomy(true)).catch(() => setAnatomy(true))
    fetch('/health').finally(() => setCore(true))
    const min = window.setTimeout(() => setMinDone(true), MIN_MS)
    const max = window.setTimeout(() => setMinDone(true), MAX_MS)
    return () => { window.clearTimeout(min); window.clearTimeout(max) }
  }, [])

  const complete = crew.length > 0 && anatomy && core && Boolean(environment)

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
      <div className="splash-logo">
        <svg className="splash-mark" viewBox={mark.viewBox} aria-hidden="true">
          <defs>
            {/* Barrido de la órbita: un frente suave que avanza de izquierda a derecha */}
            <linearGradient id={`${maskId}-g`}>
              <stop offset="0.8" stopColor="#fff" />
              <stop offset="1" stopColor="#fff" stopOpacity="0" />
            </linearGradient>
            <mask id={maskId} maskUnits="userSpaceOnUse">
              <rect className="orbit-sweep" x="-1100" y="0" width="1100" height="480" fill={`url(#${maskId}-g)`} />
            </mask>
          </defs>
          <path className="mark-a" d={parts.a} fillRule="evenodd" />
          <path className="mark-orbit" d={parts.orbit} fillRule="evenodd" mask={`url(#${maskId})`} />
        </svg>
        <svg className="splash-word" viewBox={word.viewBox} aria-hidden="true"><path d={word.d} fillRule="evenodd" /></svg>
      </div>
    </div>
  )
}
