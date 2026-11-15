# Live recording: chunks and segments

An audio **chunk** is the next 10 seconds of captured microphone samples. A transcript **segment** is one speech region returned by WhisperX. Silero voice activity detection identifies speech and WhisperX groups regions for recognition, so one chunk may yield zero, one, or several segments. Segments are not necessarily sentences. The dashboard's segment count is the number of displayed transcript entries, including sample or simulated entries if you add them.

The Python transcriber returns a list of `{ id, start, end, speaker, text }`. Times are seconds on the recording timeline. For example, speech beginning 2 seconds into the chunk that starts at 20 seconds has `start: 22`. These are region timestamps; this app does not run word alignment or speaker diarization. Quiet chunks still advance the recording clock.

The browser uses AudioWorklet to capture continuously and make a separate complete WAV for each chunk. Each WAV contains its own header. Requests are processed one at a time in capture order. The browser records the next chunk while WhisperX processes the previous one. Successful text is appended and sent to the existing mind-map API immediately; only new, unprocessed text is sent. The map request also runs one at a time.

## Files changed for live transcription

- `src/audio/chunk-processor.js`: collects mono samples; emits a chunk every 10 seconds and flushes remaining samples on Stop.
- `src/audio/encodeWav.js`: turns a sample array and sample rate into a complete mono, 16-bit WAV Blob.
- `src/services/microphoneSession.js`: opens the microphone, manages audio capture and the upload queue, retains failed chunks for retry, and releases microphone resources.
- `src/services/transcribeAudio.js`: accepts `(audioBlob, abortSignal, { chunkId, startSeconds })`, uploads multipart audio, and returns the validated list of transcript segments.
- `src/hooks/useMicrophone.js`: exposes `start(startSeconds)`, `stop()`, `retry()`, `reset()`, `status`, and `error` to React. Calls `onTranscript(segments, chunkEndSeconds)` after each successful chunk, including silent chunks with an empty list.
- `src/hooks/useMeetingProcessor.js`: processes new transcript entries as they arrive, drains entries received during an active map request, and retries on a 10-second timer while recording.
- `src/App.jsx`: appends absolute transcript timestamps and connects audio retry to the existing Process pending / retry button.
- `test/microphone.test.js`: regression coverage for chunk boundaries, WAV encoding, ordering, silence, retry, reset cancellation, and Stop.

No new npm or Python dependencies are required. The existing `backend/main.py` and `backend/whisperx/transcription.py` already support chunk IDs and start-time offsets.

## Try the updated version on macOS

The files are already merged in this project. Bring your existing .env.local into the project folder, or configure it from .env.example. Then run these commands from your project root.

Terminal 1:

```bash
source .venv/bin/activate
python -m uvicorn backend.main:app --host 127.0.0.1 --port 8000
```

Terminal 2:

```bash
npm run dev
```

If you extracted the full project into a new folder, first create its environment with `python3.11 -m venv .venv`, activate it, install `python -m pip install -r backend/requirements.txt`, and run `npm ci`. FFmpeg must be installed separately, as before.

For your own speech to change the map, your existing `.env.local` needs `MEETING_MOCK=false` and a valid `GEMINI_API_KEY`. Restart Vite after changing this file. Mock mode only responds to the included sample phrases; it can display real transcripts without building a map from them.

1. Open the Vite localhost URL and click Start Recording. Allow microphone access.
2. Speak for about 25 seconds. Check that the first transcript appears before you click Stop (allow additional inference time on CPU).
3. Press Stop. The final approximately 5-second chunk is sent, and Start stays disabled until queued transcriptions finish.
4. Check the transcript timestamps, Topics, and Mind Map. The Python terminal should show multiple POST requests to `/api/transcribe`.
5. Reset session to clear the transcript and map together.

## Timing, failures, and limitations

- The 10-second interval controls audio collection. Visible updates take 10 seconds plus WhisperX processing time, followed by the mind-map model's response time. Slow processing can create a queue.
- To bound memory, capture stops automatically if 12 chunks are queued; captured audio continues processing. The page displays an explanation.
- A transcription request times out after two minutes. On an error, recording stops and unprocessed audio stays in browser memory. Click the existing **Process pending / retry** button after fixing the server. Failed chunks keep their IDs and are appended only after success. Refreshing the page or Reset discards that pending audio.
- Stop flushes any shorter remainder. Reset aborts frontend requests and ignores late results; server inference already underway may still finish.
- Chunk boundaries can split a word or sentence and reduce recognition accuracy. This version does not overlap chunks or reconcile words across boundaries.
- Keep the page open and the computer awake. A browser or device interruption can pause capture; this is not an unattended background recorder.
- Transcript recognition remains on your Python server. With live mind-map processing enabled, transcript text is sent to Gemini by the existing API.

Validation: automated tests cover capture chunking and upload behavior using simulated audio and server replies, plus the existing processing API tests. The production build was checked. Real microphone input, CPU transcription latency, and Gemini responses must be checked on your computer using the steps above.

## Start continuous transcription on Windows

Use two terminals in the MICAWS folder. The frontend alone cannot transcribe audio.

First-time setup:

```powershell
py -3.11 -m venv .venv-whisperx
.\.venv-whisperx\Scripts\python.exe -m pip install -r backend/requirements.txt
winget install --id Gyan.FFmpeg --exact
```

Terminal 1:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/start-transcription.ps1
```

Wait for **Application startup complete**. The first startup downloads the WhisperX model; keep this terminal open. Terminal 2 runs `npm.cmd run dev`. Check readiness through the frontend at http://localhost:5173/api/transcribe/health. A ready server returns {"status":"ready"}.

The default backend address is http://127.0.0.1:8000. Set TRANSCRIPTION_URL in .env.local if your backend runs elsewhere, then restart Vite. In WSL, use an address reachable from the environment running Vite. The Docker frontend uses http://transcription:8000, the Compose service name.

For Docker, run `docker compose up --build frontend transcription`. The transcription container has its own Python environment and model cache. Watch its startup logs before recording. The diart import-check container is separate from WhisperX.

If the backend is unavailable or still loading, the frontend returns an explicit 503 error. If model loading fails, inspect Terminal 1 for the underlying dependency, FFmpeg, network, or model-download error. After recovery, use **Process pending / retry** to resend retained chunks. Reset or refresh discards retained audio.
