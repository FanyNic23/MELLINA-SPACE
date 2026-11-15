"""Copiloto médico-psicológico de a bordo: OpenAI (Structured Outputs) + ElevenLabs.

Si OpenAI/ElevenLabs no están configurados o fallan, se degrada a una respuesta
determinista basada en reglas (el sistema nunca queda mudo en una alerta).
"""
import json
import logging
import uuid
from dataclasses import dataclass
from typing import Literal, Optional

from pydantic import BaseModel

from app.schemas.fhir import Indicator
from app.services.llm import LLM, log_failure
from app.services.rule_engine import RANK, Evaluation, Level
from app.services.storage import ObjectStore
from app.services.tts import TextToSpeech

log = logging.getLogger("copilot")


# ------------------------------------------------------------------ esquema de salida (JSON Schema)
class ActionCard(BaseModel):
    step: int
    title: str
    instruction: str
    category: Literal["hidratacion", "ritmo", "respiracion", "refugio", "comunicacion", "sueno", "medico"]
    urgency: Literal["inmediata", "pronto", "rutina"]


class CopilotResponse(BaseModel):
    spoken_message: str        # <= 45 palabras, calmado, para el casco
    clinical_assessment: str   # análisis de la tendencia
    risk_projection: str       # proyección a corto plazo (con horizonte temporal)
    psychological_support: str  # contención (estrés / aislamiento)
    action_cards: list[ActionCard]
    escalate_to_ground: bool
    confidence: float


@dataclass
class CopilotResult:
    response: CopilotResponse
    audio_url: Optional[str]
    source: Literal["openai", "fallback"]

    def to_dict(self) -> dict:
        return {"source": self.source, "audio_url": self.audio_url, **self.response.model_dump()}


SYSTEM_PROMPT = """Eres MELL-Orbital, copiloto médico-psicológico a bordo del traje espacial y hábitat.
Hablas en español, con voz serena, clara y breve; jamás generas pánico ni usas dramatismo.
Recibirás JSON con la telemetría evaluada por el motor de reglas (valor, línea base, delta, % de cambio,
minutos de duración, minutos estimados hasta nivel ACTUAR) y el estado emocional reciente.

Debes:
1. Analizar la tendencia y proyectar el riesgo a corto plazo usando SOLO los datos dados
   (cita explícitamente el cambio y su duración; ej. "subió 28% en 12 minutos").
2. Dar contención psicológica breve (normalizar, anclar en el procedimiento, respiración, contacto con la tripulación).
3. Generar 3-5 tarjetas de acción ordenadas (hidratación, reducción de ritmo, protocolo de refugio, etc.).
4. `spoken_message`: máximo 45 palabras, directo al astronauta por su nombre, una instrucción principal.
5. No diagnostiques enfermedades ni inventes mediciones. Si la radiación es ACTUAR, prioriza refugio.
   Si hay incertidumbre, dilo y escala a Tierra (`escalate_to_ground`=true cuando haya algún ACTUAR)."""


# ------------------------------------------------------------------ fallback determinista
_CARDS: dict[str, list[ActionCard]] = {
    "cardio": [
        ActionCard(step=1, title="Reduce el ritmo", instruction="Detén el esfuerzo actual y baja a ritmo mínimo.", category="ritmo", urgency="inmediata"),
        ActionCard(step=2, title="Hidrátate", instruction="Bebe 150-200 ml del sistema de hidratación del traje.", category="hidratacion", urgency="inmediata"),
        ActionCard(step=3, title="Respiración 4-6", instruction="Inhala 4 s, exhala 6 s durante 2 minutos.", category="respiracion", urgency="pronto"),
        ActionCard(step=4, title="Confirma con el control", instruction="Informa tu estado a Control y evalúa regresar al refugio.", category="comunicacion", urgency="pronto"),
    ],
    "oxigeno": [
        ActionCard(step=1, title="Verifica el suministro", instruction="Revisa presión de O2 y CO2 en el panel del traje.", category="medico", urgency="inmediata"),
        ActionCard(step=2, title="Respira lento", instruction="Respiración profunda y pausada; evita hablar de más.", category="respiracion", urgency="inmediata"),
        ActionCard(step=3, title="Prepara el retorno", instruction="Inicia protocolo de retorno a esclusa si no mejora en 5 minutos.", category="refugio", urgency="pronto"),
    ],
    "radiacion": [
        ActionCard(step=1, title="Ve al refugio", instruction="Dirígete al área blindada del hábitat de inmediato.", category="refugio", urgency="inmediata"),
        ActionCard(step=2, title="Registra tu exposición", instruction="Confirma tu dosímetro personal y anota la hora.", category="medico", urgency="inmediata"),
        ActionCard(step=3, title="Avisa a la tripulación", instruction="Notifica tu ubicación a los demás miembros.", category="comunicacion", urgency="pronto"),
        ActionCard(step=4, title="Calma y espera", instruction="Respiración 4-6 mientras dura la tormenta; el refugio es seguro.", category="respiracion", urgency="rutina"),
    ],
    "conducta": [
        ActionCard(step=1, title="Pausa de descanso", instruction="Suspende tareas críticas y descansa 20 minutos.", category="sueno", urgency="pronto"),
        ActionCard(step=2, title="Habla con alguien", instruction="Contacta a un compañero o al soporte psicológico en Tierra.", category="comunicacion", urgency="pronto"),
        ActionCard(step=3, title="Higiene de sueño", instruction="Reduce luz brillante y pantallas 60 min antes de dormir.", category="sueno", urgency="rutina"),
    ],
}
_GROUP = {
    Indicator.HEART_RATE: "cardio", Indicator.BLOOD_PRESSURE: "cardio", Indicator.BODY_TEMP: "cardio",
    Indicator.RESPIRATORY_RATE: "cardio", Indicator.SPO2: "oxigeno", Indicator.RADIATION_DOSE: "radiacion",
    Indicator.SLEEP_METRICS: "conducta", Indicator.BEHAVIORAL_HEALTH: "conducta",
}


