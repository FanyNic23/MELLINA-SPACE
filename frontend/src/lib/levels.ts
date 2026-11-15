import type { StatusLabel } from '../api/types'

/** Colores y etiquetas de nivel (mismo criterio en todo el sistema). Crítico = rojo que parpadea. */
export const STATUS_COLOR: Record<StatusLabel, string> = {
  NOMINAL: '#2dd4bf',
  ALERTA_MODERADA: '#38bdf8',
  ALERTA_CRITICA: '#ef4444',
}

export const STATUS_LABEL: Record<StatusLabel, string> = {
  NOMINAL: 'NOMINAL',
  ALERTA_MODERADA: 'VIGILAR',
  ALERTA_CRITICA: 'CRÍTICO',
}

export const LEVEL_COLORS = ['#2dd4bf', '#38bdf8', '#ef4444'] as const
export const LEVEL_LABELS = ['NOMINAL', 'VIGILAR', 'CRÍTICO'] as const

export const firstName = (name: string) => name.replace(/^Dra?\.\s*/, '').split(' ')[0]
export const shortName = (name: string) => name.replace(/^Dra?\.\s*/, '')
