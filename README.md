# MIA Onboarding Agent

Local-first AI onboarding agent foundation for SaaS products.

## What Exists Now

- `docs/` is the source of truth.
- `example/demo-crm/` is preserved for later and is not implemented in this pass.
- `backend/` contains the TypeScript backend foundation, SQLite persistence, API routes, UI mapper, workflow processing, and real provider adapters.
- `backend/console/` contains the local backend-connected console UI.
- `sdk/` contains the browser SDK foundation for runtime context, the Mia Shadow Cursor, minimal workflow prompts, LiveKit voice connection, and workflow execution.

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

Qwen and Moss credentials are required for provider-backed routes. Voice uses Moss Voice Agents: the backend mints Moss participant tokens, while the deployed Moss Python agent owns STT, voice LLM turns, and TTS. Missing credentials fail with explicit config errors.

Runtime-sensitive SDK/backend routes are protected with local scoped API keys. Create one from the console API Keys page and pass it to the SDK as `apiKey`.

For authenticated UI ingestion, configure a dedicated demo account in `.env` with the `UI_SCAN_*` variables. Keep `UI_SCAN_HEADLESS=false` when using the console's interactive mapper so the Playwright browser is visible for manual dropdown/modal captures.

To run the SDK-enabled demo CRM without changing `example/demo-crm`:

```bash
npm run build -w sdk
cd example/demo-crm+sdk
cp .env.example .env.local
npm install
npm run dev -- --port 3001
```

Set `NEXT_PUBLIC_MIA_API_KEY` to a scoped local API key with `runtime:write` and `logs:write`. The SDK demo enables voice by default and renders only the custom Mia Shadow Cursor, not an Ask Mia button. Set `NEXT_PUBLIC_MIA_ENABLE_VOICE=false` only if you want to disable voice locally. `MOSS_PROJECT_ID`, `MOSS_PROJECT_KEY`, and `MOSS_VOICE_AGENT_ID` must be valid for voice startup; setup fails clearly and does not fall back to text.

To run the Moss voice agent worker locally:

```bash
cd voice-agent
python -m venv .venv
. .venv/bin/activate
pip install -r requirements.txt
python agent.py console
```

Set `voice-agent/.env` with `MIA_BACKEND_URL`, `MIA_BACKEND_API_KEY`, `MOSS_PROJECT_ID`, `MOSS_PROJECT_KEY`, and `MOSS_VOICE_AGENT_ID`. The API key needs `runtime:write`.

## Useful Commands

```bash
npm run build
npm run test
npm run dev:backend
cd backend/console && npm run build
```
