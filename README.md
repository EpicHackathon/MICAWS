# MICAWS

React holds the finalized transcript and the latest valid meeting state. The hook sends only the next unprocessed slice and the prior state to the same-origin API. The API validates both, calls Gemini with structured JSON enabled, validates the complete update, and returns it. The hook replaces its state and advances its transcript cursor only after success.

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

In macOS/Linux use `cp .env.example .env.local`. On Windows, use `npm.cmd` if PowerShell blocks npm scripts. Open the localhost URL printed by Vite. Click **Send sample batch** three times, waiting for each update. Expand **Meeting state JSON** to see the full response. Mock mode matches the included sample phrases and timestamps. Other transcript text leaves the state unchanged. The mock does not contact Google.

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
4. The default `GEMINI_MODEL=gemini-3.5-flash-lite` supports structured output and has listed free-tier pricing. Check model availability and project quotas before the demo. Keep your Google project on the free tier if you need to avoid charges. [Model details](https://ai.google.dev/gemini-api/docs/models/gemini-3.5-flash-lite) · [Pricing](https://ai.google.dev/gemini-api/docs/pricing)

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
3. To verify with mock data first, add `MEETING_MOCK=true` in the Vercel project environment settings. To switch to Gemini, set it to `false` and add `GEMINI_API_KEY` and optionally `GEMINI_MODEL` in the desired environments. Redeploy after variable changes. [Vite on Vercel](https://vercel.com/docs/frameworks/frontend/vite) · [Vercel Node runtime](https://vercel.com/docs/functions/runtimes/node-js)
4. Open the deployment URL and run the sample batches. Repeat the PowerShell endpoint test with the deployed URL. A GET to /api/process should return HTTP 405.

The endpoint has no user authentication. Use mock mode for a public demo unless your team provides access controls to protect the Gemini quota. Use sample data while testing because live mode sends meeting text and prior state to Google. Duplicate semantic topics and factual accuracy still depend on the model. Structural errors and loss of existing graph items fail the request, leaving the last valid state available for retry.

## Your completion checklist

- [ ] Install dependencies and run `npm test` and `npm run build`.
- [ ] Send all three sample batches in mock mode and inspect their JSON.
- [ ] Connect finalized transcription, mind-map nodes and edges, and dashboard tasks.
- [ ] Test recording stop and meeting reset in your team's app.
- [ ] Create a Gemini key, configure it server-side, and try a live batch.
- [ ] Deploy to Vercel, set environment variables, and verify the deployed endpoint.
