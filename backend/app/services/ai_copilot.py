"""Copiloto médico-psicológico de a bordo, 100% local: respuesta determinista basada en reglas.

Analiza la tendencia que entrega el motor de reglas, proyecta el riesgo y genera tarjetas de acción
y un mensaje breve para el casco. No depende de servicios externos: funciona igual sin enlace con Tierra.
"""
import logging
from dataclasses import dataclass
from typing import Literal, Optional

from pydantic import BaseModel

from app.schemas.fhir import Indicator
from app.services.rule_engine import RANK, Evaluation, Level

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
    audio_url: Optional[str] = None  # el casco usa la voz local del sistema
    source: Literal["rules"] = "rules"

    def to_dict(self) -> dict:
        return {"source": self.source, "audio_url": self.audio_url, **self.response.model_dump()}


# ------------------------------------------------------------------ respuesta determinista
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
    async def analyze(self, astronaut: dict, evals: list[Evaluation], latest: dict) -> CopilotResult:
        return CopilotResult(rule_based_response(astronaut, evals))

    async def converse(self, astronaut: dict, transcript: str, evals: list[Evaluation], latest: dict) -> CopilotResult:
        return CopilotResult(rule_based_response(astronaut, evals))
