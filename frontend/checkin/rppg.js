/*
 * A-HAMS · Pulso por cámara (fotopletismografía remota, rPPG), 100% local en el navegador.
 *
 * Cada latido llena de sangre los capilares de la cara y cambia muy levemente el color de la piel,
 * sobre todo en el canal verde. Se promedia el verde de una zona de la frente/mejillas durante ~15 s,
 * se quita la tendencia lenta (cambios de luz) y se busca la frecuencia dominante entre 45 y 180 lpm.
 * El video nunca sale del equipo: se analiza cuadro a cuadro y se descarta.
 *
 *   const m = new CameraPulse(videoEl, canvasEl, { seconds: 15, onProgress, onSignal });
 *   await m.start();           // pide permiso a la cámara
 *   const { bpm, quality } = await m.measure();
 *   m.stop();
 */
(function (global) {
  'use strict';

  const FS = 30;                    // frecuencia de remuestreo (Hz)
  const MIN_BPM = 45, MAX_BPM = 180;

  class CameraPulse {
    constructor(video, canvas, opts = {}) {
      this.video = video;
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d', { willReadFrequently: true });
      this.seconds = opts.seconds || 15;
      this.onProgress = opts.onProgress || (() => {});
      this.onSignal = opts.onSignal || (() => {});
      this.stream = null;
    }

    static get supported() {
      return Boolean(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
    }

    async start() {
      this.stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' }, audio: false,
      });
      this.video.srcObject = this.stream;
      this.video.muted = true;
      this.video.playsInline = true;
      await this.video.play();
    }

    stop() {
      this._stopped = true;
      if (this.stream) this.stream.getTracks().forEach(t => t.stop());
      this.stream = null;
      this.video.srcObject = null;
    }

    // Zona de medición: centro-superior del encuadre (frente y mejillas con la cara centrada).
    _roi(w, h) {
      return { x: Math.round(w * 0.38), y: Math.round(h * 0.22), w: Math.round(w * 0.24), h: Math.round(h * 0.2) };
    }

    measure() {
      this._stopped = false;
      const t0 = performance.now();
      const times = [], greens = [];
      return new Promise((resolve, reject) => {
        const frame = () => {
          if (this._stopped) return reject(new Error('Medición cancelada'));
          const w = this.video.videoWidth, h = this.video.videoHeight;
          if (w && h) {
            this.canvas.width = w;
            this.canvas.height = h;
            this.ctx.drawImage(this.video, 0, 0, w, h);
            const r = this._roi(w, h);
            const px = this.ctx.getImageData(r.x, r.y, r.w, r.h).data;
            let g = 0;
            for (let i = 1; i < px.length; i += 4) g += px[i];
            times.push((performance.now() - t0) / 1000);
            greens.push(g / (px.length / 4));
            this.onSignal(greens.slice(-150), r, w, h);
          }
          const elapsed = (performance.now() - t0) / 1000;
          this.onProgress(Math.min(1, elapsed / this.seconds));
          if (elapsed < this.seconds) requestAnimationFrame(frame);
          else resolve(CameraPulse.estimate(times, greens));
        };
        requestAnimationFrame(frame);
      });
    }

    /** Estima pulso y calidad (0-1) a partir de la serie de verde. */
    static estimate(times, values) {
      if (values.length < FS * 5) return { bpm: null, quality: 0 };
      // Remuestreo uniforme a FS Hz por interpolación lineal.
      const duration = times[times.length - 1];
      const n = Math.floor(duration * FS);
      const sig = new Float64Array(n);
      for (let i = 0, j = 0; i < n; i++) {
        const t = i / FS;
        while (j < times.length - 2 && times[j + 1] < t) j++;
        const k = (t - times[j]) / ((times[j + 1] - times[j]) || 1);
        sig[i] = values[j] + (values[j + 1] - values[j]) * Math.max(0, Math.min(1, k));
      }
      // Quita la tendencia lenta (media móvil de 1 s) y normaliza.
      const win = FS;
      const out = new Float64Array(n);
      let mean = 0, sq = 0;
      for (let i = 0; i < n; i++) {
        let s = 0, c = 0;
        for (let k = Math.max(0, i - win); k <= Math.min(n - 1, i + win); k++) { s += sig[k]; c++; }
        out[i] = sig[i] - s / c;
        mean += out[i];
      }
      mean /= n;
      for (let i = 0; i < n; i++) { out[i] -= mean; sq += out[i] * out[i]; }
      const std = Math.sqrt(sq / n) || 1;
      for (let i = 0; i < n; i++) out[i] = out[i] / std * (0.5 - 0.5 * Math.cos(2 * Math.PI * i / (n - 1)));  // ventana Hann
      // Espectro (DFT directa solo en la banda cardíaca, con resolución de 0.5 lpm).
      let best = 0, bestBpm = null, total = 0;
      for (let bpm = MIN_BPM; bpm <= MAX_BPM; bpm += 0.5) {
        const f = bpm / 60;
        let re = 0, im = 0;
        for (let i = 0; i < n; i++) {
          const a = 2 * Math.PI * f * i / FS;
          re += out[i] * Math.cos(a);
          im -= out[i] * Math.sin(a);
        }
        const p = re * re + im * im;
        total += p;
        if (p > best) { best = p; bestBpm = bpm; }
      }
      const bins = (MAX_BPM - MIN_BPM) / 0.5 + 1;
      const quality = Math.max(0, Math.min(1, (best / (total / bins) - 1) / 12));
      return { bpm: bestBpm ? Math.round(bestBpm) : null, quality };
    }
  }

  global.CameraPulse = CameraPulse;
})(window);
