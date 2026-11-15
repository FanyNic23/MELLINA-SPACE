import { useEffect, useState } from 'react'

/** Enrutado por hash (#/ dashboard · #/reloj?crew=ASTRO-03 reloj): no choca con las rutas de la API. */
export function useHashRoute(): { path: string; params: URLSearchParams } {
  const parse = () => {
    const [path, query = ''] = location.hash.replace(/^#/, '').split('?')
    return { path: path || '/', params: new URLSearchParams(query) }
  }
  const [route, setRoute] = useState(parse)
  useEffect(() => {
    const on = () => setRoute(parse())
    window.addEventListener('hashchange', on)
    return () => window.removeEventListener('hashchange', on)
  }, [])
  return route
}
