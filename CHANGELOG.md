# Changelog

All notable changes to this project are documented here.

This project follows the spirit of Keep a Changelog and uses semantic versioning once public releases begin.

## Unreleased

### Added

- Short-lived app, user, origin, capability, expiry, and use-bound browser runtime tokens.
- Per-app quotas, privacy policies, retention sweeps, data export, purge, and per-user deletion.
- Reviewed workflow target bindings, stale-map invalidation, structured locator reconciliation, and action-result verification.
- Push-to-talk, resilient Gemini Live session refresh, explicit screen sharing, Qwen TTS, and optional LiveKit token support.
- Live host-SDK readiness evidence, version-level paginated UI-map reads, and production readiness checks.
- Versioned SQLite migrations, persistent generated audio, graceful shutdown, security headers, and non-root Docker execution.
- Open-source governance, release, operations, API, SDK, security, database, and troubleshooting documentation.
- Dependency updates, license attribution, Dependabot configuration, and CI container smoke tests.

### Changed

- Reworked the console around app activation, route selection, selector review, workflow safety review, SDK handoff, runtime logs, usage, privacy, and admin operations.
- Redesigned the end-user assistant panel with theme support, accessible controls, clear privacy state, and reduced-motion behavior.
- Reduced initial console JavaScript through route-level loading and removed per-page UI-map request fan-out.
- Minimized persisted runtime data and made execution telemetry event-only by default.
- Rebranded and consolidated the SDK demo into one attributed sample application.

### Security

- Removed reusable API credentials from browser integration paths.
- Enforced production CORS, secret length, origin binding, scope/capability checks, SSRF-resistant scanner navigation, upload signatures, and request/response limits.
- Kept sensitive workflow fields manual-only and required explicit consent for full diagnostics or unredacted screen sharing.

### Removed

- Stale product screenshots and architecture images, duplicated demo sources, unused brand assets, internal critique artifacts, and dead legacy SDK UI/cursor modules.
