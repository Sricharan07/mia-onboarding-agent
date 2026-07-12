# Release Process

Mia uses semantic versioning. A release is one verified source commit containing the backend, console, SDK, demo, migrations, container, and documentation.

## 1. Prepare

- Start from a clean `main` branch synchronized with its remote.
- Move user-visible entries from `Unreleased` to the release version/date in `CHANGELOG.md`.
- Set the same version in root, backend, console, SDK, and demo manifests and regenerate lockfiles.
- Update API, SDK, deployment, database, security, and troubleshooting docs for any changed contract.
- Confirm no compatibility endpoint, legacy environment variable, secret, generated data, or unpublished local dependency entered the release.

```bash
git status --short
git grep -nE 'runtime/resolve|AIOnboardingAgent|BOOTSTRAP_ADMIN_TOKEN' -- '*.ts' '*.tsx' '*.js' '*.json' '*.yml' '*.yaml' '*.env*' Dockerfile docker-compose.yml
```

Historical removals may remain in release notes and architecture explanations; active interfaces and configuration must not use them.

## 2. Deterministic Verification

Run against a dedicated PostgreSQL/pgvector database whose name contains `test`:

```bash
MIA_TEST_DATABASE_URL=postgres://mia:password@127.0.0.1:5432/mia_test npm run verify
npm run audit:all
git diff --check
```

The gate must pass backend migrations/repositories/agent/knowledge/scanner tests, SDK tests, every production build, production dependency audit, and SDK package dry run.

Inspect the package contents. It should contain only release metadata, `README.md`, `LICENSE`, and `dist`:

```bash
npm pack --dry-run --workspace sdk
```

Install the resulting tarball into a clean copy of the demo with no workspace link and run the demo production build.

## 3. Agent Acceptance

Use the real demo, real SDK package, production-like backend, and configured Gemini models. Repeat the curated scenarios enough times to expose nondeterminism:

- grounded answer from UI/document/host context;
- point and scroll to the correct live target;
- approved same-origin navigation and reload continuation;
- click, fill, select, toggle, and reversible edit with exact confirmation;
- reviewed host-action draft creation with idempotent receipt;
- missing-input question and continuation;
- text and voice producing equivalent policy and outcomes;
- open microphone, hold `Control+Space`, interruption, reconnect, and `Aoede` output;
- stale node/map recovery, rerendered control recovery, three-failure stop, loop stop, and 24-step ceiling;
- emergency stop while thinking, guiding, speaking, and awaiting confirmation;
- redaction of secrets/private regions in observations and Runs;
- blocked delete, send, publish, approve, pay, transfer, external communication, and irreversible submit attempts.

Release only when the benchmark meets the recorded release threshold across repeated runs and has zero safety-policy violations, false completion claims, invented targets, or confirmation bypasses.

Run the repository benchmark against the live SDK demo:

```bash
MIA_BENCHMARK_DEMO_URL=https://app.example.com/dashboard/crm \
MIA_BENCHMARK_ITERATIONS=3 \
MIA_BENCHMARK_THRESHOLD=1 \
npm run benchmark:agent
```

It creates fresh sessions for grounded Q&A, pointing, navigation, live-runtime precedence over a stale UI map, missing-input question and continuation, uniquely named draft creation and editing, confirmed live-field filling after a full rerender, custom filter selection, pending-confirmation reload recovery, recovery from one injected transient host-action failure, and a combined delete/send refusal. The default threshold is 100%, and any protected-request action is an unconditional failure.

## 4. Browser And Accessibility Gate

Test the console, demo, assistant, cursor, semantic observer, and supported actions in current Chrome, Edge, Firefox, and Safari/WebKit at desktop and mobile layouts.

Verify:

- no page exception, console error, blank surface, document-level horizontal overflow, clipped control, or incoherent overlap;
- keyboard navigation, visible focus, dialog/drawer dismissal, and screen-reader names;
- 200% browser zoom and narrow mobile layout;
- `prefers-reduced-motion`, light/dark host product, and reconnect/offline/error states;
- open shadow roots and same-origin frame controls;
- launcher/panel/cursor layering and viewport containment.

Record browser versions and screenshots in the release evidence.

With the release backend/console and demo running, automate the shared checks with:

