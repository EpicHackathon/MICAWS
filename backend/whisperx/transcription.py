import math
import shutil
from pathlib import Path
from threading import Lock

import whisperx


class Transcriber:
    def __init__(self, model_name: str = "base", language: str = "en"):
        if shutil.which("ffmpeg") is None:
            raise RuntimeError(
                "FFmpeg is required. On macOS, install it with: brew install ffmpeg"
            )

        self.language = language
        self._lock = Lock()
        self._model = whisperx.load_model(
            model_name,
            device="cpu",
            compute_type="int8",
            language=language,
            vad_method="silero",
        )

    def transcribe_chunk(
        self,
        audio_path: str | Path,
        chunk_id: str,
        start_seconds: float = 0.0,
    ) -> list[dict]:
        path = Path(audio_path).expanduser()

        if not path.is_file():
            raise FileNotFoundError(f"Audio file does not exist: {path}")

        if not isinstance(chunk_id, str) or not chunk_id.strip():
            raise ValueError("chunk_id must be a nonempty string.")

        start_seconds = float(start_seconds)

        if not math.isfinite(start_seconds) or start_seconds < 0:
            raise ValueError("start_seconds must be a finite, nonnegative number.")

        audio = whisperx.load_audio(str(path))

        if audio.size == 0:
            return []

        with self._lock:
            result = self._model.transcribe(
                audio,
                batch_size=1,
                language=self.language,
            )

        segments = []

        for index, segment in enumerate(result["segments"]):
            text = segment["text"].strip()

            if not text:
                continue

            segments.append(
                {
                    "id": f"{chunk_id}-{index}",
                    "start": round(start_seconds + float(segment["start"]), 3),
                    "end": round(start_seconds + float(segment["end"]), 3),
                    "speaker": None,
                    "text": text,
                }
            )

        return segments
if __name__ == "__main__":
    import argparse
    import json

    parser = argparse.ArgumentParser()
    parser.add_argument("audio_path")
    parser.add_argument("--chunk-id", default="test-clip")
    parser.add_argument("--start-seconds", type=float, default=0.0)
    args = parser.parse_args()

    transcriber = Transcriber()
    transcript = transcriber.transcribe_chunk(
        args.audio_path,
        chunk_id=args.chunk_id,
        start_seconds=args.start_seconds,
    )
    print(json.dumps(transcript, indent=2))
