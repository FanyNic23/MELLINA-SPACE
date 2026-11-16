"""Voz 100% local: reconocimiento con Whisper en el Edge y comando de voz al copiloto.

La síntesis de voz la hace el propio reloj con las voces instaladas en el sistema (sin servicios externos).
"""
import logging

from fastapi import APIRouter, File, Form, HTTPException, Request, UploadFile

from app.services.stt import InvalidAudio, SpeechUnavailable
from app.services.sync_queue import Priority

log = logging.getLogger("voice")
router = APIRouter(tags=["Voz"])

MAX_AUDIO_BYTES = 10 * 1024 * 1024


async def _read_audio(audio: UploadFile) -> bytes:
    data = await audio.read()
    if not data:
        raise HTTPException(400, "Audio vacío.")
    if len(data) > MAX_AUDIO_BYTES:
        raise HTTPException(413, "Audio demasiado largo (máx. 10 MB).")
    return data


@router.post("/api/voice/stt", summary="Transcribe la orden de voz del astronauta")
async def speech_to_text(request: Request, audio: UploadFile = File(...), language: str | None = None,
                         prefer: str | None = None):
    data = await _read_audio(audio)
    try:
        transcript = await request.app.state.stt.transcribe(data, language, prefer)
    except InvalidAudio as exc:
        raise HTTPException(422, str(exc))
    except SpeechUnavailable as exc:
        raise HTTPException(503, str(exc))
    except Exception as exc:
        log.exception("STT falló")
        raise HTTPException(502, f"STT no disponible: {exc}")
    return transcript.to_dict()


@router.post("/voice/command", tags=["Copiloto IA"], summary="Comando de voz del astronauta: Whisper local -> copiloto")
async def voice_command(request: Request, astronaut_id: str = Form(...), audio: UploadFile = File(...)):
    st = request.app.state
    if not st.service.astronaut(astronaut_id):
        raise HTTPException(404, f"Astronauta {astronaut_id} no existe")
    data = await _read_audio(audio)
    try:
        transcript = await st.stt.transcribe(data)
    except InvalidAudio as exc:
        raise HTTPException(422, str(exc))
    except SpeechUnavailable as exc:
        raise HTTPException(503, str(exc))
    if not transcript.text:
        raise HTTPException(422, "No se detectó voz")
    reply = await st.service.consult_now(astronaut_id, transcript.text)
    await st.sync.enqueue("voice_log", {"astronaut_id": astronaut_id, "transcript": transcript.text, "reply": reply},
                          Priority.LOW, astronaut_id, False)
    return {"transcript": transcript.text, "reply": reply}
