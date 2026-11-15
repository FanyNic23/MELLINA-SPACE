/** Barra de progreso segmentada estilo HUD: se enciende en secuencia; el último segmento parpadea; crítico parpadea. */
export function SegBar({ pct, color, variant = 'slant', segments = 24 }: { pct: number; color: string; variant?: 'slant' | 'block'; segments?: number }) {
  const on = Math.round(Math.max(0, Math.min(100, pct)) / 100 * segments)
  return (
    <div className={`seg-bar seg-${variant} ${pct >= 70 ? 'is-critical-bar' : ''}`} style={{ ['--c' as string]: color }} role="img" aria-label={`${Math.round(pct)}%`}>
      {Array.from({ length: segments }, (_, k) => (
        <i key={k} className={`${k < on ? 'on' : ''} ${k === on - 1 ? 'tip' : ''}`} style={{ ['--k' as string]: k }} />
      ))}
    </div>
  )
}
