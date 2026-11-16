import { useEffect, useRef, useState } from 'react'
import { BodyModel, loadAnatomy } from '../lib/body/BodyModel'
import '../lib/body/bodyHud.css'
import { useI18n } from '../i18n'
import { useBody } from '../state/body'
import { useMission } from '../state/mission'
import { ForecastBar } from './ForecastBar'

/**
 * Cuerpo 3D (anatomía BodyParts3D, sin piel ni genitales) con HUD y gemelo digital.
 * Entra con la cámara pegada al cuerpo y se aleja hasta la vista general cuando `revealed` pasa a true
 * (al terminar la animación de arranque).
 */
export function BodyViewer({ revealed = true }: { revealed?: boolean }) {
  const section = useRef<HTMLElement>(null)
  const stage = useRef<HTMLDivElement>(null)
  const { attach, setView } = useBody()
  const { current, version } = useMission()
  const [loading, setLoading] = useState(true)
  const model = useRef<BodyModel | null>(null)
  const { t } = useI18n()

  useEffect(() => {
    let cancelled = false
    void loadAnatomy().then(anatomy => {
      if (cancelled || !stage.current) return
      model.current = new BodyModel(stage.current, { anatomy, onChange: setView, fullscreenTarget: section.current ?? undefined })
      model.current.holdIntro()
      attach(model.current)
      setLoading(false)
    })
    return () => {
      cancelled = true
      attach(null)
      model.current?.dispose()
      model.current = null
    }
  }, [attach, setView])

  useEffect(() => {
    if (revealed && !loading) model.current?.playIntro()
  }, [revealed, loading])

  return (
    <section ref={section} className="body-stage relative h-[72vh] min-h-[480px] overflow-hidden rounded-xl lg:h-full lg:min-h-0 [&:fullscreen]:rounded-none">
      <div ref={stage} className="absolute inset-0" />
      {loading && <div className="absolute inset-0 grid place-items-center font-mono text-xs text-slate-500">{t.body.loading}</div>}
      <ForecastBar key={`${current?.id}-${version}`} />
    </section>
  )
}
