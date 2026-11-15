"""Voz: reconocimiento (STT), síntesis (TTS) y comando de voz al copiloto.

Un único servicio SpeechToText atiende al asistente del reloj (/api/voice/stt) y al copiloto
(/voice/command); un único TextToSpeech (ElevenLabs) da voz al copiloto y al reloj.
"""
import logging

from fastapi import APIRouter, File, Form, HTTPException, Request, Response, UploadFile
from pydantic import BaseModel, Field

from app.services.stt import InvalidAudio, SpeechUnavailable
from app.services.sync_queue import Priority

log = logging.getLogger("voice")
router = APIRouter(tags=["Voz"])

MAX_AUDIO_BYTES = 10 * 1024 * 1024


class TTSRequest(BaseModel):
    text: str = Field(..., min_length=1, max_length=2000)
    lang: str = "es"


async def _read_audio(audio: UploadFile) -> bytes:
    data = await audio.read()
    if not data:
        raise HTTPException(400, "Audio vacío.")
    if len(data) > MAX_AUDIO_BYTES:
        raise HTTPException(413, "Audio demasiado largo (máx. 10 MB).")
    return data


@router.post("/api/voice/stt", summary="Transcribe la orden de voz del astronauta")
async def speech_to_text(request: Request, audio: UploadFile = File(...), language: str | None = None):
    data = await _read_audio(audio)
    try:
        transcript = await request.app.state.stt.transcribe(
            data, audio.filename or "voice.webm", audio.content_type or "", language)
    except InvalidAudio as exc:
        raise HTTPException(422, str(exc))
    except SpeechUnavailable as exc:
        raise HTTPException(503, str(exc))
    except Exception as exc:
        log.exception("STT falló")
        raise HTTPException(502, f"STT no disponible: {exc}")
    return transcript.to_dict()


@router.post("/api/voice/tts", summary="Sintetiza voz (mp3) para el asistente del reloj",
             responses={200: {"content": {"audio/mpeg": {}}}})
async def text_to_speech(body: TTSRequest, request: Request):
    tts = request.app.state.tts
    if not await tts.ready():
        raise HTTPException(503, "Síntesis en línea no disponible (sin ELEVENLABS_API_KEY o sin conexión).")
    audio = await tts.synthesize(body.text)
    if audio is None:
        raise HTTPException(503, "El proveedor de voz no respondió; usa la voz del sistema.")
    return Response(audio, media_type="audio/mpeg")


@router.post("/voice/command", tags=["Copiloto IA"], summary="Comando de voz del astronauta: STT -> copiloto -> TTS")
async def voice_command(request: Request, astronaut_id: str = Form(...), audio: UploadFile = File(...)):
    st = request.app.state
    if not st.service.astronaut(astronaut_id):
        raise HTTPException(404, f"Astronauta {astronaut_id} no existe")
    data = await _read_audio(audio)
    try:
        transcript = await st.stt.transcribe(data, audio.filename or "voice.webm", audio.content_type or "")
    except InvalidAudio as exc:
        raise HTTPException(422, str(exc))
    except Exception as exc:
        log.exception("STT falló")
        raise HTTPException(502, f"STT no disponible: {exc}")
    if not transcript.text:
        raise HTTPException(422, "No se detectó voz")
    reply = await st.service.consult_now(astronaut_id, transcript.text)
    await st.sync.enqueue("voice_log", {"astronaut_id": astronaut_id, "transcript": transcript.text, "reply": reply},
                          Priority.LOW, astronaut_id, False)
    return {"transcript": transcript.text, "reply": reply}
