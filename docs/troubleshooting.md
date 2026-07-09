# Troubleshooting

## Backend Fails To Start

- In production, `CORS_ORIGIN` must be an explicit comma-separated origin list.
- Check required provider keys for the features you are using.
- Ensure the SQLite directory is writable.
- Ensure `MIA_SECRET_ENCRYPTION_KEY` is set before saving per-app scan passwords.

Run:

```bash
npm run dev:backend
curl http://localhost:4000/api/v1/health
curl -H "authorization: Bearer $ADMIN_API_KEY" http://localhost:4000/api/v1/system/readiness
```

## Console Cannot Reach Backend

- For Docker, open the console at the backend origin, for example `http://localhost:4000/`.
- For Vite development, set `VITE_MIA_BACKEND_URL=http://localhost:4000` in `backend/console/.env`.
- Confirm the backend URL saved in Settings is correct.
- Confirm the backend CORS origin list includes the console origin.

## First Admin Setup Fails

- Set `BOOTSTRAP_ADMIN_TOKEN`.
- Send the same value as `x-bootstrap-admin-token`.
- In production, use at least 32 characters for both `BOOTSTRAP_ADMIN_TOKEN` and `MIA_SECRET_ENCRYPTION_KEY`.
- Use a password with at least 12 characters.
- If an admin already exists, use the login screen instead of setup.

## SDK Requests Return 401 Or 403

- `401 RUNTIME_TOKEN_REQUIRED`: `tokenProvider` did not supply a runtime token.
- `401 INVALID_RUNTIME_TOKEN`: the token is malformed or unknown.
- `401 RUNTIME_TOKEN_REVOKED`, `RUNTIME_TOKEN_EXPIRED`, or `RUNTIME_TOKEN_EXHAUSTED`: request a fresh token from the trusted host backend.
- `403 RUNTIME_CAPABILITY_FORBIDDEN`: mint the token with the capability required by the operation.
- `403 RUNTIME_TOKEN_APP_FORBIDDEN`: the token and SDK `appId` do not match.
- `403 RUNTIME_TOKEN_ORIGIN_FORBIDDEN`: mint the token for the exact host-app origin and include that origin on the server integration key.

## UI Scan Fails

- Run preflight from the UI Map page and fix every failing check first.
- Use Discover routes in the UI Map route workbench when a product has many pages or side-navigation links.
- Watch the scan progress panel; a running scan reports captured routes, indexed elements, and selector quality as it advances.
- Confirm the app base URL is reachable from the backend host or container.
- Confirm routes stay on the configured app origin.
- For authenticated scans, verify login selectors and use a dedicated test account.
- In production, private and reserved target networks are blocked before navigation and on Playwright page requests unless `UI_SCAN_ALLOW_PRIVATE_NETWORKS=true`.

## Interactive Scan Browser Does Not Appear

For local interactive mapping, set:

```bash
UI_SCAN_HEADLESS=false
```

Docker compose sets `UI_SCAN_HEADLESS=true`, which is better for server deployments. Run local development mode when you need a visible browser for manual login or state capture.

## Workflow Video Upload Fails

Supported uploads are MP4, MOV, WebM, MKV, and MPEG. The backend validates MIME type, filename extension, container signature, and `WORKFLOW_VIDEO_MAX_BYTES`. Re-export or compress the recording if the file is too large or if the content does not match the claimed video type.

## Workflow Processing Fails

- Confirm `GEMINI_API_KEY` is set.
- Check `/api/v1/system/readiness` with a console admin session token or admin API key.
- Confirm the uploaded file exists in persistent storage.
- Review the workflow job error in the console.

## Semantic Search Or Runtime Resolution Is Weak

- Confirm `OPENAI_API_KEY` is set.
- Rebuild the app semantic index after new scans or workflow imports.
- Review UI element descriptions and tags in the UI Map detail page.
- Publish only workflows that pass review without safety blockers.

## Mia Talks But Does Not Point Or Act

- Open Console -> Test Mia and run a prompt such as `Where is the stage filter?` or `Click the stage filter`.
- If Test Mia cannot find a target, rescan or review the UI map until the element has a medium or strong selector.
- If Test Mia finds a target but the host app does not move the cursor, ask from the SDK assistant panel and inspect Console -> Logs for `runtime_resolution`, `voice_resolution`, and `element_action_completed`, `element_action_unverified`, or `element_action_failed`.
- Keep `privacy.redactText: true` for production by default, but provide stable labels/selectors for controls Mia should understand.
- Enable screen sharing only when the DOM cannot describe the surface, such as canvas charts, images, videos, PDFs, or custom-rendered UI.

## Docker Data Disappeared

The compose setup stores runtime state in the `mia-data` volume. If data disappears, confirm the same Docker volume is attached and that no cleanup command removed it.

## Verification Fails Locally

Run the failing command directly:

```bash
npm run test
npm run build
npm run build:console
npm run build:demo
npm run audit:prod
npm run pack:sdk
```

Fix the first failing command before rerunning `npm run verify`.
