# MIA Onboarding Agent

Open-source, self-hosted AI onboarding agent for SaaS products.

## What Exists Now

- `backend/` contains the TypeScript backend, SQLite persistence, API routes, UI mapper, workflow processing, Gemini Live token minting, and provider adapters.
- `backend/console/` contains the backend-connected console UI.
- `sdk/` contains the browser SDK with Mia cursor, Gemini Live voice/screen streaming, runtime context, and workflow execution.
- `example/demo-crm+sdk/` demonstrates the SDK inside a host app.

## Local Setup

```bash
npm install
cp .env.example .env
npm run build
npm run dev:backend
```

The backend listens on `http://localhost:4000` by default.

Set `CORS_ORIGIN` to your host app origin in production, for example `https://app.example.com`. Use comma-separated origins for multiple apps.

Required minimum provider config:

```bash
GEMINI_API_KEY=...
BOOTSTRAP_ADMIN_TOKEN=long-random-bootstrap-token
OPENAI_API_KEY=...
```

Create the first admin API key:

```bash
curl -X POST http://localhost:4000/api/v1/api-keys \
  -H "content-type: application/json" \
  -H "x-bootstrap-admin-token: $BOOTSTRAP_ADMIN_TOKEN" \
  -d '{"name":"local admin","scopes":["admin"]}'
```

Create an SDK key with `runtime:write` and `logs:write`, then pass it to the SDK as `apiKey`.

Rebuild the local semantic index for an existing app after scans/workflow imports:

```bash
curl -X POST http://localhost:4000/api/v1/apps/$APP_ID/semantic-index/rebuild \
  -H "authorization: Bearer $ADMIN_API_KEY"
```

## Docker

```bash
cp .env.example .env
docker compose up --build
```

The backend container stores SQLite, uploads, and LanceDB semantic index files in the `mia-data` volume.

## Console

```bash
cd backend/console
npm install
npm run dev
```

The console defaults to `http://localhost:4000` and can be pointed at another backend URL from Settings.

Gemini, OpenAI embeddings, and LanceDB local storage are required for provider-backed routes. Missing credentials fail with explicit config errors.

Runtime-sensitive SDK/backend routes are protected with scoped API keys. API key management requires an `admin` key after the bootstrap key is created.

For authenticated UI ingestion, configure a dedicated demo account in `.env` with the `UI_SCAN_*` variables. Keep `UI_SCAN_HEADLESS=false` when using the console's interactive mapper so the Playwright browser is visible for manual dropdown/modal captures.

## Useful Commands

```bash
npm run build
npm run test
npm run dev:backend
cd backend/console && npm run build
```
