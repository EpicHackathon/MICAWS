# Saved meetings and partner integration

This milestone adds a separate authenticated workspace at `/workspace`. The existing `npm run dev` microphone demo remains available at `/`; it does **not** acquire persistence automatically. The production Node server redirects `/` to `/workspace` and does not expose the old unauthenticated AI endpoints.

## Try the interface without keys or infrastructure

Use Node **22.12 or later in the 22.x series**, then in the VS Code terminal:

```powershell
npm.cmd ci
npm.cmd run build
npm.cmd run demo:saved
```

Open `http://127.0.0.1:8081/workspace`, select **Open sample workspace**, then **Launch planning**. Try a source link, correct a transcript passage, search for the corrected word, change a task's progress, resolve a question, and open the related meeting. Corrections autosave after one second without typing. A confirmed human decision remains protected even if its source is corrected; it will show that its old source no longer matches.

This is a localhost-only, synthetic, in-memory demo. Data disappears when it stops. It uses a PostgreSQL emulator, not a real database. “Ask this meeting” and translation are deliberately unavailable in mock mode. Never expose this demo server publicly or put real meeting data in it. Press Ctrl+C to stop it.

## Start persistent storage

You need Docker Desktop (running Linux containers), or a separately managed PostgreSQL server. Nothing here installs system software automatically.

1. Copy `pilot.env.example` to `.env.pilot`. Keep that file private.
2. Generate **three different** random values with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`. Use them for `POSTGRES_PASSWORD`, `SESSION_SECRET`, and the service credential's `key`. Use hex for the database password so it is safe in the example connection URL.
3. Set `SERVICE_CREDENTIALS` to the organization ID and key for your partner backend. Never place this key in the browser, a `VITE_` variable, or an embed URL.
4. Keep `AI_PROVIDER=mock` initially. Set `APP_ORIGIN=http://localhost:8080` locally. Set `EMBED_ORIGINS` to exact approved parent origins; leave it blank if there is no embedding.
5. Run:

```powershell
docker compose --env-file .env.pilot -f compose.pilot.yaml up --build -d
```

Open `http://localhost:8080/workspace`. The production container includes the API, bounded worker pool, built React assets, and private PostgreSQL connection. The database has a persistent Docker volume. Neither PostgreSQL nor a model server is published by this Compose file.

Without Docker, configure `DATABASE_URL`, load the other settings into the process environment, run `npm run build`, then `node --env-file=.env.pilot server/main.js`. Use `server/main.js api` and `server/main.js worker` for separate processes; each applies the initial idempotent schema. Worker concurrency defaults to two, configurable up to ten.

For local UI development, run the saved API on port 8080 and Vite separately; `/workspace` uses Vite's `/api/v1` proxy. Add the Vite origin to `EMBED_ORIGINS` for development. `SAVED_API_URL` can override the proxy target. Do not refresh or replace an existing microphone-demo page with pending audio.

## Connect your partner backend

Import `createMicawsClient` from `sdk/client.js` in the partner's **server code**. The customer's application must authenticate its users and check their membership before issuing sessions; this project does not supply a separate password/account system.

```js
import { createMicawsClient } from './sdk/client.js';
const micaws = createMicawsClient({
  baseUrl: process.env.MICAWS_URL,
  token: process.env.MICAWS_SERVICE_KEY,
});
const meeting = await micaws.create({ title: 'Product review', series: 'Product team' });
const browserSession = await micaws.issueSession(meeting.id, 'editor');
// Return browserSession to the authorized user, never the service key.
```

Sessions expire after 15 minutes. `viewer` sessions cannot modify meetings or invoke paid AI questions. `editor` sessions can. A meeting ID restricts the session to that meeting. Passing `null` explicitly grants access to the organization's library; issue that only to users entitled to that organization-wide access. Organizations are isolated on every query. There is no cross-organization sharing.

For standalone testing, paste a **browser session token** into the connection form. Do not paste a service key. Tokens remain in memory; after refresh, reconnect. The previous selected meeting is restored if it is still accessible.

## Embed and brand

The partner's frontend imports `embedMicaws` from `sdk/embed.js`:

```js
const workspace = embedMicaws({
  container: document.getElementById('meeting-workspace'),
  workspaceUrl: 'https://meetings.example.com/workspace',
  getSession: () => fetch('/your-backend/authorized-meeting-session').then(r => r.json()),
});
// Call workspace.destroy() when the parent view unmounts.
```

