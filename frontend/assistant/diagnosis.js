/*
 * A-HAMS · Datos y diagnóstico hablado del asistente (español / inglés).
 * Consume el Edge Core (FastAPI) y, si no responde, usa la telemetría de respaldo embebida.
 * Todo el texto se redacta para ser leído en voz alta (sin siglas ni símbolos de unidades).
 * El motor clínico genera riesgos y contramedidas en español; en inglés se traducen aquí
 * (riesgos por patrón, contramedidas por ID).
 */
(function (global) {
  'use strict';

  const API_BASE = global.AHAMS_CONFIG.apiBase;
  const ASSISTANT_NAME = 'Mellina';
  let lang = 'es';

  const FALLBACK_CREW = [
    {
      id: 'ASTRO-01', name: 'Dra. Elena Rostova', role: 'Comandante de Misión', missionDay: 14,
      sews: 2, status: 'NOMINAL',
      vitals: { hr: 64, hrv: 55, spo2: 98.8, sys: 115, dia: 75, temp: 36.7 },
      env: { radiation: 24, totalRadiation: null, co2: 3.1, psi: 14.7 },
      cog: { rt: 235, lapses: 0, sleep: 7.4, stress: 0.22 },
      musc: { delta: -1.1, exercise: 95 },
      risks: [],
      countermeasures: [{ id: 'CM-NOM-00', title: 'Protocolo Nominal de Vuelo Espacial', urgency: 'PREVENTIVA', protocol: 'Mantener rutina estándar de 2.5 horas de ejercicio resistivo y cardiovascular.' }],
    },
    {
      id: 'ASTRO-02', name: 'Marcus Vance', role: 'Ingeniero de Vuelo', missionDay: 14,
      sews: 10, status: 'ALERTA_CRITICA',
      vitals: { hr: 79, hrv: 28, spo2: 97.4, sys: 128, dia: 84, temp: 36.9 },
      env: { radiation: 25, totalRadiation: null, co2: 3.2, psi: 14.7 },
      cog: { rt: 265, lapses: 1, sleep: 6.2, stress: 0.45 },
      musc: { delta: -6.8, exercise: 42 },
      risks: [
        'Atrofia muscular acelerada (-6.8% vs baseline)',
        'Incumplimiento crítico de protocolo de contramedidas ARED/Treadmill',
        'Estrés autonómico elevado (HRV reducido)',
      ],
      countermeasures: [{ id: 'CM-MUSC-03', title: 'Intensificación de Protocolo ARED (Carga Excéntrica)', urgency: 'ALTA', protocol: 'Incorporar 3 series adicionales de sentadillas y elevación de talones en ARED al 85% 1RM con enfoque excéntrico.' }],
    },
    {
      id: 'ASTRO-03', name: 'Dr. Kenji Sato', role: 'Oficial Científico', missionDay: 14,
      sews: 9, status: 'ALERTA_CRITICA',
      vitals: { hr: 74, hrv: 18, spo2: 98.0, sys: 122, dia: 80, temp: 36.8 },
      env: { radiation: 24, totalRadiation: null, co2: 3.8, psi: 14.7 },
      cog: { rt: 395, lapses: 3, sleep: 4.1, stress: 0.82 },
      musc: { delta: -2.1, exercise: 88 },
      risks: [
        'Agotamiento neurovegetativo severo (HRV crítico < 20ms)',
        'Riesgo elevado de fallo operacional por fatiga psicomotriz severa (PVT Lapses)',
        'Deprivación aguda de sueño (< 5h)',
        'Indicador de distrés psicológico agudo por biomarcador vocal',
      ],
      countermeasures: [{ id: 'CM-COG-02', title: 'Higiene Circadiana y Terapia Lumínica Dinámica', urgency: 'ALTA', protocol: '1. Ajustar LED de cabina a 460nm (enriquecida en azul) durante horario operativo.' }],
    },
    {
      id: 'ASTRO-04', name: 'Dra. Sarah Miller', role: 'Especialista Médica', missionDay: 14,
      sews: 7, status: 'ALERTA_MODERADA',
      vitals: { hr: 85, hrv: 36, spo2: 98.2, sys: 120, dia: 78, temp: 36.8 },
      env: { radiation: 89, totalRadiation: null, co2: 2.9, psi: 14.7 },
      cog: { rt: 252, lapses: 0, sleep: 6.8, stress: 0.38 },
      musc: { delta: -1.8, exercise: 92 },
      risks: ['Evento de Partículas Solares (SPE) o anomalía de radiación: 89 uSv/h'],
      countermeasures: [{ id: 'CM-RAD-01', title: 'Protocolo de Refugio contra Tormenta de Radiación (SPE)', urgency: 'INMEDIATA', protocol: 'Desplazarse a módulo blindado central. Iniciar monitorización de dosimetría personal.' }],
    },
  ];

  const FALLBACK_DTN = {
    link: 'LOS', line_of_sight: false, one_way_latency_minutes: 14.2, pending_packets: 56, last_sync_at: null,
  };

  async function getJSON(path, timeoutMs = 1500) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(API_BASE + path, { signal: ctrl.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } finally {
      clearTimeout(timer);
    }
  }

  function fromApi({ latest_record: r, assessment: a }) {
    return {
      id: a.crew_member_id, name: a.crew_member_name, role: a.role, missionDay: a.mission_day,
      sews: a.sews_score, status: a.status_label, displayStatus: a.status_label, alerts: [],
      vitals: { hr: r.heart_rate, hrv: r.hrv, spo2: r.spo2, sys: r.systolic_bp, dia: r.diastolic_bp, temp: r.core_temp },
      env: { radiation: r.radiation_rate, totalRadiation: r.total_radiation, co2: r.co2_mmhg, psi: r.cabin_psi },
      cog: { rt: r.reaction_time, lapses: r.lapses, sleep: r.sleep_hours, stress: r.voice_stress },
      musc: { delta: r.muscle_delta_pct, exercise: r.exercise_pct },
      risks: a.systemic_risks,
      countermeasures: a.active_countermeasures.map((c) => ({
        id: c.id, title: c.title, urgency: c.urgency, protocol: c.action_protocol,
      })),
    };
  }

  // Telemetría en tiempo real (motor de reglas FHIR): sus valores son más recientes que los del
  // dataset SEWS por días, así que los reemplazan; sus alertas activas se anuncian primero.
  const LIVE_TO_SEWS = { VIGILAR: 'ALERTA_MODERADA', ACTUAR: 'ALERTA_CRITICA' };
  const STATUS_RANK = { NOMINAL: 0, ALERTA_MODERADA: 1, ALERTA_CRITICA: 2 };
  const LEVEL_RANK = { NOMINAL: 0, VIGILAR: 1, ACTUAR: 2 };

  function applyLive(m, live) {
    if (!live) return m;
    const value = (indicator, key) => {
      const v = live.latest[indicator] && live.latest[indicator].values[key];
      return v == null ? undefined : v;
    };
    m.vitals.hr = value('heart_rate', 'value') ?? m.vitals.hr;
    m.vitals.spo2 = value('spo2', 'value') ?? m.vitals.spo2;
    m.env.radiation = value('radiation_dose', 'rate_usv_h') ?? m.env.radiation;
    m.env.totalRadiation = value('radiation_dose', 'cumulative_msv') ?? m.env.totalRadiation;
    m.alerts = [...live.active_alerts].sort((a, b) =>
      LEVEL_RANK[b.level] - LEVEL_RANK[a.level] || Math.abs(b.delta_pct) - Math.abs(a.delta_pct));
    const liveStatus = LIVE_TO_SEWS[live.status];
    if (liveStatus && STATUS_RANK[liveStatus] > STATUS_RANK[m.status]) m.displayStatus = liveStatus;
    return m;
  }

  /** Devuelve { online, crew, dtn }. Nunca lanza: sin backend usa los datos de respaldo. */
  async function loadMissionData() {
    try {
      const [overview, dtn, live] = await Promise.all([
        getJSON('/api/crew'),
        getJSON('/api/dtn/status'),
        getJSON('/crew').catch(() => null),
      ]);
      const liveById = Object.fromEntries(((live && live.crew) || []).map((c) => [c.id, c]));
      return { online: true, crew: overview.map((o) => applyLive(fromApi(o), liveById[o.crew_id])), dtn };
    } catch (err) {
      console.info('[asistente] Edge Core no disponible, modo autónomo:', err.message);
      return { online: false, crew: FALLBACK_CREW.map((m) => ({ ...m, displayStatus: m.status, alerts: [] })), dtn: FALLBACK_DTN };
    }
  }

  /**
   * Respuesta de la IA en línea (Edge Core → modelo de lenguaje con todo el contexto de la misión),
   * o null si no está disponible o tarda demasiado: entonces el reloj responde en modo offline.
   */
  async function askOnline({ crewId, topic, question, history }) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 25000);
    try {
      const res = await fetch(`${API_BASE}/api/assistant/ask`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ crew_id: crewId, lang, topic: question ? null : topic, question: question || null, history }),
        signal: ctrl.signal,
      });
      if (!res.ok) return null;
      return (await res.json()).reply || null;
    } catch (err) {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  // ── Utilidades comunes ──────────────────────────────────────────────
  const num = (n, d = 0) => Number(n).toLocaleString(lang, { maximumFractionDigits: d });

  function firstName(name) {
    return name.replace(/^Dra?\.\s*/, '').split(' ')[0];
  }

  const fold = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

  function findMember(t, crew) {
    return crew.find((m) => {
      const words = fold(m.name.replace(/^Dra?\.\s*/, '')).split(' ');
      return words.some((w) => w.length > 2 && t.includes(w));
    });
  }

  // Métricas del motor de reglas en tiempo real: [nombre, unidad hablada] por idioma.
  const METRICS = {
    heart_rate: { es: ['frecuencia cardíaca', 'latidos por minuto'], en: ['heart rate', 'beats per minute'] },
    spo2: { es: ['saturación de oxígeno', 'por ciento'], en: ['oxygen saturation', 'percent'] },
    'blood_pressure.systolic': { es: ['presión sistólica', 'milímetros de mercurio'], en: ['systolic pressure', 'millimeters of mercury'] },
    'blood_pressure.diastolic': { es: ['presión diastólica', 'milímetros de mercurio'], en: ['diastolic pressure', 'millimeters of mercury'] },
    body_temp: { es: ['temperatura corporal', 'grados'], en: ['body temperature', 'degrees'] },
    respiratory_rate: { es: ['frecuencia respiratoria', 'respiraciones por minuto'], en: ['respiratory rate', 'breaths per minute'] },
    'sleep_metrics.hours': { es: ['sueño', 'horas'], en: ['sleep', 'hours'] },
    'radiation_dose.rate_usv_h': { es: ['radiación', 'microsieverts por hora'], en: ['radiation', 'microsieverts per hour'] },
    'radiation_dose.cumulative_msv': { es: ['dosis acumulada', 'milisieverts'], en: ['cumulative dose', 'millisieverts'] },
    'behavioral_health.stress_score': { es: ['estrés', 'puntos'], en: ['stress', 'points'] },
    'behavioral_health.reaction_time_ms': { es: ['tiempo de reacción', 'milisegundos'], en: ['reaction time', 'milliseconds'] },
  };
  const MAX_SPOKEN_ALERTS = 2;

  /** Frases de las alertas en tiempo real más graves; el texto lo arma cada idioma. */
  function liveAlerts(m, phrase) {
    return m.alerts.slice(0, MAX_SPOKEN_ALERTS)
      .filter((a) => METRICS[a.metric])
      .map((a) => phrase({
        critical: a.level === 'ACTUAR',
        label: METRICS[a.metric][lang][0],
        value: `${num(a.current_value, 1)} ${METRICS[a.metric][lang][1]}`,
        pct: num(Math.abs(a.delta_pct)),
        above: a.delta_pct >= 0,
        minutes: a.duration_minutes >= 1 ? num(a.duration_minutes) : null,
        toCritical: a.minutes_to_actuar != null ? num(a.minutes_to_actuar) : null,
      }));
  }

  // ── Español ─────────────────────────────────────────────────────────
  function speakableEs(text) {
    return text
      .replace(/\s*\([^)]*\)/g, '')
      .replace(/[μu]Sv\/h/g, 'microsieverts por hora')
      .replace(/(\d)\s*nm\b/g, '$1 nanómetros')
      .replace(/(\d)\s*%/g, '$1 por ciento')
      .replace(/\bHRV\b/g, 'variabilidad cardíaca')
      .replace(/\bPVT\b/g, 'de vigilancia psicomotriz')
      .replace(/\ben ARED\b/g, 'en el equipo de resistencia')
      .replace(/\b(del?\s+)?ARED\b/g, 'del equipo de resistencia')
      .replace(/\bSPE\b/g, '')
      .replace(/\b1RM\b/g, 'de tu repetición máxima')
      .replace(/&/g, 'y')
      .replace(/\s+\/\s+/g, ' o ')
      .replace(/\s{2,}/g, ' ')
      .trim();
  }

  function firstStepEs(protocol) {
    const step = protocol.split('\n')[0].replace(/^\d+\.\s*/, '');
    return speakableEs(step.split(/(?<=\.)\s/)[0]).replace(/\.$/, '');
  }

  const ES = {
    status: { NOMINAL: 'estado nominal', ALERTA_MODERADA: 'alerta moderada', ALERTA_CRITICA: 'alerta crítica' },
    urgency: { INMEDIATA: 'inmediata', ALTA: 'de prioridad alta', MODERADA: 'moderada', PREVENTIVA: 'preventiva' },

    greeting: (m) =>
      `Hola, ${firstName(m.name)}. Soy ${ASSISTANT_NAME}, tu asistente médica de a bordo. ` +
      'Puedo darte tu diagnóstico de salud, el estado de la nave o el del ambiente.',

    liveAlert: (a) =>
      `Alerta${a.critical ? ' crítica' : ''} en tiempo real: ${a.label} en ${a.value}, ` +
      `${a.pct} por ciento ${a.above ? 'por encima' : 'por debajo'} de tu línea base` +
      `${a.minutes ? ` desde hace ${a.minutes} minutos` : ''}.` +
      `${a.toCritical ? ` Si sigue así, llegaría a nivel crítico en unos ${a.toCritical} minutos.` : ''}`,

    health(m) {
      const v = m.vitals;
      const c = m.cog;
      const parts = [
        ...liveAlerts(m, this.liveAlert),
        `${firstName(m.name)}, tu índice de alerta temprana del día ${m.missionDay} es ${m.sews} de 15: ${this.status[m.status] || m.status}.`,
        `Frecuencia cardíaca de ${num(v.hr)} latidos por minuto, variabilidad cardíaca de ${num(v.hrv)} milisegundos y saturación de oxígeno del ${num(v.spo2, 1)} por ciento.`,
      ];
      if (c.lapses >= 2 || c.rt > 350) parts.push(`Tu tiempo de reacción es de ${num(c.rt)} milisegundos con ${c.lapses} lapsos: detecto fatiga psicomotriz.`);
      if (c.sleep < 6) parts.push(`Dormiste solo ${num(c.sleep, 1)} horas.`);
      if (m.musc.delta <= -5) parts.push(`Tu masa muscular bajó un ${num(Math.abs(m.musc.delta), 1)} por ciento desde el inicio de la misión.`);
      if (m.risks.length) {
        const n = m.risks.length;
        parts.push(`Detecto ${n} ${n === 1 ? 'riesgo' : 'riesgos'}. El principal: ${speakableEs(m.risks[0])}.`);
      } else {
        parts.push('Todos tus parámetros están dentro de rango.');
      }
      const cm = m.countermeasures[0];
      if (cm) parts.push(`Recomendación ${this.urgency[cm.urgency] || ''}: ${speakableEs(cm.title)}. ${firstStepEs(cm.protocol)}.`);
      return parts.join(' ');
    },

    environment(m) {
      const e = m.env;
      const parts = [`La radiación ambiental es de ${num(e.radiation, 1)} microsieverts por hora.`];
      if (e.radiation > 50) parts.push('Es un nivel crítico, compatible con una tormenta de partículas solares. Dirígete al refugio blindado ahora.');
      else if (e.radiation > 25) parts.push('Está por encima de lo habitual; limita la actividad cerca del casco exterior.');
      else parts.push('Está dentro del rango nominal.');
      if (e.totalRadiation != null) parts.push(`Llevas una dosis acumulada de ${num(e.totalRadiation, 1)} milisieverts en la misión.`);
      return parts.join(' ');
    },

    ship(m, dtn) {
      const e = m.env;
      const psiOk = Math.abs(e.psi - 14.7) <= 0.3;
      const parts = [`Presión de cabina de ${num(e.psi, 1)} libras por pulgada cuadrada, ${psiOk ? 'estable' : 'fuera de rango; revisa el control atmosférico'}.`];
      if (e.co2 > 4) parts.push(`El dióxido de carbono está alto, en ${num(e.co2, 1)} milímetros de mercurio. Revisa el sistema de depuración de aire.`);
      else if (e.co2 > 3) parts.push(`El dióxido de carbono está ligeramente elevado, en ${num(e.co2, 1)} milímetros de mercurio.`);
      else parts.push(`El dióxido de carbono es nominal, ${num(e.co2, 1)} milímetros de mercurio.`);
      if (dtn) {
        parts.push(
          `Enlace con Tierra: ${num(dtn.one_way_latency_minutes, 1)} minutos de latencia en un sentido, ` +
          `${dtn.line_of_sight ? 'con línea de vista' : 'sin línea de vista en este momento'}.`,
          dtn.pending_packets ? `Hay ${dtn.pending_packets} paquetes en cola para enviar.` : 'No hay paquetes pendientes de envío.'
        );
      }
      return parts.join(' ');
    },

    unknown: () => 'No te entendí. Puedes pedirme salud, nave, ambiente o un diagnóstico completo.',

    intents: {
      full: /(diagnostico|completo|todo|reporte|informe)/,
      environment: /(ambiente|radiacion|entorno|tormenta|solar)/,
      ship: /(nave|cabina|presion|co2|dioxido|enlace|tierra|comunicacion)/,
      health: /(salud|estado|estoy|corazon|signos|vital|cuerpo|sueno)/,
      stop: /\b(para|detente|silencio|callate|stop|basta)\b/,
      select: /\b(cambia|cambiar|cambio|pasa|selecciona|tripulante|muestra|ver)\b/,
      greeting: /(hola|buenas|hey)/,
    },
  };

  // ── English ─────────────────────────────────────────────────────────
  const RISKS_EN = [
    [/^Agotamiento neurovegetativo/, () => 'severe autonomic exhaustion'],
    [/^Estrés autonómico/, () => 'elevated autonomic stress'],
    [/^Arritmia/, () => 'arrhythmia or abnormal heart rate in microgravity'],
    [/^Riesgo elevado de fallo operacional/, () => 'high risk of operational error due to severe psychomotor fatigue'],
    [/^Fatiga cognitiva/, () => 'mild to moderate cognitive fatigue'],
    [/^Deprivación aguda de sueño/, () => 'acute sleep deprivation'],
    [/^Indicador de distrés/, () => 'acute psychological distress detected in your voice biomarker'],
    [/^Atrofia muscular acelerada \((-?[\d.]+)%/, (m) => `accelerated muscle atrophy, ${num(Math.abs(parseFloat(m[1])), 1)} percent below baseline`],
    [/^Pérdida moderada de masa muscular/, () => 'moderate muscle mass loss'],
    [/^Incumplimiento crítico/, () => 'critical non-compliance with the exercise countermeasure protocol'],
    [/^Evento de Partículas Solares.*?:\s*([\d.]+)/, (m) => `a solar particle event or radiation anomaly, at ${num(parseFloat(m[1]), 1)} microsieverts per hour`],
    [/^Tasa de radiación cósmica/, () => 'galactic cosmic radiation above the nominal threshold'],
    [/^Hipercapnia/, () => 'hypercapnia from carbon dioxide buildup in the cabin'],
  ];

  const COUNTERMEASURES_EN = {
    'CM-RAD-01': ['Radiation storm shelter protocol', 'Move to the central shielded module and start personal dosimetry monitoring'],
    'CM-COG-02': ['Circadian hygiene and dynamic light therapy', 'Set the cabin lights to 460 nanometers, blue-enriched, during operating hours'],
    'CM-MUSC-03': ['Intensified resistance exercise protocol', 'Add 3 extra sets of squats and calf raises on the resistance device at 85 percent of your one-rep max, with an eccentric focus'],
    'CM-PSY-04': ['Psycho-respiratory biofeedback decompression', 'Do an autonomous heart coherence session, breathing at 0.1 hertz, with the immersive nature module in virtual reality'],
    'CM-NOM-00': ['Nominal spaceflight protocol', 'Keep your standard routine of 2.5 hours of resistance and cardiovascular exercise'],
  };

  function riskEn(text) {
    for (const [re, fn] of RISKS_EN) {
      const m = text.match(re);
      if (m) return fn(m);
    }
    return 'a risk flagged on the main dashboard';
  }

  const EN = {
    status: { NOMINAL: 'nominal', ALERTA_MODERADA: 'moderate alert', ALERTA_CRITICA: 'critical alert' },
    urgency: { INMEDIATA: 'Immediate', ALTA: 'High-priority', MODERADA: 'Moderate', PREVENTIVA: 'Preventive' },

    greeting: (m) =>
      `Hi, ${firstName(m.name)}. I'm ${ASSISTANT_NAME}, your onboard medical assistant. ` +
      'I can give you your health diagnosis, the ship status, or the environment report.',

    liveAlert: (a) =>
      `Real-time ${a.critical ? 'critical ' : ''}alert: ${a.label} at ${a.value}, ` +
      `${a.pct} percent ${a.above ? 'above' : 'below'} your baseline` +
      `${a.minutes ? ` for the last ${a.minutes} minutes` : ''}.` +
      `${a.toCritical ? ` If this continues, it would reach a critical level in about ${a.toCritical} minutes.` : ''}`,

    health(m) {
      const v = m.vitals;
      const c = m.cog;
      const parts = [
        ...liveAlerts(m, this.liveAlert),
        `${firstName(m.name)}, your day ${m.missionDay} early warning score is ${m.sews} out of 15: ${this.status[m.status] || m.status}.`,
        `Heart rate ${num(v.hr)} beats per minute, heart rate variability ${num(v.hrv)} milliseconds, and oxygen saturation ${num(v.spo2, 1)} percent.`,
      ];
      if (c.lapses >= 2 || c.rt > 350) parts.push(`Your reaction time is ${num(c.rt)} milliseconds with ${c.lapses} lapses: I'm detecting psychomotor fatigue.`);
      if (c.sleep < 6) parts.push(`You only slept ${num(c.sleep, 1)} hours.`);
      if (m.musc.delta <= -5) parts.push(`Your muscle mass is down ${num(Math.abs(m.musc.delta), 1)} percent since the start of the mission.`);
      if (m.risks.length) {
        const n = m.risks.length;
        parts.push(`I detect ${n} ${n === 1 ? 'risk' : 'risks'}. The main one: ${riskEn(m.risks[0])}.`);
      } else {
        parts.push('All your parameters are within range.');
      }
      const cm = m.countermeasures[0];
      if (cm) {
        const [title, step] = COUNTERMEASURES_EN[cm.id] || ['Countermeasure available', 'Check the details on the main dashboard'];
        parts.push(`${this.urgency[cm.urgency] || ''} recommendation: ${title}. ${step}.`);
      }
      return parts.join(' ');
    },

    environment(m) {
      const e = m.env;
      const parts = [`Ambient radiation is ${num(e.radiation, 1)} microsieverts per hour.`];
      if (e.radiation > 50) parts.push("That's a critical level, consistent with a solar particle storm. Go to the shielded shelter now.");
      else if (e.radiation > 25) parts.push("It's above normal; limit activity near the outer hull.");
      else parts.push("It's within the nominal range.");
      if (e.totalRadiation != null) parts.push(`Your cumulative mission dose is ${num(e.totalRadiation, 1)} millisieverts.`);
      return parts.join(' ');
    },

    ship(m, dtn) {
      const e = m.env;
      const psiOk = Math.abs(e.psi - 14.7) <= 0.3;
      const parts = [`Cabin pressure is ${num(e.psi, 1)} pounds per square inch, ${psiOk ? 'stable' : 'out of range; check atmospheric control'}.`];
      if (e.co2 > 4) parts.push(`Carbon dioxide is high, at ${num(e.co2, 1)} millimeters of mercury. Check the air scrubbing system.`);
      else if (e.co2 > 3) parts.push(`Carbon dioxide is slightly elevated, at ${num(e.co2, 1)} millimeters of mercury.`);
      else parts.push(`Carbon dioxide is nominal, at ${num(e.co2, 1)} millimeters of mercury.`);
      if (dtn) {
        parts.push(
          `Earth link: ${num(dtn.one_way_latency_minutes, 1)} minutes of one-way latency, ` +
          `${dtn.line_of_sight ? 'with line of sight' : 'with no line of sight right now'}.`,
          dtn.pending_packets ? `There are ${dtn.pending_packets} packets queued for transmission.` : 'No packets are waiting to be sent.'
        );
      }
      return parts.join(' ');
    },

    unknown: () => "I didn't catch that. You can ask me for health, ship, environment, or a full diagnosis.",

    intents: {
      full: /(diagnos|full|complete|everything|summary)/,
      environment: /(environment|radiation|solar|storm|cosmic)/,
      ship: /(ship|cabin|pressure|co2|carbon|link|earth|comms|communication)/,
      health: /(health|status|how am i|heart|vital|sleep|body)/,
      stop: /\b(stop|quiet|silence|enough|shut up)\b/,
      select: /\b(switch|change|select|show|go to|crew)\b/,
      greeting: /\b(hello|hi|hey)\b/,
    },
  };

  const TEXT = { es: ES, en: EN };
  const T = () => TEXT[lang];

  function intentFrom(transcript, crew) {
    const t = fold(transcript);
    const re = T().intents;
    const member = findMember(t, crew);
    for (const type of ['full', 'environment', 'ship', 'health']) {
      if (re[type].test(t)) return { type, member };
    }
    // "para" también es preposición: detener solo vale en frases cortas sin otra consulta.
    if (t.split(/\s+/).length <= 3 && re.stop.test(t)) return { type: 'stop' };
    if (member && re.select.test(t)) return { type: 'select', member };
    if (re.greeting.test(t)) return { type: 'greeting', member };
    return { type: 'unknown' };
  }

  global.MissionDiagnosis = {
    ASSISTANT_NAME,
    LANGUAGES: Object.keys(TEXT),
    setLanguage(code) { if (TEXT[code]) lang = code; },
    get language() { return lang; },
    loadMissionData,
    askOnline,
    greeting: (m) => T().greeting(m),
    health: (m) => T().health(m),
    environment: (m) => T().environment(m),
    ship: (m, dtn) => T().ship(m, dtn),
    full: (m, dtn) => [T().health(m), T().environment(m), T().ship(m, dtn)].join(' '),
    unknown: () => T().unknown(),
    intentFrom,
  };
})(window);
