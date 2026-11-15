/*
 * A-HAMS · Avatar holográfico 3D del asistente (busto: de hombros hacia arriba).
 * Geometría 100% procedural (sin modelos ni texturas externas) para operar offline en el Edge.
 *
 * API pública:
 *   const avatar = new HoloAvatar(canvas);
 *   avatar.setMouth(open, width)   // open 0..1, width ~0.6..1.2 (lo alimenta la capa de voz)
 *   avatar.setMode(mode)           // 'idle' | 'listening' | 'thinking' | 'speaking'
 *   avatar.lookAt(x, y)            // mirada normalizada -1..1
 *   avatar.setStatus(status)       // NOMINAL | ALERTA_MODERADA | ALERTA_CRITICA (emblema del traje)
 */
import * as THREE from 'three';

const STATUS_COLORS = {
  NOMINAL: 0x2dd4bf,
  ALERTA_MODERADA: 0x38bdf8,
  ALERTA_CRITICA: 0xef4444,
};
const HOLO_COLOR = 0x22d3ee;

const VERT = `
  varying vec3 vNormal;
  varying vec3 vViewDir;
  varying vec3 vWorld;
  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorld = world.xyz;
    vNormal = normalize(normalMatrix * normal);
    vec4 mv = viewMatrix * world;
    vViewDir = normalize(-mv.xyz);
    gl_Position = projectionMatrix * mv;
  }`;

// Holograma: borde fresnel + luz clave suave + líneas de escaneo + barrido vertical + desvanecido inferior.
const FRAG = `
  uniform vec3 uColor;
  uniform float uTime;
  uniform float uIntensity;
  uniform float uOpacity;
  uniform float uFadeY;
  uniform float uSweep;
  varying vec3 vNormal;
  varying vec3 vViewDir;
  varying vec3 vWorld;
  void main() {
    vec3 n = normalize(vNormal);
    float facing = abs(dot(n, normalize(vViewDir)));
    float fresnel = pow(1.0 - facing, 2.0);
    float key = max(dot(n, normalize(vec3(0.35, 0.55, 0.75))), 0.0);
    float scan = 0.82 + 0.18 * sin(vWorld.y * 90.0 - uTime * 6.0);
    float sweepPos = mod(uTime * uSweep, 5.0) - 3.2;
    float sweep = exp(-pow((vWorld.y - sweepPos) * 9.0, 2.0));
    float fade = smoothstep(uFadeY, uFadeY + 0.9, vWorld.y);
    float a = (0.05 + 0.24 * key + 0.85 * fresnel + 0.45 * sweep) * scan * fade * uOpacity * uIntensity;
    vec3 col = uColor * (0.55 + 0.9 * fresnel + 0.45 * key) + vec3(0.5) * sweep * 0.4;
    gl_FragColor = vec4(col, a);
  }`;

const gauss = (dx, dy) => Math.exp(-(dx * dx + dy * dy));

// Esfera deformada en cabeza humana: proporciones, mandíbula, nariz, cuencas, pómulos, mentón.
function headGeometry(segments) {
  const g = new THREE.SphereGeometry(1, segments, segments);
  const p = g.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const front = Math.max(0, (v.z - 0.55) / 0.45);
    let x = v.x * 0.8;
    const y = v.y;
    let z = v.z * 0.9;
    if (y < 0) {
      x *= 1 + y * 0.22;
      z *= 1 + y * 0.1;
    }
    if (v.z < 0) z *= 1.06;
    z += front * (
      0.16 * gauss(x / 0.075, (y + 0.12) / 0.2) +           // tabique nasal
      0.06 * gauss(x / 0.07, (y + 0.27) / 0.06) +           // punta de la nariz
      0.05 * gauss(x / 0.45, (y - 0.3) / 0.07) -            // arco superciliar
      0.07 * gauss((x - 0.27) / 0.12, (y - 0.13) / 0.08) -  // cuenca ocular
      0.07 * gauss((x + 0.27) / 0.12, (y - 0.13) / 0.08) +
      0.04 * gauss((Math.abs(x) - 0.38) / 0.12, (y + 0.1) / 0.1) + // pómulos
      0.05 * gauss(x / 0.16, (y + 0.82) / 0.1) +            // mentón
      0.03 * gauss(x / 0.15, (y + 0.46) / 0.06)             // volumen labial
    );
    p.setXYZ(i, x, y, z);
  }
  g.computeVertexNormals();
  return g;
}

