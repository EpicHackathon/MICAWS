# Skills validation — November 18, 2026

## Confirmed fixes

- PostgreSQL JSONB key ordering no longer causes duplicate transcript conflicts or rejects unchanged prefixes when new segments arrive during processing.
- Draft recovery tests wait for observable completion of asynchronous encryption/decryption instead of assuming React `act()` finishes native WebCrypto work.
- The TypeScript migration now has consistent test, server, worker, demo and container launch commands. `tsx` is a production dependency; the container build copies `tsconfig.json`. UI tests use the migrated entrypoint, which retains the local workspace help.
- Gemini receives a compact generation schema. Strict local schemas and evidence/manual-edit checks still validate responses. SDK transport tests verify no implicit retry, quota fallback, and exhausted-model cooldown.

## Checks in this run

- Windows Node 24.16.0 with **real PostgreSQL 17**: 102 tests passed, zero failed/skipped before the final schema regressions were added.
- Final schema and SDK regressions: 4 tests passed, using mocked transport (no paid requests).
- TypeScript checking and Vite production build passed; existing bundle-size and dependency annotation warnings remain.
- Python 3.11.9: one transcription unit test passed with a stub model, not actual WhisperX audio.
- `npm ci`: audit reported zero vulnerabilities after synchronizing the merged lockfile.
- Final full suite on **Linux Node 22.23.5 + PostgreSQL 17**: **104 passed, 0 failed, 0 skipped** (`npm test`). Log: ignored `.cache/skills-node22-tests.log`.
- Final production image built successfully. Isolated container returned `/ready` 200, `/workspace` 200 and unauthenticated `/api/v1/meetings` 401. AI mode was mock.
- Created one synthetic meeting through the container API; custom-format PostgreSQL backup restored into a separate new database. Verified restored row count and meeting title. This did not exercise S3 or customer backup infrastructure.
- Full `npm audit --audit-level=high`: zero reported vulnerabilities.

## Live AI evaluation: blocked

Four synthetic requests were sent to the configured `gemini-3.5-flash-lite` model, within the approved five-request/$1 envelope. Three requests returned HTTP 400: the generation schema exceeded provider grammar complexity. After simplifying the schema, the fourth returned HTTP 503 (high demand). No further live retries were made. No usable generated outputs or token usage were returned, so semantic quality, translation quality and actual billed cost were not established.

The harness capped each request at 100,000 input bytes and 12,000 output tokens; the conservative estimate for all five authorized calls was under $1 using [Google's published rates](https://ai.google.dev/gemini-api/docs/pricing/). This is a budget estimate, not a billing statement. Sanitized local diagnostics are in ignored `.cache/live-evaluation-results.json` (last attempt).

## Skill outcomes and remaining release gates

- Integration/security: automated authorization isolation, expired credentials, retained-input recovery, corrections, stale responses, durable leases and deletion are covered. This is not an independent penetration test.
- UI: migrated component interaction tests pass. Fresh browser visual/keyboard checks were blocked because the desktop tool denied access to Microsoft Edge. The prior milestone's visual observations below are historical, not a new check.
- Deployment: container build and isolated smoke results are listed below. An isolated PostgreSQL backup/restore drill passed for a synthetic meeting; customer hosting/TLS, real S3 and combined object/database recovery, customer identity integration and production crash recovery remain unverified.
- AI evaluation: blocked by provider failures; no semantic-quality pass claimed.
- Release: a test-fix integration milestone only. Ten concurrent two-hour meetings, p95 latency, real multilingual evaluation and actual WhisperX audio remain required before pilot release.

No deployment to customer infrastructure or push is included.

---

## Previous milestone evidence (historical)

# Saved-workspace validation — November 17, 2026

## Verified locally

- `node --test --test-concurrency=1`: **99 tests, 98 passed, 0 failed, 1 skipped**.
- New feature coverage includes segment deduplication/corrections, exact-quote validation, organization/meeting/role isolation, token expiry/tampering, encrypted draft recovery, database repository operations, stale result/lease rejection, bounded retries, retention cleanup, idempotent command replay, insufficient-evidence answers, and reserved identifier rejection.
- The React component test simulates a successful server save followed by a lost response, remounts the workspace, and verifies recovery without duplicate changes.
- `npm run build`: passed. Existing large-bundle and dependency annotation warnings remain.
- Python transcription unit test: **1 passed**, using a stub model. No real WhisperX model was invoked.
- `npm audit --omit=dev --audit-level=high`: **0 reported vulnerabilities**.
- Browser smoke check against the synthetic localhost demo: connected to library, opened a meeting, autosaved Friday → Monday as transcript revision 2, observed updated mock highlights, and followed an evidence link at a 390px mobile viewport. Desktop layout also inspected. This was not a full accessibility audit.
- A pre-existing real-time batching test flaked under CPU load; it now uses a controlled clock and passes without changing application behavior.

Local JavaScript checks ran on **Node 24.16.0**. The project specifies **Node 22.x**; the added CI workflow targets Node 22 but has not run in this session.

## Not verified / release gates

- Local persistence checks use **pg-mem**, not an actual PostgreSQL server. The real PostgreSQL lease-concurrency test is skipped without `MICAWS_TEST_DATABASE_URL`. CI supplies PostgreSQL 17 and runs it; adding the workflow is not evidence of a successful CI run.
- Docker image/Compose startup, real S3 uploads/playback/deletion, database backup restoration, process-crash recovery on actual PostgreSQL, and partner identity integration need deployment-environment checks.
- External AI calls, real multilingual quality, real recordings, ten concurrent two-hour meetings, 95th-percentile latency, and provider costs were not measured. The fixture provider does not simulate AI reasoning or translation quality.
- The full dependency audit reports four high-severity entries in the Vite development dependency chain associated with picomatch (GHSA-fc5q-39xc-vjpf). No forced major-version downgrade was applied. Production dependency audit is clean. Recheck tooling advisories before production build/release.
- Original local microphone capture and document extraction remain separate from the authenticated saved workspace. Partner transcript ingestion and optional aligned WAV upload are supported; automatic migration/upload of an existing browser-memory session is not.

This is a tested integration milestone, **not a production certification**. No deployment, public release, or Git push was performed.
