/*
 * A-HAMS · Avatar holográfico 3D del asistente (busto: de hombros hacia arriba).
 * Escaneo 3D real de una cabeza (Lee Perry-Smith, CC BY 3.0, ver assets/avatar/LICENSE.txt) empaquetado
 * con la app: no depende de servicios externos. Se dibuja como un holograma de líneas de escaneo
 * horizontales que se desintegran en partículas por un costado.
 *
 * API pública:
 *   const avatar = new HoloAvatar(canvas);
 *   avatar.setMouth(open, width)   // open 0..1, width ~0.6..1.2 (lo alimenta la capa de voz)
 *   avatar.setMode(mode)           // 'idle' | 'listening' | 'thinking' | 'speaking'
 *   avatar.lookAt(x, y)            // mirada normalizada -1..1
 *   avatar.setStatus(status)       // NOMINAL | ALERTA_MODERADA | ALERTA_CRITICA (tono del pecho)
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import headUrl from '../../assets/avatar/head-scan.glb?url';

const STATUS_COLORS = {
  NOMINAL: 0x2dd4bf,
  ALERTA_MODERADA: 0x38bdf8,
  ALERTA_CRITICA: 0xef4444,
};
const HOLO_COLOR = 0x22d3ee;
const LINE_PX = 4; // separación entre líneas de escaneo, en píxeles de pantalla

// Coordenadas del escaneo (y arriba, la cara mira a +z): base del cuello y boca.
const NECK = 'vec3(0.0, -1.6, -0.3)';
const MOUTH_Y = 0.22;

// Pose compartida por las líneas, el oclusor y las partículas: la mandíbula se abre con la voz y la
// cabeza gira sobre el cuello (el peso crece del pecho hacia arriba, así el cuello se tuerce, no los hombros).
const POSE = `
  uniform vec3 uHead;   // giro, cabeceo, inclinación
  uniform vec2 uMouth;  // apertura, ancho
  vec3 rotate(vec3 q, vec3 a) {
    q = vec3(q.x, q.y * cos(a.y) - q.z * sin(a.y), q.y * sin(a.y) + q.z * cos(a.y));
    q = vec3(q.x * cos(a.x) + q.z * sin(a.x), q.y, -q.x * sin(a.x) + q.z * cos(a.x));
    return vec3(q.x * cos(a.z) - q.y * sin(a.z), q.x * sin(a.z) + q.y * cos(a.z), q.z);
  }
  float headWeight(vec3 p) { return smoothstep(-2.4, -0.7, p.y); }
  vec3 pose(vec3 p) {
    // Mandíbula: baja la parte frontal bajo la boca; los labios se estiran o se juntan con el ancho.
    float front = smoothstep(1.0, 1.9, p.z) * (1.0 - smoothstep(1.1, 1.9, abs(p.x)));
    float jaw = front * smoothstep(${MOUTH_Y.toFixed(2)}, ${(MOUTH_Y - 0.18).toFixed(2)}, p.y) * smoothstep(-1.6, -0.7, p.y);
    float lips = front * exp(-pow((p.y - ${MOUTH_Y.toFixed(2)}) * 3.2, 2.0));
    p.y -= uMouth.x * 0.32 * jaw;
    p.z -= uMouth.x * 0.08 * jaw;
    p.x *= mix(1.0, uMouth.y, lips * (1.0 - smoothstep(0.3, 0.9, abs(p.x))));
    vec3 n = ${NECK};
    return rotate(p - n, uHead * headWeight(p)) + n;
  }`;

const LINE_VERT = `
  ${POSE}
  varying vec3 vWorld;
  varying vec3 vModel;
  varying vec3 vNormal;
  varying vec3 vView;
  void main() {
    vModel = position;
    vec3 p = pose(position);
    vec4 world = modelMatrix * vec4(p, 1.0);
    vWorld = world.xyz;
    vNormal = normalize(normalMatrix * rotate(normal, uHead * headWeight(position)));
    vec4 mv = viewMatrix * world;
    vView = normalize(-mv.xyz);
    gl_Position = projectionMatrix * mv;
  }`;

const NOISE = `
  float hash(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
  float noise(vec3 p) {
    vec3 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(hash(i), hash(i + vec3(1, 0, 0)), f.x), mix(hash(i + vec3(0, 1, 0)), hash(i + vec3(1, 1, 0)), f.x), f.y),
               mix(mix(hash(i + vec3(0, 0, 1)), hash(i + vec3(1, 0, 1)), f.x), mix(hash(i + vec3(0, 1, 1)), hash(i + vec3(1, 1, 1)), f.x), f.y), f.z);
  }
  // Desintegración: crece hacia el costado derecho de la cabeza (x positivo), con borde irregular.
  float dissolve(vec3 m, float t) {
    float edge = m.x + (noise(m * 1.3 + vec3(0.0, t * 0.25, 0.0)) - 0.5) * 1.6;
    return smoothstep(0.5, 2.6, edge) * smoothstep(-1.1, -0.2, m.y);
  }`;

// Líneas de escaneo horizontales con núcleo brillante y halo; se cortan en trazos donde se desintegra.
const LINE_FRAG = `
  uniform vec3 uColor;
  uniform vec3 uStatus;
  uniform float uSpacing;
  uniform float uTime;
  uniform float uIntensity;
  uniform float uSweep;
  varying vec3 vWorld;
  varying vec3 vModel;
  varying vec3 vNormal;
  varying vec3 vView;
  ${NOISE}
  void main() {
    float row = vWorld.y / uSpacing;
    float d = abs(fract(row) - 0.5);                    // distancia al centro de la línea (en filas)
    float px = d / max(fwidth(row), 1e-4);              // ... en píxeles
    float core = exp(-px * px / 1.1);
    float halo = exp(-px * px / 7.0) * 0.35;
    float line = core + halo;
    if (line < 0.01) discard;

    // Trazos sueltos donde la cabeza se desintegra.
    float dis = dissolve(vModel, uTime);
    float cell = hash(vec3(floor(vModel.x / (uSpacing * 0.45)), floor(row), 3.0));
    if (cell < dis * 1.15) discard;

    vec3 n = normalize(vNormal);
    float facing = abs(dot(n, normalize(vView)));
    // Relieve: luz principal desde arriba a la izquierda + contorno; las cuencas y el cuello quedan en penumbra.
    float key = max(dot(n, normalize(vec3(-0.35, 0.55, 0.75))), 0.0);
    float rim = pow(1.0 - facing, 3.0);
    float light = 0.12 + 1.05 * key * key + 0.5 * rim;
    float sweepPos = mod(uTime * uSweep, 9.0) - 4.5;
    float sweep = exp(-pow((vWorld.y - sweepPos) * 2.2, 2.0));
    float fade = smoothstep(-4.2, -2.4, vWorld.y);     // la base del busto se apaga
    float chest = 1.0 - smoothstep(-2.6, -1.6, vModel.y);
    vec3 tint = mix(uColor, uStatus, chest * 0.55);
    vec3 col = mix(tint, vec3(0.85, 0.98, 1.0), core * 0.55) * (light + sweep * 0.8);
    gl_FragColor = vec4(col * line * fade * uIntensity * (1.0 - dis * 0.35), 1.0);
  }`;

// Partículas que se desprenden del costado y derivan hacia afuera, alineadas a las filas de escaneo.
const DUST_VERT = `
  ${POSE}
  ${NOISE}
  attribute float seed;
  uniform float uTime;
  uniform float uSpacing;
  uniform float uPixel;
  varying float vAlpha;
  void main() {
    float speed = 0.06 + 0.1 * fract(seed * 13.7);
    float phase = fract(uTime * speed + seed * 7.31);
    vec3 p = pose(position);
    vec3 drift = vec3(phase * phase * (1.6 + 2.2 * fract(seed * 3.1)), (fract(seed * 5.3) - 0.5) * 0.25 * phase, 0.4 * phase);
    vec4 world = modelMatrix * vec4(p + drift, 1.0);
    world.y = (floor(world.y / uSpacing) + 0.5) * uSpacing; // sobre una fila de escaneo
    float dis = dissolve(position, uTime);
    vAlpha = smoothstep(0.0, 0.08, phase) * (1.0 - phase) * smoothstep(0.05, 0.35, dis);
    vec4 mv = viewMatrix * world;
    gl_PointSize = uPixel * (1.4 + 1.6 * fract(seed * 9.7)) * (1.0 - phase * 0.5);
    gl_Position = projectionMatrix * mv;
  }`;

const DUST_FRAG = `
  uniform vec3 uColor;
  uniform float uIntensity;
  varying float vAlpha;
  void main() {
    float r = length(gl_PointCoord - 0.5);
    float a = smoothstep(0.5, 0.1, r) * vAlpha;
    if (a < 0.01) discard;
    gl_FragColor = vec4(mix(uColor, vec3(0.9, 1.0, 1.0), 0.5) * a * uIntensity, 1.0);
  }`;

const OCCLUDER_FRAG = 'void main() { gl_FragColor = vec4(0.0); }';

let headPromise = null;
/** Descarga (una vez) el escaneo de la cabeza empaquetado con la app. */
function loadHead() {
  headPromise ??= new GLTFLoader().loadAsync(headUrl).then(gltf => {
    let geometry = null;
    gltf.scene.traverse(o => { if (o.isMesh && !geometry) geometry = o.geometry; });
    return geometry;
  });
  return headPromise;
}

