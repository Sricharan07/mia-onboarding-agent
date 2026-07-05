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
curl http://localhost:4000/api/v1/system/readiness
```

## Console Cannot Reach Backend

- For Docker, open the console at the backend origin, for example `http://localhost:4000/`.
- For Vite development, set `VITE_MIA_BACKEND_URL=http://localhost:4000` in `backend/console/.env`.
- Confirm the backend URL saved in Settings is correct.
- Confirm the backend CORS origin list includes the console origin.

## First Admin Setup Fails

- Set `BOOTSTRAP_ADMIN_TOKEN`.
- Send the same value as `x-bootstrap-admin-token`.
- Use a password with at least 12 characters.
- If an admin already exists, use the login screen instead of setup.

## SDK Requests Return 401 Or 403

- `401 API_KEY_REQUIRED`: the SDK key is missing or not reaching the backend.
- `401 INVALID_API_KEY`: the key is malformed, revoked, or copied incorrectly.
- `403 API_KEY_FORBIDDEN`: the key is missing the required scope.
- `403 API_KEY_APP_FORBIDDEN`: the key is bound to another app.
- `403 API_KEY_ORIGIN_FORBIDDEN`: add the browser origin to the key's allowed origins.

## UI Scan Fails

- Run preflight from the UI Map page and fix every failing check first.
- Confirm the app base URL is reachable from the backend host or container.
- Confirm routes stay on the configured app origin.
- For authenticated scans, verify login selectors and use a dedicated test account.
- In production, private and reserved target networks are blocked unless `UI_SCAN_ALLOW_PRIVATE_NETWORKS=true`.

## Interactive Scan Browser Does Not Appear

For local interactive mapping, set:

```bash
UI_SCAN_HEADLESS=false
```

Docker compose sets `UI_SCAN_HEADLESS=true`, which is better for server deployments. Run local development mode when you need a visible browser for manual login or state capture.

## Workflow Video Upload Fails

Supported uploads are MP4, MOV, WebM, MKV, and MPEG. The backend validates MIME type, filename extension, and container signature. Re-export the recording if the file extension or content does not match the claimed video type.

## Workflow Processing Fails

- Confirm `GEMINI_API_KEY` is set.
- Check `/api/v1/system/readiness`.
- Confirm the uploaded file exists in persistent storage.
- Review the workflow job error in the console.

## Semantic Search Or Runtime Resolution Is Weak

- Confirm `OPENAI_API_KEY` is set.
- Rebuild the app semantic index after new scans or workflow imports.
- Review UI element descriptions and tags in the UI Map detail page.
- Publish only workflows that pass review without safety blockers.

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
