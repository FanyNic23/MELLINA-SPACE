/**
 * Barra de progreso segmentada estilo HUD: se enciende en secuencia y el último segmento parpadea.
 * `alarm` (por defecto, daño ≥ 70 %) hace parpadear toda la barra; una barra de carga lo desactiva.
 */
export function SegBar({ pct, color, variant = 'slant', segments = 24, alarm = pct >= 70 }: {
  pct: number; color: string; variant?: 'slant' | 'block'; segments?: number; alarm?: boolean
}) {
  const on = Math.round(Math.max(0, Math.min(100, pct)) / 100 * segments)
  return (
    <div className={`seg-bar seg-${variant} ${alarm ? 'is-critical-bar' : ''}`} style={{ ['--c' as string]: color }} role="img" aria-label={`${Math.round(pct)}%`}>
      {Array.from({ length: segments }, (_, k) => (
        <i key={k} className={`${k < on ? 'on' : ''} ${k === on - 1 ? 'tip' : ''}`} style={{ ['--k' as string]: k }} />
      ))}
    </div>
  )
}
