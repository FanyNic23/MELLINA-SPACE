import { CategoryScale, Chart, LinearScale, LineController, LineElement, PointElement, Tooltip } from 'chart.js'
import { useEffect, useRef } from 'react'
import type { Astronaut } from '../api/types'

Chart.register(LineController, LineElement, PointElement, LinearScale, CategoryScale, Tooltip)

/** Tendencia de la misión: HRV (cian) y Δ masa muscular (blanco), sin puntos ni leyenda. */
export function TrendChart({ astro }: { astro: Astronaut }) {
  const canvas = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    if (!canvas.current) return
    const ticks = (color: string) => ({ color, font: { size: 9, family: 'monospace' }, maxTicksLimit: 4 })
    const line = (data: number[], color: string, yAxisID: string) => ({
      data, borderColor: color, borderWidth: 2, tension: 0.35, yAxisID, pointRadius: 0, pointHoverRadius: 3, pointBackgroundColor: color,
    })
    const chart = new Chart(canvas.current, {
      type: 'line',
      data: {
        labels: astro.history.days.map(d => `S${d}`),
        datasets: [line(astro.history.hrv, '#22d3ee', 'y'), line(astro.history.muscle, '#f8fafc', 'y1')],
      },
      options: {
        responsive: true, maintainAspectRatio: false, animation: false,
        interaction: { mode: 'index', intersect: false },
        plugins: { legend: { display: false } },
        scales: {
          x: { grid: { display: false }, ticks: ticks('#64748b') },
          y: { position: 'left', grid: { color: '#121820' }, ticks: ticks('#22d3ee') },
          y1: { position: 'right', grid: { drawOnChartArea: false }, ticks: ticks('#f8fafc') },
        },
      },
    })
    return () => chart.destroy()
  }, [astro])

  return <canvas ref={canvas} aria-label="Tendencia de HRV y masa muscular" role="img" />
}
