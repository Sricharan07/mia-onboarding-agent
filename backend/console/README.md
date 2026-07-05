# Console UI

Local Vite console for operating the MIA onboarding backend.

The console connects to the backend APIs in `backend/src/routes` and intentionally avoids local mock data for backend-backed features.

## Run Locally

```bash
npm install
npm run dev
```

Start the backend separately from the repo root:

```bash
npm run dev:backend
```

The console defaults to `http://localhost:4000` for backend API calls. You can change this in the console Settings page.
Set `VITE_MIA_BACKEND_URL` in `backend/console/.env` to change the default for fresh browsers or deployments.

Console login:

```text
Create the first admin with BOOTSTRAP_ADMIN_TOKEN, then sign in with admin email and password.
```

## Current Backend Coverage

- Apps: list and create/update.
- Health: backend status.
- UI map: scan, list versions, list pages, list elements, update element descriptions.
- Workflow videos: upload and start processing.
- Workflow jobs: list and process.
- Workflows: list, review metadata, add/edit/delete/reorder steps, approve, publish, archive.
- Logs: list execution logs.
- Usage: aggregate metrics and daily timeseries from backend logs.
- API keys: create, list, and revoke local scoped API keys, including app-bound SDK keys with allowed browser origins.
- Provider readiness: database/config checks, secret-storage readiness, and no-credit provider reachability where safe.
- First-run activation: app setup, scan profile, UI map, SDK key, and runtime verification checklist.
- UI map preflight: base URL, route, auth selector, privacy selector, and route-discovery checks before scan.
- Console admins: create admins, change password, disable users, and revoke console sessions.
