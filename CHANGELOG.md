# Changelog

All notable changes to Mia are documented here. The project follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and semantic versioning.

## Unreleased

### Fixed

- Enforced typed host-action effects, synonym-resistant prohibited-operation policy, manual-action non-execution, and administrator-reviewed UI policy across rescans.
- Added strict final judgment for grounded answers, append-only action attempts with completed no-op replay, exact route verification, and cross-origin link defense.
- Revoked other administrator sessions on password change, bound runtime events to their host user, and pinned UI scans against DNS rebinding.
- Synchronized administrator redaction selectors into every SDK observation, kept page titles private by default, and excluded document-head text.
- Corrected contenteditable verification, safe Space/Escape handling, cursor hotspot geometry, mobile assistant controls, and audio walkthrough uploads.

## 1.0.0 - 2026-07-10

### Added

- One persisted Gemini observe-reason-act-verify agent for text and voice.
- Semantic DOM and accessibility observation with open shadow-root and same-origin frame traversal.
- A separate visible Mia cursor for pointing, highlighting, scrolling, and guided navigation.
- Guarded DOM actions and reviewed JSON-schema host actions with idempotency keys and structured receipts.
- Exact confirmation binding for reversible changes, including voice approval.
- PostgreSQL and pgvector persistence with hybrid full-text and vector retrieval.
- SSRF-protected documentation crawling, Markdown/text/PDF ingestion, Playwright UI scanning, and reviewed recording-to-skill generation.
- Session revisioning, reload continuation, cancellation, verification, loop detection, three-failure recovery, and a 24-step ceiling.
- Gemini Live voice with `Aoede`, open microphone, interruption, reconnection, and hold `Control+Space` push-to-talk.
- Single-product administrator console with Setup, Overview, Knowledge, Skills, Actions & Safety, Test Mia, Runs, and Settings.
- Runtime diagnostics for transcripts, model decisions, evidence, approvals, receipts, timing, token use, and errors.
- Docker Compose deployment with pgvector PostgreSQL, persistent uploads, health/readiness checks, and secure first-run setup.
- Framework-neutral ESM SDK package and a Next.js CRM integration with real reversible host actions.

### Changed

- Replaced classifier routing and fixed workflow execution with model reasoning constrained by deterministic policy and validation.
- Replaced SQLite and LanceDB with PostgreSQL full-text search and pgvector.
- Unified text and voice on the same backend session, context, policies, receipts, and final judgment.
- Reworked recordings into reviewed agent skills rather than brittle execution scripts.
- Reduced the end-user assistant to transcript, input, microphone, stop, progress, and contextual confirmation/input controls.
- Made live SDK observations the runtime source of truth while retaining UI maps as semantic memory and policy metadata.
- Set every release component to version `1.0.0`.

### Security

- Added origin-bound, capability-bound, expiring runtime tokens and hashed administrator/integration credentials.
- Added encrypted Gemini and scanner secrets, required production CORS origins, and secure setup-token handling.
- Added browser and backend redaction for credentials, payment data, configured private regions, and diagnostic payloads.
- Added target allowlisting, prompt-injection boundaries, schema validation, confirmation binding, and receipt verification.
- Blocked delete, send, publish, approve, payment, transfer, external communication, and irreversible submission operations in v1.

### Removed

- Multi-app, invitation, environment, and multi-tenant concepts.
- Legacy resolver unions, `appId`, `/runtime/resolve`, workflow execution APIs, and compatibility behavior.
- OpenAI embeddings, Qwen TTS, LiveKit, SQLite, LanceDB, and their deployment configuration.
- Default credentials and legacy console pages for API keys, logs, usage, workflow scripts, and per-app UI maps.
