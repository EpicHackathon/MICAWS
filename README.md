# MICAWS

React holds the finalized transcript and the latest valid meeting state. The hook sends only the next unprocessed slice and prior state to the same-origin API. The API can use Gemini or a local Ollama model, validates the complete result, and returns it. The hook advances its transcript cursor only after success.

```text
MICAWS/
  api/process.js
  src/
    shared/meetingSchema.js
    shared/demo.js
    services/processTranscript.js
    hooks/useMeetingProcessor.js
    App.jsx
    main.jsx
  test/processor.test.js
  index.html
  vite.config.js
  vercel.json
  package.json
  package-lock.json
  .env.example
  .gitignore
  README.md
```

## What each required file does

1. `api/process.js` implements POST /api/process, the Gemini prompt and request, validation, and safe error messages. It checks that valid existing node IDs, edges and tasks survive each update.
2. `src/shared/meetingSchema.js` defines the exact input and output shapes, the initial empty state, and graph checks. Zod also derives the structural JSON schema sent to Gemini.
3. `src/services/processTranscript.js` exports `processTranscript(newSegments, previousState)`. It returns the full validated JSON state or throws. Assign its return value only on success.
4. `src/hooks/useMeetingProcessor.js` batches work every 20 seconds during recording. It keeps one active request per hook instance, flushes pending segments when recording stops, retries on the next tick during recording, and exposes a manual retry after recording. Reset aborts and invalidates old requests.

## Run the mock locally

In VS Code, choose **File → Open Folder** and select MICAWS, then choose **Terminal → New Terminal**. Node.js runs this project on your computer. Check your installation with `node --version`. This project targets Node.js 22.12 or later in the Node 22 series. Run these commands in the terminal.

```powershell
npm.cmd ci
if (!(Test-Path .env.local)) { Copy-Item .env.example .env.local }
npm test
npm run dev
```

In macOS/Linux use `cp .env.example .env.local`. On Windows, use `npm.cmd` if PowerShell blocks npm scripts. Open the localhost URL printed by Vite. Click **Send sample batch** three times, waiting for each update. Expand **Meeting state JSON** to see the full response. Mock mode matches the included sample phrases and timestamps. Other transcript text appears as quoted test input in mock mode, without inferred tasks. The mock does not contact Google.

| Batch | Expected state |
| --- | --- |
| 1 | Launch node with June 12 decision, Priya's checklist task, zero edges |
| 2 | Same launch ID with invite-only beta summary, Instagram node, one edge, Sam's campaign task added |
| 3 | Same two node IDs and one edge, launch summary adds the 50-person limit, same two tasks |

Exact expected JSON for each batch is exported as `demoStates` in `src/shared/demo.js`. To test the real request path without the frontend, run this from another PowerShell window while Vite is running. Adjust the port if Vite prints a different URL.

```powershell
$body = @{
  newSegments = @(@{ time = 1; speaker = 'Alex'; text = 'We agreed to launch the product on June 12.' })
  previousState = @{ nodes = @(); edges = @(); actionItems = @() }
} | ConvertTo-Json -Depth 6
Invoke-RestMethod -Uri http://localhost:5173/api/process -Method Post -ContentType application/json -Body $body |
  ConvertTo-Json -Depth 6
```

`npm test` runs independently of Vite and covers the three sequential calls, validation, provider errors, quota errors and retry. `npm run build` checks the frontend production build. The local Vite middleware calls the same handler that Vercel serves.

Open `.env.local` in VS Code and set `MEETING_MOCK=true` for the sample demo. Save the file. After changing environment settings, press **Ctrl+C** in the terminal and run `npm.cmd run dev` again. Keep the terminal open while using the app. The setup command preserves an existing `.env.local` file and key.

## Enable Gemini

