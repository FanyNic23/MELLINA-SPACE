/*
 * A-HAMS · Capa de voz del asistente, desacoplada del avatar.
 *
 * Motores:
 *   'browser' → síntesis del navegador (speechSynthesis). Lip-sync por texto: cada letra se
 *               traduce a un visema (apertura/ancho de boca) y se resincroniza con los eventos
 *               de palabra del motor.
 *   'model'   → voz del Edge Core (ElevenLabs o un modelo propio). POST {text, lang: 'es'|'en'} a VOICE_CONFIG.modelEndpoint y
 *               se espera audio (wav/mp3/ogg). El lip-sync sale de la energía real del audio
 *               (AnalyserNode), así que sirve para cualquier modelo TTS sin tocar el avatar.
 *               Si el endpoint falla, se cae al motor del navegador.
 *
 * El motor 'model' se activa solo cuando el Edge Core informa síntesis disponible (ElevenLabs con clave
 * en backend/.env); para conectar un modelo de voz propio basta con servirlo en ese mismo endpoint.
 */
(function (global) {
  'use strict';

  const VOICE_CONFIG = {
    engine: 'browser',
    language: 'es',
    // Variantes regionales por orden de preferencia para elegir la voz por defecto.
    locales: {
      es: ['es-MX', 'es-US', 'es-419', 'es-ES'],
      en: ['en-US', 'en-GB', 'en-AU', 'en-IE', 'en-CA', 'en-IN', 'en-ZA'],
    },
    // Voces por defecto si están instaladas (las más claras de macOS); si no, la primera del idioma.
    preferredVoices: {
      es: ['Paulina', 'Mónica'],
      en: ['Samantha', 'Daniel'],
    },
    rate: 1.0,
    pitch: 1.0,
    modelEndpoint: `${global.AHAMS_CONFIG.apiBase}/api/voice/tts`,
  };

  // [apertura, ancho] por vocal; bilabiales cierran la boca.
  const VISEMES = { a: [0.95, 1.0], e: [0.6, 1.12], i: [0.38, 1.18], o: [0.75, 0.72], u: [0.5, 0.62] };
  const BILABIAL = new Set(['m', 'b', 'p']);
  const CHARS_PER_SECOND = 14;

  function letterShape(ch) {
    if (!ch) return null;
    const c = ch.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
    if (VISEMES[c]) return VISEMES[c];
    if (BILABIAL.has(c)) return [0, 0.92];
    if (/[a-zñ0-9]/.test(c)) return [0.22, 1];
    return null;
  }

  // Voces de efectos de macOS: no tienen sentido para un asistente médico. El navegador las
  // muestra traducidas al idioma del sistema, por eso se listan en inglés y en español.
  const NOVELTY_VOICES = new RegExp('^(' + [
    'Albert', 'Bahh', 'Boing', 'Trinoids', 'Wobble', 'Zarvox',
    'Bad News', 'Bells', 'Bubbles', 'Cellos', 'Good News', 'Jester', 'Organ', 'Superstar', 'Whisper',
    'Malas noticias', 'Campanas', 'Burbujas', 'Violonchelos', 'Buenas noticias', 'Bufón', 'Órgano', 'Superestrella', 'Susurro',
  ].join('|') + ')(?=\\s|\\(|$)');

  // Las voces mejoradas suenan mucho más naturales: se prefieren a las compactas.
  const quality = (v) => (/(Premium|Enhanced|Mejorada|Neural|Natural)/i.test(v.name) ? 2 : 0) + (v.localService ? 1 : 0);

  function splitSentences(text) {
    // Solo corta si al signo le sigue un espacio: así "93.1" (decimal en inglés) no se parte.
    return text.split(/(?<=[.!?;])\s+/).map((s) => s.trim()).filter(Boolean);
  }

  class VoiceEngine {
    constructor({ onMouth, onState, onSentence } = {}) {
      this.config = VOICE_CONFIG;
      this.onMouth = onMouth || (() => {});
      this.onState = onState || (() => {});
      this.onSentence = onSentence || (() => {});
      this.voice = null;
      this._voiceByLanguage = {};
      this._token = 0;
      this._lip = null;
      this._analyser = null;
      this._audio = null;
      this.supported = 'speechSynthesis' in global;

      if (this.supported) {
        const pick = () => { if (!this.voice) this.voice = this._defaultVoice(); };
        pick();
        speechSynthesis.addEventListener('voiceschanged', pick);
      }
      this._tick = this._tick.bind(this);
      requestAnimationFrame(this._tick);
    }

    get language() {
      return VOICE_CONFIG.language;
    }

    /** Voces instaladas del idioma activo, sin voces de efectos, de mejor a peor calidad. */
    get voices() {
      if (!this.supported) return [];
      const prefix = VOICE_CONFIG.language + '-';
      return speechSynthesis.getVoices()
        .filter((v) => v.lang.replace('_', '-').toLowerCase().startsWith(prefix) && !NOVELTY_VOICES.test(v.name))
        .sort((a, b) => quality(b) - quality(a) || a.name.localeCompare(b.name));
    }

    _defaultVoice() {
      const voices = this.voices;
      for (const name of VOICE_CONFIG.preferredVoices[VOICE_CONFIG.language] || []) {
        const v = voices.find((x) => x.name === name);
        if (v) return v;
      }
      for (const locale of VOICE_CONFIG.locales[VOICE_CONFIG.language] || []) {
        const v = voices.find((x) => x.lang.replace('_', '-') === locale);
        if (v) return v;
      }
      return voices[0] || null;
    }

    /** Con síntesis disponible en el Edge Core se usa esa voz; si no, la del sistema. */
    useServerVoice(enabled) {
      VOICE_CONFIG.engine = enabled ? 'model' : 'browser';
    }

    /** Cambia de idioma y recupera la última voz elegida en ese idioma. */
    setLanguage(code) {
      if (!VOICE_CONFIG.locales[code]) return;
      this.stop();
      VOICE_CONFIG.language = code;
      const remembered = this._voiceByLanguage[code];
      this.voice = this.voices.find((v) => v.name === remembered) || this._defaultVoice();
    }

    setVoice(name) {
      this.voice = this.voices.find((v) => v.name === name) || this.voice;
      if (this.voice) this._voiceByLanguage[VOICE_CONFIG.language] = this.voice.name;
    }

    async speak(text) {
      this.stop();
      const token = this._token;
      if (this.config.engine === 'model') {
        try {
          await this._speakModel(text, token);
          return;
        } catch (err) {
          console.warn('[voz] Modelo de voz no disponible, usando voz del navegador:', err);
        }
      }
      if (token === this._token) await this._speakBrowser(text, token);
    }

    stop() {
      this._token++;
      if (this.supported) speechSynthesis.cancel();
      if (this._audio) {
        this._audio.pause();
        this._audio = null;
      }
      this._finish();
    }

    // ── Motor del navegador ──────────────────────────────────────────
    _speakBrowser(text, token) {
      if (!this.supported) {
        this.onSentence(text);
        return Promise.resolve();
      }
      const sentences = splitSentences(text);
      this.onState('speaking');
      return new Promise((resolve) => {
        let i = 0;
        const next = () => {
          if (token !== this._token) return resolve();
          if (i >= sentences.length) {
            this._finish();
            return resolve();
          }
          const sentence = sentences[i++];
          const u = new SpeechSynthesisUtterance(sentence);
          u.lang = (this.voice && this.voice.lang) || VOICE_CONFIG.locales[VOICE_CONFIG.language][0];
          if (this.voice) u.voice = this.voice;
          u.rate = VOICE_CONFIG.rate;
          u.pitch = VOICE_CONFIG.pitch;
          u.onstart = () => {
            this._lip = { text: sentence, t0: performance.now(), cps: CHARS_PER_SECOND * VOICE_CONFIG.rate };
            this.onSentence(sentence);
          };
          u.onboundary = (e) => {
            if (this._lip) this._lip.t0 = performance.now() - (e.charIndex / this._lip.cps) * 1000;
          };
          u.onend = next;
          u.onerror = next;
          speechSynthesis.speak(u);
        };
        next();
      });
    }

    // ── Modelo de voz propio ─────────────────────────────────────────
    async _speakModel(text, token) {
      const res = await fetch(this.config.modelEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, lang: VOICE_CONFIG.language }),
      });
      if (!res.ok) throw new Error(`TTS HTTP ${res.status}`);
      const blob = await res.blob();
      if (token !== this._token) return;
      this.onSentence(text);
      await this.speakAudio(URL.createObjectURL(blob));
    }

    /** Reproduce cualquier audio con lip-sync por energía. Útil para el modelo de voz. */
    async speakAudio(src) {
      this._ctx = this._ctx || new (global.AudioContext || global.webkitAudioContext)();
      await this._ctx.resume();
      const audio = new Audio(src);
      const source = this._ctx.createMediaElementSource(audio);
      const analyser = this._ctx.createAnalyser();
      analyser.fftSize = 1024;
      source.connect(analyser);
      analyser.connect(this._ctx.destination);
      this._audio = audio;
      this._analyser = analyser;
      this._buf = new Float32Array(analyser.fftSize);
      this.onState('speaking');
      await new Promise((resolve) => {
        audio.onended = resolve;
        audio.onerror = resolve;
        audio.onpause = resolve;
        audio.play().catch(resolve);
      });
      source.disconnect();
      if (this._audio === audio) this._finish();
    }

    _finish() {
      this._lip = null;
      this._analyser = null;
      this.onMouth(0, 1);
      this.onState('idle');
    }

    _tick() {
      requestAnimationFrame(this._tick);
      if (this._analyser) {
        this._analyser.getFloatTimeDomainData(this._buf);
        let sum = 0;
        for (let i = 0; i < this._buf.length; i++) sum += this._buf[i] * this._buf[i];
        const rms = Math.sqrt(sum / this._buf.length);
        this.onMouth(Math.min(1, Math.max(0, (rms - 0.015) * 7)), 1);
        return;
      }
      if (this._lip) {
        const L = this._lip;
        const pos = Math.floor(((performance.now() - L.t0) / 1000) * L.cps);
        const shape = letterShape(L.text[pos]);
        if (shape) this.onMouth(shape[0] * (0.85 + Math.random() * 0.15), shape[1]);
        else this.onMouth(0.05, 1);
      }
    }
  }

  global.VOICE_CONFIG = VOICE_CONFIG;
  global.VoiceEngine = VoiceEngine;
})(window);
