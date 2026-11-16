"""Configuración única del Edge Core. Lee backend/.env (ver backend/.env.example).

Las variables de entorno reales tienen prioridad sobre el archivo. Las rutas relativas
(base SQLite, audio, modelos, datos) se resuelven desde backend/, no desde el directorio de arranque.
"""
from functools import lru_cache
from pathlib import Path
from typing import Annotated

from pydantic import field_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parents[2]


def _resolve(path: str) -> str:
    p = Path(path)
    return str(p if p.is_absolute() else (BACKEND_DIR / p).resolve())


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=BACKEND_DIR / ".env", env_file_encoding="utf-8", extra="ignore")

    app_name: str = "A-HAMS Edge Core"
    log_level: str = "INFO"

    # --- Servidor (backend/run.py)
    server_host: str = "127.0.0.1"
    server_port: int = 8000
    server_reload: bool = True
    cors_origins: Annotated[list[str], NoDecode] = ["*"]

    # --- Base de datos local SQLite (sin servidor, ideal para el Edge)
    database_url: str = "sqlite+aiosqlite:///runtime/astro_health.db"
    auto_create_tables: bool = True

    # --- Datos SEWS (motor clínico por días de misión)
    telemetry_data_path: str = "../data/crew_telemetry_sample.json"
    earth_one_way_latency_minutes: float = 14.2
    # --- Chequeos diarios registrados por los astronautas (persisten entre reinicios)
    checkins_path: str = "runtime/checkins.json"
    routine_path: str = "runtime/routine.json"
    mission_path: str = "runtime/mission.json"

    # --- Reconocimiento de voz 100% local (Whisper en el Edge, faster-whisper)
    stt_language: str = "auto"  # auto: detecta inglés o español en cada orden
    whisper_model: str = "small"
    whisper_model_dir: str = "models/whisper"
    whisper_device: str = "cpu"
    whisper_compute_type: str = "int8"
    # Servidores con poca CPU (p. ej. plan gratuito de Render): 1 hilo y beam 1 transcriben mucho más rápido.
    whisper_cpu_threads: int = 0       # 0 = automático
    whisper_beam_size: int = 5
    # False = nunca descargar (operación estrictamente offline). El modelo se instala una sola vez
    # con scripts/download_whisper_model.py antes de la misión.
    whisper_allow_download: bool = False

    # --- Simulador
    sim_autostart: bool = False
    sim_tick_seconds: float = 2.0      # tiempo real entre ticks
    sim_minutes_per_tick: float = 5.0  # minutos "de misión" que avanza cada tick

    # --- Copiloto
    copilot_cooldown_seconds: float = 60.0

    @field_validator("cors_origins", mode="before")
    @classmethod
    def _split_origins(cls, v):
        return [o.strip() for o in v.split(",") if o.strip()] if isinstance(v, str) else v

    @field_validator("telemetry_data_path", "whisper_model_dir", "checkins_path", "routine_path", "mission_path")
    @classmethod
    def _abs_path(cls, v: str) -> str:
        return _resolve(v)

    @field_validator("database_url")
    @classmethod
    def _abs_sqlite(cls, v: str) -> str:
        prefix, sep, path = v.partition(":///")
        if sep and prefix.startswith("sqlite") and not path.startswith("/") and path != ":memory:":
            db = Path(_resolve(path))
            db.parent.mkdir(parents=True, exist_ok=True)
            return f"{prefix}:///{db}"
        return v


@lru_cache
def get_settings() -> Settings:
    return Settings()
