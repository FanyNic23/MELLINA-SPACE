/*
 * A-HAMS · Chequeo diario guiado: el astronauta se mide, entiende su resultado y sabe qué hacer.
 *
 *   1. Mídete     — un indicador por paso, con cómo medirlo en el espacio y por qué importa.
 *                   Entrada por teclado, clic o cámara (pulso por video, checkin/rppg.js).
 *   2. Entiéndete — semáforo por indicador y el SEWS explicado punto por punto.
 *   3. Actúa      — contramedidas prescritas y, ante banderas rojas, aviso al cirujano de vuelo
 *                   (queda en la cola DTN y sale en la próxima ventana de enlace).
 *
 *   DailyCheckin.open(astro, { onDone })   astro = tripulante normalizado de data/mission-api.js
 */
(function (global) {
  'use strict';

  const C = { ok: '#2dd4bf', watch: '#38bdf8', crit: '#ef4444' };

  // Rangos de referencia (adulto en reposo) usados para el semáforo de cada indicador.
  const STEPS = [
    {
      id: 'bp', icon: 'gauge', title: 'Presión arterial', unit: 'mmHg',
      how: ['Sujétate al asiento con las piernas fijas y reposa 5 minutos.', 'Coloca el brazalete en el brazo izquierdo, a la altura del corazón.', 'No hables ni te muevas durante la medición.'],
      why: 'Sin gravedad, los fluidos suben hacia la cabeza y el corazón trabaja distinto. Al volver a la gravedad la presión puede caer y provocar mareos.',
      range: 'Normal: 90–139 / 60–89 mmHg',
      fields: [
        { key: 'systolic_bp', label: 'Sistólica', min: 60, max: 250, step: 1, ph: '120' },
        { key: 'diastolic_bp', label: 'Diastólica', min: 30, max: 150, step: 1, ph: '80' },
      ],
      status: v => (v.systolic_bp >= 180 || v.diastolic_bp >= 110) ? 'crit'
        : (v.systolic_bp >= 140 || v.diastolic_bp >= 90 || v.systolic_bp < 90) ? 'watch' : 'ok',
      show: v => `${v.systolic_bp}/${v.diastolic_bp}`,
    },
    {
      id: 'hr', icon: 'heartbeat', title: 'Pulso en reposo', unit: 'lpm', camera: true,
      how: ['Usa la cámara: centra tu cara, buena luz y quédate quieto 15 segundos.', 'O manual: dos dedos en la muñeca, cuenta 30 segundos y multiplica por 2.'],
      why: 'El corazón se desacondiciona en microgravedad. Un pulso en reposo alto puede indicar estrés, fatiga o deshidratación.',
      range: 'Normal: 50–100 lpm',
      fields: [{ key: 'heart_rate', label: 'Pulso', min: 30, max: 220, step: 1, ph: '68' }],
      status: v => (v.heart_rate > 130 || v.heart_rate < 40) ? 'crit' : (v.heart_rate > 100 || v.heart_rate < 50) ? 'watch' : 'ok',
      show: v => v.heart_rate,
    },
    {
      id: 'spo2', icon: 'drop', title: 'Oxígeno en sangre (SpO₂)', unit: '%',
      how: ['Coloca el oxímetro en el dedo índice, sin esmalte.', 'Mantén la mano quieta y a la altura del pecho 30 segundos.'],
      why: 'El CO₂ se acumula en zonas sin ventilación de la nave y reduce la oxigenación: aparecen dolor de cabeza y fatiga.',
      range: 'Normal: 95–100 %',
      fields: [{ key: 'spo2', label: 'SpO₂', min: 70, max: 100, step: 0.1, ph: '98' }],
      status: v => v.spo2 < 92 ? 'crit' : v.spo2 < 95 ? 'watch' : 'ok',
      show: v => v.spo2,
    },
    {
      id: 'glucose', icon: 'drop', title: 'Glucosa en sangre', unit: 'mg/dL',
      how: ['Lávate y seca el dedo; pincha el costado de la yema con la lanceta.', 'Descarta la primera gota y aplica la segunda a la tira del glucómetro.', 'Idealmente en ayunas, antes del desayuno.'],
      why: 'La inactividad y la microgravedad reducen la sensibilidad a la insulina. Una glucosa baja afecta los reflejos en tareas críticas.',
      range: 'Normal en ayunas: 70–125 mg/dL',
      fields: [{ key: 'glucose_mg_dl', label: 'Glucosa', min: 20, max: 600, step: 1, ph: '92' }],
      status: v => (v.glucose_mg_dl < 60 || v.glucose_mg_dl > 250) ? 'crit' : (v.glucose_mg_dl < 70 || v.glucose_mg_dl >= 126) ? 'watch' : 'ok',
      show: v => v.glucose_mg_dl,
    },
    {
      id: 'temp', icon: 'thermometer', title: 'Temperatura corporal', unit: '°C',
      how: ['Termómetro bajo la lengua, boca cerrada, 1 minuto.', 'No midas justo después de hacer ejercicio ni de beber.'],
      why: 'El sistema inmune se debilita en vuelo y pueden reactivarse virus latentes. La fiebre en un espacio cerrado afecta a toda la tripulación.',
      range: 'Normal: 36.0–37.9 °C',
      fields: [{ key: 'core_temp', label: 'Temperatura', min: 32, max: 43, step: 0.1, ph: '36.7' }],
      status: v => (v.core_temp >= 38.5 || v.core_temp < 35) ? 'crit' : (v.core_temp >= 38 || v.core_temp < 35.5) ? 'watch' : 'ok',
      show: v => v.core_temp,
    },
    {
      id: 'sleep', icon: 'bed', title: 'Horas de sueño', unit: 'h',
      how: ['Indica cuántas horas dormiste en las últimas 24 h (o el dato del actígrafo).'],
      why: 'En órbita hay hasta 16 amaneceres al día: el reloj biológico se desajusta y la falta de sueño degrada reflejos y decisiones.',
      range: 'Recomendado: 7–9 h',
      fields: [{ key: 'sleep_hours', label: 'Sueño', min: 0, max: 16, step: 0.1, ph: '7.5' }],
      status: v => v.sleep_hours < 5 ? 'crit' : v.sleep_hours < 6.5 ? 'watch' : 'ok',
      show: v => v.sleep_hours,
    },
    {
      id: 'mood', icon: 'smiley', title: '¿Cómo te sientes hoy?', unit: '', mood: true,
      how: ['Elige la opción que mejor describe tu estado ahora mismo. Es confidencial y solo tú y el oficial médico la ven.'],
      why: 'El aislamiento y el confinamiento elevan el estrés y el riesgo de depresión. Registrar el ánimo a diario permite detectarlo a tiempo.',
      range: '',
      options: [
        { key: 'calm', label: 'Bien y tranquilo', icon: 'smiley', valence: 0.6, arousal: 0 },
        { key: 'focused', label: 'Con energía', icon: 'smiley', valence: 0.4, arousal: 0.5 },
        { key: 'meh', label: 'Regular', icon: 'smiley-meh', valence: -0.1, arousal: 0 },
        { key: 'anxious', label: 'Tenso o ansioso', icon: 'smiley-nervous', valence: -0.45, arousal: 0.6 },
        { key: 'exhausted', label: 'Agotado o triste', icon: 'smiley-sad', valence: -0.65, arousal: -0.5 },
      ],
      status: v => v.mood_valence < -0.4 ? 'watch' : 'ok',
      show: v => v.mood_label,
    },
  ];

  const LEVEL_TEXT = { ok: 'En rango', watch: 'Vigilar', crit: 'Crítico' };
  const icon = (n, cls = 'w-5 h-5') => global.Icons.svg(n, cls);
  let root, state;

  function build() {
    root = document.createElement('div');
    root.className = 'ck-overlay';
    root.hidden = true;
    root.innerHTML = '<div class="ck-modal" role="dialog" aria-modal="true" aria-label="Chequeo diario"></div>';
    document.body.appendChild(root);
    root.addEventListener('click', e => { if (e.target === root) close(); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && !root.hidden) close(); });
  }

  function open(astro, opts = {}) {
    if (!root) build();
    state = { astro, step: 0, values: {}, onDone: opts.onDone || (() => {}), pulse: null };
    root.hidden = false;
    render();
  }

  function close() {
    stopCamera();
    root.hidden = true;
  }

  const modal = () => root.querySelector('.ck-modal');

  function progress() {
    const n = STEPS.length + 1;
    return `<div class="ck-progress">${Array.from({ length: n }, (_, i) =>
      `<i class="${i < state.step ? 'done' : i === state.step ? 'now' : ''}"></i>`).join('')}</div>`;
  }

  function header(sub) {
    return `<header class="ck-head">
      <img src="${state.astro.photo}" alt="">
      <div class="min-w-0"><div class="ck-kicker">CHEQUEO DIARIO · SOL ${String(state.astro.missionDay).padStart(3, '0')}</div>
        <div class="ck-who">${state.astro.name}</div><div class="ck-sub">${sub}</div></div>
      <button class="ck-x" aria-label="Cerrar">${icon('x-circle', 'w-6 h-6')}</button>
    </header>${progress()}`;
  }

  function render() {
    stopCamera();
    if (state.step >= STEPS.length) return renderSummary();
    const s = STEPS[state.step];
    const v = state.values;
    const input = s.mood
      ? `<div class="ck-moods">${s.options.map(o => `
          <button type="button" class="ck-mood ${v.mood_key === o.key ? 'on' : ''}" data-mood="${o.key}">
            ${icon(o.icon, 'w-7 h-7')}<span>${o.label}</span></button>`).join('')}</div>`
      : `<div class="ck-fields">${s.fields.map(f => `
          <label class="ck-field"><span>${f.label}</span>
            <input type="number" inputmode="decimal" id="ck-${f.key}" min="${f.min}" max="${f.max}" step="${f.step}"
              placeholder="${f.ph}" value="${v[f.key] ?? ''}"><b>${s.unit}</b></label>`).join('')}</div>
        ${s.camera && global.CameraPulse && CameraPulse.supported ? `
          <div class="ck-cam" id="ck-cam">
            <button type="button" class="ck-cam-btn" id="ck-cam-start">${icon('camera')} Medir con la cámara (15 s)</button>
            <div class="ck-cam-live" hidden>
              <div class="ck-video"><video id="ck-video" playsinline muted></video><span class="ck-roi" id="ck-roi"></span></div>
              <canvas id="ck-canvas" hidden></canvas>
              <svg class="ck-wave" viewBox="0 0 300 60" preserveAspectRatio="none"><path id="ck-wave-path" d=""/></svg>
              <div class="ck-cam-bar"><i id="ck-cam-progress"></i></div>
              <div class="ck-cam-msg" id="ck-cam-msg">Centra tu cara en el recuadro y quédate quieto.</div>
            </div>
          </div>` : ''}`;
    modal().innerHTML = `${header(`Paso ${state.step + 1} de ${STEPS.length}`)}
      <section class="ck-body">
        <div class="ck-title"><span class="ck-ic">${icon(s.icon, 'w-6 h-6')}</span><h2>${s.title}</h2></div>
        <div class="ck-grid">
          <div class="ck-col">
            <div class="ck-label">CÓMO MEDIRLO</div>
            <ol class="ck-how">${s.how.map(h => `<li>${h}</li>`).join('')}</ol>
            <div class="ck-label">POR QUÉ IMPORTA EN EL ESPACIO</div>
            <p class="ck-why">${s.why}</p>
            ${s.range ? `<div class="ck-range">${s.range}</div>` : ''}
          </div>
          <div class="ck-col">${input}<div class="ck-error" id="ck-error"></div></div>
        </div>
      </section>
      <footer class="ck-foot">
        <button type="button" class="ck-ghost" id="ck-back" ${state.step === 0 ? 'disabled' : ''}>Atrás</button>
        <button type="button" class="ck-ghost" id="ck-skip">Omitir</button>
        <button type="button" class="ck-primary" id="ck-next">${state.step === STEPS.length - 1 ? 'Ver mi evaluación' : 'Siguiente'} ${icon('arrow-right', 'w-4 h-4')}</button>
      </footer>`;
    wire(s);
    const first = modal().querySelector('input');
    if (first) first.focus();
  }

  function wire(s) {
    const m = modal();
    m.querySelector('.ck-x').onclick = close;
    m.querySelector('#ck-back').onclick = () => { state.step--; render(); };
    m.querySelector('#ck-skip').onclick = () => { state.step++; render(); };
    m.querySelector('#ck-next').onclick = () => { if (collect(s)) { state.step++; render(); } };
    m.querySelectorAll('input').forEach(i => i.addEventListener('keydown', e => {
      if (e.key === 'Enter') m.querySelector('#ck-next').click();
    }));
    m.querySelectorAll('[data-mood]').forEach(b => b.onclick = () => {
      const o = s.options.find(x => x.key === b.dataset.mood);
      Object.assign(state.values, { mood_key: o.key, mood_label: o.label, mood_valence: o.valence, mood_arousal: o.arousal });
      render();
    });
    const camBtn = m.querySelector('#ck-cam-start');
    if (camBtn) camBtn.onclick = measurePulse;
  }

  function collect(s) {
    const err = modal().querySelector('#ck-error');
    if (s.mood) {
      if (state.values.mood_key) return true;
      err.textContent = 'Elige una opción o pulsa Omitir.';
      return false;
    }
    const got = {};
    for (const f of s.fields) {
      const raw = modal().querySelector(`#ck-${f.key}`).value.trim();
      if (raw === '') { err.textContent = `Escribe ${f.label.toLowerCase()} o pulsa Omitir.`; return false; }
      const n = Number(raw);
      if (!Number.isFinite(n) || n < f.min || n > f.max) {
        err.textContent = `${f.label}: el valor debe estar entre ${f.min} y ${f.max} ${s.unit}.`;
        return false;
      }
      got[f.key] = n;
    }
    Object.assign(state.values, got);
    return true;
  }

  // ---------------------------------------------------------------- pulso por cámara
  async function measurePulse() {
    const m = modal();
    const live = m.querySelector('.ck-cam-live'), btn = m.querySelector('#ck-cam-start'), msg = m.querySelector('#ck-cam-msg');
    live.hidden = false;
    btn.hidden = true;
    const video = m.querySelector('#ck-video'), roiEl = m.querySelector('#ck-roi'), wave = m.querySelector('#ck-wave-path');
    state.pulse = new CameraPulse(video, m.querySelector('#ck-canvas'), {
      seconds: 15,
      onProgress: k => { m.querySelector('#ck-cam-progress').style.width = `${Math.round(k * 100)}%`; },
      onSignal: (vals, r, w, h) => {
        roiEl.style.cssText = `left:${r.x / w * 100}%;top:${r.y / h * 100}%;width:${r.w / w * 100}%;height:${r.h / h * 100}%`;
        if (vals.length < 3) return;
        const lo = Math.min(...vals), hi = Math.max(...vals) || 1;
        wave.setAttribute('d', vals.map((y, i) => `${i ? 'L' : 'M'}${(i / (vals.length - 1) * 300).toFixed(1)} ${(55 - (y - lo) / ((hi - lo) || 1) * 50).toFixed(1)}`).join(' '));
      },
    });
    try {
      await state.pulse.start();
      msg.textContent = 'Midiendo… no te muevas.';
      const { bpm, quality } = await state.pulse.measure();
      stopCamera();
      if (!bpm || quality < 0.15) {
        msg.textContent = 'Señal débil: mejora la luz y quédate quieto, o escribe el pulso a mano.';
        btn.hidden = false;
        btn.innerHTML = `${icon('camera')} Repetir medición`;
        return;
      }
      m.querySelector('#ck-heart_rate').value = bpm;
      state.values.pulse_source = 'camera';
      msg.innerHTML = `Pulso estimado: <b>${bpm} lpm</b> · calidad de señal ${Math.round(quality * 100)} %`;
    } catch (err) {
      stopCamera();
      live.hidden = true;
      btn.hidden = false;
      modal().querySelector('#ck-error').textContent = err.name === 'NotAllowedError'
        ? 'Sin permiso para la cámara: escribe el pulso a mano.' : 'No se pudo usar la cámara: escribe el pulso a mano.';
    }
  }

  function stopCamera() {
    if (state && state.pulse) { state.pulse.stop(); state.pulse = null; }
  }

  // ---------------------------------------------------------------- 2 y 3: entiéndete y actúa
  async function renderSummary() {
    const v = state.values;
    const payload = {};
    for (const k of ['systolic_bp', 'diastolic_bp', 'heart_rate', 'spo2', 'glucose_mg_dl', 'core_temp', 'sleep_hours', 'mood_valence', 'mood_arousal', 'pulse_source']) {
      if (v[k] !== undefined) payload[k] = v[k];
    }
    if (!Object.keys(payload).filter(k => k !== 'pulse_source').length) {
      modal().innerHTML = `${header('Sin mediciones')}<section class="ck-body"><p class="ck-why">No registraste ningún valor. Vuelve cuando tengas tus mediciones.</p></section>
        <footer class="ck-foot"><button class="ck-primary" id="ck-close">Cerrar</button></footer>`;
      modal().querySelector('.ck-x').onclick = close;
      modal().querySelector('#ck-close').onclick = close;
      return;
    }
    modal().innerHTML = `${header('Evaluando en el Edge Core…')}<section class="ck-body ck-center">Analizando tus mediciones…</section>`;
    let r;
    try {
      r = await global.MissionAPI.checkin(state.astro.id, payload);
    } catch (err) {
      modal().innerHTML = `${header('Error')}<section class="ck-body"><p class="ck-why">No se pudo guardar el chequeo: ${err.message}</p></section>
        <footer class="ck-foot"><button class="ck-primary" id="ck-close">Cerrar</button></footer>`;
      modal().querySelector('.ck-x').onclick = close;
      modal().querySelector('#ck-close').onclick = close;
      return;
    }
    const level = r.status_label === 'ALERTA_CRITICA' ? 'crit' : r.status_label === 'ALERTA_MODERADA' ? 'watch' : 'ok';
    const rows = STEPS.filter(s => s.mood ? v.mood_key : s.fields.every(f => v[f.key] !== undefined)).map(s => {
      const st = s.status(v);
      return `<div class="ck-row"><span class="ck-ic sm" style="color:${C[st]}">${icon(s.icon, 'w-4 h-4')}</span>
        <span class="flex-1">${s.title}</span><b>${s.show(v)} ${s.unit}</b>
        <em style="color:${C[st]}" class="${st === 'crit' ? 'is-critical' : ''}">${LEVEL_TEXT[st]}</em></div>`;
    }).join('');
    const factors = r.score_breakdown.length
      ? r.score_breakdown.map(f => `<div class="ck-factor"><b>+${f.points}</b><span>${f.risk}</span><em>${f.value}</em></div>`).join('')
      : '<div class="ck-why">Ningún indicador suma puntos: todo en rango.</div>';
    const surgeon = r.escalate_to_surgeon
      ? `<div class="ck-alert is-critical-bg">${icon('warning-octagon', 'w-7 h-7')}
          <div><b>Avisa al cirujano de vuelo</b><span>${r.escalation_reasons.join(' · ')}</span>
          <small>${icon('paper-plane-tilt', 'w-3.5 h-3.5')} ${global.MISSION_ENV && global.MISSION_ENV.realtime_surgeon
            ? 'Enlace en tiempo real con la Tierra: llama ahora al cirujano de vuelo. Tu chequeo ya le llegó.'
            : 'Tu chequeo ya está en la cola prioritaria hacia la Tierra y sale en la próxima ventana de enlace.'}</small>
          ${global.MISSION_ENV ? `<small>${icon('rocket-launch', 'w-3.5 h-3.5')} ${global.MISSION_ENV.evacuation}</small>` : ''}</div></div>`
      : `<div class="ck-ok">${icon('check-circle', 'w-6 h-6')}<div><b>No necesitas avisar a la Tierra</b><span>Sigue las acciones de abajo y repite el chequeo mañana.</span></div></div>`;
    const actions = r.active_countermeasures.slice(0, 3).map(c => `
      <div class="ck-action"><div class="flex justify-between gap-2"><b>${c.title}</b>
        <em class="${c.urgency === 'INMEDIATA' ? 'is-critical' : ''}" style="color:${c.urgency === 'INMEDIATA' ? C.crit : c.urgency === 'ALTA' ? C.watch : C.ok}">${c.urgency}</em></div>
        <p>${c.action_protocol.split('\n')[0].replace(/^1\.\s*/, '')}</p></div>`).join('');
    modal().innerHTML = `${header('Tu evaluación')}
      <section class="ck-body">
        <div class="ck-score" style="--c:${C[level]}">
          <div class="ck-score-n ${level === 'crit' ? 'is-critical' : ''}">${String(r.sews_score).padStart(2, '0')}<small>/15</small></div>
          <div><div class="ck-label">SEWS · ${LEVEL_TEXT[level].toUpperCase()}</div><p class="ck-why">${r.summary_clinical}</p></div>
        </div>
        ${surgeon}
        <div class="ck-grid">
          <div class="ck-col"><div class="ck-label">TUS MEDICIONES</div>${rows}</div>
          <div class="ck-col"><div class="ck-label">POR QUÉ ESTE SEWS</div>${factors}</div>
        </div>
        <div class="ck-label">QUÉ HACER AHORA</div>
        <div class="ck-actions">${actions}</div>
      </section>
      <footer class="ck-foot"><button class="ck-primary" id="ck-close">Listo ${icon('check-circle', 'w-4 h-4')}</button></footer>`;
    modal().querySelector('.ck-x').onclick = close;
    modal().querySelector('#ck-close').onclick = close;
    state.onDone(r);
  }

  global.DailyCheckin = { open, close, STEPS };
})(window);
