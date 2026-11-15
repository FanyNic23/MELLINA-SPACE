// Idioma de la interfaz: inglés por defecto, español opcional. Se recuerda en este navegador y se envía
// al Edge Core en cada petición (cabecera X-Lang) para que el motor clínico responda en el mismo idioma.
export type Lang = 'en' | 'es'
export const LANGS: Lang[] = ['en', 'es']

const KEY = 'ahams.lang'
const listeners = new Set<() => void>()

function stored(): Lang {
  try {
    const v = localStorage.getItem(KEY)
    return v === 'es' || v === 'en' ? v : 'en'
  } catch {
    return 'en'
  }
}

let current: Lang = stored()
document.documentElement.lang = current

export const getLang = (): Lang => current

export function setLang(lang: Lang) {
  if (lang === current) return
  current = lang
  document.documentElement.lang = lang
  try { localStorage.setItem(KEY, lang) } catch { /* sin almacenamiento: dura esta sesión */ }
  listeners.forEach(fn => fn())
}

export function subscribeLang(fn: () => void) {
  listeners.add(fn)
  return () => { listeners.delete(fn) }
}
