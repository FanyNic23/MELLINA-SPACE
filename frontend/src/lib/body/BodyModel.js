/*
 * A-HAMS · Mapa corporal 3D del tripulante.
 * Anatomía real de BodyParts3D 4.0 (DBCLS, CC BY 4.0) empaquetada en anatomy-data.js: músculos,
 * esqueleto, cerebro, sistema límbico, corazón y pulmones, sin piel ni órganos genitales.
 * Funciona offline. La lógica clínica (niveles, % de daño, amenazas) vive en clinical-map.js.
 *
 * API pública:
 *   const body = new BodyModel(container, { onChange, sidebar, fullscreenTarget })
 *     onChange({ mode, id })   al cambiar la vista
 *     sidebar                  panel superpuesto a la izquierda del visor (el cuerpo se centra en el espacio libre)
 *     fullscreenTarget         elemento que pasa a pantalla completa (por defecto, el contenedor)
 *   body.update(astro)          // astro = registro de CREW_DATA del dashboard
 *   body.status()               // estado por sistema: nivel, % de daño, detalle
 *   body.hazards()              // amenazas espaciales con su gravedad para el tripulante
 *   body.focusSystem(id)        // vuela al órgano y abre su ficha de daño
 *   body.showHazard(id)         // resalta los órganos que afecta la amenaza, con su animación
 *   body.reset()                // vuelve a la vista general
 */
import * as THREE from 'three';
import { svgIcon } from '../svgIcons';
import { HAZARDS, levelOf, SYSTEMS } from './clinicalMap';

const LEVEL_COLORS = [0x2dd4bf, 0x38bdf8, 0xef4444]; // nominal · vigilar · crítico (rojo de alarma)
const LEVEL_LABELS = ['NOMINAL', 'VIGILAR', 'CRÍTICO'];
const HOLO_COLOR = 0x22d3ee;
const hex = c => '#' + c.toString(16).padStart(6, '0');
const icon = (name, cls) => svgIcon(name, cls);

// Aspecto natural de cada grupo anatómico. Los internos se ven a través de músculo y hueso.
const LOOK = {
  neuro:     { color: 0xe9b7b0, opacity: 1,    order: 0 },
  psych:     { color: 0xd98aa8, opacity: 1,    order: 0 },
  heart:     { color: 0xb23a3a, opacity: 1,    order: 0 },
  lungs:     { color: 0xe6a3a0, opacity: 0.85, order: 1 },
  radiation: { color: 0xe8dcc4, opacity: 0.45, order: 2 },
  muscle:    { color: 0xb5524a, opacity: 0.28, order: 3 },
};

const OVERVIEW = { target: new THREE.Vector3(0, 0.86, 0), dist: 3.75, el: 0.01 };
const ease = t => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

/** Descarga (una vez) el modelo anatómico empaquetado: manifiesto + geometría binaria cuantizada. */
let anatomyPromise = null;
export function loadAnatomy() {
  anatomyPromise ??= Promise.all([
    fetch('/anatomy/anatomy.json').then(r => r.json()),
    fetch('/anatomy/anatomy.bin').then(r => r.arrayBuffer()),
  ]).then(([manifest, buffer]) => ({ manifest, buffer }));
  return anatomyPromise;
}

function decodeAnatomy({ manifest: data, buffer }) {
  const bytes = { buffer };
  const [lo, hi] = data.bounds;
  const center = lo.map((v, a) => (v + hi[a]) / 2);
  const half = lo.map((v, a) => (hi[a] - v) / 2);
  return data.meshes.map(m => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Int16Array(bytes.buffer, m.positions, m.vertexCount * 3), 3, true));
    geo.setAttribute('normal', new THREE.BufferAttribute(new Int8Array(bytes.buffer, m.normals, m.vertexCount * 3), 3, true));
    geo.setIndex(new THREE.BufferAttribute(new Uint16Array(bytes.buffer, m.indices, m.indexCount), 1));
    geo.computeBoundingSphere();
    geo.computeBoundingBox();
    return { group: m.group, geo, center, half };
  });
}

