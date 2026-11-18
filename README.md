# MICAWS

## Saved workspace and integration milestone

MICAWS now includes an authenticated `/workspace` with PostgreSQL-backed saved meetings, autosaved transcript corrections and encrypted pending-change recovery, clickable transcript/recording evidence, cited meeting questions, decision/proposal/question tracking, task progress, related meeting history, and an embeddable partner workspace. This is a separate server-backed workflow; the original local microphone demo below remains unchanged.

**Try it without keys:** run `npm.cmd ci`, `npm.cmd run build`, then `npm.cmd run demo:saved`. Open `http://127.0.0.1:8081/workspace` and select **Open sample workspace**. This synthetic demo is memory-only; real persistence requires PostgreSQL. Mock mode does not pretend to translate or answer AI questions.

See [Saved workspace setup, API and operations](docs/SAVED_WORKSPACE.md) for persistent Docker setup, API keys/session tokens, partner embedding, privacy, recording storage, recovery, and validation limits. Existing Vercel-only hosting does not run the new database-backed worker; use the production Node container or equivalent customer infrastructure.

MICAWS (Meeting Processor) turns live meeting audio into an editable mind map, action items, and an end-of-meeting summary.

While recording, the browser captures microphone audio in 10-second chunks, sends them to a Python WhisperX transcription server, and streams new transcript segments to a mind-map API (Gemini or Ollama). The API returns the full updated meeting state — nodes, edges, action items — and the React UI renders it with [React Flow](https://reactflow.dev/).

You can type meeting text, attach supporting PDF/PPTX/TXT materials, edit multiple topic trees, translate the transcript, and download the recording. The complete upgrade setup and limitations are documented below.

## Project structure

```
MICAWS/
  api/
    process.ts        POST /api/process — mind-map updates (Gemini/Ollama), validation
    summary.ts        POST /api/summary — end-of-meeting summary generation
    ollama.ts         Ollama provider helper
  server/             Node API and worker for saved meetings
  transcription/      Python speech transcription and optional Diart tooling
  src/
    App.tsx           Main app: recording controls, segments, processor + summary wiring
    main.tsx          React entry point
    index.html        Vite HTML entry
    styles.css        Theme tokens (neutral / warm / cool / dark) and base styles
    shared/
      meetingSchema.ts   Zod schemas: meeting state, nodes, edges, action items, user notes
      demo.ts            Mock demo batches and expected states
      mapEdits.ts        Hand-edits: add/move/delete nodes and user notes
      mockMeeting.ts     Sample meeting for the dev-mode sandbox
      summarySchema.ts   Summary request/response schemas
      formatTime.ts      Timestamp formatting helpers
    components/
      MeetingView.tsx    Map + transcript side panel + notes card + summary
      MindMap.tsx        React Flow mind map with inline edit panel
      TranscriptPanel.tsx Scrolling transcript list
      ManualInput.tsx    Accessible typed meeting input
      MicIcon.tsx / StopIcon.tsx
      meetingLayout.css  Map/transcript layout + notes card styling
      mindmap.css        Node layout and styles for tree/linear/bubble views
    hooks/
      useMeetingProcessor.ts   Batches transcript segments, calls the AI map API,
                               applies hand edits and user notes, handles retries
      useMeetingSummary.ts     Generates and regenerates the end-of-meeting summary
      useMicrophone.ts         Microphone capture, chunking, upload queue, retry
    services/
      processTranscript.ts   Fetch wrapper for POST /api/process
      summarizeMeeting.ts    Fetch wrapper for POST /api/summary
      microphoneSession.ts   Audio capture and chunk upload lifecycle
      transcribeAudio.ts     WhisperX multipart upload
      audio/chunk-processor.ts  10-second audio chunking
      audio/encodeWav.ts     WAV blob encoding
  test/
    processor.test.ts, mapEdits.test.ts, merging.test.ts, limits.test.ts,
    microphone.test.ts, recording.test.ts, ui.test.ts, transcriptionProxy.test.ts,
    helpers/audio.ts
  vercel.json         Serverless function config for /api/*
  vite.config.ts      Vite dev server + proxy to Python transcription backend
```

## Features

- **Live mind map**: React Flow diagram (tree, linear, or bubble layout) built from transcript evidence
- **Live notes**: Add free-form context during the meeting; the AI treats notes as a source of truth when shaping the map and summary
- **Hand editing**: Rename, move, delete, or add nodes on the map. Hand-edited nodes are locked so the AI won't move or remove them, but the AI can still add children under them
- **Action items**: Tasks inferred from the discussion, listed separately
- **End-of-meeting summary**: Overview, key points, and follow-ups. Click **Regenerate summary** to refresh it after adding notes or when more transcript arrives
- **Mock mode** (`MEETING_MOCK=true`): Test the full flow without a Gemini key or microphone — sample batches drive the map
- **Live transcription**: Requires a Python WhisperX server (see [`LIVE_TRANSCRIPTION.md`](LIVE_TRANSCRIPTION.md))

## Run locally

### Frontend only (mock mode)

```powershell
npm.cmd ci
if (!(Test-Path .env.local)) { Copy-Item .env.example .env.local }
npm test
npm run dev
```

Open the Vite URL (usually http://localhost:5173). In dev mode (`?dev` in the URL) you can inject manual transcript text and load a sample meeting to practice editing the map.

## Enable Gemini

1. Create a Gemini API key in [Google AI Studio](https://aistudio.google.com/app/apikey).
2. Edit `.env.local`. Set `MEETING_MOCK=false` and paste the key as `GEMINI_API_KEY=your_actual_key`. Keep it out of Git and never put it in a `VITE_` environment variable.
3. Restart `npm run dev`.

The default `GEMINI_MODEL=gemini-3.5-flash-lite` supports structured output. Optional `GEMINI_MODELS=gemini-2.5-flash,gemini-2.5-flash-lite` adds ordered quota fallbacks; choose models enabled for your API key. A model that returns HTTP 429 is skipped for 60 seconds (configurable with `GEMINI_QUOTA_COOLDOWN_MS`). If all are limited, the request stays available for retry.

## Use local AI with Ollama

Install [Ollama](https://ollama.com/download), open a terminal, and download a model: `ollama pull qwen3:8b`. In `.env.local`, set `MEETING_MOCK=false`, `AI_PROVIDER=ollama`, and `OLLAMA_MODEL=qwen3:8b`. Ollama's default local address is `http://127.0.0.1:11434`; change `OLLAMA_URL` if needed. Start Ollama and then restart Vite. Both mind-map updates and end-of-meeting summaries use the local model, so no Gemini API key or quota is involved. Local Ollama works with the development server; it is not reachable from a Vercel deployment.

## Tests

```powershell
npm test
```

Runs serially with Node’s test runner and the `tsx` loader (`npm test`). Covers map edits, merging, node limits, processor retry/quota behavior, microphone chunking/WAV encoding, transcription proxy, and UI flows. One test (`recording.test.ts`) exercises the full microphone hook and may take a few minutes.

## Build

```powershell
npm run build
```

Outputs to `dist/`.

## What the AI is told (system prompts)

**Mind map** (`api/process.ts`): Review existing topics, merge similar ones, add new information from transcript, group related topics without inventing categories, never delete locked or user-added nodes, never delete user notes, max 5 levels, max 4 children per node.

**Summary** (`api/summary.ts`): Write overview (2–4 sentences), key points (3–6), and next-time follow-ups (0–5). Ground everything in the transcript, map, and user notes. Never invent facts.



## Meeting upgrade: forests, materials, playback and languages

### Getting started

Use Node 22.12 or newer in the Node 22 series. Run `npm.cmd ci` after pulling this upgrade. Copy `.env.example` to `.env.local` only if that file does not exist; preserve your existing key. Start Vite with `npm.cmd run dev`. For microphone input, start a second terminal with `powershell -ExecutionPolicy Bypass -File scripts/start-transcription.ps1` and wait for **Application startup complete**. See LIVE_TRANSCRIPTION.md for Python 3.11 environment and FFmpeg installation. Restart the Python server after upgrading its code.

Choose `MEETING_MOCK=true` for simulated processing. For actual AI reasoning and translation, set `MEETING_MOCK=false` and either configure Gemini or set `AI_PROVIDER=ollama`, `OLLAMA_MODEL=qwen3:8b`, run `ollama pull qwen3:8b`, and keep Ollama running. Restart Vite after environment changes. Model availability, quality, speed and language coverage depend on the chosen provider. Gemini sends submitted transcript, current map and attached extracted text to Google; Ollama sends them to your configured Ollama server.

### Editing and multiple trees

A meeting can now contain several independent roots. Single-root meetings remain valid. AI grouping is evidence-based: unrelated subjects can form separate trees, related details stay together, and a genuinely single-topic discussion is not padded with invented categories. Layouts arrange separate trees with spacing. Use the map editor or **Accessible outline and keyboard editing** to create trees, rename topics, add children, move a topic to another tree, promote a topic to an independent tree, or delete a branch. Five levels remain the maximum. Cycles and orphaned nodes are rejected.

Manual edits trigger reassessment without requiring new speech. Changed nodes and tasks are protected; deliberate deletions are included in subsequent AI context. Requests made before an edit are invalidated. Summaries are keyed to the map and context, not just transcript length. Generated tasks may change during reassessment; explicitly edited tasks retain their wording. Deleted topic IDs and exact normalized labels are blocked from automatic recreation, but semantic paraphrase avoidance still depends on the AI. Locked manual wording is not automatically translated.

### Supporting documents

Upload PDF, PPTX (not legacy PPT), or UTF-8 TXT through Meeting materials. Limits: three documents, 10 MB each, 50 pages/slides each, 30,000 extracted characters each, and 60,000 combined characters. Extracted text previews show page/slide references. Add, replace, cancel and remove are supported. Changes trigger reassessment of derived content. Document statements are background information, not agreed meeting commitments.

Extraction happens in the browser. Files and extracted text remain in page memory; nothing is persistently uploaded as a document. Extracted text is sent to the selected AI provider when processing. Scans and image-only slides need OCR first; this version does not perform OCR. Mixed documents disclose pages with no extractable text. Password-protected, corrupt and oversized documents are rejected with an error. Resetting or reloading clears documents.

### Recording and playback

After capture stops, the recording appears with native playback controls and a WAV download link, even if transcription is awaiting retry. Click a transcript timestamp to seek to that recording time. Stop/resume intervals are concatenated: real-world pauses are omitted. Failed transcription retries do not duplicate audio. The archive is limited to approximately 64 MiB of PCM; recording stops when the limit is reached. Download and start a new session for longer meetings.

Recordings and pending audio are memory-only and do not survive reload, reset or closing the tab. Reset explains this and asks for confirmation; the browser receives an unload warning when audio is present. Download first. A typed transcript or sample batch has no corresponding recorded speech.

### Accessibility and languages

Keyboard users can use the editable outline instead of the visual map. Visible focus, reduced-motion support, labeled controls, text input, status announcements and keyboard resizing are available. Typed meeting text is available without developer mode.

Select Speech language before recording, or use automatic detection. WhisperX uses its multilingual base model to transcribe original speech; it does not translate the transcript. Automatic detection runs on short chunks and may be inaccurate for brief speech or language switching; select the known language for better reliability. The UI exposes English, Spanish, French, German, Portuguese, Chinese, Japanese, Korean, Hindi and Arabic.

Translate transcript selects a separate AI translation, displayed alongside original text with unchanged timestamps and speakers. Original text stays available when translation fails; use Retry translation. Map and summary language independently controls generated map, task and summary text. Translation needs live Gemini/Ollama mode and consumes AI requests; mock mode does not pretend to translate. Quality must be checked by speakers of the target language.

### Deployment and verification

Vercel serves the JavaScript AI endpoints, but cannot access services on your laptop's localhost. Host transcription separately with appropriate access controls and a supported frontend route. A local Ollama server needs a reachable server-side address for remote deployments. In Docker Desktop, accessing host Ollama may require `OLLAMA_URL=http://host.docker.internal:11434`; do not expose an unauthenticated Ollama service publicly. Browser extraction and memory-only playback need no file-storage server.

Run `npm test` and `npm.cmd run build`. Python transcription unit checks: `.\.venv-whisperx\Scripts\python.exe -m unittest discover -s test -p backend_transcription_test.py`. Automated tests use simulated AI and microphone replies; document tests parse generated PDF/PPTX fixtures and recording tests inspect WAV bytes. Live microphone, multilingual recognition/translation quality, Docker and deployed hosting require separate end-to-end checks. AI semantic grouping and task accuracy are not guaranteed by schema validation.

## Workspace layout

Recording and speech-language controls are grouped at the top. Map output language sits in the Mind map header; transcript translation, retry status and typed input are in the transcript panel. Summaries and action items appear below the map, followed by supporting materials and recording playback/download. The raw Connections list has been removed; relationships remain visible in the map and accessible outline. The workspace uses responsive cards, consistent controls and the existing four themes.

## In-page instructions

Both workspaces include a collapsed **How to use this workspace** guide near the top. Expand individual topics for getting started, controls, evidence, corrections, decisions, languages, saving/recovery, and troubleshooting. The guide distinguishes local recording from server-backed saved meetings and clearly labels the synthetic demo. Future functionality changes must update the affected in-page guide and README together.

### TypeScript runtime and reliable retries

Use Node.js 22 and run `npm ci` after pulling dependency changes. `npm test`,
`npm start`, `npm run worker`, and `npm run demo:saved` use `tsx` to run the TypeScript entry points. The pilot container includes this
runtime and type-checks the application and server during its build.
Saved transcript retries compare JSON structurally, so PostgreSQL key ordering
does not create false conflicts. The saved
workspace provider leaves SDK retry options unset (one transport attempt in the
locked SDK); each application retry reserves its own request allowance. A smaller
Gemini generation schema avoids provider grammar limits; strict local validation
still checks bounds, citations, and protected edits before saving.
The request allowance is not a dollar spending limit.
