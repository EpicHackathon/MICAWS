import logging
import math
import shutil
from contextlib import asynccontextmanager
from pathlib import Path
from tempfile import TemporaryDirectory
from typing import Annotated

from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
from backend.whisperx.transcription import Transcriber

logger = logging.getLogger("uvicorn.error")


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Loading WhisperX; the first startup downloads model files. Wait for Application startup complete before recording.")
    app.state.transcriber = Transcriber()
    try:
        yield
    finally:
        app.state.transcriber = None


app = FastAPI(title="MICAWS Transcription API", lifespan=lifespan)


@app.get("/api/transcribe/health")
def transcription_health():
    return {"status": "ready"}


@app.post("/api/transcribe")
def transcribe_audio(
    request: Request,
    audio: Annotated[UploadFile, File()],
    chunk_id: Annotated[str, Form()],
    start_seconds: Annotated[float, Form()] = 0.0,
) -> list[dict]:
    if not chunk_id.strip() or not math.isfinite(start_seconds) or start_seconds < 0:
        raise HTTPException(400, "Provide a chunk ID and a finite, nonnegative start time.")
    try:
        with TemporaryDirectory(prefix="micaws-") as directory:
            path = Path(directory) / "recording"
            with path.open("wb") as destination:
                shutil.copyfileobj(audio.file, destination)
            if not path.stat().st_size:
                raise HTTPException(400, "The recording is empty.")
            return request.app.state.transcriber.transcribe_chunk(path, chunk_id, start_seconds)
    except HTTPException:
        raise
    except Exception as error:
        logger.exception("Transcription failed")
        raise HTTPException(500, "Transcription failed. Check the Python server terminal.") from error
