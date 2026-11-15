"""
Arranca el Edge Core con la configuración de backend/.env.

Uso (desde la raíz del repositorio):
    python backend/run.py
"""

import os
import sys

import uvicorn

BACKEND_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, BACKEND_DIR)

from app.core.config import get_settings  # noqa: E402

if __name__ == "__main__":
    settings = get_settings()
    uvicorn.run(
        "app.main:app",
        host=settings.server_host,
        port=settings.server_port,
        reload=settings.server_reload,
        reload_dirs=[os.path.join(BACKEND_DIR, "app")] if settings.server_reload else None,
        app_dir=BACKEND_DIR,
    )