function torsoGeometry() {
  const profile = [
    [0.37, 0], [0.6, -0.05], [1.1, -0.12], [1.45, -0.22],
    [1.65, -0.42], [1.72, -0.8], [1.72, -1.4], [1.68, -1.9],
  ].map(([r, y]) => new THREE.Vector2(r, y));
  return new THREE.LatheGeometry(profile, 72);
}

export class HoloAvatar {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setClearColor(0x000000, 0);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(30, 1, 0.1, 50);
    this.camera.position.set(0, -0.1, 8.6);
    this.camera.lookAt(0, -0.2, 0);

    this.uniforms = {
      uTime: { value: 0 },
      uColor: { value: new THREE.Color(HOLO_COLOR) },
      uIntensity: { value: 1 },
      uFadeY: { value: -2.95 },
      uSweep: { value: 0.9 },
    };

    this.mouth = { open: 0, width: 1, targetOpen: 0, targetWidth: 1 };
    this.look = { x: 0, y: 0, cx: 0, cy: 0 };
    this.mode = 'idle';
    this.blink = { next: 1.5, phase: -1 };
    this.speakLevel = 0;

    this._build();
    this._resize();
    this._ro = new ResizeObserver(() => this._resize());
    this._ro.observe(canvas.parentElement || canvas);