export class HoloAvatar {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setClearColor(0x000000, 0);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(30, 1, 0.1, 100);
    // Ligeramente desde arriba: las líneas se curvan sobre la cara y los hombros.
    this.camera.position.set(0, 3.4, 16);
    this.camera.lookAt(0, 0.1, 0);

    this.uniforms = {
      uTime: { value: 0 },
      uColor: { value: new THREE.Color(HOLO_COLOR) },
      uStatus: { value: new THREE.Color(STATUS_COLORS.NOMINAL) },
      uIntensity: { value: 1 },
      uSweep: { value: 0.9 },
      uSpacing: { value: 0.12 },
      uPixel: { value: 1 },
      uHead: { value: new THREE.Vector3() },
      uMouth: { value: new THREE.Vector2(0, 1) },
    };

    this.mouth = { open: 0, width: 1, targetOpen: 0, targetWidth: 1 };
    this.look = { x: 0, y: 0, cx: 0, cy: 0 };
    this.mode = 'idle';
    this.speakLevel = 0;
    this.root = new THREE.Group();
    this.scene.add(this.root);

    loadHead()
      .then(geometry => { if (!this._disposed) this._build(geometry); })
      .catch(err => console.error('[holograma] no se pudo cargar el escaneo de la cabeza', err));

    this._resize();
    this._ro = new ResizeObserver(() => this._resize());
    this._ro.observe(canvas.parentElement || canvas);

