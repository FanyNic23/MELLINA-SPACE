import { api } from '../../api/client'
import type { Urgency } from '../../api/types'
import { systemForRisk } from '../../lib/body/clinicalMap'
import { useBody } from '../../state/body'
import { useMission } from '../../state/mission'
import { useToast } from '../../state/toast'
import { Icon } from '../Icon'

const URGENCY_STYLE: Record<Urgency, string> = {
  INMEDIATA: 'bg-red-950 text-red-400 is-critical',
  ALTA: 'bg-sky-950 text-sky-300',
  MODERADA: 'bg-cyan-950 text-cyan-300',
  PREVENTIVA: 'bg-cyan-950 text-cyan-300',
}

/** Diagnóstico autónomo: resumen, aviso al cirujano, desglose del SEWS, riesgos y contramedidas. */
export function ClinicalTab({ onInspect }: { onInspect: () => void }) {
  const { current: a, environment, refresh } = useMission()
  const { model } = useBody()
  const toast = useToast()
  if (!a) return null

  const inspect = (system: Parameters<NonNullable<typeof model>['focusSystem']>[0]) => {
    onInspect()
    model?.focusSystem(system)
  }

  const confirm = async (cmId: string) => {
    try {
      const r = await api.completeTask(a.id, `cm:${cmId}`)
      toast(r.awarded ? `Protocolo ${cmId} confirmado · +${r.awarded} pts` : `Protocolo ${cmId} ya estaba confirmado hoy`)
      void refresh()
    } catch {
      toast(`No se pudo registrar ${cmId}`)
    }
  }

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <h3 className="flex items-center gap-2 text-sm font-bold text-white"><Icon name="stethoscope" className="text-accent" /> Diagnóstico autónomo</h3>
        <p className="text-xs leading-relaxed text-slate-300">{a.summary}</p>

        {a.escalate && (
          <div className="flex items-start gap-2.5 rounded-[10px] bg-red-500/15 px-3 py-2.5 text-red-500 animate-[surgeon-alarm_1.4s_ease-in-out_infinite]">
            <Icon name="warning-octagon" size={20} />
            <div>
              <b className="block text-xs">Avisar al cirujano de vuelo</b>
              <span className="mt-0.5 block text-[11px] text-red-200">
                {a.escalationReasons.join(' · ')}.{' '}
                {environment?.realtime_surgeon ? 'Enlace en tiempo real: llama ahora al cirujano de vuelo.' : 'El aviso sale con prioridad en la próxima ventana de enlace.'}{' '}
                {environment?.evacuation}
              </span>
            </div>
          </div>
        )}

        <div className="panel-title pt-1">Por qué este SEWS</div>
        {a.breakdown.length ? (
          <div className="space-y-1.5">
            {a.breakdown.map(f => (
              <button key={f.indicator + f.risk} type="button" onClick={() => inspect(f.system)} title="Ver en el mapa corporal"
                className="grid w-full grid-cols-[30px_1fr_auto] items-center gap-2 rounded-lg bg-space-800 px-2.5 py-1.5 text-left text-[11px] text-slate-300 transition hover:bg-space-700">
                <b className="font-mono text-[13px] font-extrabold text-critical">+{f.points}</b>
                <span>{f.indicator}</span>
                <em className="font-mono text-[10px] not-italic text-slate-400">{f.value}</em>
              </button>
            ))}
            <div className="pt-1 text-right font-mono text-[10px] text-slate-500">TOTAL {a.sews} / 15</div>
          </div>
        ) : <div className="text-xs italic text-slate-500">Ningún indicador suma puntos.</div>}

        <div className="panel-title pt-1">Riesgos detectados</div>
        <div className="space-y-1.5">
          {a.risks.length === 0 && <div className="text-xs italic text-slate-500">No hay riesgos sistémicos detectados.</div>}
          {a.risks.map(risk => {
            const system = systemForRisk(risk)
            return (
              <button key={risk} type="button" disabled={!system} onClick={() => system && inspect(system)}
                className="flex w-full items-start gap-2 rounded bg-red-950/40 p-2 text-left text-xs text-red-300 transition enabled:hover:translate-x-0.5 enabled:hover:bg-red-500/20">
                <Icon name="warning" className="mt-px text-red-400" />
                <span className="flex-1">{risk}</span>
                {system && <span className="inline-flex items-center gap-1 whitespace-nowrap font-mono text-[10px] text-cyan-300">VER <Icon name="crosshair" size={14} /></span>}
              </button>
            )
          })}
        </div>
      </div>

      <div className="space-y-2">
        <h3 className="flex items-center gap-2 text-sm font-bold text-white"><Icon name="lightning" className="text-sky-400" /> Contramedidas prescritas</h3>
        {a.countermeasures.map(cm => (
          <div key={cm.id} className="space-y-2 rounded-lg bg-space-800/80 p-3.5">
            <div className="flex items-center justify-between gap-2">
              <span className="font-mono text-xs font-semibold text-cyan-400">{cm.id} | {cm.category}</span>
              <span className={`rounded px-2 py-0.5 font-mono text-xs font-bold ${URGENCY_STYLE[cm.urgency]}`}>{cm.urgency}</span>
            </div>
            <div className="text-xs font-bold text-white">{cm.title}</div>
            <div className="whitespace-pre-line text-xs leading-relaxed text-slate-300">{cm.action_protocol}</div>
            <div className="pt-1.5 font-mono text-xs text-slate-400"><span className="text-slate-500">Duración/Dosis:</span> {cm.prescribed_dosage_duration}</div>
            <button type="button" onClick={() => void confirm(cm.id)}
              className="mt-2 w-full rounded bg-space-700 py-1.5 text-xs font-bold uppercase tracking-wider text-cyan-300 transition hover:bg-cyan-600 hover:text-black">
              Confirmar y ejecutar protocolo
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}
