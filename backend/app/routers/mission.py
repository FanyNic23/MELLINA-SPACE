"""Entorno de misión: nave a Marte, estación orbital, base lunar, base marciana o rover.

Cambiarlo ajusta umbrales del motor clínico (radiación, CO2), la latencia con la Tierra, si el cirujano de
vuelo puede atender en tiempo real y la proyección del gemelo digital (gravedad). Se guarda en disco.
"""
import json
import os

from fastapi import APIRouter, HTTPException, Request

from app.core.environments import DEFAULT_ENVIRONMENT, ENVIRONMENTS
from app.core.i18n import tr
from app.services.clinical_engine import SpaceClinicalEngine

router = APIRouter(prefix="/api/mission", tags=["Entorno de misión"])


def load_environment(path: str) -> str:
    """Activa el entorno guardado (o el de por defecto) al arrancar el Edge Core."""
    env_id = DEFAULT_ENVIRONMENT
    if os.path.exists(path):
        with open(path, "r", encoding="utf-8") as f:
            env_id = json.load(f).get("environment", DEFAULT_ENVIRONMENT)
    if env_id not in ENVIRONMENTS:
        env_id = DEFAULT_ENVIRONMENT
    SpaceClinicalEngine.ENV = ENVIRONMENTS[env_id]
    return env_id


def _public(env_id: str) -> dict:
    return {"id": env_id, **{k: tr(*v) if isinstance(v, tuple) else v for k, v in ENVIRONMENTS[env_id].items()}}


@router.get("/environment", summary="Entorno activo y entornos disponibles")
def get_environment(request: Request):
    st = request.app.state
    return {"active": _public(st.environment), "available": [_public(k) for k in ENVIRONMENTS]}


@router.post("/environment/{env_id}", summary="Cambia el entorno de misión y reevalúa a la tripulación")
def set_environment(env_id: str, request: Request):
    if env_id not in ENVIRONMENTS:
        raise HTTPException(404, f"Entorno desconocido: {env_id}")
    st = request.app.state
    st.environment = env_id
    SpaceClinicalEngine.ENV = ENVIRONMENTS[env_id]
    st.settings.earth_one_way_latency_minutes = ENVIRONMENTS[env_id]["latency_min"]
    path = st.settings.mission_path
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump({"environment": env_id}, f)
    st.sews.recompute()
    return {"active": _public(env_id)}
