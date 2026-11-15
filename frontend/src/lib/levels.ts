import type { StatusLabel } from '../api/types'

/** Colores de nivel (mismo criterio en todo el sistema). Crítico = rojo que parpadea. Etiquetas: i18n `status`. */
export const STATUS_COLOR: Record<StatusLabel, string> = {
  NOMINAL: '#2dd4bf',
  ALERTA_MODERADA: '#38bdf8',
  ALERTA_CRITICA: '#ef4444',
}


export const firstName = (name: string) => name.replace(/^Dra?\.\s*/, '').split(' ')[0]
export const shortName = (name: string) => name.replace(/^Dra?\.\s*/, '')
