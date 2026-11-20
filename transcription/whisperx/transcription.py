import logging
import math
import shutil
from pathlib import Path
from threading import Lock

import whisperx
from whisperx.utils import LANGUAGES


logger = logging.getLogger(__name__)


class Transcriber:
    def __init__(self, model_name: str = "base", language: str = "auto", *, align_words: bool = False):
        if shutil.which("ffmpeg") is None:
            raise RuntimeError(
                "FFmpeg is required. Windows: winget install --id Gyan.FFmpeg --exact; macOS: brew install ffmpeg"
            )

        self.language = language
        self._lock = Lock()
        self._align_words = align_words
        self._alignment = None
        self._unsupported_alignment = set()
        self._model = whisperx.load_model(
            model_name,
            device="cpu",
            compute_type="int8",
            language=None,
            vad_method="silero",
        )

    def transcribe_chunk(
        self,
        audio_path: str | Path,
        chunk_id: str,
        start_seconds: float = 0.0,
        language: str | None = None,
        *, include_words: bool = False,
    ) -> list[dict]:
        path = Path(audio_path).expanduser()

        if not path.is_file():
            raise FileNotFoundError(f"Audio file does not exist: {path}")

        if not isinstance(chunk_id, str) or not chunk_id.strip():
            raise ValueError("chunk_id must be a nonempty string.")

        start_seconds = float(start_seconds)

        if not math.isfinite(start_seconds) or start_seconds < 0:
            raise ValueError("start_seconds must be a finite, nonnegative number.")

        language = language or self.language
        if language != "auto" and language not in LANGUAGES:
            raise ValueError("Unsupported source language. Use auto or a supported Whisper language code.")

        audio = whisperx.load_audio(str(path))

        if audio.size == 0:
            return []

        with self._lock:
            # A previous failed decode may have left a tokenizer behind.
            if language == "auto":
                self._model.tokenizer = None
            result = self._model.transcribe(
                audio,
                batch_size=1,
                language=None if language == "auto" else language,
                task="transcribe",
            )

            if include_words and self._align_words and result["segments"]:
                alignment_language = result.get("language") if language == "auto" else language
                result = self._align(result, audio, alignment_language)

        segments = []

        for index, segment in enumerate(result["segments"]):
            text = segment["text"].strip()

            if not text:
                continue

            entry = {
                "id": f"{chunk_id}-{index}",
                "start": round(start_seconds + float(segment["start"]), 3),
                "end": round(start_seconds + float(segment["end"]), 3),
                "speaker": None,
                "text": text,
            }
            if include_words and segment.get("words"):
                words = []
                for word in segment["words"]:
                    start, end = word.get("start"), word.get("end")
                    if (isinstance(start, (float, int)) and isinstance(end, (float, int))
                            and math.isfinite(start) and math.isfinite(end) and 0 <= start < end):
                        start = round(start_seconds + start, 3)
                        end = round(start_seconds + end, 3)
                        if end > start and word.get("word", "").strip():
                            words.append({"text": word["word"].strip(), "start": start, "end": end})
                if words:
                    entry["words"] = words
            segments.append(entry)

        return segments

    def _align(self, result, audio, language):
        if not language or language in self._unsupported_alignment:
            return result
        try:
            if self._alignment is None or self._alignment[0] != language:
                model, metadata = whisperx.load_align_model(language_code=language, device="cpu")
                self._alignment = (language, model, metadata)
            _, model, metadata = self._alignment
        except Exception:
            self._unsupported_alignment.add(language)
            logger.warning("WhisperX word alignment model unavailable for %s. Using segment timings.", language)
            return result
        try:
            aligned = whisperx.align(result["segments"], model, metadata, audio, "cpu")
            return aligned if aligned.get("segments") else result
        except Exception:
            logger.warning("WhisperX could not align this window. Using segment timings.")
            return result


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
