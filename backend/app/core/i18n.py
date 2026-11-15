"""Idioma de las respuestas (inglés por defecto, español opcional).

La interfaz envía `X-Lang: en|es` en cada petición; el middleware de main.py lo fija aquí durante la
petición y el motor clínico, el gemelo digital, la rutina y los entornos generan sus textos en ese idioma.
Los textos viven junto a la lógica que los produce como pares `tr(es, en)`.
"""
from contextlib import contextmanager
from contextvars import ContextVar
from typing import Iterator, Mapping, Optional

LANGS = ("en", "es")
DEFAULT_LANG = "en"

_lang: ContextVar[str] = ContextVar("lang", default=DEFAULT_LANG)


def normalize(code: Optional[str]) -> str:
    code = (code or "").strip().lower()[:2]
    return code if code in LANGS else DEFAULT_LANG


def current() -> str:
    return _lang.get()


def set_lang(code: Optional[str]):
    return _lang.set(normalize(code))


def reset_lang(token) -> None:
    _lang.reset(token)


@contextmanager
def use_lang(code: str) -> Iterator[None]:
    token = set_lang(code)
    try:
        yield
    finally:
        _lang.reset(token)


def tr(es: str, en: str) -> str:
    """Devuelve el texto en el idioma de la petición en curso."""
    return es if _lang.get() == "es" else en


def pick(texts: Mapping[str, str]) -> str:
    """Elige de un diccionario {"es": ..., "en": ...}."""
    return texts.get(_lang.get()) or texts[DEFAULT_LANG]


# Tripulación: los nombres y cargos llegan en español en los datos de misión.
ROLES_EN = {
    "Comandante de Misión": "Mission Commander",
    "Ingeniero de Vuelo": "Flight Engineer",
    "Oficial Científico": "Science Officer",
    "Especialista Médico": "Medical Specialist",
    "Ingeniero de Soporte Vital": "Life Support Engineer",
}


def role(text: str) -> str:
    return ROLES_EN.get(text, text) if _lang.get() == "en" else text


def name(text: str) -> str:
    return text.replace("Dra. ", "Dr. ") if _lang.get() == "en" else text
