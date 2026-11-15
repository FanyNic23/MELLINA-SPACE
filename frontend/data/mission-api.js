/*
 * A-HAMS · Fuente única de datos de la tripulación para el dashboard y el reloj.
 *
 * Todo sale del motor clínico SEWS del Edge Core local (backend, misma nave, sin internet):
 *   GET  /api/crew                       estado SEWS, riesgos y contramedidas de cada tripulante
 *   GET  /api/crew/{id}/history          serie por días de misión (tendencia)
 *   POST /api/sim/{id}                   datos simulados -> el motor reevalúa al instante
 *   POST /api/sim/{id}/scenario/{crisis} crisis predefinida
 *   POST /api/sim/{id}/reset             vuelve a los datos de misión
 *   POST /api/checkin/{id}               chequeo diario: mediciones del propio astronauta
 *   GET  /api/crew/{id}/forecast         gemelo digital: proyección sin y con contramedidas
 *   GET  /api/routine/{id}               rutina del día, puntos, nivel, racha e insignias (y POST .../complete/{tarea})
 *   GET  /api/dtn/status · POST /link    enlace con la Tierra (AOS / LOS) y paquetes en cola
 * Aquí solo vive lo visual de cada tripulante (foto y color); los valores clínicos nunca se escriben a mano.
 *
 *   MissionAPI.loadCrew()             -> [tripulante normalizado]   (lanza MissionAPI.OfflineError si el Edge Core no responde)
 *   MissionAPI.simulate(id, values) / scenario(id, key) / reset(id) / scenarios() / checkin(id, values)
 */
(function (global) {
  'use strict';

  const API = (global.AHAMS_CONFIG && global.AHAMS_CONFIG.apiBase) || 'http://127.0.0.1:8000';

  // Identidad visual (no clínica) de cada tripulante.
  const PROFILE = {
    'ASTRO-01': { photo: 'crew/photos/astro-01.jpg', accent: '#22d3ee', initials: 'ER' },
    'ASTRO-02': { photo: 'crew/photos/astro-02.jpg', accent: '#38bdf8', initials: 'MV' },
    'ASTRO-03': { photo: 'crew/photos/astro-03.jpg', accent: '#2dd4bf', initials: 'KS' },
    'ASTRO-04': { photo: 'crew/photos/astro-04.jpg', accent: '#34d399', initials: 'SM' },
    'ASTRO-05': { photo: 'crew/photos/astro-05.jpg', accent: '#22d3ee', initials: 'DH' },
  };

  class OfflineError extends Error {}

  async function request(path, options = {}, timeoutMs = 2500) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(API + path, { ...options, signal: ctrl.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status} en ${path}`);
      return await res.json();
    } catch (err) {
      if (err.name === 'AbortError' || err instanceof TypeError) throw new OfflineError('El Edge Core no responde');
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }
  const post = (path, body) => request(path, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined,
  });

  // Cuadrante emocional de Russell a partir de valencia y activación.
  function mood(valence, arousal) {
    if (valence < -0.4 && arousal < 0) return 'Agotado / Desánimo';
    if (valence < -0.1 && arousal >= 0.3) return 'Ansioso / Sobrecargado';
    if (valence < -0.1) return 'Tenso / Bajo ánimo';
    if (arousal >= 0.3) return 'Alerta / Activado';
    return 'Calmo / Equilibrado';
  }
  function voiceNote(stress) {
    if (stress > 0.7) return 'Aplanamiento prosódico y distrés vocal.';
    if (stress > 0.4) return 'Tensión vocal moderada.';
    return 'Prosodia y tono acústico balanceado.';
  }

  // Une registro + evaluación del motor + historial en el formato que pintan las pantallas.
  function normalize(rec, a, history) {
    const days = history.filter((_, i) => i % 2 === 0 || i === history.length - 1);
    return {
      id: a.crew_member_id,
      ...PROFILE[a.crew_member_id],
      name: a.crew_member_name,
      role: a.role,
      missionDay: a.mission_day,
      simulated: Boolean(rec.is_simulated),
      checkinAt: rec.checkin_at || null,
      status: a.status_label,
      sews: a.sews_score,
      vitals: { hr: Math.round(rec.heart_rate), hrv: Math.round(rec.hrv), spo2: rec.spo2,
                bp: `${Math.round(rec.systolic_bp)}/${Math.round(rec.diastolic_bp)}`,
                temp: rec.core_temp, glucose: rec.glucose_mg_dl ?? null },
      cognitive: { rt: Math.round(rec.reaction_time), lapses: rec.lapses, sleep: rec.sleep_hours, voice_stress: rec.voice_stress },
      muscle: { delta: Math.round(rec.muscle_delta_pct * 10) / 10, exercise_pct: Math.round(rec.exercise_pct) },
      environment: { radiation: Math.round(rec.radiation_rate), co2: Math.round(rec.co2_mmhg * 10) / 10 },
      psych: { voice: rec.voice_stress, coherence: Math.round(rec.coherence_pct), mood: mood(rec.mood_valence, rec.mood_arousal),
               sensory: rec.sensory_risk, desc: voiceNote(rec.voice_stress) },
      risks: a.systemic_risks,
      breakdown: a.score_breakdown || [],       // por qué este SEWS: puntos, motivo, valor y sistema
      escalate: a.escalate_to_surgeon,          // avisar al cirujano de vuelo
      escalationReasons: a.escalation_reasons || [],
      countermeasures: a.active_countermeasures.map(c => ({
        id: c.id, category: c.category, title: c.title, urgency: c.urgency,
        protocol: c.action_protocol, dosage: c.prescribed_dosage_duration,
      })),
      history: {
        days: days.map(h => h.mission_day),
        hrv: days.map(h => h.hrv),
        rt: days.map(h => h.reaction_time),
        muscle: days.map(h => h.muscle_delta_pct),
      },
      raw: rec,
    };
  }

  async function loadCrew() {
    const overview = await request('/api/crew');
    const histories = await Promise.all(overview.map(o => request(`/api/crew/${o.crew_id}/history`)));
    return overview.map((o, i) => normalize(o.latest_record, o.assessment, histories[i]));
  }

  global.MissionAPI = {
    OfflineError,
    loadCrew,
    scenarios: () => request('/api/sim/scenarios'),
    simulate: (id, values) => post(`/api/sim/${id}`, values),
    scenario: (id, key) => post(`/api/sim/${id}/scenario/${key}`),
    reset: id => post(`/api/sim/${id}/reset`),
    checkin: (id, values) => post(`/api/checkin/${id}`, values),
    forecast: (id, days = 30) => request(`/api/crew/${id}/forecast?days=${days}`),
    routine: id => request(`/api/routine/${id}`),
    completeTask: (id, task) => post(`/api/routine/${id}/complete/${encodeURIComponent(task)}`),
    submitPVT: (id, rt) => post('/api/cognitive/pvt-submit', { crew_id: id, mean_reaction_time_ms: rt, lapses_count: rt > 500 ? 1 : 0 }),
    dtn: () => request('/api/dtn/status'),
    setLink: state => post('/link', { state }),
    environment: () => request('/api/mission/environment'),
    setEnvironment: id => post(`/api/mission/environment/${id}`),
    // Convierte un día proyectado (registro + evaluación) al formato de las pantallas.
    toAstro: (rec, report, history = []) => normalize(rec, report, history),
  };
})(window);