The helper verifies message origin and source, sends tokens only to the exact workspace origin, and renews the session every 12 minutes. Configure the parent origin in `EMBED_ORIGINS`; frame restrictions are enforced by CSP. Set `BRAND_NAME` for the displayed company name. Arbitrary HTML, CSS, or logo URLs are not accepted. The iframe title and sizing can be customized through the returned iframe element. Serve both pages over HTTPS outside localhost.

## Transcript input, corrections and recovery

```js
const current = await micaws.get(meeting.id);
const operationId = crypto.randomUUID();
await micaws.command(meeting.id, current.revision, {
  type: 'segments',
  segments: [{ id: 'segment-0001', revision: 1, time: 0, end: 8,
    speaker: 'Alex', text: 'We agreed to launch on Friday.' }],
}, operationId);
```

Keep each segment ID stable, and increase its revision when correcting it. Times are seconds on the recording timeline. Delayed arrivals are sorted by time and ID. An older revision is ignored; an identical revision/text is a no-op; different text at an already-used revision is rejected. Reuse the same operation ID for retries after an uncertain response. Receipt records prevent replaying an accepted command, including a manual map edit.

All mutations require the current meeting revision through `If-Match`. A conflict returns 409; fetch the latest meeting and review the change before retrying. Do not silently overwrite a different user's correction. The browser encrypts each pending command before sending it. Its recovery key is available only after editor authorization for that meeting. Accepted commands are committed before acknowledgment. Original and corrected segment versions are **not** retained as a full audit history: the latest segment revision replaces prior text.

Pending drafts survive browser refresh in encrypted local storage, assuming the browser permits storage. Reconnect to the same meeting, inspect **Pending change**, and retry or discard it. Transcript retries can use the latest meeting revision because each segment has its own revision check. Conflicting map changes require manual reconciliation. Rotating `SESSION_SECRET` makes old encrypted drafts unrecoverable; finish saving drafts first. Unsaved keystrokes during the one-second debounce and in explicit-submit forms are not guaranteed to survive a tab crash. Recording uploads do not use the encrypted text outbox.

## Evidence, questions and history

- Each generated map node, task, and summary point needs an exact quote plus a segment ID and revision. Unknown sources or invented quote text reject the AI update. Clicking a map topic or **Source** button opens its passage; a loaded aligned recording seeks to that time.
- A matching quote proves provenance, **not** that an AI inference is correct. Users must verify meaning. Manual content can have no citation; attach one explicitly. Correcting a passage invalidates its stale citations and translations immediately and queues reassessment. Protected manual edits and confirmed decisions remain untouched.
- Search uses Unicode keyword matching in the current transcript. “Ask this meeting” uses the configured AI provider, returns validated quote references, and returns an insufficient-evidence response when no sources are supplied. Answers are rejected if the meeting changes during generation. It does not search other meetings or the web.
- AI decision classifications are suggestions until reviewed. Humans can add confirmed decisions, proposals, and questions, resolve/reopen questions, and mark tasks open/in progress/done.
- Use the same exact **Series / project** value to connect meetings. History lists their decisions, question status and task progress. A new decision can explicitly replace a confirmed decision in another meeting in that series. No automatic semantic claim of equivalence or cross-meeting change is made. The library currently lists the most recent 200 meetings.

## AI and recording configuration

For Gemini set `AI_PROVIDER=gemini`, `ALLOW_EXTERNAL_AI=true`, `GEMINI_API_KEY`, and a `GEMINI_MODEL` available to your account. Optional `GEMINI_MODELS` is an ordered quota-only fallback within Gemini. Shared provider quotas can still block all models. The configured cooldown is not a prediction of a daily quota reset.

For local models set `AI_PROVIDER=ollama`, `OLLAMA_URL` and `OLLAMA_MODEL`. There is no silent switch between external and local providers. Full transcript/context is sent to the configured provider. `AI_DAILY_CALL_LIMIT` bounds attempted provider calls per organization/day in PostgreSQL; it is **not** a dollar budget. Output and request durations are bounded. Tune the limit and provider billing controls together.

To save recordings configure a private S3-compatible bucket with encryption enabled, restricted credentials/role, and the variables in `pilot.env.example`. WAV uploads are capped at 64 MiB. The file must start at the same time zero as transcript timestamps. Playback is authenticated; no public object URL is returned. The browser loads the authorized recording into a temporary blob URL, revoked when it is replaced or the workspace disconnects. Source document persistence and automatic microphone-to-saved-workspace upload are not part of this milestone; a partner supplies transcripts and may upload the aligned recording. The existing local microphone/document workflow is unchanged.

