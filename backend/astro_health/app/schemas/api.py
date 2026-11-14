import uuid
from datetime import datetime
from typing import Optional

from pydantic import BaseModel, ConfigDict, Field

from app.services.simulator import ScenarioKind
from app.services.sync_queue import LinkState


class AlertOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    astronaut_id: str
    indicator: str
    metric: str
    level: str
    baseline_value: float
    current_value: float
    delta_value: float = Field(description="Cambio absoluto vs línea base")
    delta_pct: float = Field(description="Cambio porcentual vs línea base")
    duration_minutes: float = Field(description="Desde hace cuánto se desvía (minutos de misión)")
    minutes_to_actuar: Optional[float] = Field(None, description="Proyección lineal hasta nivel ACTUAR")
    message: str
    is_active: bool
    is_synthetic: bool
    effective_at: datetime
    created_at: datetime
    resolved_at: Optional[datetime] = None
    ai_response: Optional[dict] = None
    audio_url: Optional[str] = None


class CrewItem(BaseModel):
    id: str
    name: str
    role: str
    status: str
    color: str
    active_alerts: list[AlertOut]
    latest: dict


class CrewOverview(BaseModel):
    link: str
    crew_status: str
    counts: dict[str, int]
    crew: list[CrewItem]


class LinkRequest(BaseModel):
    state: LinkState


class ScenarioRequest(BaseModel):
    astronaut_ids: Optional[list[str]] = Field(None, description="Vacío = toda la tripulación")
    duration_minutes: float = Field(120, gt=5, le=1440, description="Minutos de misión")
    intensity: float = Field(1.0, gt=0, le=1.5)


class ConsultRequest(BaseModel):
    astronaut_id: str
    text: Optional[str] = Field(None, description="Mensaje del astronauta (opcional)")


class ScenarioInfo(BaseModel):
    kind: ScenarioKind
    triggered_for: list[str]