    this.clock = new THREE.Clock();
    this._loop = this._loop.bind(this);
    requestAnimationFrame(this._loop);
  }

  _build(geometry) {
    const shader = (vertexShader, fragmentShader, extra = {}) =>
      new THREE.ShaderMaterial({ uniforms: this.uniforms, vertexShader, fragmentShader, ...extra });

    // 1. Oclusor: solo profundidad, para que las líneas de la nuca no se vean a través de la cara.
    const occluder = new THREE.Mesh(geometry, shader(LINE_VERT, OCCLUDER_FRAG, { colorWrite: false }));
    occluder.renderOrder = 0;
    // 2. Líneas de escaneo, sumadas sobre el fondo.
    const lines = new THREE.Mesh(geometry, shader(LINE_VERT, LINE_FRAG, {
      depthWrite: false, depthFunc: THREE.LessEqualDepth, blending: THREE.AdditiveBlending, transparent: true,
    }));
    lines.renderOrder = 1;
    this.root.add(occluder, lines);

    // 3. Partículas: vértices del costado derecho de la cabeza.
    const pos = geometry.attributes.position;
    const picked = [];
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
      if (x > 0.5 && y > -0.9) picked.push(x, y, z);
    }
    const count = Math.min(1400, picked.length / 3);
    const dust = new Float32Array(count * 3);
    const seeds = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      const j = Math.floor(Math.random() * (picked.length / 3)) * 3;
      dust.set(picked.slice(j, j + 3), i * 3);
      seeds[i] = Math.random();
    }
    const dg = new THREE.BufferGeometry();
    dg.setAttribute('position', new THREE.BufferAttribute(dust, 3));
    dg.setAttribute('seed', new THREE.BufferAttribute(seeds, 1));
    const particles = new THREE.Points(dg, shader(DUST_VERT, DUST_FRAG, {
      depthWrite: false, blending: THREE.AdditiveBlending, transparent: true,
    }));
    particles.renderOrder = 2;
    particles.frustumCulled = false;
    this.root.add(particles);
  }

  _resize() {
    const el = this.canvas.parentElement || this.canvas;
    const w = el.clientWidth || 300;
    const h = el.clientHeight || 300;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    // Separación de líneas constante en pantalla: unidades de mundo por píxel a la distancia del busto.
    const visible = 2 * this.camera.position.z * Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2));
    this.uniforms.uSpacing.value = (visible / h) * LINE_PX;
    this.uniforms.uPixel.value = this.renderer.getPixelRatio();
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
    this.uniforms.uStatus.value.setHex(STATUS_COLORS[status] || STATUS_COLORS.NOMINAL);
  }

  /** Detiene el bucle de render y libera WebGL (al desmontar el componente de React). */
  dispose() {
    this._disposed = true;
    this._ro.disconnect();
    // La geometría del escaneo se comparte entre avatares (se descarga una vez): solo se liberan materiales.
    this.scene.traverse(o => {
      if (o.isPoints) o.geometry.dispose();
      if (o.material) o.material.dispose();
    });
    this.renderer.dispose();
  }

  _loop() {
    if (this._disposed) return;
    requestAnimationFrame(this._loop);
    if (document.hidden) return;
    const dt = Math.min(this.clock.getDelta(), 0.05);
    this._update(dt, this.clock.elapsedTime);
    this.renderer.render(this.scene, this.camera);
  }

  _update(dt, t) {
    const u = this.uniforms;
    u.uTime.value = t;

    const speaking = this.mode === 'speaking' ? 1 : 0;
    this.speakLevel += (speaking - this.speakLevel) * Math.min(1, dt * 4);
    let intensity = 1;
    let sweep = 0.9;
    if (this.mode === 'listening') intensity = 1.2 + 0.2 * Math.sin(t * 6);
    if (this.mode === 'thinking') sweep = 3;
    if (this.mode === 'speaking') intensity = 1.12;
    u.uIntensity.value += (intensity - u.uIntensity.value) * Math.min(1, dt * 6);
    u.uSweep.value = sweep;

    // Respiración.
    this.root.position.y = Math.sin(t * 1.5) * 0.03;

    // Mirada suavizada + micro-movimientos + asentimiento al hablar.
    const L = this.look;
    L.cx += (L.x - L.cx) * Math.min(1, dt * 3);
    L.cy += (L.y - L.cy) * Math.min(1, dt * 3);
    const yaw = L.cx * 0.35 + Math.sin(t * 0.37) * 0.06;
    const pitch = -L.cy * 0.18 + Math.sin(t * 0.53) * 0.03 + Math.sin(t * 5.2) * 0.02 * this.speakLevel;
    const roll = Math.sin(t * 0.29) * 0.025;
    const h = u.uHead.value;
    const k = Math.min(1, dt * 5);
    h.x += (yaw - h.x) * k;
    h.y += (pitch - h.y) * k;
    h.z += (roll - h.z) * k;

    // Boca.
    const M = this.mouth;
    const mk = Math.min(1, dt * 18);
    M.open += (M.targetOpen - M.open) * mk;
    M.width += (M.targetWidth - M.width) * mk;
    u.uMouth.value.set(M.open, 0.85 + 0.15 * M.width);
  }
}