## API quick reference

Every endpoint except health/readiness/config requires `Authorization: Bearer ...`. JSON input is capped at 1 MiB. Identifiers use UUIDs for meetings and safe alphanumeric/underscore/hyphen IDs for transcript segments. Transcript limits: 2,000 segments, 200,000 total characters, 2,000 characters per segment, timestamps through two hours. Accepted corrections after finishing require reopening first.

| Endpoint | Purpose |
| --- | --- |
| `GET /health`, `GET /ready` | Process liveness / database reachability (not AI readiness) |
| `GET /api/v1/config` | Public brand and allowed embed origins |
| `GET /api/v1/session` | Current authorization scope |
| `POST /api/v1/sessions` | Service-key-only browser session issuance |
| `GET, POST /api/v1/meetings` | List / create within the authorized organization |
| `GET, DELETE /api/v1/meetings/:id` | Load / delete meeting |
| `POST /api/v1/meetings/:id/commands` | Revision-checked mutation; optional UUID `Idempotency-Key` |
| `GET /api/v1/meetings/:id/events?after=0` | SSE revisions with persistent event IDs; reconnect using cursor |
| `GET /api/v1/meetings/:id/search?q=...` | Transcript search |
| `POST /api/v1/meetings/:id/ask` | `{question}` → `{answer,citations}` |
| `GET /api/v1/meetings/:id/export` | Authorized JSON export |
| `GET, PUT /api/v1/meetings/:id/recording` | Private WAV download / upload (PUT requires If-Match) |
| `GET /api/v1/meetings/:id/recovery-key` | Editor-only encrypted draft recovery key |

Commands are `segments`, `edit` (complete valid map state), `metadata`, `decision`, `task`, `evidence`, `finish`, `reopen`, and `retry`. Exact schemas live in `src/shared/savedMeeting.js`. SSE uses authenticated fetch instead of putting tokens in URLs. Reconnect fetches the authoritative meeting; the stream only announces revisions.

## Operations and release checks

Default retention is 30 days from creation (configurable to 1–365 days). Expired meetings immediately fail access checks. A periodic sweep removes their database records and queues object deletion. Explicit deletion also queues recording cleanup. Failed object deletions are retried; crash-abandoned uploads have a one-hour cleanup grace period. Backend deletion cannot revoke previously downloaded exports or recordings. Browser encrypted drafts stay on that device until saved/discarded or browser storage is cleared.

Terminate TLS at the customer's reverse proxy; forward authorization and SSE without response buffering. Keep databases/model servers private. Restrict access to environment files, backups and logs. Logs include request ID, method, status and elapsed time, without meeting bodies or credentials. Rotate organization service keys as needed; browser sessions expire after 15 minutes. Session-secret rotation invalidates all browser sessions and pending draft recovery keys.

Back up PostgreSQL and the object bucket together, encrypted. Use `pg_dump --format=custom` against the configured database; restore with `pg_restore` into a **new isolated database**, start a copy of the matching application image, and verify meeting access, evidence, and recordings before adopting it. Backup retention and deletion of older object versions must be configured separately; application deletion does not purge customer backups. Keep the prior image for rollback. This initial schema is additive; future destructive migrations require their own reviewed migration and backup plan.

Validation commands:

```powershell
node --test --test-concurrency=1
npm.cmd run build
python -m unittest discover -s test -p backend_transcription_test.py
```

By default the new persistence tests use `pg-mem`; this is not evidence of real PostgreSQL durability or locking. Set `MICAWS_TEST_DATABASE_URL` to a dedicated test database to run them against PostgreSQL and enable the lease-concurrency check. Tests create and delete uniquely named schemas inside that database. CI configures PostgreSQL 17, Node 22, build checks, production dependency audit, and the stubbed Python test. CI has not been run merely by adding its workflow.

Not yet certified for a paid production pilot: measure ten concurrent two-hour sessions, 95th-percentile update latency, provider costs and language accuracy on customer hardware; exercise real S3 uploads/deletion, backup restoration, process crashes, and partner identity integration. No deployment, external AI requests, real recordings, or pushes are performed by this milestone. The implementation is an integration candidate, not a guarantee of production readiness.
