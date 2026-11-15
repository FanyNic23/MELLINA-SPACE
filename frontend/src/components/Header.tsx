import { useEffect, useRef, useState } from 'react'
import { LANGS, setLang, useI18n } from '../i18n'
import { useMission } from '../state/mission'
import { BrandMark, BrandWord } from './Brand'
import { Icon } from './Icon'

const MISSION_DAYS = 210
const RING = 2 * Math.PI * 16

/** Encabezado: marca, entorno de misión (selector), día de misión, latencia con la Tierra, idioma y chequeo diario. */
export function Header({ onCheckin, checkinDue, checkinSub }: { onCheckin: () => void; checkinDue: boolean; checkinSub: string }) {
  const { environment, environments, setEnvironment, current } = useMission()
  const { t } = useI18n()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const day = current?.missionDay ?? 14

  useEffect(() => {
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('click', close)
    return () => document.removeEventListener('click', close)
  }, [])

  return (
    <header className="flex-none bg-space-800 px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <BrandMark className="h-[34px] text-white drop-shadow-[0_0_8px_rgba(255,255,255,0.25)]" />
          <span className="h-8 w-px bg-space-600" />
          <div>
            <BrandWord className="h-[13px] text-slate-50" />
            <p className="mt-1.5 hidden text-[11px] text-slate-400 xl:block">{t.header.tagline}</p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-x-8 gap-y-3">
          {/* Entorno de misión: cambia umbrales clínicos, latencia, gravedad y evacuación */}
          <div ref={ref} className="relative">
            <button type="button" onClick={() => setOpen(o => !o)} aria-haspopup="listbox" aria-expanded={open}
              className="flex items-center gap-2.5 rounded-xl py-1 pl-1 pr-2.5 transition hover:bg-space-700 aria-expanded:bg-space-700">
              <span className="grid size-9 place-items-center rounded-[10px] bg-space-800 text-accent">
                <Icon name={environment?.icon ?? 'rocket-launch'} size={18} />
              </span>
              <span className="text-left">
                <span className="panel-title block">{t.header.environment}</span>
                <span className="mt-1 block font-mono text-[13px] font-bold text-cyan-300">{environment?.short ?? '—'}</span>
                <span className="mt-0.5 block font-mono text-[10px] text-slate-500">{environment?.gravity_text}</span>
              </span>
            </button>
            {open && (
              <div role="listbox" className="absolute left-0 top-[calc(100%+8px)] z-50 w-[340px] rounded-2xl bg-space-900 p-1.5 shadow-[0_24px_60px_rgba(0,0,0,0.7),0_0_0_1px_rgba(34,211,238,0.12)]">
                {environments.map(e => (
                  <button key={e.id} type="button" role="option" aria-selected={e.id === environment?.id}
                    onClick={() => { setOpen(false); void setEnvironment(e.id) }}
                    className={`flex w-full items-center gap-2.5 rounded-[10px] px-2.5 py-2 text-left transition hover:bg-space-700 ${e.id === environment?.id ? 'bg-cyan-400/10' : ''}`}>
                    <span className="grid size-8 place-items-center rounded-[10px] bg-space-800 text-accent"><Icon name={e.icon} /></span>
                    <span className="min-w-0">
                      <b className="block text-[13px] text-white">{e.name}</b>
                      <small className="block text-[10px] text-slate-400">{e.gravity_text} · {t.header.earthAt(e.latency_text)}</small>
                      <small className="block text-[10px] text-slate-400">{e.evacuation}</small>
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Día de misión */}
          <div className="flex items-center gap-2.5" title={t.header.dayOf(day, MISSION_DAYS)}>
            <svg className="size-10" viewBox="0 0 40 40" aria-hidden="true">
              <circle cx="20" cy="20" r="16" fill="none" stroke="#18202a" strokeWidth="3" />
              <circle cx="20" cy="20" r="16" fill="none" stroke="#22d3ee" strokeWidth="3" strokeLinecap="round"
                strokeDasharray={RING} strokeDashoffset={RING * (1 - day / MISSION_DAYS)} transform="rotate(-90 20 20)"
                className="drop-shadow-[0_0_4px_#22d3ee]" />
              <text x="20" y="24" textAnchor="middle" className="fill-slate-200 font-mono text-[11px] font-bold">{day}</text>
            </svg>
            <div>
              <div className="panel-title">{t.header.missionDay}</div>
              <div className="mt-1 font-mono text-[13px] font-bold text-cyan-300">SOL {String(day).padStart(3, '0')}</div>
              <div className="mt-0.5 hidden font-mono text-[10px] text-slate-500 xl:block">{t.header.ofTotal(MISSION_DAYS, environment?.short.toLowerCase() ?? '')}</div>
            </div>
          </div>

          {/* Latencia con la Tierra (DTN) */}
          <div>
            <div className="panel-title">{t.header.latency}</div>
            <div className="my-1 flex items-center gap-2">
              <Icon name="globe-hemisphere-west" className="text-sky-400" />
              <span className="relative h-0.5 w-[84px] overflow-hidden rounded bg-space-600">
                <span className="absolute inset-y-0 -left-[30%] w-[30%] animate-[link_2.2s_linear_infinite] bg-accent shadow-[0_0_8px_#22d3ee]" />
              </span>
              <Icon name={environment?.icon ?? 'rocket-launch'} className="text-cyan-300" />
            </div>
            <div className="font-mono text-[13px] font-bold text-sky-400">{environment?.latency_text.split(' (')[0] ?? '—'}</div>
          </div>

          <LanguageSwitch />

          {/* Acción principal: chequeo diario */}
          <button type="button" onClick={onCheckin}
            className={`flex items-center gap-2.5 rounded-xl bg-accent px-4 py-2 text-left text-black shadow-[0_10px_30px_rgba(34,211,238,0.35)] transition hover:-translate-y-px hover:bg-cyan-300 ${checkinDue ? 'animate-[cta-due_1.8s_ease-in-out_infinite]' : ''}`}>
            <Icon name="clipboard-text" size={20} />
            <span>
              <b className="block font-mono text-xs font-extrabold tracking-[0.14em]">{t.header.checkin}</b>
              <small className="mt-0.5 block text-[10px] font-semibold opacity-70">{checkinSub}</small>
            </span>
          </button>
        </div>
      </div>
    </header>
  )
}

/** Selector de idioma de toda la interfaz (inglés por defecto); también cambia la voz de Mellina. */
export function LanguageSwitch() {
  const { lang, t } = useI18n()
  return (
    <div className="flex gap-0.5 rounded-lg bg-space-950 p-1 font-mono text-[11px]" role="radiogroup" aria-label={t.language.label}>
      {LANGS.map(code => (
        <button key={code} type="button" role="radio" aria-checked={lang === code} onClick={() => setLang(code)}
          className={`rounded-md px-2.5 py-1.5 font-bold transition ${lang === code ? 'bg-accent text-black' : 'text-slate-400 hover:text-white'}`}>
          {t.language[code]}
        </button>
      ))}
    </div>
  )
}