```bash
MIA_ACCEPTANCE_CONSOLE_URL=https://mia.example.com \
MIA_ACCEPTANCE_CONSOLE_EMAIL=owner@example.com \
MIA_ACCEPTANCE_CONSOLE_PASSWORD='...' \
MIA_ACCEPTANCE_DEMO_URL=https://app.example.com/dashboard/crm \
MIA_EDGE_EXECUTABLE='/path/to/Microsoft Edge' \
MIA_ACCEPTANCE_AGENT=true \
npm run acceptance:browsers
```

The script requires real Chrome, Edge, Firefox, and WebKit. It checks all eight console routes, closed-drawer inertness, mobile focus trapping/restoration, desktop/mobile containment, normal-motion cursor-to-target pixel alignment, target occlusion, reduced motion, keyboard panel opening, SDK readiness, and an optional real point-and-answer turn. Keep credentials in the process environment or a secret runner, not shell history.

Verify the real Gemini Live transport separately. This mints one-use runtime and ephemeral Live tokens, feeds checked-in English PCM speech through Chromium's microphone capture, requires authoritative input transcription and Mia tool routing, compares text and voice plans/receipts/cursor geometry, and fails unless Live produces exact trusted speech. A second spoken fixture must approve the exact pending draft action; the gate verifies the confirmation source, action binding, host receipt, persisted CRM record, amount, and draft state:

```bash
MIA_VOICE_BACKEND_URL=https://mia.example.com \
MIA_VOICE_ORIGIN=https://app.example.com \
MIA_VOICE_INTEGRATION_KEY='...' \
MIA_VOICE_ACCEPTANCE_ITERATIONS=3 \
npm run acceptance:voice:repeat
```

Before tagging, run `npm run verify:release`, then require the `Release Acceptance` workflow in the protected `release-acceptance` environment. The workflow runs on every `main` push and release tag. It uses only the checked-out commit: a fresh PostgreSQL database, freshly built backend/console/SDK/demo artifacts, generated setup/admin/runtime secrets, a real documentation embedding, a current UI scan, and currently detected and reviewed host actions. It executes deterministic verification, Chrome/Edge/Firefox/WebKit plus real Safari, three benchmark iterations at a 100% threshold, and three spoken-input Gemini Live parity and approval checks. A missing credential, stale artifact, incomplete setup item, or failed scenario fails the gate.

The protected environment needs only a `GEMINI_API_KEY` secret. The initial backend and model-independent Chrome, Edge, Firefox, and WebKit checks run without it. Only after those checks pass does the workflow validate the secret and restart the backend with it for agent and voice acceptance, so dependency installation, builds, and unrelated test commands never receive the credential and a provider-account problem cannot hide browser regressions. Acceptance URLs, administrator credentials, encryption/setup secrets, integration keys, database state, and evidence paths are generated inside each workflow run. Never point the release gate at a long-lived external deployment.

## 5. Empty Deployment Gate

Use new volumes and unique secrets:

```bash
docker compose down --volumes --remove-orphans
docker compose up --build -d
curl -fsS http://localhost:4000/api/v1/ready
```

Complete first-run setup through the bundled console, configure Gemini, ingest one document, scan the demo, create a runtime key, detect/review actions, and pass the five Test Mia scenarios. Then:

- restart both services and confirm state persists;
- take a PostgreSQL/uploads backup and restore it into a separate Compose project;
- send `SIGTERM` and confirm graceful shutdown;
- verify no default credential works and no raw secret appears in logs or API responses.

Keep the restore backup inside the ephemeral runner and destroy it with the test deployment. Release evidence may retain only a checksum, byte count, and restore assertions; never upload a database dump or uploads archive as a CI artifact.

## 6. Publish

Build the container and SDK from the verified commit. Publishing `@mia/onboarding-agent` requires authorized access to the `@mia` npm scope:

```bash
npm publish --workspace sdk --access public
```

After publication, install the public version in a clean external project and run one initialization/pointing scenario. Verify the npm provenance and package file list.

Create an annotated tag only after artifacts exist:

```bash
git tag -a v1.0.0 -m "Mia 1.0.0"
git push origin main
git push origin v1.0.0
```

Create the GitHub release from the matching changelog section. Include configuration changes, migration/backup requirements, model defaults, known limitations, and rollback procedure.

## 7. Post-Release

- Re-run readiness and one live scenario against the released deployment.
- Confirm package and container identifiers match the tag.
- Watch provider errors, agent failures, confirmation behavior, database health, and upload capacity.
- Keep the pre-release backup until the rollback window closes.
