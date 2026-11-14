import uuid
from datetime import datetime
from typing import Optional

from sqlalchemy import JSON, Boolean, DateTime, Float, ForeignKey, Index, Integer, String, Text, Uuid
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base, utcnow

JSONType = JSON().with_variant(JSONB(), "postgresql")


class AstronautRow(Base):
    __tablename__ = "astronauts"

    id: Mapped[str] = mapped_column(String(32), primary_key=True)
    name: Mapped[str] = mapped_column(String(120))
    role: Mapped[str] = mapped_column(String(80))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class ObservationRow(Base):
    """Serie temporal biométrica: un renglón por Observation FHIR."""
    __tablename__ = "observations"
    __table_args__ = (Index("ix_obs_astro_ind_time", "astronaut_id", "indicator", "effective_at"),)

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    astronaut_id: Mapped[str] = mapped_column(ForeignKey("astronauts.id"), index=True)
    indicator: Mapped[str] = mapped_column(String(32))
    effective_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    primary_value: Mapped[float] = mapped_column(Float)
    values: Mapped[dict] = mapped_column(JSONType)
    resource: Mapped[dict] = mapped_column(JSONType)  # Observation FHIR completa
    danger_level: Mapped[str] = mapped_column(String(10), default="NOMINAL")
    is_synthetic: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class AlertRow(Base):
    __tablename__ = "alerts"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    astronaut_id: Mapped[str] = mapped_column(ForeignKey("astronauts.id"), index=True)
    indicator: Mapped[str] = mapped_column(String(32))
    metric: Mapped[str] = mapped_column(String(64))
    level: Mapped[str] = mapped_column(String(10))
    # trazabilidad del cambio
    baseline_value: Mapped[float] = mapped_column(Float)
    current_value: Mapped[float] = mapped_column(Float)
    delta_value: Mapped[float] = mapped_column(Float)
    delta_pct: Mapped[float] = mapped_column(Float)
    duration_minutes: Mapped[float] = mapped_column(Float)
    minutes_to_actuar: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    message: Mapped[str] = mapped_column(Text)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, index=True)
    is_synthetic: Mapped[bool] = mapped_column(Boolean, default=False)
    effective_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    resolved_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    ai_response: Mapped[Optional[dict]] = mapped_column(JSONType, nullable=True)
    audio_url: Mapped[Optional[str]] = mapped_column(String(300), nullable=True)


class SyncPacketRow(Base):
    """Buffer local store-and-forward (Tierra-Espacio)."""
    __tablename__ = "sync_queue"
    __table_args__ = (Index("ix_sync_pending", "status", "priority", "created_at"),)

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    kind: Mapped[str] = mapped_column(String(32))  # observation_bundle | alert | copilot_advice | voice_log
    priority: Mapped[int] = mapped_column(Integer)  # 0 = crítica
    astronaut_id: Mapped[Optional[str]] = mapped_column(String(32), nullable=True)
    payload: Mapped[dict] = mapped_column(JSONType)
    is_synthetic: Mapped[bool] = mapped_column(Boolean, default=False)
    status: Mapped[str] = mapped_column(String(10), default="pending")  # pending | sent | failed
    attempts: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    sent_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
