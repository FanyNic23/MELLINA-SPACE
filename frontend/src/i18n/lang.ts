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
let hinted: Lang | null = null   // idioma que el asistente sugiere activar (se resalta en el selector)
let hintTimer = 0
document.documentElement.lang = current

export const getLang = (): Lang => current

export function setLang(lang: Lang) {
  if (lang === current) return
  current = lang
  hinted = null
  document.documentElement.lang = lang
  try { localStorage.setItem(KEY, lang) } catch { /* sin almacenamiento: dura esta sesión */ }
  listeners.forEach(fn => fn())
}

export const getHint = (): Lang | null => hinted

/** Resalta en el selector el idioma al que conviene cambiar (el asistente oyó una orden en ese idioma). */
export function hintLang(lang: Lang) {
  hinted = lang
  window.clearTimeout(hintTimer)
  hintTimer = window.setTimeout(() => { hinted = null; listeners.forEach(fn => fn()) }, 10_000)
  listeners.forEach(fn => fn())
}

export function subscribeLang(fn: () => void) {
  listeners.add(fn)
  return () => { listeners.delete(fn) }
}