1. Create a Gemini API key in [Google AI Studio](https://aistudio.google.com/app/apikey).
2. Edit .env.local. Set `MEETING_MOCK=false` and paste the key as `GEMINI_API_KEY=your_actual_key`. Keep it out of Git and never put it in a `VITE_` environment variable.
3. Restart `npm run dev`. Repeat the demo or endpoint test. Live wording and IDs may differ from the fixture. Existing IDs should remain stable within the meeting.
4. The default `GEMINI_MODEL=gemini-3.5-flash-lite` supports structured output. Optional `GEMINI_MODELS=gemini-2.5-flash,gemini-2.5-flash-lite` adds ordered quota fallbacks; choose models enabled for your API key. A model that returns HTTP 429 is skipped for 60 seconds (configurable with `GEMINI_QUOTA_COOLDOWN_MS`). If all are limited, the request stays available for retry. Shared quotas can affect every model. Check current model availability and pricing before use. [Models](https://ai.google.dev/gemini-api/docs/models) · [Pricing](https://ai.google.dev/gemini-api/docs/pricing)

## Use local AI with Ollama

Install [Ollama](https://ollama.com/download), open a terminal, and download a model: `ollama pull qwen3:8b`. This model needs several GB of memory; a smaller model may run better on older computers. In `.env.local`, set `MEETING_MOCK=false`, `AI_PROVIDER=ollama`, and `OLLAMA_MODEL=qwen3:8b`. Ollama's default local address is `http://127.0.0.1:11434`; change `OLLAMA_URL` if needed. Start Ollama and then restart Vite. Both mind-map updates and end-of-meeting summaries use the local model, so no Gemini API key or quota is involved. Responses are limited by your computer's memory and speed. Local Ollama works with the development server; it is not reachable from a Vercel deployment. Ollama supports schema-constrained JSON responses used by MICAWS. [Structured outputs](https://github.com/ollama/ollama/blob/main/docs/capabilities/structured-outputs.mdx)

## Integrate in your team app

Copy the four required files and `src/shared/demo.js` into the matching paths. Merge the package dependencies and Vite middleware with your existing app. `src/App.jsx` contains a runnable integration example and a reusable `MeetingResults` component. Swap the sample transcript controls for your transcription developer's recording controls.

The transcription developer appends finalized segments using `setSegments(current => [...current, finalizedSegment])`, with each segment shaped as `{ time: seconds, speaker: nameOrNull, text }`. Pass the full append-only array and recording status to the hook in App.jsx:

```jsx
const { state, error, isProcessing, processPending, reset } =
  useMeetingProcessor(segments, isRecording);

return (
  <>
    {error && <p role="alert">{error}</p>}
    <button disabled={isProcessing} onClick={processPending}>Process pending / retry</button>
    <button onClick={() => { reset(); setSegments([]); }}>Reset meeting</button>
    <MindMap nodes={state.nodes} edges={state.edges} />
    <Dashboard actionItems={state.actionItems} />
  </>
);
```

Mount one hook per meeting. When starting over, reset the hook and clear the transcript together. If the speech recognizer delivers a last finalized segment after recording stops, append it normally. The hook flushes it when it becomes visible.

The Python transcriber in this repository returns `{ id, start, end, speaker, text }`. Convert each finalized chunk before passing it to the hook.

```js
const finalizedSegments = transcriptionResult.map(segment => ({
  time: segment.start,
  speaker: segment.speaker,
  text: segment.text,
}));
setSegments(current => [...current, ...finalizedSegments]);
```

Append each chunk once. Keep transcription IDs in your integration layer to detect repeated chunk delivery. The Python transcription service and microphone controls still need to be connected to this React demo.

The mind-map developer adapts nodes for React Flow in the view layer. For example, use `nodes.map((node, index) => ({ id: node.id, position: { x: (index % 3) * 220, y: Math.floor(index / 3) * 100 }, data: { label: node.label, summary: node.summary, importance: node.importance } }))`. Edges already have React Flow's required id/source/target fields. Preserve positions by ID in the view if you support dragging. The dashboard can render each task's text using its id as the React key.

## Deploy to Vercel

1. Commit the project files and push MICAWS to GitHub. Leave .env.local untracked.
2. In Vercel, import the Git repository. Select the Vite preset, Node.js 22.x, the folder containing package.json as the root, and leave the build command and output at `npm run build` and `dist`.
3. To verify with mock data first, add `MEETING_MOCK=true` in the Vercel project environment settings. To switch to Gemini, set it to `false` and add `GEMINI_API_KEY` and optionally `GEMINI_MODEL`. Ollama must run on a machine reachable from the server; a local Ollama process on your laptop cannot serve a Vercel deployment. Redeploy after variable changes. [Vite on Vercel](https://vercel.com/docs/frameworks/frontend/vite) · [Vercel Node runtime](https://vercel.com/docs/functions/runtimes/node-js)
4. Open the deployment URL and run the sample batches. Repeat the PowerShell endpoint test with the deployed URL. A GET to /api/process should return HTTP 405.

The endpoint has no user authentication. Use mock mode for a public demo unless your team provides access controls to protect the Gemini quota. Use sample data while testing because live mode sends meeting text and prior state to Google. Duplicate semantic topics and factual accuracy still depend on the model. Structural errors and loss of existing graph items fail the request, leaving the last valid state available for retry.

## Your completion checklist

- [ ] Install dependencies and run `npm test` and `npm run build`.
- [ ] Send all three sample batches in mock mode and inspect their JSON.
- [ ] Connect finalized transcription, mind-map nodes and edges, and dashboard tasks.
- [ ] Test recording stop and meeting reset in your team's app.
- [ ] Create a Gemini key, configure it server-side, and try a live batch.
- [ ] Deploy to Vercel, set environment variables, and verify the deployed endpoint.

## Three-level meeting hierarchy

Each node has a required parentId. A nonempty meeting has one root with parentId null and importance 5. Main points reference the root, and details reference a main point. Other nodes use importance 1–4. The tree has at most three levels; it can begin with only the root.

Every non-root node has exactly one edge from its parent, with id "<parentId>-<childId>". Validation rejects cycles, missing parents, extra or missing edges, and changes to an existing parent. The empty initial state remains valid before meaningful speech arrives.

The map places the root above its main points and details. With MEETING_MOCK=true, use the three sample-batch buttons and expand Meeting state JSON to inspect parentId. Use Reset session to start again. Existing flat JSON without parentId is rejected; reset an older in-memory meeting and reprocess its transcript with the new schema.

The original three sample batches keep their requested root/main-point structure. Automated tests also cover a third-level campaign detail. No actual meeting transcript or mockMeeting.js was supplied for an additional meeting fixture.

## Inspect nodes and test typed text

After sending a sample batch, click a map node to open its details. Use Show topic list for keyboard-friendly topic buttons, or Show mind map to return to the visualization. The details panel shows the summary, importance, parent, and direct children. Parent and child buttons navigate between details. Close node details dismisses the panel.

Map connections come from parentId. Nodes and edges cannot be edited or reconnected in the visualization. Zoom, pan, and fit-view controls remain available.

Action items are meeting-wide because the agreed task schema contains only id and text. The UI does not infer task-to-topic assignments.

Expand Dev tools — test text, enter a statement, and choose Send test text. Blank submissions are disabled. Input enters the same queue as the sample transcript, and processing errors appear above the results. Use Process pending / retry after a failure. Reset session clears the queued text and the details panel.

With MEETING_MOCK=true, arbitrary text appears verbatim as a quoted mock topic. This verifies the request and display flow without an API key. With MEETING_MOCK=false, Gemini analyzes the text using the configured server-side key. Sample batches and typed text can be used in the same mock session.

Voice recording uses the microphone hook and AudioWorklet chunk capture. The sample buttons and typed input also let you test the meeting UI independently of microphone hardware.

The automated UI test uses jsdom to exercise typed submission, a failed request and retry, view switching, details navigation, and reset confirmation. React Flow can emit layout/style warnings in this simulated environment because it does not calculate browser layout. Check the visual map in a browser when reviewing styling changes.

## Run with Docker Compose

Install Docker Desktop with WSL 2 support, start it, then open a terminal in MICAWS. Ensure .env.local exists (copy .env.example if needed). Choose MEETING_MOCK=true for the sample demo or configure the Gemini key for live processing.

Run:

```powershell
docker compose up --build -d
docker compose ps -a
docker compose logs --tail=50
```

Open http://localhost:5173. The frontend remains running. The transcription service runs WhisperX on port 8000. Wait for Application startup complete in its logs. The diart service only verifies its import, prints "diart ready", and exits; it does not start an audio API.

Stop the project with `docker compose down`. Local environment files are excluded from image builds, and Compose loads .env.local into the frontend container at runtime. Recreate the frontend after changing environment settings with `docker compose up -d --force-recreate frontend`.


## Live microphone integration

This merged version captures microphone audio in 10-second chunks and updates the transcript and meeting state while recording. See LIVE_TRANSCRIPTION.md for startup instructions and limitations. Main's map styles, focus navigation, manual input, sample meetings, and Docker files are preserved. Run the Python transcription server separately from Vite; Docker Compose now includes a dedicated transcription service.


## Automated recording checks

Run `npm.cmd test` to exercise recording without a real microphone, audio file, Python service, or Gemini key. The audio doubles emulate AudioContext, AudioWorkletNode, microphone permission, and transcription responses.

The recording integration test mounts the actual App and microphone hook. It verifies start/stop controls, timestamp conversion, accumulation across recordings, transcription and processing retries, and reset while transcription is pending. Lower-level tests cover WAV chunks, permission denial, unsupported APIs, worklet startup failure, delayed microphone permission, malformed responses, and stop timeouts.

If the audio worklet cannot acknowledge stop within five seconds, capture resources are released and a visible message explains that the final chunk could not be recovered. Previously queued audio can still complete or be retried. These automated checks validate lifecycle and data flow; actual recognition accuracy and microphone hardware still require a live test.

## Python version for local development

Use Python 3.11 for local Windows development. WhisperX currently requires Python >=3.10 and <3.14, so Python 3.14 cannot install the current release. The repository's diart Docker image uses its own Python 3.10 runtime, independently of Windows.

Keep WhisperX and diart in separate environments. diart 0.9.2 requires NumPy below 2, while current WhisperX requires NumPy 2.1 or newer. Installing both into one environment creates conflicting requirements. The diart Dockerfile also pins a different PyTorch stack.

On Windows, explicitly select the installed interpreter:

```powershell
py -3.11 --version
py -3.11 -m venv .venv-whisperx
..venv-whisperxScriptspython.exe -m pip install -r backend/requirements.txt
..venv-whisperxScriptspython.exe -m uvicorn backend.main:app --host 127.0.0.1 --port 8000
```

WhisperX also requires FFmpeg available on PATH and downloads model files when first used. In VS Code, run **Python: Select Interpreter** from the Command Palette and select .venv-whisperx/Scripts/python.exe.

Use the existing Dockerfile.diart for the separate diarization environment. If developing diart directly on Windows, create .venv-diart with `py -3.11 -m venv .venv-diart` and install its own compatible dependency stack there.

The .python-version file records the project choice for tools that support it. The Windows launcher still needs `py -3.11` to select this version explicitly.

Sources: [WhisperX package](https://pypi.org/project/whisperx/), [WhisperX dependency metadata](https://github.com/m-bain/whisperX/blob/main/pyproject.toml), [diart 0.9.2 dependencies](https://github.com/juanmc2005/diart/blob/v0.9.2/setup.cfg).
