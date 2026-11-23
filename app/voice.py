"""Server-side speech-to-text for Voice Mode.

Groq Whisper runs with the key that already lives on the server, so nothing
secret reaches the page and Voice Mode still works in browsers whose built-in
recognition is missing or blocked.
"""

from __future__ import annotations

import os

from fastapi import APIRouter, Header, HTTPException, Request

from app.integrations.deps import get_current_user_and_client

router = APIRouter(prefix="/voice", tags=["voice"])

MAX_AUDIO_BYTES = 24 * 1024 * 1024
DEFAULT_MODEL = "whisper-large-v3"


def model_name() -> str:
    return os.getenv("GROQ_WHISPER_MODEL", DEFAULT_MODEL)


@router.get("/status")
def voice_status(authorization: str | None = Header(default=None)):
    """Tell the client whether server transcription is available."""
    get_current_user_and_client(authorization)
    return {
        "transcription": bool(os.getenv("GROQ_API_KEY")),
        "model": model_name(),
        "max_bytes": MAX_AUDIO_BYTES,
    }


@router.post("/transcribe")
async def transcribe(
    request: Request,
    authorization: str | None = Header(default=None),
):
    """Turn a recorded clip into text with Groq Whisper."""
    # Authentication first: an anonymous request never reaches the parser.
    get_current_user_and_client(authorization)

    form = await request.form()
    file = form.get("file")
    if file is None or not hasattr(file, "read"):
        raise HTTPException(status_code=400, detail="Attach a recording to transcribe.")

    data = await file.read()
    if not data:
        raise HTTPException(status_code=400, detail="The recording was empty.")
    if len(data) > MAX_AUDIO_BYTES:
        raise HTTPException(status_code=413, detail="That recording is too long.")

    key = os.getenv("GROQ_API_KEY")
    if not key:
        raise HTTPException(status_code=503, detail="Speech transcription is not configured.")

    from groq import Groq

    client = Groq(api_key=key)
    name = file.filename or "voice.webm"
    mime = file.content_type or "audio/webm"

    try:
        result = client.audio.transcriptions.create(
            file=(name, data, mime),
            model=model_name(),
            response_format="text",
            language="en",
        )
    except Exception as error:  # noqa: BLE001
        print("VOICE TRANSCRIBE ERROR:", repr(error))
        raise HTTPException(
            status_code=502,
            detail="Vicora could not transcribe that recording. Please try again.",
        )

    text = result if isinstance(result, str) else getattr(result, "text", "")
    return {"text": (text or "").strip()}
