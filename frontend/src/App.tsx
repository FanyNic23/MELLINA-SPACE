import { useEffect, useState } from 'react'
import { api } from './api/client'
import { BodyViewer } from './components/BodyViewer'
import { CheckinWizard } from './components/CheckinWizard'
import { CrewPanel } from './components/CrewPanel'
import { Header } from './components/Header'
import { Icon } from './components/Icon'
import { RightPanel, type TabId } from './components/RightPanel'
import { WatchApp } from './components/watch/WatchApp'
import { useI18n } from './i18n'
import { useHashRoute } from './lib/route'
import { BodyProvider } from './state/body'
import { useMission } from './state/mission'

/** Dashboard de una sola pantalla: tripulación | cuerpo 3D | paneles. */
export default function App() {
  const { offline, current, environment, refresh, version } = useMission()
  const route = useHashRoute()
  const { t } = useI18n()
  const [tab, setTab] = useState<TabId>('hazards')
  const [checkin, setCheckin] = useState(false)
  const [checkinToday, setCheckinToday] = useState(true)
  const openCheckin = () => setCheckin(true)
  const crewId = current?.id

  // Recordatorio: el botón de chequeo late mientras el tripulante no se haya medido hoy.
  useEffect(() => {
    if (crewId) api.routine(crewId).then(r => setCheckinToday(r.checkin_today)).catch(() => {})
  }, [crewId, version])

  const checkinSub = current?.checkinAt
    ? t.app.lastCheckin(new Date(current.checkinAt).toLocaleTimeString(t.locale, { hour: '2-digit', minute: '2-digit' }))
    : t.app.checkinTagline

  const offlineOverlay = (offline || !current) && (
    <div className="fixed inset-0 z-[90] grid place-items-center bg-space-950/90">
      <div className="rounded-[18px] bg-space-900 px-9 py-8 text-center shadow-[0_20px_60px_rgba(0,0,0,0.6)]">
        <Icon name="cpu" size={40} className="mx-auto text-accent" />
        <div className="mt-3 text-lg font-bold text-white">{t.app.connecting}</div>
        <p className="mt-2 max-w-sm text-sm text-slate-400">
          {t.app.offlineBefore} <code className="text-cyan-300">make run</code>{t.app.offlineAfter}
        </p>
      </div>
    </div>
  )

  if (route.path === '/reloj') return <><WatchApp crewParam={route.params.get('crew')} />{offlineOverlay}</>

  return (
    <div className="flex h-full flex-col lg:overflow-hidden">
      <Header onCheckin={openCheckin} checkinDue={!checkinToday} checkinSub={checkinSub} />
      <main className="gap-3 space-y-3 p-3 lg:grid lg:min-h-0 lg:flex-1 lg:grid-cols-[320px_minmax(0,1fr)_360px] lg:space-y-0 xl:grid-cols-[340px_minmax(0,1fr)_380px]">
        <CrewPanel />
        <BodyProvider>
          <BodyViewer />
          <RightPanel tab={tab} onTab={setTab} onCheckin={openCheckin} />
        </BodyProvider>
      </main>

      {checkin && current && (
        <CheckinWizard astro={current} environment={environment} onClose={() => setCheckin(false)} onDone={() => void refresh()} />
      )}

      {offlineOverlay}
    </div>
  )
}
