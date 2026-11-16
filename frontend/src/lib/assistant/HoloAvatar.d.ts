import type { StatusLabel } from '../../api/types'

export type AvatarMode = 'idle' | 'listening' | 'thinking' | 'speaking'

/** Holograma 3D del asistente Mellina: escaneo real de un busto dibujado con líneas de escaneo (empaquetado, sin red). */
export class HoloAvatar {
  constructor(canvas: HTMLCanvasElement)
  setMouth(open: number, width: number): void
  setMode(mode: AvatarMode): void
  lookAt(x: number, y: number): void
  setStatus(status: StatusLabel): void
  dispose(): void
}
