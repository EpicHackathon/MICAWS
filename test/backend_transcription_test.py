"""Fast regression checks with a stub model; no downloads or GPU required."""
import importlib.util
from pathlib import Path
import sys
import tempfile
import types
import unittest
from unittest.mock import Mock, patch

fake_whisper = types.ModuleType("whisperx")
fake_utils = types.ModuleType("whisperx.utils")
fake_utils.LANGUAGES = {"en": "english", "es": "spanish"}
with patch.dict(sys.modules, {"whisperx": fake_whisper, "whisperx.utils": fake_utils}):
    spec = importlib.util.spec_from_file_location("transcription_under_test", Path(__file__).parents[1] / "backend/whisperx/transcription.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)


class LanguageTests(unittest.TestCase):
    def test_auto_and_explicit_language_keep_original_transcription_with_offsets(self):
        fake_whisper.load_audio = Mock(return_value=types.SimpleNamespace(size=16000))
        model = Mock()
        model.transcribe.return_value = {"segments": [{"text": " Hola ", "start": 0.2, "end": 0.9}]}
        fake_whisper.load_model = Mock(return_value=model)
        with patch.object(module.shutil, "which", return_value="ffmpeg"), tempfile.NamedTemporaryFile() as audio:
            transcriber = module.Transcriber()
            for language, expected in [("es", "es"), ("auto", None)]:
                result = transcriber.transcribe_chunk(audio.name, "chunk", 5, language=language)
                self.assertEqual(result[0]["start"], 5.2)
                self.assertEqual(result[0]["text"], "Hola")
                self.assertEqual(model.transcribe.call_args.kwargs["language"], expected)
                self.assertEqual(model.transcribe.call_args.kwargs["task"], "transcribe")
            with self.assertRaisesRegex(ValueError, "Unsupported source language"):
                transcriber.transcribe_chunk(audio.name, "chunk", language="invalid")


if __name__ == "__main__":
    unittest.main()
