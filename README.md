# MICAWS

MICAWS is a meeting workspace that turns speech and typed meeting text into a transcript, an editable mind map, action items, and a summary. Use it during a meeting to organize the discussion, or revisit a saved meeting to see what was decided and where it came up.

| Workspace | What you can do |
| --- | --- |
| **Live meeting** at `/` | Record from your microphone, type meeting text, attach PDF, PowerPoint, or text files, edit the mind map, translate the transcript, and play back or download a WAV recording. |
| **Saved meetings** at `/workspace` | Reopen meetings, correct transcripts, follow source links, track decisions and tasks, and review related meetings. With a configured AI provider, ask questions and get answers that cite the transcript. |

Live recordings and attachments stay in browser memory. The saved workspace uses PostgreSQL for persistence. Partner integrations can submit transcripts and upload recordings that match the transcript timestamps.

## Quick start

Use Node.js 22.12 or later in the Node 22 series. If you already have the repository open, run `npm ci` from its root. For a fresh checkout, run:

```bash
git clone https://github.com/EpicHackathon/MICAWS.git
cd MICAWS
npm ci
```

### Try the saved workspace

```bash
npm run build
npm run demo:saved
```

Open <http://127.0.0.1:8081/workspace>, select **Open sample workspace**, and open **Launch planning**. Use <http://127.0.0.1:8081/?dev> to try the live workspace on the same server. Try correcting a transcript passage, following a source link, or changing a task’s progress.

The demo uses synthetic data and in-memory storage. You can run it without a microphone, API keys, or a PostgreSQL server. Changes disappear when you stop the demo.

### Try the live workspace

If you don’t already have a `.env.local` file, create one from the [example](.env.example). In Bash or WSL:

```bash
cp -n .env.example .env.local
npm run dev
```

With `MEETING_MOCK=true`, open <http://localhost:5173/?dev> and select **Send sample batch** to see how the map updates.

To process your own meeting text, set `MEETING_MOCK=false` and configure a provider in `.env.local`.

| Provider | Settings |
| --- | --- |
| Google Gemini | Set `AI_PROVIDER=gemini`, `GEMINI_API_KEY`, and `GEMINI_MODEL` to a model available to your account. |
| Ollama | Start Ollama, download a model, and set `AI_PROVIDER=ollama` and `OLLAMA_MODEL`. Set `OLLAMA_URL` if Ollama runs at a different address. |

Restart Vite after changing `.env.local`. The selected provider receives meeting text and extracted text from attached documents when processing them. Keep API keys out of Git and browser-side `VITE_` variables.

### Enable microphone transcription

Install Python 3.11 and FFmpeg. From the repository root, run the transcription service in a second terminal. On Linux, macOS, or WSL:

```bash
python3.11 -m venv .venv-whisperx
source .venv-whisperx/bin/activate
python -m pip install -r transcription/requirements.txt
python -m uvicorn transcription.main:app --host 127.0.0.1 --port 8000
```

Wait for **Application startup complete**, then allow microphone access in the live workspace. The first startup may download model files. The browser sends ten-second audio chunks to WhisperX and adds the returned speech segments to the transcript. [Live transcription guide and Windows setup](LIVE_TRANSCRIPTION.md)

### Try experimental live captions

Choose **Live captions (experimental)** in **Transcription mode** before recording.
Standard mode sends 10-second chunks. The experiment sends new audio every 1.5 seconds,
with up to 3 seconds of preceding context. Draft captions may change while WhisperX
works. Finalized lines feed the mind map and summary. See the
[live transcription guide](LIVE_TRANSCRIPTION.md#compare-the-experimental-caption-mode)
for a comparison checklist and optional word alignment.

## Project structure

| Directory | What lives there |
| --- | --- |
| [`src/`](src/) | React 19 and TypeScript UI, React Flow and Dagre mind maps, browser audio, and shared Zod schemas |
| [`api/`](api/) | Live endpoints for mind-map updates, summaries, and translation using Gemini or Ollama |
| [`server/`](server/) | Node.js, Express, and TypeScript saved-meeting API, background worker, PostgreSQL schema, and optional S3-compatible recording storage |
| [`transcription/`](transcription/) | Python FastAPI and WhisperX transcription service, plus optional Diart tooling |
| [`sdk/`](sdk/) | TypeScript client and iframe embedding helper for partner applications |
| [`scripts/`](scripts/) | Saved-workspace demo and Windows transcription launcher |
| [`test/`](test/) | Node and Python tests for the UI, audio processing, APIs, and saved meetings |

## Persistent setup and deployment

Express serves the React build and saved API. The Node backend uses the `pg` driver to access PostgreSQL. The live routes also run in Express during Vite development.

For self-hosting both screens at one address, set `ENABLE_LIVE_WORKSPACE=true` and point `TRANSCRIPTION_URL` at a reachable WhisperX service. Enable the live routes on a trusted network or behind access controls because they accept requests without a saved-workspace session.

The saved workspace can run with PostgreSQL using Docker Compose or a separately managed database. Start with [`pilot.env.example`](pilot.env.example) and follow the [saved-workspace guide](docs/SAVED_WORKSPACE.md) for configuration, authentication, recording storage, and partner embedding. [Docker Compose configuration](compose.pilot.yaml)

The [Vercel configuration](vercel.json) covers the Vite frontend and live AI endpoints. The saved-meeting API and worker, and the Python transcription service, need hosting that supports long-running processes. [Validation and deployment notes](docs/VALIDATION.md)

## Development checks

```bash
npm test
npm run build
python -m unittest discover -s test -p backend_transcription_test.py
```

The build type-checks the application and server before bundling the UI. To include PostgreSQL integration tests, set `MICAWS_TEST_DATABASE_URL` to a disposable PostgreSQL test database. [GitHub Actions workflow](.github/workflows/verify.yaml)

## License

[MIT](LICENSE)
## In-page instructions

Both workspaces include a collapsible **How to use this workspace** guide near
the top. Each topic includes jump links to the relevant controls. Links reveal
collapsed sections and move keyboard focus; unavailable controls are labeled.
Navigation does not start recording, submit forms, or discard pending work.
Future functionality changes must update this guide and the README together.

Use the package scripts (`npm start`, `npm run worker`, `npm run demo:saved`)
to launch TypeScript services with the required runtime loader. Saved transcript
retries use structural JSON comparisons to avoid PostgreSQL key-order conflicts.
Generated results still undergo strict local validation of citations, bounds,
and protected edits. Provider request allowances are not dollar spending limits.