    this.clock = new THREE.Clock();
    this._loop = this._loop.bind(this);
    requestAnimationFrame(this._loop);
  }

  _holo(opacity, side) {
    return new THREE.ShaderMaterial({
      uniforms: { ...this.uniforms, uOpacity: { value: opacity } },
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: side || THREE.FrontSide,
    });
  }

  _glow(color, opacity) {
    return new THREE.MeshBasicMaterial({
      color, transparent: true, opacity,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
  }

  _build() {
    const root = new THREE.Group();
    this.root = root;
    this.scene.add(root);

    // ── Torso, cuello y cuello del traje ─────────────────────────────
    const torso = new THREE.Group();
    this.torso = torso;
    root.add(torso);

    const body = new THREE.Mesh(torsoGeometry(), this._holo(0.9));
    body.scale.z = 0.52;
    body.position.set(0, -1.3, -0.12);
    torso.add(body);

    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.36, 0.7, 40, 1, true), this._holo(0.8));
    neck.position.set(0, -0.98, -0.12);
    torso.add(neck);

    const collar = new THREE.Mesh(new THREE.TorusGeometry(0.4, 0.05, 12, 64), this._holo(1.4));
    collar.rotation.x = Math.PI / 2;
    collar.scale.y = 0.75;
    collar.position.set(0, -1.33, -0.12);
    torso.add(collar);

    // Emblema del traje: refleja el estado SEWS del tripulante.
    this.emblem = new THREE.Mesh(new THREE.CircleGeometry(0.09, 32), this._glow(STATUS_COLORS.NOMINAL, 0.9));
    this.emblem.position.set(0.75, -1.85, 0.66);
    this.emblem.rotation.y = 0.5;
    torso.add(this.emblem);
    const emblemRing = new THREE.Mesh(new THREE.RingGeometry(0.12, 0.135, 40), this._glow(HOLO_COLOR, 0.6));
    emblemRing.position.copy(this.emblem.position);
    emblemRing.rotation.copy(this.emblem.rotation);
    torso.add(emblemRing);

    // ── Cabeza (pivota en la base del cuello) ────────────────────────
    const pivot = new THREE.Group();
    pivot.position.set(0, -0.75, -0.1);
    this.headPivot = pivot;
    root.add(pivot);

    const head = new THREE.Group();
    head.position.set(0, 0.75, 0.1);
    pivot.add(head);

    head.add(new THREE.Mesh(headGeometry(96), this._holo(1)));

    const wire = new THREE.LineSegments(
      new THREE.WireframeGeometry(headGeometry(22)),
      new THREE.LineBasicMaterial({ color: HOLO_COLOR, transparent: true, opacity: 0.07, blending: THREE.AdditiveBlending, depthWrite: false })
    );
    wire.scale.setScalar(1.004);
    head.add(wire);

    for (const side of [-1, 1]) {
      const ear = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 16), this._holo(0.9));
      ear.scale.set(0.05, 0.16, 0.1);
      ear.position.set(side * 0.77, 0.03, -0.05);
      ear.rotation.y = side * 0.3;
      head.add(ear);
    }

    // Ojos: esclerótica tenue + iris brillante; el parpadeo escala el grupo en Y.
    this.eyes = [];
    for (const side of [-1, 1]) {
      const eye = new THREE.Group();
      eye.position.set(side * 0.27, 0.13, 0.74);
      const sclera = new THREE.Mesh(new THREE.SphereGeometry(0.07, 24, 16), this._glow(HOLO_COLOR, 0.25));
      sclera.scale.set(1.25, 0.8, 0.6);
      const iris = new THREE.Mesh(new THREE.CircleGeometry(0.034, 24), this._glow(0xbffcff, 0.95));
      iris.position.z = 0.045;
      eye.add(sclera, iris);
      eye.userData = { baseX: side * 0.27, iris };
      head.add(eye);
      this.eyes.push(eye);
    }

    // Boca: labios + cavidad; la capa de voz controla apertura y ancho (visemas).
    const mouth = new THREE.Group();
    mouth.position.set(0, -0.48, 0.79);
    head.add(mouth);
    const lipMat = this._glow(HOLO_COLOR, 0.75);
    this.upperLip = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 12), lipMat);
    this.upperLip.scale.set(0.15, 0.022, 0.03);
    this.upperLip.position.y = 0.012;
    this.lowerLip = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 12), lipMat);
    this.lowerLip.scale.set(0.13, 0.026, 0.03);
    this.cavity = new THREE.Mesh(new THREE.CircleGeometry(1, 32), this._glow(0x67e8f9, 0.35));
    this.cavity.position.z = -0.01;
    mouth.add(this.upperLip, this.lowerLip, this.cavity);

    // ── Partículas del proyector holográfico ─────────────────────────
    const count = 160;
    const pos = new Float32Array(count * 3);
    this._particleSpeed = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = 0.6 + Math.random() * 1.6;
      pos[i * 3] = Math.cos(a) * r;
      pos[i * 3 + 1] = -3.2 + Math.random() * 4.6;
      pos[i * 3 + 2] = Math.sin(a) * r * 0.6 - 0.2;
      this._particleSpeed[i] = 0.08 + Math.random() * 0.25;
    }
    const pg = new THREE.BufferGeometry();
    pg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.particles = new THREE.Points(pg, new THREE.PointsMaterial({
      color: HOLO_COLOR, size: 0.025, transparent: true, opacity: 0.55,
      blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    this.scene.add(this.particles);
  }

  _resize() {
    const el = this.canvas.parentElement || this.canvas;
    const w = el.clientWidth || 300;
    const h = el.clientHeight || 300;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  setMouth(open, width) {
    this.mouth.targetOpen = Math.max(0, Math.min(1, open));
    this.mouth.targetWidth = width == null ? 1 : width;
  }

  setMode(mode) {
    this.mode = mode;
  }

  lookAt(x, y) {
    this.look.x = Math.max(-1, Math.min(1, x));
    this.look.y = Math.max(-1, Math.min(1, y));
  }

  setStatus(status) {
    this.emblem.material.color.setHex(STATUS_COLORS[status] || STATUS_COLORS.NOMINAL);
  }

  /** Detiene el bucle de render y libera WebGL (al desmontar el componente de React). */
  dispose() {
    this._disposed = true;
    this._ro.disconnect();
    this.scene.traverse(o => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => m.dispose());
    });
    this.renderer.dispose();
  }

  _loop() {
    if (this._disposed) return;
    requestAnimationFrame(this._loop);
    if (document.hidden) return;
    const dt = Math.min(this.clock.getDelta(), 0.05);
    const t = this.clock.elapsedTime;
    this._update(dt, t);
    this.renderer.render(this.scene, this.camera);
  }

  _update(dt, t) {
    const u = this.uniforms;
    u.uTime.value = t;

    const speaking = this.mode === 'speaking' ? 1 : 0;
    this.speakLevel += (speaking - this.speakLevel) * Math.min(1, dt * 4);
    let intensity = 1;
    let sweep = 0.9;
    if (this.mode === 'listening') intensity = 1.15 + 0.2 * Math.sin(t * 6);
    if (this.mode === 'thinking') sweep = 2.6;
    if (this.mode === 'speaking') intensity = 1.1;
    u.uIntensity.value += (intensity - u.uIntensity.value) * Math.min(1, dt * 6);
    u.uSweep.value = sweep;

    // Respiración y balanceo idle.
    const breath = Math.sin(t * 1.5);
    this.torso.scale.y = 1 + breath * 0.006;
    this.root.position.y = breath * 0.012;

    // Mirada suavizada + micro-movimientos + asentimiento al hablar.
    const L = this.look;
    L.cx += (L.x - L.cx) * Math.min(1, dt * 3);
    L.cy += (L.y - L.cy) * Math.min(1, dt * 3);
    const yaw = L.cx * 0.35 + Math.sin(t * 0.37) * 0.06;
    const pitch = -L.cy * 0.2 + Math.sin(t * 0.53) * 0.03 + Math.sin(t * 5.2) * 0.018 * this.speakLevel;
    const roll = Math.sin(t * 0.29) * 0.03;
    const hp = this.headPivot.rotation;
    const k = Math.min(1, dt * 5);
    hp.y += (yaw - hp.y) * k;
    hp.x += (pitch - hp.x) * k;
    hp.z += (roll - hp.z) * k;
    this.torso.rotation.y += (yaw * 0.3 - this.torso.rotation.y) * k;

    // Parpadeo aleatorio.
    const B = this.blink;
    B.next -= dt;
    if (B.next <= 0 && B.phase < 0) B.phase = 0;
    let lid = 1;
    if (B.phase >= 0) {
      B.phase += dt / 0.14;
      lid = 1 - Math.sin(Math.min(B.phase, 1) * Math.PI) * 0.92;
      if (B.phase >= 1) {
        B.phase = -1;
        B.next = 2 + Math.random() * 3.5;
      }
    }
    for (const eye of this.eyes) {
      eye.scale.y = lid;
      eye.position.x = eye.userData.baseX + L.cx * 0.012;
      eye.userData.iris.position.y = L.cy * 0.008;
    }

    // Boca.
    const M = this.mouth;
    const mk = Math.min(1, dt * 18);
    M.open += (M.targetOpen - M.open) * mk;
    M.width += (M.targetWidth - M.width) * mk;
    this.upperLip.scale.x = 0.15 * M.width;
    this.lowerLip.scale.x = 0.13 * M.width;
    this.lowerLip.position.y = -0.012 - M.open * 0.09;
    this.cavity.scale.set(0.12 * M.width, 0.004 + M.open * 0.045, 1);
    this.cavity.position.y = -M.open * 0.045;

    // Partículas ascendentes.
    const p = this.particles.geometry.attributes.position;
    for (let i = 0; i < p.count; i++) {
      let y = p.getY(i) + this._particleSpeed[i] * dt;
      if (y > 1.4) y = -3.2;
      p.setY(i, y);
    }
    p.needsUpdate = true;
  }
}
