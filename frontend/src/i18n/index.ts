import { useSyncExternalStore } from 'react'
import { en, type Dict } from './en'
import { es } from './es'
import { getLang, subscribeLang, type Lang } from './lang'

export { getHint, getLang, hintLang, LANGS, setLang, type Lang } from './lang'
export type { Dict } from './en'

const DICTS: Record<Lang, Dict> = { en, es }

/** Textos del idioma activo, para código fuera de React (mapas clínicos, cliente de la API, HUD 3D). */
export const tr = (): Dict => DICTS[getLang()]

/** Idioma activo y sus textos; el componente se vuelve a pintar al cambiarlo. */
export function useI18n() {
  const lang = useSyncExternalStore(subscribeLang, getLang)
  return { lang, t: DICTS[lang] }
}
