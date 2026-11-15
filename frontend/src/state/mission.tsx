// Estado de la misión compartido por toda la app: tripulación (del motor clínico), tripulante
// seleccionado, entorno de misión y disponibilidad del Edge Core.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { api, OfflineError } from '../api/client'
import type { Astronaut, MissionEnvironment } from '../api/types'

interface MissionState {
  crew: Astronaut[]
  current: Astronaut | null
  select: (id: string) => void
  refresh: () => Promise<void>
  environment: MissionEnvironment | null
  environments: MissionEnvironment[]
  setEnvironment: (id: string) => Promise<void>
  offline: boolean
  /** Versión de los datos: cambia tras cada recarga (chequeo, simulación, entorno). */
  version: number
}

const MissionContext = createContext<MissionState | null>(null)

export function MissionProvider({ children }: { children: ReactNode }) {
  const [crew, setCrew] = useState<Astronaut[]>([])
  const [currentId, setCurrentId] = useState<string>(() => new URLSearchParams(location.search).get('crew') ?? 'ASTRO-01')
  const [environment, setEnv] = useState<MissionEnvironment | null>(null)
  const [environments, setEnvs] = useState<MissionEnvironment[]>([])
  const [offline, setOffline] = useState(false)
  const [version, setVersion] = useState(0)
  const retry = useRef<number | undefined>(undefined)

  const refresh = useCallback(async function load(): Promise<void> {
    try {
      const [list, env] = await Promise.all([api.loadCrew(), api.environment()])
      setCrew(list)
      setEnv(env.active)
      setEnvs(env.available)
      setOffline(false)
      setVersion(v => v + 1)
    } catch (err) {
      if (!(err instanceof OfflineError)) console.warn('[A-HAMS]', err)
      setOffline(true)
      window.clearTimeout(retry.current)
      retry.current = window.setTimeout(() => void load(), 3000) // reintenta hasta que el Edge Core arranque
    }
  }, [])

  useEffect(() => {
    // Carga inicial desde el Edge Core (sistema externo).
    // oxlint-disable-next-line react/set-state-in-effect
    void refresh()
    return () => window.clearTimeout(retry.current)
  }, [refresh])

  const setEnvironment = useCallback(async (id: string) => {
    await api.setEnvironment(id)
    await refresh()
  }, [refresh])

  const value = useMemo<MissionState>(() => ({
    crew,
    current: crew.find(a => a.id === currentId) ?? crew[0] ?? null,
    select: setCurrentId,
    refresh,
    environment,
    environments,
    setEnvironment,
    offline,
    version,
  }), [crew, currentId, refresh, environment, environments, setEnvironment, offline, version])

  return <MissionContext.Provider value={value}>{children}</MissionContext.Provider>
}

export function useMission(): MissionState {
  const ctx = useContext(MissionContext)
  if (!ctx) throw new Error('useMission debe usarse dentro de <MissionProvider>')
  return ctx
}
