"""
Descarga el modelo Whisper una sola vez para que el reconocimiento de voz funcione offline.

Uso:
    python backend/scripts/download_whisper_model.py            # modelo por defecto (small)
    python backend/scripts/download_whisper_model.py base       # otro tamaño

Después se puede arrancar el servidor con WHISPER_ALLOW_DOWNLOAD=0 para garantizar que nunca
intente conectarse a internet.
"""

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from faster_whisper import WhisperModel  # noqa: E402
from app.core.config import get_settings  # noqa: E402

settings = get_settings()

model_name = sys.argv[1] if len(sys.argv) > 1 else settings.whisper_model
print(f"Descargando modelo Whisper '{model_name}' en {settings.whisper_model_dir} ...")
WhisperModel(model_name, device=settings.whisper_device, compute_type=settings.whisper_compute_type,
             download_root=settings.whisper_model_dir)
print("Listo. El reconocimiento de voz ya funciona sin conexión.")
