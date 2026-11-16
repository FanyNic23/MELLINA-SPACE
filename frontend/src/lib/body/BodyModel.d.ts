import type { Astronaut, SystemId } from '../../api/types'

export interface Anatomy {
  manifest: { bounds: [number[], number[]]; meshes: unknown[]; source: string }
  buffer: ArrayBuffer
}

export interface BodyView { mode: 'system' | 'hazard' | null; id: string | null }

export interface SystemStatus {
  id: SystemId; label: string; organ: string; level: 0 | 1 | 2; levelLabel: string; color: string; damage: number; detail: string
}

export interface HazardStatus {
  id: string; name: string; icon: string; summary: string; systems: SystemId[]; severity: number
  level: 0 | 1 | 2; levelLabel: string; color: string
}

/** Descarga (una vez) el modelo anatómico BodyParts3D empaquetado. */
export function loadAnatomy(): Promise<Anatomy>

/** Visor 3D del cuerpo con HUD: cámara orbital, zoom al órgano, amenazas animadas. */
export class BodyModel {
  constructor(container: HTMLElement, opts: { anatomy: Anatomy; onChange?: (view: BodyView) => void; fullscreenTarget?: HTMLElement })
  update(astro: Astronaut): SystemStatus[]
  status(): SystemStatus[]
  hazards(): HazardStatus[]
  focusSystem(id: SystemId): void
  showHazard(id: string): void
  reset(): void
  /** Entrada: deja la cámara muy cerca del cuerpo hasta playIntro(). */
  holdIntro(): void
  /** Entrada: aleja la cámara girando hasta la vista general. */
  playIntro(): void
  dispose(): void
}
