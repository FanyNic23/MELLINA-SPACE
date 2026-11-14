from functools import lru_cache
from typing import Literal

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    app_name: str = "Astro Health Monitor"
    log_level: str = "INFO"

    # --- PostgreSQL (asyncpg). Para pruebas: sqlite+aiosqlite:///./astro.db
    database_url: str = "postgresql+asyncpg://postgres:postgres@localhost:5432/astro_health"
    auto_create_tables: bool = True  # en producción usa Alembic

    # --- OpenAI
    openai_api_key: str = ""
    openai_model: str = "gpt-4o"
    openai_whisper_model: str = "whisper-1"

    # --- STT
    stt_provider: Literal["whisper", "deepgram"] = "whisper"
    deepgram_api_key: str = ""
    deepgram_model: str = "nova-3"
    deepgram_language: str = "es"

    # --- ElevenLabs
    elevenlabs_api_key: str = ""
    elevenlabs_voice_id: str = "21m00Tcm4TlvDq8ikWAM"
    elevenlabs_model: str = "eleven_turbo_v2_5"

    # --- AWS
    aws_region: str = "us-east-1"
    aws_access_key_id: str = ""
    aws_secret_access_key: str = ""
    s3_bucket: str = ""
    sqs_queue_url: str = ""

    # --- Audio local (siempre se guarda; S3 es adicional)
    audio_dir: str = "./audio_out"

    # --- Simulador
    sim_autostart: bool = False
    sim_tick_seconds: float = 2.0  # tiempo real entre ticks
    sim_minutes_per_tick: float = 5.0  # minutos "de misión" que avanza cada tick

    # --- Copiloto
    copilot_cooldown_seconds: float = 60.0


@lru_cache
def get_settings() -> Settings:
    return Settings()
