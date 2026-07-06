# MIA Onboarding Agent

Open-source, self-hosted AI onboarding agent for SaaS products. MIA maps a product UI, turns approved workflow recordings into guided onboarding flows, and exposes a browser SDK that can answer user requests and execute published workflows inside the host app.

## Project Layout

- `backend/` contains the TypeScript backend, SQLite persistence, API routes, UI mapper, workflow processing, Gemini Live token minting, and provider adapters.
- `backend/console/` contains the backend-connected console UI.
- `sdk/` contains the browser SDK with Mia cursor, Gemini Live voice/screen streaming, runtime context, and workflow execution.
- `example/demo-crm+sdk/` demonstrates the SDK inside a host app.

## Documentation

- [Production deployment](docs/production.md)
- [SDK integration](docs/sdk.md)
- [HTTP API](docs/api.md)
- [Security model](docs/security.md)
- [Database operations](docs/database.md)
- [Troubleshooting](docs/troubleshooting.md)
- [Contributing](CONTRIBUTING.md)
- [Security policy](SECURITY.md)

## Local Setup

```bash
npm install
cp .env.example .env
npm run build
npm run dev:backend
```

The backend listens on `http://localhost:4000` by default.

Set `CORS_ORIGIN` to your host app origin in production, for example `https://app.example.com`. Use comma-separated origins for multiple apps.

Required minimum production config:

```bash
GEMINI_API_KEY=...
BOOTSTRAP_ADMIN_TOKEN=long-random-bootstrap-token
MIA_SECRET_ENCRYPTION_KEY=long-random-secret-encryption-key
OPENAI_API_KEY=...
```

`BOOTSTRAP_ADMIN_TOKEN` is needed only while creating the first console admin. Keep `MIA_SECRET_ENCRYPTION_KEY` stable for the lifetime of the database so saved scan credentials remain decryptable.

Create the first console admin in the console, or with the setup endpoint:

```bash
curl -X POST http://localhost:4000/api/v1/console/auth/setup \
  -H "content-type: application/json" \
  -H "x-bootstrap-admin-token: $BOOTSTRAP_ADMIN_TOKEN" \
  -d '{"name":"Local Admin","email":"admin@example.com","password":"long-random-password"}'
```

Use the returned console session token for admin API requests:

```bash
curl -X POST http://localhost:4000/api/v1/apps \
  -H "content-type: application/json" \
  -H "authorization: Bearer $CONSOLE_SESSION_TOKEN" \
  -d '{"name":"local app","slug":"local-app","baseUrl":"http://localhost:3000"}'
```

Create an SDK key with `runtime:write` and `logs:write`, bound to the target app and allowed browser origins, then pass it to the SDK as `apiKey`. The console generates this install/init snippet after key creation.

```bash
curl -X POST http://localhost:4000/api/v1/api-keys \
  -H "content-type: application/json" \
  -H "authorization: Bearer $CONSOLE_SESSION_TOKEN" \
  -d '{"name":"local SDK","scopes":["runtime:write","logs:write"],"appId":"<app_id>","allowedOrigins":["http://localhost:3000"]}'
```

All non-admin keys must include `appId` and `allowedOrigins`. Console users manage SDK keys from the self-hosted console.

Rebuild the local semantic index for an existing app after scans or workflow imports:

```bash
curl -X POST http://localhost:4000/api/v1/apps/<app_id>/semantic-index/rebuild \
  -H "authorization: Bearer $CONSOLE_SESSION_TOKEN"
```

## Docker

```bash
cp .env.example .env
docker compose up --build
```

The Docker image serves the console at `/` and the API under `/api/v1`. The backend container stores SQLite, uploads, and LanceDB semantic index files in the `mia-data` volume. See [Production deployment](docs/production.md) before exposing the service publicly.

## Console

```bash
cd backend/console
npm install
npm run dev
```

The console defaults to `http://localhost:4000` and can be pointed at another backend URL from Settings.
For fresh browser sessions or hosted console deployments, set `VITE_MIA_BACKEND_URL` in `backend/console/.env`.
On first run, create the first console admin with the `BOOTSTRAP_ADMIN_TOKEN` from the backend environment. After setup, sign in with the admin email and password.

Gemini, OpenAI embeddings, and LanceDB local storage are required for provider-backed routes. Missing credentials fail with explicit config errors.

Runtime-sensitive SDK/backend routes are protected with scoped API keys. API key management requires a signed-in console admin or an `admin` API key.

To add a web app for UI mapping:

1. Open Console -> Overview and follow the activation checklist.
2. Create an application record with the app name, slug, and base URL.
3. Configure the app's UI scan profile: default routes, auth mode, login selectors when needed, ignored selectors, redacted selectors, and optional same-origin route discovery.
4. Open Console -> UI Map, run preflight, then run an explicit route scan.
5. Use interactive scan for manual SSO login, modals, drawers, dropdowns, row action menus, and other hidden states.
6. Review generated workflows and clear safety blockers before approval/publish.
7. Create an app-bound SDK key from Console -> API keys and use the generated SDK snippet.

Automated route discovery is opt-in and only follows same-origin links from scanned pages. It filters obvious destructive/logout/binary routes, but production scans should still start with explicit routes.

The SDK redacts visible DOM text by default before context leaves the browser. Keep `redactText` enabled unless the host app has reviewed the data that may be sent to the backend/model provider:

```ts
AIOnboardingAgent.init({
  appId: "app_local",
  backendUrl: "http://localhost:4000",
  apiKey: "...",
  enableVoice: true,
  privacy: {
    redactText: true,
    redactedSelectors: ["[data-private]", ".billing-card"],
    redactScreenFrame: (canvas, context) => {
      context.clearRect(0, 0, 220, 80);
    }
  }
});
```

For authenticated UI ingestion, prefer the per-app scan profile in the console. Per-app scan passwords are encrypted at rest when `MIA_SECRET_ENCRYPTION_KEY` is configured, and the backend rejects new per-app scan passwords without that key. The `UI_SCAN_*` variables remain as backend-level fallbacks. Use a dedicated demo/test account only. Keep `UI_SCAN_HEADLESS=false` when using the console's interactive mapper so the Playwright browser is visible for manual login and state capture.

## Useful Commands

```bash
npm run verify
npm run build
npm run test
npm run dev:backend
npm run dev:console
npm run build:console
npm run pack:sdk
```