export class BodyModel {
  constructor(container, opts = {}) {
    this.container = container;
    this.anatomy = opts.anatomy;
    this.onChange = opts.onChange || (() => {});
    this.sidebar = opts.sidebar || null;
    this.fullscreenTarget = opts.fullscreenTarget || container;
    this.levels = {};
    this.focusSet = new Set();  // sistemas resaltados
    this.mode = null;           // null | 'system' | 'hazard'
    this.activeId = null;
    this.effect = null;
    this.hovered = null;
    this.astro = null;
    this.reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setClearColor(0x000000, 0);
    container.appendChild(this.renderer.domElement);
    this.renderer.domElement.className = 'body-canvas';

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(30, 1, 0.02, 30);
    this.scene.add(new THREE.HemisphereLight(0xdfefff, 0x1a2233, 0.9));
    const key = new THREE.DirectionalLight(0xffffff, 1.1);
    key.position.set(1.5, 2.5, 3);
    this.scene.add(key);
    const rim = new THREE.DirectionalLight(0x66ccff, 0.6);
    rim.position.set(-2, 1.5, -2.5);
    this.scene.add(rim);
    this.camera.add(new THREE.PointLight(0xffffff, 0.35)); // luz de cámara: el órgano enfocado nunca queda en sombra
    this.scene.add(this.camera);

    this.root = new THREE.Group();
    this.scene.add(this.root);
    this.organs = {}; // systemId -> [mesh]
    this.pivots = {}; // systemId -> Group centrado en el órgano (latido / respiración)
    this.boxes = {};  // systemId -> Box3 en coordenadas de mundo
    this._buildAnatomy();
    this._buildRadiation();
    this._buildPlatform();
    this._buildScanRing();
    this._buildHud();

    // Cámara orbital: objetivo, distancia, azimut y elevación (todo interpolable).
    this.view = { target: OVERVIEW.target.clone(), dist: OVERVIEW.dist, az: 0.35, el: OVERVIEW.el, shift: 0, lift: 0 };
    this.tween = null;

    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
    this.dragging = false;
    this.velAz = 0;
    this.lastInteraction = 0;
    this.lastHover = 0;
    this._bindEvents();

    this.clock = new THREE.Clock();
    this._ro = new ResizeObserver(() => this._resize());
    this._ro.observe(container);
    this._resize();
    this.visible = true;
    this._io = new IntersectionObserver(([e]) => { this.visible = e.isIntersecting; });
    this._io.observe(container);
    this.renderer.setAnimationLoop(() => this._tick());
  }

  // ------------------------------------------------------------------ construcción
  _buildAnatomy() {
    const data = this.anatomy;
    if (!data) throw new Error('Falta el modelo anatómico (loadAnatomy)');
    const box = new THREE.Box3();
    for (const { group, geo, center, half } of decodeAnatomy(data)) {
      const look = LOOK[group];
      const transparent = look.opacity < 1;
      const material = new THREE.MeshStandardMaterial({
        color: look.color, emissive: 0x000000, roughness: 0.6, metalness: 0.05,
        transparent, opacity: look.opacity, depthWrite: !transparent,
      });
      const mesh = new THREE.Mesh(geo, material);
      mesh.scale.set(...half);
      mesh.position.set(...center);
      mesh.renderOrder = look.order;
      mesh.userData.system = group;
      mesh.userData.baseColor = new THREE.Color(look.color);
      mesh.userData.baseOpacity = look.opacity;
      // Corazón y pulmones cuelgan de un pivote en su centro para latir y respirar sin desplazarse.
      if (!this.pivots[group]) {
        this.pivots[group] = new THREE.Group();
        this.root.add(this.pivots[group]);
      }
      this.pivots[group].add(mesh);
      (this.organs[group] = this.organs[group] || []).push(mesh);
      mesh.updateMatrixWorld(true);
      box.expandByObject(mesh);
    }
    for (const id of ['heart', 'lungs']) {
      const pivot = this.pivots[id];
      const c = new THREE.Box3().setFromObject(pivot).getCenter(new THREE.Vector3());
      pivot.position.copy(c);
      for (const m of pivot.children) m.position.sub(c);
    }
    // Centra el cuerpo sobre la plataforma y guarda la caja de cada órgano para la cámara.
    const c = box.getCenter(new THREE.Vector3());
    this.root.position.set(-c.x, -box.min.y, -c.z);
    this.root.updateMatrixWorld(true);
    this.bodyHeight = box.max.y - box.min.y;
    for (const id of Object.keys(this.pivots)) this.boxes[id] = new THREE.Box3().setFromObject(this.pivots[id]);
    this.rootBaseY = this.root.position.y;
  }

