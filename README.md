# MICAWS

MICAWS (Meeting Processor) turns live meeting audio into an editable mind map, action items, and an end-of-meeting summary.

While recording, the browser captures microphone audio in 10-second chunks, sends them to a Python WhisperX transcription server, and streams new transcript segments to a mind-map API (Gemini or Ollama). The API returns the full updated meeting state — nodes, edges, action items — and the React UI renders it with [React Flow](https://reactflow.dev/).

You can also add free-form **meeting notes** during the call. Notes are treated as an extra source of truth: the mind map and summary adapt to them. After recording, you can regenerate the summary at any time to incorporate new notes or transcript text.

## Project structure

```
MICAWS/
  api/
    process.js        POST /api/process — mind-map updates (Gemini/Ollama), validation
    summary.js        POST /api/summary — end-of-meeting summary generation
    ollama.js         Ollama provider helper
  src/
    App.jsx           Main app: recording controls, segments, processor + summary wiring
    main.jsx          React entry point
    index.html        Vite HTML entry
    styles.css        Theme tokens (neutral / warm / cool / dark) and base styles
    shared/
      meetingSchema.js   Zod schemas: meeting state, nodes, edges, action items, user notes
      demo.js            Mock demo batches and expected states
      mapEdits.js        Hand-edits: add/move/delete nodes and user notes
      mockMeeting.js     Sample meeting for the dev-mode sandbox
      summarySchema.js   Summary request/response schemas
      formatTime.js      Timestamp formatting helpers
    components/
      MeetingView.jsx    Map + transcript side panel + notes card + summary
      MindMap.jsx        React Flow mind map with inline edit panel
      TranscriptPanel.jsx Scrolling transcript list
      ManualInput.jsx    Dev-mode manual transcript injection
      MicIcon.jsx / StopIcon.jsx
      meetingLayout.css  Map/transcript layout + notes card styling
      mindmap.css        Node layout and styles for tree/linear/bubble views
    hooks/
      useMeetingProcessor.js   Batches transcript segments, calls the AI map API,
                               applies hand edits and user notes, handles retries
      useMeetingSummary.js     Generates and regenerates the end-of-meeting summary
      useMicrophone.js         Microphone capture, chunking, upload queue, retry
    services/
      processTranscript.js   Fetch wrapper for POST /api/process
      summarizeMeeting.js    Fetch wrapper for POST /api/summary
      microphoneSession.js   Audio capture and chunk upload lifecycle
      transcribeAudio.js     WhisperX multipart upload
      audio/chunk-processor.js  10-second audio chunking
      audio/encodeWav.js     WAV blob encoding
  test/
    processor.test.js, mapEdits.test.js, merging.test.js, limits.test.js,
    microphone.test.js, recording.test.js, ui.test.js, transcriptionProxy.test.js,
    helpers/audio.js
  vercel.json         Serverless function config for /api/*
  vite.config.js      Vite dev server + proxy to Python transcription backend
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

Runs with `node --test`. Covers map edits, merging, node limits, processor retry/quota behavior, microphone chunking/WAV encoding, transcription proxy, and UI flows. One test (`recording.test.js`) exercises the full microphone hook and may take a few minutes.

## Build

```powershell
npm run build
```

Outputs to `dist/`.

## What the AI is told (system prompts)

**Mind map** (`api/process.js`): Review existing topics, merge similar ones, add new information from transcript, keep 3–5 main points, never delete locked or user-added nodes, never delete user notes, max 5 levels, max 4 children per node.

**Summary** (`api/summary.js`): Write overview (2–4 sentences), key points (3–6), and next-time follow-ups (0–5). Ground everything in the transcript, map, and user notes. Never invent facts.


