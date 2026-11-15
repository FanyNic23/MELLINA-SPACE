/*
 * Genera frontend/body/anatomy-data.js: subconjunto anatómico de BodyParts3D 4.0 (CC BY 4.0)
 * para el Mapa Corporal 3D del dashboard, agrupado por los sistemas SEWS.
 *
 * - Sin piel ni órganos genitales: se excluyen el sistema reproductor, la uretra, el vello púbico,
 *   los vasos del pene/testículos y los músculos perineales.
 * - Se empaqueta como .js (base64) para que cargue con <script> también desde file:// (doble clic).
 *
 * Fuente: geometría ya convertida de https://github.com/ashemag/human-atlas (public/models:
 * atlas.json + body-N.bin, descomprimidos). Uso:
 *   npm i meshoptimizer
 *   node build-anatomy.mjs <carpeta-con-atlas.json-y-body-N.bin> <salida/anatomy-data.js>
 */
import fs from 'node:fs';
import path from 'node:path';
import { MeshoptSimplifier } from 'meshoptimizer';

const [srcDir, outFile] = process.argv.slice(2);
if (!srcDir || !outFile) throw new Error('Uso: node build-anatomy.mjs <carpeta-origen> <anatomy-data.js>');
await MeshoptSimplifier.ready;

const atlas = JSON.parse(fs.readFileSync(path.join(srcDir, 'atlas.json'), 'utf8'));
const chunks = atlas.chunks.map((_, i) => fs.readFileSync(path.join(srcDir, `body-${i}.bin`)));

const GENITAL = /penis|scrot|\btestis\b|testicular|epididym|glans|cavernos|spongios|prostat|seminal|deferens|spermatic|ejaculat|bulbourethral|urethra|pubic hair|prepuce|perine|ischiocavernosus|bulbospongiosus|cremaster|dartos/i;
const LIMBIC = /amygdala|hippocamp|cingulate|fornix|mammillary|hypothalamus|stria terminalis/i;
const NOT_BRAIN = /nerve|ganglion|plexus|spinal|\broot\b|ramus|branch|ansa|cauda/i;

// Grupo SEWS de cada pieza (null = se descarta). `keep` = fracción de triángulos a conservar,
// `err` = error máximo de simplificación relativo al tamaño de cada pieza.
const GROUPS = {
  neuro:     { keep: 0.25, err: 0.03, test: p => p.system === 'nervous' && !NOT_BRAIN.test(p.name) && !LIMBIC.test(p.name) },
  psych:     { keep: 0.5,  err: 0.02, test: p => p.system === 'nervous' && LIMBIC.test(p.name) },
  heart:     { keep: 0.5,  err: 0.02, test: p => p.system === 'cardiac' && /atri|valve|leaflet|cusp|wall of ventricle/i.test(p.name) },
  lungs:     { keep: 0.4,  err: 0.03, test: p => p.system === 'respiratory' && /bronch|lung|trachea/i.test(p.name) },
  muscle:    { keep: 0.2,  err: 0.03, test: p => p.system === 'muscular' },
  radiation: { keep: 0.12, err: 0.05, test: p => p.system === 'skeletal' && !/gingiva/i.test(p.name) },
};
const groupOf = p => GENITAL.test(p.name) ? null
  : Object.keys(GROUPS).find(g => GROUPS[g].test(p)) ?? null;

// Cuantización: posiciones Int16 sobre la caja global, normales Int8, índices Uint16 por submalla.
const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
const selected = atlas.parts.filter(groupOf);
for (const p of selected) for (let a = 0; a < 3; a++) {
  lo[a] = Math.min(lo[a], p.bounds[0][a]); hi[a] = Math.max(hi[a], p.bounds[1][a]);
}
const q = (v, a) => Math.round(((v - lo[a]) / (hi[a] - lo[a])) * 65535) - 32768;

const segments = [], meshes = [];
let bytes = 0;
const append = typed => {
  const pad = (4 - (bytes % 4)) % 4;
  if (pad) { segments.push(Buffer.alloc(pad)); bytes += pad; }
  const offset = bytes;
  segments.push(Buffer.from(typed.buffer, typed.byteOffset, typed.byteLength));
  bytes += typed.byteLength;
  return offset;
};

const stats = {}, excluded = [];
for (const g of Object.keys(GROUPS)) {
  let pos = [], nrm = [], idx = [];
  const flush = () => {
    if (!idx.length) return;
    const vertexCount = pos.length / 3;
    meshes.push({
      group: g, vertexCount, indexCount: idx.length,
      positions: append(Int16Array.from(pos)), normals: append(Int8Array.from(nrm)), indices: append(Uint16Array.from(idx)),
    });
    pos = []; nrm = []; idx = [];
  };
  for (const p of atlas.parts) {
    if (GENITAL.test(p.name) && GROUPS[g].test(p)) { excluded.push(p.name); continue; }
    if (groupOf(p) !== g) continue;
    const b = chunks[p.chunk];
    const P = new Float32Array(b.buffer, b.byteOffset + p.positions, p.vertexCount * 3);
    const N = new Int16Array(b.buffer, b.byteOffset + p.normals, p.vertexCount * 3);
    const I = new Uint32Array(b.buffer, b.byteOffset + p.indices, p.indexCount);
    const target = Math.max(48, Math.floor((p.indexCount * GROUPS[g].keep) / 3) * 3);
    let [simple] = MeshoptSimplifier.simplify(I, P, 3, Math.min(I.length, target), GROUPS[g].err);
    // Mallas con topología cerrada que no bajan del objetivo: simplificación "sloppy" (ignora la topología).
    if (simple.length > target * 1.5) [simple] = MeshoptSimplifier.simplifySloppy(I, P, 3, null, target, GROUPS[g].err);
    const [remap, count] = MeshoptSimplifier.compactMesh(simple);
    if (pos.length / 3 + count > 65535) flush();
    const base = pos.length / 3;
    const local = new Array(count);
    for (let old = 0; old < remap.length; old++) if (remap[old] !== 0xffffffff) local[remap[old]] = old;
    for (const old of local) {
      for (let a = 0; a < 3; a++) {
        pos.push(q(P[old * 3 + a], a));
        nrm.push(Math.round((N[old * 3 + a] / 32767) * 127));
      }
    }
    for (const i of simple) idx.push(base + i);
    stats[g] = (stats[g] || 0) + simple.length / 3;
  }
  flush();
}

const manifest = {
  source: 'BodyParts3D 4.0 © The Database Center for Life Science (DBCLS), CC BY 4.0. Adaptado: subconjunto sin piel ni órganos genitales, simplificado y cuantizado.',
  bounds: [lo, hi], meshes,
};
const payload = Buffer.concat(segments).toString('base64');
fs.writeFileSync(outFile,
  `/* Generado por tools/build-anatomy.mjs. ${manifest.source} */\n` +
  `window.ANATOMY_DATA = ${JSON.stringify(manifest)};\nwindow.ANATOMY_DATA.b64 = "${payload}";\n`);
console.log(JSON.stringify({ triangles: stats, meshes: meshes.length, rawMB: +(bytes / 1e6).toFixed(2),
  fileMB: +(fs.statSync(outFile).size / 1e6).toFixed(2), excludedGenital: [...new Set(excluded)] }, null, 1));
