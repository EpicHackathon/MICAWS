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
