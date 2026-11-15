# A-HAMS · tareas de instalación y arranque (todo local, sin servicios en la nube)
PY      ?= python3
VENV    := venv
VPY     := $(VENV)/bin/python
WHISPER ?= small

.PHONY: setup backend frontend whisper run dev test lint deploy clean

## Instala todo lo necesario antes de la misión (requiere internet una sola vez)
setup: backend frontend whisper

backend:
	test -d $(VENV) || $(PY) -m venv $(VENV)
	$(VPY) -m pip install --upgrade pip
	$(VPY) -m pip install -r backend/requirements.txt
	test -f backend/.env || cp backend/.env.example backend/.env

frontend:
	cd frontend && npm ci && npm run build

whisper:
	$(VPY) backend/scripts/download_whisper_model.py $(WHISPER)

## Arranca el Edge Core: API + interfaz en http://127.0.0.1:8000 (sin internet)
run:
	SERVER_RELOAD=0 $(VPY) backend/run.py

## Desarrollo: backend con recarga en :8000 y Vite en :5173 (proxy a la API)
dev:
	$(VPY) backend/run.py & cd frontend && npm run dev

test:
	cd backend && ../$(VPY) -m tests.smoke_test

lint:
	cd frontend && npm run lint && npm run typecheck

## Publica el último commit como demo en Hugging Face Spaces (requiere: $(VENV)/bin/hf auth login)
deploy:
	$(VPY) deploy/hf_space.py $(SPACE)

clean:
	rm -rf frontend/dist frontend/node_modules
