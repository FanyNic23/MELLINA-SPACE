/*
 * A-HAMS · Avatares de la tripulación: casco de astronauta en SVG plano (sin imágenes externas ni degradados).
 * El visor y la franja del traje usan el color de acento del tripulante; la insignia lleva sus iniciales.
 *
 *   CrewAvatar.svg(astro)  -> string SVG que escala al tamaño de su contenedor
 */
(function (global) {
  'use strict';

  function svg(astro) {
    const accent = astro.accent || '#22d3ee';
    return `
<svg viewBox="0 0 64 64" width="100%" height="100%" role="img" aria-label="Avatar de ${astro.name}">
  <path d="M8 64c0-13 10-20 24-20s24 7 24 20z" fill="#cbd5e1"/>
  <path d="M32 44c14 0 24 7 24 20H40c0-11-3-17-8-20z" fill="#94a3b8"/>
  <path d="M14 56c5-5 11-7 18-7s13 2 18 7" fill="none" stroke="${accent}" stroke-width="2.4" stroke-linecap="round"/>
  <rect x="21" y="41" width="22" height="6" rx="3" fill="#64748b"/>
  <circle cx="32" cy="26" r="19" fill="#e2e8f0"/>
  <path d="M32 7a19 19 0 0 1 0 38a24 24 0 0 0 0-38z" fill="#b6c2d1"/>
  <circle cx="13.5" cy="27" r="2.6" fill="${accent}"/>
  <circle cx="50.5" cy="27" r="2.6" fill="${accent}"/>
  <rect x="17" y="15" width="30" height="23" rx="11.5" fill="#0b1220"/>
  <rect x="17" y="15" width="30" height="23" rx="11.5" fill="${accent}" fill-opacity="0.22"/>
  <path d="M21.5 21c2.5-3.2 6-4.6 10-4.6" fill="none" stroke="#fff" stroke-opacity="0.8" stroke-width="2.2" stroke-linecap="round"/>
  <path d="M38 33.5c2.4-1 4.2-2.8 5.2-5" fill="none" stroke="${accent}" stroke-width="1.6" stroke-linecap="round"/>
  <circle cx="44" cy="55" r="5.2" fill="#0b1220"/>
  <text x="44" y="57" text-anchor="middle" font-family="ui-monospace,monospace" font-size="5" font-weight="700" fill="${accent}">${astro.initials}</text>
</svg>`;
  }

  global.CrewAvatar = { svg };
})(window);
