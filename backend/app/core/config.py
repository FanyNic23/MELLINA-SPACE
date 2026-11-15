"""Configuración única del Edge Core. Lee backend/.env (ver backend/.env.example).

Las variables de entorno reales tienen prioridad sobre el archivo. Las rutas relativas
(base SQLite, audio, modelos, datos) se resuelven desde backend/, no desde el directorio de arranque.
"""
from functools import lru_cache
from pathlib import Path
from typing import Annotated, Literal

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

    # --- Base de datos. SQLite por defecto (sin servidor, ideal para el Edge);
    #     PostgreSQL: postgresql+asyncpg://usuario:clave@host:5432/astro_health
    database_url: str = "sqlite+aiosqlite:///runtime/astro_health.db"
    auto_create_tables: bool = True

    # --- Datos SEWS (motor clínico por días de misión)
    telemetry_data_path: str = "../data/crew_telemetry_sample.json"
    earth_one_way_latency_minutes: float = 14.2

    # --- Modo de IA: auto (en línea si hay claves e internet; si no, offline) | online | offline
    ai_mode: Literal["auto", "online", "offline"] = "auto"

    # --- Reconocimiento de voz: auto (nube en línea, Whisper local offline) | local | openai | deepgram
    stt_provider: Literal["auto", "local", "openai", "deepgram"] = "auto"
    stt_language: str = "es"
    whisper_model: str = "small"
    whisper_model_dir: str = "models/whisper"
    whisper_device: str = "cpu"
    whisper_compute_type: str = "int8"
    whisper_allow_download: bool = True
    deepgram_api_key: str = ""
    deepgram_model: str = "nova-3"

    # --- OpenAI: asistente y copiloto (texto) y STT en línea.
    #     openai_base_url permite un proxy o un servidor compatible (vacío = API oficial).
    openai_api_key: str = ""
    openai_base_url: str = ""
    openai_model: str = "gpt-4o"
    openai_whisper_model: str = "whisper-1"

    # --- ElevenLabs (voz del copiloto y del asistente del reloj)
    elevenlabs_api_key: str = ""
    elevenlabs_base_url: str = "https://api.elevenlabs.io"
    elevenlabs_voice_id: str = "21m00Tcm4TlvDq8ikWAM"
    elevenlabs_model: str = "eleven_turbo_v2_5"

    # --- AWS (opcional: sin esto la Estación en Tierra es un sumidero simulado)
    aws_region: str = "us-east-1"
    aws_access_key_id: str = ""
    aws_secret_access_key: str = ""
    s3_bucket: str = ""
    sqs_queue_url: str = ""

    # --- Audio generado (siempre local; S3 es adicional)
    audio_dir: str = "runtime/audio_out"

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

    @field_validator("telemetry_data_path", "whisper_model_dir", "audio_dir")
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
