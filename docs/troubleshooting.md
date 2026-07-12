# Troubleshooting

## Backend Does Not Start

Check structured container logs first:

```bash
docker compose logs --tail=200 mia-backend postgres
docker compose config
```

Common causes:

- `DATABASE_URL` is not PostgreSQL or the password does not match the database container.
- PostgreSQL is unavailable or the role cannot create/use the `vector` extension.
- Production `CORS_ORIGIN` is `*`, malformed, contains a path, or uses non-local HTTP.
- `MIA_SECRET_ENCRYPTION_KEY` is missing or shorter than 32 characters.
- An empty production database has no valid `SETUP_TOKEN`.
- `LOCAL_UPLOAD_DIR` is not writable.

Check liveness and readiness separately:

```bash
curl -i http://localhost:4000/api/v1/health
curl -i http://localhost:4000/api/v1/ready
```

`health` can be healthy while `ready` returns `503` for a database outage.

## PostgreSQL Migration Fails

- Confirm the database is dedicated to Mia and the role can create tables, indexes, and `CREATE EXTENSION vector`.
- Confirm the installed pgvector supports HNSW indexes and `VECTOR(768)`.
- Do not edit or delete rows from `schema_migrations` to force startup.
- Restore the pre-upgrade backup before retrying a failed production migration.

Integration tests intentionally refuse to reset a database whose name does not contain `test`.

## First-Run Setup Fails

- `SETUP_TOKEN_NOT_CONFIGURED`: configure a high-entropy token and restart an empty production deployment.
- `SETUP_TOKEN_INVALID`: enter the exact deployment token; surrounding whitespace is significant.
- `SETUP_COMPLETE`: the singleton administrator already exists; use sign in.
- `PASSWORD_TOO_SHORT`: use at least 12 characters.
- `ORIGIN_INVALID`: use one exact HTTPS origin without a path/query/fragment, or localhost HTTP for development.

No default administrator credentials exist.

## Console Cannot Reach The Backend

The production console is served by the backend at `/`. For Vite development, set:

```bash
VITE_MIA_BACKEND_URL=http://localhost:4000
```

Then verify the console origin is listed in `CORS_ORIGIN`. Inspect the browser Network panel for the JSON error envelope. A stale `mia:v1:admin-session` value in `sessionStorage` is cleared automatically after a `401`; sign in again.

## Gemini Is Not Ready

- Configure the key under Setup/Settings or set `GEMINI_API_KEY` in the backend environment.
- An environment key takes precedence; remove it from the deployment before trying to clear the console-stored key.
- Confirm outbound HTTPS/WebSocket access to the configured Gemini endpoint.
- Keep the locked planner, embedding dimension `768`, and Live model settings aligned.
- `GEMINI_RESPONSE_INVALID` means structured output remained invalid after bounded correction retries. Inspect the Run's sanitized provider attempts and retry the user turn.
- `GEMINI_EMBEDDING_INVALID` commonly means an incompatible embedding model/dimension or incomplete provider response.

Provider keys are never sent to the browser.

## Runtime Token Returns 401 Or 403

- `INTEGRATION_KEY_REQUIRED`: the trusted host endpoint omitted `x-mia-key`.
- `INTEGRATION_KEY_INVALID`: replace a malformed, revoked, or origin-invalid key from Settings.
- `RUNTIME_TOKEN_REQUIRED` / `RUNTIME_TOKEN_INVALID`: `tokenProvider` returned no valid `mia_rt_...` token.
- `RUNTIME_TOKEN_EXPIRED` / `RUNTIME_TOKEN_EXHAUSTED`: request a fresh token.
- `RUNTIME_CAPABILITY_FORBIDDEN`: mint `agent:run`, `events:write`, or `voice:live` as required.
- `RUNTIME_ORIGIN_FORBIDDEN`: the browser origin, product origin, integration-key origin, and token request origin must match exactly, including scheme and port.

Do not solve token errors by exposing the integration key in the browser.

## Mia Answers But Does Not Point

1. Open Runs and confirm the turn produced a `point`, `highlight`, or `scroll_to` directive rather than an answer-only decision.
2. Confirm the target reference names a current observation node or mapped element.
3. Ensure the control has an accessible name and is visible, enabled, and not covered by another element.
4. Add a stable `data-mia-key` to important controls, then rescan.
5. Confirm private-region selectors are not redacting the target unintentionally.
6. Rebuild/reload the host app so it uses the current SDK package and CSS.

The UI map helps retrieval and policy, but Mia will not point at a stale target absent from the live page.

## Mia Says It Cannot Click Or Act

- Check **Actions & Safety**. A host action must be detected, reviewed, and published after its latest manifest hash.
- Check the UI map policy. `guide_only`, `manual`, or `blocked` controls cannot be mutated automatically.
- A click/fill/select/toggle is a reversible write and waits for exact approval. Approve or decline the visible pending confirmation before starting another turn.
- Protected targets such as passwords, payment fields, file inputs, CAPTCHA, and WebAuthn remain manual.
- Delete, send, publish, approve, pay, transfer, external communication, and irreversible submit requests are intentionally blocked.
- Inspect the action receipt. `unverified` means the SDK could not prove the expected focus/value/state/route/DOM change; fix product semantics or the host receipt rather than bypassing verification.

