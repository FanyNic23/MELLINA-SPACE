/*
 * A-HAMS · Entrada de voz del asistente (Speech-to-Text), 100% local.
 *
 * Graba con MediaRecorder, corta solo al detectar silencio y envía el clip al Edge Core de la nave
 * (POST /api/voice/stt), donde lo transcribe Whisper local. No usa el reconocimiento del navegador
 * (Web Speech API), porque en Chrome envía el audio a servidores externos.
 *
 * API: const l = new VoiceListener({ onState }); await l.init(); const texto = await l.listen();
 *      l.language es el idioma detectado en la última orden ('en' | 'es').
 *      l.stop() corta la grabación y transcribe lo grabado; l.cancel() lo descarta.
 *      onState recibe 'listening' | 'transcribing' | 'idle'.
 */
export const STT_CONFIG = {
  endpoint: "/api/voice/stt",
  statusEndpoint: "/health",
  language: 'auto',   // Whisper detecta si la orden es en inglés o en español
  threshold: 0.015,   // RMS a partir del cual se considera que hay voz
  silenceMs: 1100,    // silencio tras hablar que da la orden por terminada
  noSpeechMs: 5000,   // si nadie habla en este tiempo, se deja de escuchar
  maxMs: 12000,       // duración máxima de una orden
};

const canRecord = !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && window.MediaRecorder);

export class VoiceListener {
  constructor({ onState } = {}) {
    this.config = STT_CONFIG;
    this.onState = onState || (() => {});
    this.engine = null;
    this.server = null;       // { provider, model, offline } del reconocimiento en el Edge Core
    this.busy = false;
    this.language = null;     // idioma detectado en la última orden
    this._finish = null;
  }

  /** Comprueba que Whisper local esté disponible en el Edge Core. */
  async init() {
    this.engine = null;
    if (canRecord) {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 5000);
      try {
        const res = await fetch(STT_CONFIG.statusEndpoint, { signal: ctrl.signal });
        const { stt } = await res.json();
        if (stt && stt.available) {
          this.engine = 'server';
          this.server = stt;
        }
      } catch {
        // Edge Core no disponible
      } finally {
        clearTimeout(timer);
      }
    }
    return this.engine;
  }

  async listen() {
    if (this.busy) return '';
    this.busy = true;
    this._cancelled = false;
    try {
      if (this.engine === 'server') return await this._listenServer();
      throw new Error('No hay motor de reconocimiento de voz disponible.');
    } finally {
      this.busy = false;
    this.language = null;     // idioma detectado en la última orden
      this.onState('idle');
    }
  }

  stop() {
    if (this._finish) this._finish();
  }

  cancel() {
    this._cancelled = true;
    this.stop();
  }

  // ── Edge Core (Whisper local por defecto) ──────────────────────
  async _listenServer() {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
    });
    const mimeType = ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/mp4']
      .find((t) => MediaRecorder.isTypeSupported(t));
    const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    const chunks = [];
    recorder.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
    const stopped = new Promise((resolve) => { recorder.onstop = resolve; });

    // Detección de silencio sobre la misma señal del micrófono.
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const source = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    source.connect(analyser);
    const buf = new Float32Array(analyser.fftSize);
    const started = performance.now();
    let heard = false;
    let lastVoice = started;

    this._finish = () => { if (recorder.state === 'recording') recorder.stop(); };
    const vad = setInterval(() => {
      analyser.getFloatTimeDomainData(buf);
      let sum = 0;
      for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
      const now = performance.now();
      if (Math.sqrt(sum / buf.length) > STT_CONFIG.threshold) {
        heard = true;
        lastVoice = now;
      }
      if ((heard && now - lastVoice > STT_CONFIG.silenceMs) ||
          (!heard && now - started > STT_CONFIG.noSpeechMs) ||
          now - started > STT_CONFIG.maxMs) {
        this._finish();
      }
    }, 50);

    recorder.start();
    this.onState('listening');
    await stopped;

    clearInterval(vad);
    this._finish = null;
    source.disconnect();
    ctx.close();
    stream.getTracks().forEach((t) => t.stop());

    if (this._cancelled || !heard || !chunks.length) return '';

    this.onState('transcribing');
    const type = recorder.mimeType || mimeType || 'audio/webm';
    const ext = type.includes('mp4') ? 'mp4' : type.includes('ogg') ? 'ogg' : 'webm';
    const form = new FormData();
    form.append('audio', new Blob(chunks, { type }), `orden.${ext}`);
    const res = await fetch(`${STT_CONFIG.endpoint}?language=${STT_CONFIG.language}`, { method: 'POST', body: form });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.detail || `STT HTTP ${res.status}`);
    this.language = json.language || null;
    return (json.text || '').trim();
  }
}