  _buildRadiation() {
    const n = 520;
    this.particleSeeds = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      this.particleSeeds[i * 3] = Math.random() * Math.PI * 2;      // ángulo
      this.particleSeeds[i * 3 + 1] = 0.36 + Math.random() * 0.4;   // radio
      this.particleSeeds[i * 3 + 2] = Math.random();                 // fase
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    // Partícula redonda de color plano (textura generada en canvas, sin archivos externos).
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d');
    g.fillStyle = '#fff';
    g.beginPath();
    g.arc(32, 32, 20, 0, Math.PI * 2);
    g.fill();
    this.particleMat = new THREE.PointsMaterial({
      color: LEVEL_COLORS[0], size: 0.03, map: new THREE.CanvasTexture(c), transparent: true, opacity: 0.7,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    this.particles = new THREE.Points(geo, this.particleMat);
    this.particles.frustumCulled = false;
    this.scene.add(this.particles);
  }

  _buildPlatform() {
    const mk = (geo, opacity) => {
      const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
        color: HOLO_COLOR, transparent: true, opacity, side: THREE.DoubleSide, depthWrite: false,
      }));
      m.rotation.x = -Math.PI / 2;
      this.scene.add(m);
      return m;
    };
    mk(new THREE.RingGeometry(0.36, 0.38, 96), 0.5);
    mk(new THREE.CircleGeometry(0.36, 96), 0.06);
    this.platformRing = mk(new THREE.RingGeometry(0.42, 0.425, 96, 1, 0, Math.PI * 1.4), 0.35);
  }

  // Anillo de escaneo que barre el órgano o el cuerpo de arriba abajo.
  _buildScanRing() {
    const mat = opacity => new THREE.MeshBasicMaterial({ color: HOLO_COLOR, transparent: true, opacity,
      side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false });
    this.scanRing = new THREE.Mesh(new THREE.RingGeometry(0.97, 1, 96), mat(0.55));
    this.scanDisc = new THREE.Mesh(new THREE.CircleGeometry(0.97, 96), mat(0.05));
    for (const m of [this.scanRing, this.scanDisc]) {
      m.rotation.x = -Math.PI / 2;
      this.scene.add(m);
    }
  }

  // Capa HTML del HUD: marco, retículas con línea guía y ficha de daño.
  _buildHud() {
    this.hud = document.createElement('div');
    this.hud.className = 'hud';
    this.hud.innerHTML = `
      <div class="hud-corners"><i></i><i></i><i></i><i></i></div>
      <div class="hud-scanlines"></div>
      <div class="hud-vignette"></div>
      <div class="hud-top"><span class="hud-title">ESCANEO BIOMÉTRICO</span><span class="hud-sub"></span></div>
      <svg class="hud-svg"><g class="hud-links"></g><g class="hud-reticles"></g></svg>
      <div class="hud-panel" hidden></div>
      <button class="hud-reset" type="button" hidden>${icon('arrow-counter-clockwise')} Vista general</button>
      <button class="hud-fullscreen" type="button" aria-label="Pantalla completa">${icon('corners-out')}</button>`;
    this.container.appendChild(this.hud);
    this.hudSub = this.hud.querySelector('.hud-sub');
    this.hudLinks = this.hud.querySelector('.hud-links');
    this.hudReticles = this.hud.querySelector('.hud-reticles');
    this.hudPanel = this.hud.querySelector('.hud-panel');
    this.hudReset = this.hud.querySelector('.hud-reset');
    this.hudReset.addEventListener('click', () => this.reset());
    const fsButton = this.hud.querySelector('.hud-fullscreen');
    fsButton.addEventListener('click', () => {
      if (document.fullscreenElement) document.exitFullscreen();
      else this.fullscreenTarget.requestFullscreen?.();
    });
    this._onFullscreen = () => { fsButton.innerHTML = icon(document.fullscreenElement ? 'corners-in' : 'corners-out'); };
    document.addEventListener('fullscreenchange', this._onFullscreen);
    this.hudPanel.addEventListener('click', e => {
      const t = e.target.closest('[data-system],[data-hazard],[data-close]');
      if (!t) return;
      if (t.dataset.close !== undefined) this.reset();
      else if (t.dataset.system) this.focusSystem(t.dataset.system);
      else this.showHazard(t.dataset.hazard);
    });
    this.tooltip = document.createElement('div');
    this.tooltip.className = 'body-tooltip';
    this.tooltip.hidden = true;
    this.container.appendChild(this.tooltip);
  }

  // ------------------------------------------------------------------ datos
  update(astro) {
    this.astro = astro;
    for (const sys of SYSTEMS) this.levels[sys.id] = sys.level(astro);
    this.hudSub.textContent = `${astro.id} · ${astro.name}`;
    if (this.mode === 'system') this._renderSystemPanel(this.activeId);
    else if (this.mode === 'hazard') this._renderHazardPanel(this.activeId);
    this._applyLook();
    return this.status();
  }

  status() {
    if (!this.astro) return [];
    return SYSTEMS.map(sys => {
      const level = this.levels[sys.id];
      return { id: sys.id, label: sys.label, organ: sys.organ, level, levelLabel: LEVEL_LABELS[level],
        color: hex(LEVEL_COLORS[level]), damage: sys.damage(this.astro), detail: sys.detail(this.astro) };
    });
  }

  hazards() {
    if (!this.astro) return [];
    return HAZARDS.map(h => {
      const severity = h.severity(this.astro), level = levelOf(severity);
      return { id: h.id, name: h.name, icon: h.icon, summary: h.summary, systems: h.systems, severity, level,
        levelLabel: LEVEL_LABELS[level], color: hex(LEVEL_COLORS[level]) };
    });
  }

  // ------------------------------------------------------------------ vistas
  focusSystem(id) {
    if (!this.organs[id]) return;
    this.mode = 'system'; this.activeId = id; this.effect = 'pulse';
    this.focusSet = new Set([id]);
    this._flyTo([id]);
    this._renderSystemPanel(id);
    this._applyLook();
    this.onChange({ mode: this.mode, id });
  }

  showHazard(id) {
    const h = HAZARDS.find(x => x.id === id);
    if (!h) return;
    this.mode = 'hazard'; this.activeId = id; this.effect = h.effect;
    this.focusSet = new Set(h.systems);
    this._flyTo(h.systems);
    this._renderHazardPanel(id);
    this._applyLook();
    this.onChange({ mode: this.mode, id });
  }

  reset() {
    this.mode = null; this.activeId = null; this.effect = null;
    this.focusSet = new Set();
    this._tweenView({ target: OVERVIEW.target.clone(), dist: OVERVIEW.dist, el: OVERVIEW.el, shift: this._shiftFor(false), lift: 0, az: this.view.az });
    this.hudPanel.hidden = true;
    this.hudReset.hidden = true;
    this.hud.classList.remove('is-zoomed');
    this._applyLook();
    this.onChange({ mode: null, id: null });
  }

  // Encuadra los órganos dejando sitio a la ficha; gira por el camino más corto al frente.
  _flyTo(ids) {
    const box = new THREE.Box3();
    for (const id of ids) box.union(this.boxes[id]);
    const sphere = box.getBoundingSphere(new THREE.Sphere());
    const fov = THREE.MathUtils.degToRad(this.camera.fov);
    const fit = sphere.radius / Math.sin(fov / 2);
    const dist = THREE.MathUtils.clamp(fit * (this.compact ? 1.5 : 1.35), 0.85, OVERVIEW.dist);
    const twoPi = Math.PI * 2;
    const az = Math.round(this.view.az / twoPi) * twoPi;
    this._tweenView({ target: sphere.center.clone(), dist, az, el: 0.06, shift: this._shiftFor(true), lift: this.compact ? 0.45 : 0 });
    this.hudPanel.hidden = false;
    this.hudReset.hidden = false;
    this.hud.classList.add('is-zoomed');
  }

  // Desplazamiento horizontal del encuadre (fracción de media pantalla) para centrar el cuerpo
  // entre la barra lateral superpuesta y la ficha del HUD.
  _shiftFor(panelOpen) {
    const w = this.container.clientWidth;
    if (!w) return 0;
    const sb = this.sidebar;
    const left = sb && getComputedStyle(sb).position === 'absolute' ? sb.offsetLeft + sb.offsetWidth : 0;
    const right = panelOpen && !this.compact ? 300 : 0;
    return 1 - (left + w - right) / w;
  }

  _tweenView(to) {
    const from = { target: this.view.target.clone(), dist: this.view.dist, az: this.view.az, el: this.view.el,
      shift: this.view.shift, lift: this.view.lift };
    this.tween = { from, to, t0: performance.now(), dur: this.reduceMotion ? 1 : 1400 };
    this.lastInteraction = performance.now();
  }

  // ------------------------------------------------------------------ ficha HUD
  _gauge(pct, color) {
    const r = 34, c = 2 * Math.PI * r;
    return `<div class="hud-gauge-wrap"><svg class="hud-gauge" viewBox="0 0 84 84">
      <circle cx="42" cy="42" r="40" class="hud-gauge-ticks"/>
      <circle cx="42" cy="42" r="${r}" class="hud-gauge-track"/>
      <circle cx="42" cy="42" r="${r}" class="hud-gauge-bar" stroke="${color}"
        stroke-dasharray="${c.toFixed(1)}" style="--from:${c.toFixed(1)};--to:${(c * (1 - pct / 100)).toFixed(1)}"/>
    </svg><div class="hud-pct" style="color:${color}"><span data-count="${pct}">0</span><small>%</small></div></div>`;
  }

  _rows(rows) {
    return `<div class="hud-rows">${rows.map(([k, v]) => `<div><span>${k}</span><b>${v}</b></div>`).join('')}</div>`;
  }

  _renderSystemPanel(id) {
    const sys = SYSTEMS.find(s => s.id === id), a = this.astro;
    const level = this.levels[id], color = hex(LEVEL_COLORS[level]), pct = sys.damage(a);
    const hazards = HAZARDS.filter(h => h.systems.includes(id));
    this.hudPanel.style.setProperty('--accent', color);
    this.hudPanel.innerHTML = `
      <button class="hud-close" data-close aria-label="Cerrar">${icon('x-circle')}</button>
      <div class="hud-kicker">ÓRGANO ANALIZADO</div>
      <div class="hud-name">${sys.organ}</div>
      <div class="hud-sys">${sys.label}</div>
      <div class="hud-score">${this._gauge(pct, color)}
        <div><div class="hud-chip" style="color:${color}">${LEVEL_LABELS[level]}</div>
        <div class="hud-caption">índice de daño estimado</div></div></div>
      ${this._rows(sys.metrics(a))}
      <div class="hud-kicker">CAUSAS ESPACIALES</div>
      <div class="hud-tags">${hazards.map(h => `<button type="button" data-hazard="${h.id}">${icon(h.icon)} ${h.name}</button>`).join('')}</div>`;
    this._animatePanel();
  }

  _renderHazardPanel(id) {
    const h = HAZARDS.find(x => x.id === id), a = this.astro;
    const pct = h.severity(a), level = levelOf(pct), color = hex(LEVEL_COLORS[level]);
    this.hudPanel.style.setProperty('--accent', color);
    this.hudPanel.innerHTML = `
      <button class="hud-close" data-close aria-label="Cerrar">${icon('x-circle')}</button>
      <div class="hud-kicker">AMENAZA DEL ESPACIO PROFUNDO</div>
      <div class="hud-name"><span class="hud-name-icon">${icon(h.icon)}</span>${h.name}</div>
      <div class="hud-score">${this._gauge(pct, color)}
        <div><div class="hud-chip" style="color:${color}">${LEVEL_LABELS[level]}</div>
        <div class="hud-caption">gravedad para este tripulante</div></div></div>
      <p class="hud-text">${h.summary}</p>
      ${this._rows(h.metrics(a))}
      <div class="hud-kicker">ÓRGANOS AFECTADOS</div>
      <div class="hud-organs">${h.systems.map(sid => {
        const s = SYSTEMS.find(x => x.id === sid), d = s.damage(a), c = hex(LEVEL_COLORS[this.levels[sid]]);
        return `<button type="button" data-system="${sid}"><span>${s.organ}</span><i style="--w:${d}%;--c:${c}"></i><b style="color:${c}">${d}%</b></button>`;
      }).join('')}</div>`;
    this._animatePanel();
  }

  // Entrada de la ficha, conteo del porcentaje y llenado del medidor.
  _animatePanel() {
    const n = this.hudPanel.querySelector('[data-count]');
    const target = +n.dataset.count, t0 = performance.now(), dur = this.reduceMotion ? 1 : 1100;
    const step = now => {
      const k = Math.min(1, (now - t0) / dur);
      n.textContent = Math.round(target * ease(k));
      if (k < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
    this.hudPanel.classList.remove('is-in');
    void this.hudPanel.offsetWidth;
    this.hudPanel.classList.add('is-in');
  }

  // Retículas sobre cada órgano resaltado y línea guía del principal hacia la ficha.
  _updateHudOverlay() {
    const w = this.container.clientWidth, h = this.container.clientHeight;
    if (!this.focusSet.size) {
      if (this.hudReticles.childElementCount) { this.hudReticles.innerHTML = ''; this.hudLinks.innerHTML = ''; }
      return;
    }
    const v = new THREE.Vector3();
    const pts = [...this.focusSet].map(id => {
      this.boxes[id].getCenter(v);
      v.y += this.root.position.y - this.rootBaseY;
      v.project(this.camera);
      return { x: (v.x + 1) / 2 * w, y: (1 - v.y) / 2 * h, color: hex(LEVEL_COLORS[this.levels[id] || 0]) };
    });
    if (this.hudReticles.childElementCount !== pts.length) {
      this.hudReticles.innerHTML = pts.map(() => `
        <g class="hud-reticle"><g class="r-spin"><circle r="20" class="r-outer"/></g><circle r="11" class="r-inner"/>
        <path d="M-30 0h9M21 0h9M0 -30v9M0 21v9" class="r-ticks"/></g>`).join('');
    }
    [...this.hudReticles.children].forEach((g, i) => {
      g.setAttribute('transform', `translate(${pts[i].x.toFixed(1)},${pts[i].y.toFixed(1)})`);
      g.style.color = pts[i].color;
    });
    const panel = this.hudPanel;
    if (panel.hidden || this.compact) { this.hudLinks.innerHTML = ''; return; }
    const p = pts[0], px = panel.offsetLeft, py = panel.offsetTop + 46, mx = px - 36;
    this.hudLinks.innerHTML = `<path class="hud-link" style="color:${p.color}"
      d="M${(p.x + 24).toFixed(1)} ${p.y.toFixed(1)} L${mx.toFixed(1)} ${py} L${px} ${py}"/>
      <circle cx="${px}" cy="${py}" r="3" class="hud-link-dot" style="color:${p.color}"/>`;
  }

  // ------------------------------------------------------------------ aspecto
  // Color natural; los sistemas alterados se tiñen y brillan con el color de su nivel.
  // Con sistemas enfocados, esos se vuelven opacos y el resto queda como referencia tenue.
  _applyLook() {
    const tmp = new THREE.Color();
    const focused = this.focusSet.size > 0;
    for (const [id, meshes] of Object.entries(this.organs)) {
      const level = this.levels[id] || 0;
      const isFocus = this.focusSet.has(id), isHover = this.hovered === id;
      // En la vista de amenaza, músculo y hueso enfocados conservan algo de transparencia para ver el interior.
      const see = this.mode === 'hazard' && (id === 'muscle' || id === 'radiation') ? 0.75 : 1;
      for (const mesh of meshes) {
        const mat = mesh.material, base = mesh.userData.baseColor;
        const glowK = 1;
        mat.color.copy(level ? tmp.copy(base).lerp(new THREE.Color(LEVEL_COLORS[level]), 0.65) : base);
        mat.emissive.setHex(level ? LEVEL_COLORS[level] : isHover ? 0x0e7490 : 0x000000);
        mesh.userData.emissiveBase = ((level ? 0.35 : 0) + (isFocus || isHover ? 0.3 : 0)) * glowK;
        mesh.userData.glowK = glowK;
        mat.emissiveIntensity = mesh.userData.emissiveBase;
        const opacity = isFocus ? see : focused ? Math.min(mesh.userData.baseOpacity, 0.07) : mesh.userData.baseOpacity;
        mat.transparent = opacity < 1;
        mat.depthWrite = opacity === 1;
        mat.opacity = opacity;
        mat.needsUpdate = true;
      }
    }
    const radLevel = this.levels.radiation || 0;
    const hazard = this.mode === 'hazard' ? HAZARDS.find(x => x.id === this.activeId) : null;
    const hazardColor = hazard && this.astro ? LEVEL_COLORS[levelOf(hazard.severity(this.astro))] : null;
    const haze = this.effect === 'haze';
    this.particleMat.color.setHex(haze ? 0x9fd6a8 : hazardColor ?? LEVEL_COLORS[radLevel]);
    // Las partículas son ambiente: se ocultan al analizar un órgano (cerca de la cámara se verían como puntos).
    this.particleMat.size = haze ? 0.052 : [0.018, 0.024, 0.032][radLevel];
    this.particleMat.opacity = this.mode === 'system' ? 0 : haze ? 0.2 : 0.6;
    // Solo las amenazas con animación de partículas las muestran de cerca.
    this.particles.visible = !this.mode || ['radiation', 'float', 'haze'].includes(this.effect);
    const scanColor = this.mode === 'system' ? LEVEL_COLORS[this.levels[this.activeId]] : hazardColor ?? HOLO_COLOR;
    this.scanRing.material.color.setHex(scanColor);
    this.scanDisc.material.color.setHex(scanColor);
    this.hud.dataset.effect = this.effect || '';
  }

  // ------------------------------------------------------------------ interacción
  _bindEvents() {
    const el = this.renderer.domElement;
    let lastX = 0, lastY = 0, moved = 0;
    el.addEventListener('pointerdown', e => {
      this.dragging = true; lastX = e.clientX; lastY = e.clientY; moved = 0;
      el.setPointerCapture(e.pointerId);
    });
    el.addEventListener('pointermove', e => {
      if (this.dragging) {
        const dx = e.clientX - lastX, dy = e.clientY - lastY;
        lastX = e.clientX; lastY = e.clientY; moved += Math.abs(dx) + Math.abs(dy);
        this.view.az -= dx * 0.01;
        this.view.el = THREE.MathUtils.clamp(this.view.el + dy * 0.006, -0.5, 0.7);
        this.velAz = -dx * 0.01;
        this.tween = null;
        this.lastInteraction = performance.now();
        this.tooltip.hidden = true;
      } else if (performance.now() - this.lastHover > 60) { // el raycast sobre ~250k triángulos se limita a ~16/s
        this.lastHover = performance.now();
        this._hover(e);
      }
    });
    el.addEventListener('pointerup', e => {
      if (!this.dragging) return;
      this.dragging = false;
      if (moved < 5) {
        const id = this._pick(e);
        if (id) this.focusSystem(id);
      }
    });
    el.addEventListener('pointercancel', () => { this.dragging = false; });
    el.addEventListener('pointerleave', () => { this._setHover(null); this.tooltip.hidden = true; });
  }

  // El órgano más cercano a la cámara; con algo enfocado solo se eligen los órganos resaltados.
  _pick(e) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const targets = Object.entries(this.organs)
      .filter(([id]) => !this.focusSet.size || this.focusSet.has(id))
      .flatMap(([, m]) => m);
    // Músculo y hueso son translúcidos: si el rayo también cruza un órgano interno, gana el órgano.
    const hits = this.raycaster.intersectObjects(targets, false);
    hits.sort((a, b) => LOOK[a.object.userData.system].order - LOOK[b.object.userData.system].order || a.distance - b.distance);
    return hits.length ? hits[0].object.userData.system : null;
  }

  _hover(e) {
    const id = this._pick(e);
    this._setHover(id);
    if (!id || !this.astro) { this.tooltip.hidden = true; return; }
    const s = this.status().find(x => x.id === id);
    this.tooltip.innerHTML = `<strong>${s.organ}</strong><span style="color:${s.color}">${s.levelLabel} · daño ${s.damage}%</span><small>Clic para analizar</small>`;
    const rect = this.container.getBoundingClientRect();
    this.tooltip.style.left = `${Math.max(8, Math.min(e.clientX - rect.left + 14, rect.width - 190))}px`;
    this.tooltip.style.top = `${e.clientY - rect.top + 14}px`;
    this.tooltip.hidden = false;
  }

  _setHover(id) {
    if (this.hovered === id) return;
    this.hovered = id;
    this.renderer.domElement.style.cursor = id ? 'pointer' : 'grab';
    this._applyLook();
  }

  // ------------------------------------------------------------------ render
  _resize() {
    const w = this.container.clientWidth, h = this.container.clientHeight;
    if (!w || !h) return;
    this.compact = w < 640;
    this.hud.classList.toggle('is-compact', this.compact);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    if (this.view && !this.tween) this.view.shift = this._shiftFor(!!this.mode);
  }

  _updateCamera(now) {
    if (this.tween) {
      const { from, to, t0, dur } = this.tween;
      const k = ease(Math.min(1, (now - t0) / dur));
      this.view.target.lerpVectors(from.target, to.target, k);
      for (const key of ['dist', 'az', 'el', 'shift', 'lift']) this.view[key] = from[key] + (to[key] - from[key]) * k;
      if (k >= 1) this.tween = null;
    } else if (!this.dragging) {
      this.velAz *= 0.92;
      this.view.az += this.velAz;
      // Giro lento automático solo en la vista general.
      if (!this.mode && !this.reduceMotion && now - this.lastInteraction > 2500) this.view.az += 0.004;
    }
    const { target, dist, az, el, shift, lift } = this.view;
    const cam = this.camera;
    cam.position.set(target.x + dist * Math.sin(az) * Math.cos(el), target.y + dist * Math.sin(el),
      target.z + dist * Math.cos(az) * Math.cos(el));
    // Desplaza el encuadre para que el órgano quede a la izquierda de la ficha (o encima, en pantallas angostas).
    const right = new THREE.Vector3(Math.cos(az), 0, -Math.sin(az));
    const halfH = dist * Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2);
    cam.lookAt(target.clone().addScaledVector(right, halfH * cam.aspect * shift).add(new THREE.Vector3(0, -halfH * lift, 0)));
  }

  _tick() {
    if (!this.visible || document.hidden) return;
    const now = performance.now();
    const t = this.clock.getElapsedTime();
    const motion = !this.reduceMotion;
    this._updateCamera(now);

    if (this.astro && motion) {
      // Latido al ritmo del pulso real y respiración (~14 rpm).
      const beat = Math.pow(Math.max(0, Math.sin(t * Math.PI * 2 * (this.astro.vitals.hr / 60))), 8);
      this.pivots.heart.scale.setScalar(1 + beat * 0.07);
      this.pivots.lungs.scale.setScalar(1 + Math.sin(t * Math.PI * 2 * (14 / 60)) * 0.035);
    }
    // Microgravedad: el cuerpo flota e inclina suavemente.
    const float = this.effect === 'float' && motion;
    this.root.position.y = this.rootBaseY + (float ? 0.05 + Math.sin(t * 1.2) * 0.03 : 0);
    this.root.rotation.z = float ? Math.sin(t * 0.7) * 0.03 : 0;

    // Pulso de brillo en los órganos enfocados.
    if (this.focusSet.size) {
      const glow = motion ? 0.25 + 0.25 * Math.sin(t * 4) : 0.3;
      for (const id of this.focusSet) for (const m of this.organs[id]) m.material.emissiveIntensity = m.userData.emissiveBase + glow * m.userData.glowK;
    }

    // Anillo de escaneo: barre la zona enfocada (o todo el cuerpo) de arriba abajo.
    const box = new THREE.Box3();
    if (this.focusSet.size) for (const id of this.focusSet) box.union(this.boxes[id]);
    else box.set(new THREE.Vector3(-0.3, 0, -0.2), new THREE.Vector3(0.3, this.bodyHeight, 0.2));
    const size = box.getSize(new THREE.Vector3()), center = box.getCenter(new THREE.Vector3());
    const phase = motion ? (Math.sin(t * (this.focusSet.size ? 1.6 : 0.6)) + 1) / 2 : 0.5;
    const radius = Math.max(size.x, size.z) * 0.62 + 0.03;
    for (const m of [this.scanRing, this.scanDisc]) {
      m.position.set(center.x, box.min.y + size.y * phase + (this.root.position.y - this.rootBaseY), center.z);
      m.scale.setScalar(radius);
    }
    this.platformRing.rotation.z = motion ? t * 0.4 : 0;

    this._updateParticles(t, center, size);
    this._updateHudOverlay();
    this.renderer.render(this.scene, this.camera);
  }

  // Partículas: órbita (normal), lluvia hacia el cuerpo (radiación), deriva (microgravedad) o neblina (CO₂).
  _updateParticles(t, center, size) {
    const attr = this.particles.geometry.attributes.position;
    const s = this.particleSeeds, H = this.bodyHeight + 0.1;
    const speed = [0.15, 0.4, 0.9][this.levels.radiation || 0];
    for (let i = 0; i < attr.count; i++) {
      const ang0 = s[i * 3], r0 = s[i * 3 + 1], ph = s[i * 3 + 2];
      let x, y, z;
      if (this.effect === 'radiation') {
        const r = r0 * 2.2 * (1 - ((ph + t * 0.35) % 1)) + 0.05;   // de fuera hacia el cuerpo
        x = Math.cos(ang0) * r; z = Math.sin(ang0) * r; y = ph * H;
      } else if (this.effect === 'float') {
        const ang = ang0 + t * 0.08;
        x = Math.cos(ang) * r0 * 1.4; z = Math.sin(ang) * r0 * 1.4;
        y = ((ph + t * 0.03) % 1) * H * 1.2;
      } else if (this.effect === 'haze') {
        // Neblina de CO₂ alrededor de los órganos afectados (diseño original, más abierta y dispersa).
        const ang = ang0 + t * 0.12 * (0.5 + ph);
        const r = (0.3 + r0 * 1.5) * Math.max(size.x, size.z, 0.25);
        x = center.x + Math.cos(ang) * r; z = center.z + Math.sin(ang) * r * 0.8;
        y = center.y + (ph - 0.5) * Math.max(size.y, 0.3) * 2.4 + Math.sin(t + ang0) * 0.02;
      } else {
        const ang = ang0 + t * speed * (0.5 + (i % 7) * 0.1);
        x = Math.cos(ang) * r0; z = Math.sin(ang) * r0 * 0.75;
        y = ((ph + t * speed * 0.08) % 1) * H;
      }
      attr.setXYZ(i, x, y, z);
    }
    attr.needsUpdate = true;
  }

  /** Libera WebGL, observadores y DOM (al desmontar el componente de React). */
  dispose() {
    this.renderer.setAnimationLoop(null);
    this._ro.disconnect();
    this._io.disconnect();
    document.removeEventListener('fullscreenchange', this._onFullscreen);
    this.scene.traverse(o => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => { m.map?.dispose(); m.dispose(); });
    });
    this.renderer.dispose();
    this.renderer.domElement.remove();
    this.hud.remove();
    this.tooltip.remove();
  }
}
