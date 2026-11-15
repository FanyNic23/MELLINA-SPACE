// Visor 3D compartido: el cuerpo, la barra del gemelo digital y los paneles leen y controlan el mismo modelo.
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { Astronaut } from '../api/types'
import type { BodyModel, BodyView, HazardStatus, SystemStatus } from '../lib/body/BodyModel'
import { setEnvironment } from '../lib/body/clinicalMap'
import { useMission } from './mission'

interface BodyState {
  model: BodyModel | null
  attach: (m: BodyModel | null) => void
  view: BodyView
  setView: (v: BodyView) => void
  systems: SystemStatus[]
  hazards: HazardStatus[]
  /** Tripulante proyectado por el gemelo digital (null = estado actual). */
  projection: Astronaut | null
  setProjection: (a: Astronaut | null) => void
}

const BodyContext = createContext<BodyState | null>(null)

export function BodyProvider({ children }: { children: ReactNode }) {
  const { current, environment } = useMission()
  const [model, attach] = useState<BodyModel | null>(null)
  const [view, setView] = useState<BodyView>({ mode: null, id: null })
  const [projection, setProjection] = useState<Astronaut | null>(null)
  const [systems, setSystems] = useState<SystemStatus[]>([])
  const [hazards, setHazards] = useState<HazardStatus[]>([])

  const shown = projection ?? current
  useEffect(() => {
    if (!model || !shown) return
    if (environment) setEnvironment(environment) // umbrales del entorno (radiación, CO2, gravedad) antes de evaluar
    // Sincroniza la escena 3D (sistema externo) y lee el estado que calcula para pintar los paneles.
    // oxlint-disable-next-line react/set-state-in-effect
    setSystems(model.update(shown))
    setHazards(model.hazards())
  }, [model, shown, environment])

  const value = useMemo(() => ({ model, attach, view, setView, systems, hazards, projection, setProjection }),
    [model, view, systems, hazards, projection])
  return <BodyContext.Provider value={value}>{children}</BodyContext.Provider>
}

export function useBody(): BodyState {
  const ctx = useContext(BodyContext)
  if (!ctx) throw new Error('useBody debe usarse dentro de <BodyProvider>')
  return ctx
}

/** Desde un riesgo del diagnóstico o un factor del SEWS: vuela al órgano. */
export function useInspect() {
  const { model } = useBody()
  return useCallback((id: Parameters<BodyModel['focusSystem']>[0]) => model?.focusSystem(id), [model])
}