def _horizon(minutes: Optional[float]) -> str:
    if minutes is None:
        return "sin proyección de empeoramiento por ahora"
    if minutes < 90:
        return f"en aproximadamente {minutes:.0f} minutos alcanzaría nivel crítico"
    return f"en aproximadamente {minutes / 60:.1f} horas alcanzaría nivel crítico"


def rule_based_response(astronaut: dict, evals: list[Evaluation]) -> CopilotResponse:
    name = astronaut.get("name", "astronauta").split()[-1]
    if not evals:
        return CopilotResponse(
            spoken_message=f"{name}, tus signos están dentro de rango. Sigue con el plan.",
            clinical_assessment="Sin desviaciones activas.", risk_projection="Sin riesgo proyectado.",
            psychological_support="Todo en orden; mantén tus rutinas.", action_cards=[],
            escalate_to_ground=False, confidence=0.5)
    top = max(evals, key=lambda e: (RANK[e.level], abs(e.delta_pct)))
    group = _GROUP[top.indicator]
    direction = "subió" if top.delta_value > 0 else "bajó"
    change = f"{top.label.lower()} {direction} {abs(top.delta_pct):.0f}% en los últimos {top.duration_minutes:.0f} minutos"
    projection = _horizon(top.minutes_to_actuar)
    act = any(e.level == Level.ACTUAR for e in evals)
    outlook = f" Si continúa así, {projection}." if top.minutes_to_actuar is not None else ""
    spoken = f"{name}, tu {change}.{outlook} {_CARDS[group][0].instruction} Estoy contigo."
    return CopilotResponse(
        spoken_message=spoken,
        clinical_assessment="; ".join(e.reason for e in evals[:4]),
        risk_projection=(f"Si la tendencia se mantiene, {projection}." if top.minutes_to_actuar is not None
                         else "Sin proyección de empeoramiento por ahora."),
        psychological_support=("Es normal sentir tensión en aislamiento y bajo esfuerzo. Sigue el procedimiento "
                               "paso a paso, respira lento y recuerda que Control está monitoreando contigo."),
        action_cards=_CARDS[group],
        escalate_to_ground=act,
        confidence=0.55,
    )


# ------------------------------------------------------------------ servicio
class AICopilot:
    def __init__(self, llm: LLM, store: ObjectStore, tts: TextToSpeech) -> None:
        self.llm = llm
        self.store = store
        self.tts = tts

    # -- API pública
    async def analyze(self, astronaut: dict, evals: list[Evaluation], latest: dict) -> CopilotResult:
        prompt = "Alerta fisiológica/conductual detectada. Analiza y responde.\n" + self._context(astronaut, evals, latest)
        return await self._run(prompt, astronaut, evals)

    async def converse(self, astronaut: dict, transcript: str, evals: list[Evaluation], latest: dict) -> CopilotResult:
        prompt = (f"El astronauta dijo por voz: \"{transcript}\".\n"
                  "Responde a su consulta/estado emocional considerando su telemetría.\n"
                  + self._context(astronaut, evals, latest))
        return await self._run(prompt, astronaut, evals)

    # -- internos
    async def _run(self, prompt: str, astronaut: dict, evals: list[Evaluation]) -> CopilotResult:
        parsed, source = None, "fallback"
        if await self.llm.ready():
            try:
                comp = await self.llm.client.chat.completions.parse(
                    model=self.llm.model,
                    messages=[{"role": "system", "content": SYSTEM_PROMPT},
                              {"role": "user", "content": prompt}],
                    response_format=CopilotResponse,
                    temperature=0.3,
                )
                parsed, source = comp.choices[0].message.parsed, "openai"
            except Exception as exc:
                log_failure(log, "Copiloto (OpenAI)", exc)
                self.llm.failed()
        if parsed is None:
            parsed = rule_based_response(astronaut, evals)
        audio = await self.tts.synthesize(parsed.spoken_message)
        audio_url = await self.store.save_audio(f"{uuid.uuid4().hex}.mp3", audio) if audio else None
        return CopilotResult(parsed, audio_url, source)  # type: ignore[arg-type]

    @staticmethod
    def _context(astronaut: dict, evals: list[Evaluation], latest: dict) -> str:
        ctx = {
            "astronauta": {"id": astronaut.get("id"), "nombre": astronaut.get("name"), "rol": astronaut.get("role")},
            "evaluaciones": [
                {"metrica": e.label, "estado": e.level.value, "valor": round(e.current, 1), "unidad": e.unit,
                 "linea_base": round(e.baseline, 1), "delta": round(e.delta_value, 1),
                 "cambio_pct": round(e.delta_pct, 1), "duracion_min": round(e.duration_minutes, 1),
                 "min_hasta_ACTUAR": None if e.minutes_to_actuar is None else round(e.minutes_to_actuar, 1)}
                for e in evals[:8]
            ],
            "ultimos_valores": {k: v.get("values") for k, v in latest.items()},
        }
        return json.dumps(ctx, ensure_ascii=False)
