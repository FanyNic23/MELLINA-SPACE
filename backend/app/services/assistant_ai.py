"""Asistente del reloj en línea: el modelo de lenguaje responde cualquier pregunta del astronauta
con todo el contexto de la misión (SEWS, telemetría en vivo, alertas, nave y enlace con Tierra).

Offline no se usa: el reloj responde con sus plantillas locales (frontend/assistant/diagnosis.js).
"""
import json
import logging
import re
from typing import Optional

from app.services.llm import LLM, log_failure

log = logging.getLogger("assistant")

SYSTEM = {
    "es": """Eres Mellina, asistente médica de a bordo en el reloj inteligente de un astronauta.
Responde en español, con tono sereno, cálido y claro, hablándole por su nombre.
Tu respuesta se lee en voz alta: texto plano, sin markdown, listas, emojis, siglas ni símbolos de unidades
(escribe "microsieverts por hora", "milímetros de mercurio", "por ciento").
Sé breve: máximo {words} palabras.
Usa SOLO los datos del contexto; si falta un dato, dilo. Las alertas en tiempo real de nivel ACTUAR van primero.
El índice SEWS es la evaluación clínica del día de misión indicado; la telemetría en vivo es más reciente.
No diagnostiques enfermedades nuevas: ante un riesgo serio indica la contramedida prescrita y avisar al oficial médico.""",
    "en": """You are Mellina, the onboard medical assistant on an astronaut's smartwatch.
Answer in English, in a calm, warm and clear tone, addressing them by name.
Your answer is read aloud: plain text, no markdown, lists, emojis, acronyms or unit symbols
(write "microsieverts per hour", "millimeters of mercury", "percent").
Be brief: at most {words} words.
Use ONLY the data in the context; if something is missing, say so. Real-time ACTUAR-level alerts come first.
The SEWS score is the clinical assessment for the stated mission day; live telemetry is more recent.
Do not diagnose new diseases: for a serious risk, give the prescribed countermeasure and advise alerting the medical officer.""",
}

# Consultas de los botones del reloj (sin pregunta libre).
TOPICS = {
    "es": {
        "health": "Dame mi diagnóstico de salud: alertas en tiempo real, índice SEWS, signos vitales, riesgo principal y la contramedida.",
        "environment": "¿Cómo está el ambiente? Radiación actual, dosis acumulada y qué debo hacer.",
        "ship": "¿Cómo está la nave? Presión de cabina, dióxido de carbono y enlace con Tierra.",
        "full": "Dame un diagnóstico completo: salud, ambiente y nave, priorizando lo urgente.",
    },
    "en": {
        "health": "Give me my health diagnosis: real-time alerts, SEWS score, vital signs, main risk and the countermeasure.",
        "environment": "How is the environment? Current radiation, cumulative dose and what I should do.",
        "ship": "How is the ship? Cabin pressure, carbon dioxide and the Earth link.",
        "full": "Give me a full diagnosis: health, environment and ship, prioritizing what is urgent.",
    },
}
MAX_WORDS = {"full": 130}
DEFAULT_WORDS = 75
MAX_HISTORY = 6


def _speakable(text: str) -> str:
    """Quita restos de formato que no deben leerse en voz alta."""
    text = re.sub(r"[*_#`>]+", "", text)
    text = re.sub(r"^\s*[-•]\s*", "", text, flags=re.MULTILINE)
    return re.sub(r"\s+", " ", text).strip()


class AssistantAI:
    def __init__(self, llm: LLM) -> None:
        self.llm = llm

    async def ready(self) -> bool:
        return await self.llm.ready()

    async def ask(self, context: dict, lang: str, question: Optional[str], topic: Optional[str],
                  history: list[dict]) -> Optional[str]:
        """Respuesta lista para hablar, o None si no hay IA disponible (el reloj usa el modo offline)."""
        if not await self.llm.ready():
            return None
        lang = lang if lang in SYSTEM else "es"
        prompt = question or TOPICS[lang].get(topic or "", TOPICS[lang]["health"])
        messages = [{"role": "system", "content": SYSTEM[lang].format(words=MAX_WORDS.get(topic, DEFAULT_WORDS))},
                    {"role": "system", "content": "Contexto de la misión (JSON):\n" + json.dumps(context, ensure_ascii=False, default=str)}]
        messages += [{"role": "assistant" if h.get("role") == "assistant" else "user", "content": h.get("text", "")}
                     for h in history[-MAX_HISTORY:] if h.get("text")]
        messages.append({"role": "user", "content": prompt})
        try:
            comp = await self.llm.client.chat.completions.create(
                model=self.llm.model, messages=messages, temperature=0.3, max_tokens=400)
        except Exception as exc:
            log_failure(log, "Modelo de lenguaje", exc)
            self.llm.failed()
            return None
        return _speakable(comp.choices[0].message.content or "") or None