The cursor is Mia's separate visual cursor. The browser does not allow an SDK to move the user's physical pointer or create trusted native events.

## Mia Repeats An Action

The agent stops after three matching loop signatures or three consecutive failed/unverified attempts. A repeated target usually means the product did not expose the expected result.

- Return specific host-action evidence such as record ID and resulting state.
- Make the new DOM state observable through accessible value, checked/selected/expanded state, route, or meaningful text.
- Avoid actions whose success response arrives before the product state updates; resolve the executor only after the state is durable.
- Inspect completion-judge evidence in Runs.

## Confirmation Is Stuck Or Rejected

- Confirm the session has not been reloaded with a value-bearing action; unsafe pending values are cancelled on reload.
- Confirm the approval arrived before the five-minute expiry.
- Use the current opaque binding only once and with the current session revision.
- Do not start a second turn while confirmation is pending.
- Voice approval must clearly approve or decline the exact prompt; otherwise use the visible controls.

## Voice Does Not Start

- Voice must be enabled in the SDK and product settings.
- Use HTTPS or localhost and grant microphone permission.
- The runtime token needs `voice:live`.
- Allow the returned Gemini WebSocket endpoint in CSP `connect-src` and network egress.
- Check browser `Permissions-Policy`; a parent frame may deny microphone access.
- `Aoede` is the default voice. The console's curated product voice is authoritative; SDK requests cannot replace it. If another voice is heard, verify the effective voice returned by the token endpoint and rebuild the deployed bundle rather than relying on a stale development process.

For push-to-talk, hold `Control+Space`. Releasing either key, switching tabs, or losing window focus pauses the microphone. Open-mic mode remains active until **Stop voice**.

## Voice Ends Or Reconnects Repeatedly

- Inspect Runs/runtime events for `voice_started`, provider errors, and token expiry.
- Confirm system time is correct; ephemeral token validity is time-sensitive.
- Check WebSocket proxies, idle timeouts, and provider reachability.
- Do not cache a voice token across sessions. The SDK requests a new ephemeral token when connecting.
- Emergency stop intentionally ends speech and active transport.
- Run `npm run acceptance:voice` against the deployment to distinguish microphone/UI problems from ephemeral-token, tool-routing, or trusted-speech failures.

## Knowledge URL Fails

- Documentation must use HTTPS and an administrator-approved origin.
- Redirects must remain approved and pass DNS/SSRF checks.
- Private, loopback, link-local, reserved, and metadata endpoints are blocked.
- The server must return supported text/HTML content within size and page limits.
- Review `DOCUMENT_*` error details in Knowledge and retry after fixing the source.

## Document Or Recording Upload Fails

- Documents support Markdown, text, and PDF with matching content/extension.
- Recordings must use a supported media type accepted by the Gemini file path.
- Files must be nonempty and at or below `MAX_UPLOAD_BYTES`.
- Confirm the upload volume is writable and has free space.
- A recording produces a skill requiring review; it does not immediately become executable.

## UI Scan Fails

- Confirm the product origin is reachable from the backend/container.
- Routes must be same-origin and non-destructive.
- For login-form scanning, provide login URL, username, password, username/password/submit selectors, and optional success pattern.
- Use a dedicated least-privilege scanner account.
- Private/reserved product networks require an intentional `UI_SCAN_ALLOW_PRIVATE_NETWORKS=true` deployment.
- Cross-origin assets must be listed in scan access settings.
- Duplicate visible labels are allowed, but add stable product keys when a control needs reliable policy/targeting.

The scanner runs headless in Docker. Set `UI_SCAN_HEADLESS=false` only for local debugging.

## SDK Panel Or Cursor Has No Styles

A strict CSP may block injected Shadow DOM styles. Generate a style nonce in the host response, allow it in `style-src`, and pass:

```ts
ui: { styleNonce: cspNonce }
```

Also allow the Mia backend and Gemini Live WebSocket in `connect-src`. The SDK does not require `unsafe-eval`.

## Reload Does Not Resume

The SDK stores only a session ID and resume token in `sessionStorage`, scoped by backend URL. Resume will fail after user identity changes, backend URL changes, token loss, session cancellation, or invalid resume binding. The SDK clears invalid state and creates a new session.

Do not copy session storage across users or persist it in local storage.

## Docker Data Disappeared

Confirm the same `mia-postgres` and `mia-uploads` volumes are attached:

```bash
docker volume ls | grep mia
docker compose ps
```

`docker compose down --volumes` intentionally deletes both stores. Restore PostgreSQL and uploads from the same backup set using [Database operations](database.md).

## Verification Fails

Run the first failing gate directly:

```bash
MIA_TEST_DATABASE_URL=postgres://mia:password@127.0.0.1:5432/mia_test npm --workspace backend test
npm --workspace sdk test
npm run build
npm run build:console
npm run build:demo
npm run audit:prod
npm run pack:sdk
```

Do not ignore a failing test, audit, package check, Docker readiness check, or live acceptance scenario.
