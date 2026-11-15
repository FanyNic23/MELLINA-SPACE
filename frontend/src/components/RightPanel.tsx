import type { ReactNode } from 'react'
import { useBody } from '../state/body'
import { useMission } from '../state/mission'
import { ClinicalTab } from './tabs/ClinicalTab'
import { RoutineTab } from './tabs/RoutineTab'
import { SimTab } from './tabs/SimTab'
import { Icon } from './Icon'
import { SegBar } from './SegBar'
import { WatchDock } from './WatchDock'

export type TabId = 'hazards' | 'systems' | 'clinical' | 'routine' | 'sim'
const TABS: [TabId, string][] = [['hazards', 'AMENAZAS'], ['systems', 'SISTEMAS'], ['clinical', 'CLÍNICO'], ['routine', 'RUTINA'], ['sim', 'SIMULAR']]

/** Panel derecho: mini reloj arriba y pestañas (amenazas por defecto). */
export function RightPanel({ tab, onTab, onCheckin }: { tab: TabId; onTab: (t: TabId) => void; onCheckin: () => void }) {
  return (
    <aside className="card flex min-h-0 flex-col lg:h-full">
      <WatchDock />
      <div className="m-2 grid grid-cols-5 gap-1 rounded-lg bg-space-950 p-1.5 font-mono text-[10px]" role="tablist">
        {TABS.map(([id, label]) => (
          <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => onTab(id)}
            className={`rounded-md py-1.5 transition ${tab === id ? 'bg-accent font-bold text-black' : 'text-slate-400 hover:text-white'}`}>
            {label}
          </button>
        ))}
      </div>
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-3 pb-3">
        {tab === 'hazards' && <HazardList />}
        {tab === 'systems' && <SystemList />}
        {tab === 'clinical' && <ClinicalTab onInspect={() => onTab('systems')} />}
        {tab === 'routine' && <RoutineTab onCheckin={onCheckin} />}
        {tab === 'sim' && <SimTabKeyed />}
      </div>
    </aside>
  )
}

/** Lista que reparte todo el alto disponible entre sus filas (sin huecos abajo). */
function FillList({ children }: { children: ReactNode }) {
  return <div className="flex flex-1 flex-col gap-1.5 [&>button]:flex [&>button]:flex-[1_1_auto] [&>button]:flex-col [&>button]:justify-center">{children}</div>
}

function rowClass(active: boolean) {
  return `w-full rounded-lg px-3 py-2 text-left text-xs transition ${active ? 'bg-cyan-500/15 shadow-lg shadow-cyan-500/10' : 'bg-space-800/60 hover:bg-space-700/70'}`
}

function HazardList() {
  const { hazards, model, view } = useBody()
  return (
    <FillList>
      {hazards.map(h => {
        const active = view.mode === 'hazard' && view.id === h.id
        return (
          <button key={h.id} type="button" className={rowClass(active)} onClick={() => (active ? model?.reset() : model?.showHazard(h.id))}>
            <div className="flex w-full items-center gap-2">
              <span className="grid size-7 shrink-0 place-items-center rounded-lg" style={{ color: h.color, background: `${h.color}22` }}><Icon name={h.icon} /></span>
              <span className="min-w-0 flex-1 truncate font-semibold text-slate-200">{h.name}</span>
              <span className={`font-mono text-[10px] font-bold ${h.level === 2 ? 'is-critical' : ''}`} style={{ color: h.color }}>{h.levelLabel}</span>
            </div>
            <div className="mt-1.5 flex w-full items-center gap-2 pl-9">
              <div className="flex-1"><SegBar pct={h.severity} color={h.color} variant="slant" /></div>
              <span className="w-9 text-right font-mono text-[11px] font-bold" style={{ color: h.color }}>{h.severity}%</span>
            </div>
          </button>
        )
      })}
    </FillList>
  )
}

function SystemList() {
  const { systems, model, view } = useBody()
  return (
    <FillList>
      {systems.map(s => {
        const active = view.mode === 'system' && view.id === s.id
        return (
          <button key={s.id} type="button" className={rowClass(active)} onClick={() => (active ? model?.reset() : model?.focusSystem(s.id))}>
            <div className="flex w-full items-center gap-2">
              <span className="min-w-0 flex-1 truncate font-semibold text-slate-200">{s.label}</span>
              <span className="font-mono text-[11px] font-bold" style={{ color: s.color }}>{s.damage}%</span>
            </div>
            <div className="mt-0.5 w-full truncate text-[10px] text-slate-400">{s.detail}</div>
            <div className="mt-2 w-full"><SegBar pct={s.damage} color={s.color} variant="block" /></div>
          </button>
        )
      })}
    </FillList>
  )
}

function SimTabKeyed() {
  const { current, version } = useMission()
  return <SimTab key={`${current?.id}-${version}`} />
}
