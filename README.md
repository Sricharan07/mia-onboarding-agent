# MIA Onboarding Agent

Local-first AI onboarding agent foundation for SaaS products.

## What Exists Now

- `docs/` is the source of truth.
- `example/demo-crm/` is preserved for later and is not implemented in this pass.
- `backend/` contains the TypeScript backend foundation, SQLite persistence, API routes, UI mapper, workflow processing, and real provider adapters.
- `backend/console/` contains the local backend-connected console UI.
- `sdk/` contains the browser SDK foundation for runtime context, LiveKit connection, AI cursor, highlighting, and workflow execution.

## Local Setup

```bash
npm install
cp .env.example .env
npm run build
npm run dev:backend
```

The backend listens on `http://localhost:4000` by default.

To run the local console:

```bash
cd backend/console
npm install
npm run dev
```

The console defaults to `http://localhost:4000` and can be pointed at another backend URL from Settings.

Qwen, Moss, LiveKit, STT, and TTS credentials are required for provider-backed routes. Missing credentials fail with explicit config errors.

Runtime-sensitive SDK/backend routes are protected with local scoped API keys. Create one from the console API Keys page and pass it to the SDK as `apiKey`.

For authenticated UI ingestion, configure a dedicated demo account in `.env` with the `UI_SCAN_*` variables. Keep `UI_SCAN_HEADLESS=false` when using the console's interactive mapper so the Playwright browser is visible for manual dropdown/modal captures.

## Useful Commands

```bash
npm run build
npm run test
npm run dev:backend
cd backend/console && npm run build
```
