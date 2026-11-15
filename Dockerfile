# A-HAMS Edge Core · imagen autocontenida (API + interfaz + Whisper), funciona sin red.

# 1) Interfaz React
FROM node:22-alpine AS web
WORKDIR /web
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# 2) Edge Core
FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 \
    SERVER_HOST=0.0.0.0 SERVER_PORT=8000 SERVER_RELOAD=0 WHISPER_ALLOW_DOWNLOAD=0
WORKDIR /app
COPY backend/requirements.txt backend/requirements.txt
RUN pip install --no-cache-dir -r backend/requirements.txt
COPY backend/ backend/
COPY data/ data/
COPY --from=web /web/dist frontend/dist

# El modelo de voz queda dentro de la imagen; en vuelo no se descarga nada.
# `tiny` responde en segundos con poca CPU (plan gratuito de Render). En un servidor con más CPU, `small`
# entiende mejor:  docker build --build-arg WHISPER_MODEL=small .
ARG WHISPER_MODEL=tiny
ENV WHISPER_MODEL=${WHISPER_MODEL}
RUN python backend/scripts/download_whisper_model.py ${WHISPER_MODEL}

# Usuario sin privilegios.
RUN useradd -m -u 1000 ahams && mkdir -p backend/runtime && chown -R ahams /app/backend/runtime /app/backend/models
USER ahams

# Puerto: el que asigne la plataforma (PORT, p. ej. Render) o 8000.
EXPOSE 8000
CMD ["sh", "-c", "SERVER_PORT=${PORT:-8000} exec python backend/run.py"]
