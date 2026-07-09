# Production Deployment

This guide covers the supported self-hosted deployment shape: one Node.js 22 backend service that serves the console at `/`, API routes under `/api/v1`, SQLite state, local uploads and generated audio, and a local LanceDB semantic index.

The current persistence and coordination model supports one backend replica. Do not mount one SQLite data directory into concurrent backend replicas. A multi-replica deployment requires an external transactional database, shared runtime-token and rate-limit state, distributed job coordination, and shared object storage; an edge rate limiter alone is not sufficient.

## Deployment Checklist

- Terminate TLS at a reverse proxy or load balancer.
- Set `NODE_ENV=production`.
- Set `CORS_ORIGIN` to explicit origins. Do not use `*` in production.
- Set independent, stable, high-entropy values for `MIA_SECRET_ENCRYPTION_KEY` and `BOOTSTRAP_ADMIN_TOKEN`. Production requires at least 32 characters.
- Provide `GEMINI_API_KEY` and `OPENAI_API_KEY` when using provider-backed workflow processing, semantic search, or voice.
- Mount persistent storage for SQLite, uploads, generated audio, and LanceDB.
- Create the first console admin, then rotate or remove the bootstrap token from the runtime environment.
- Create app-bound server integration keys with allowed browser origins. Never ship an admin or integration key to a browser; mint short-lived runtime tokens from the trusted host backend.
- Configure backups before onboarding real users.
- Tune `CONSOLE_AUTH_RATE_LIMIT_MAX` and `WORKFLOW_VIDEO_MAX_BYTES` for the deployment size and reverse-proxy limits.

## Docker Compose

```bash
cp .env.example .env
docker compose up --build
```

The compose file requires `CORS_ORIGIN` and stores all mutable runtime data in the `mia-data` volume:

- SQLite database: `/app/data/sqlite/local.db`
- Workflow video uploads: `/app/data/uploads`
- Generated audio: `/app/data/tts`
- Semantic index: `/app/data/lancedb`

The container listens on port `4000`. The console is available at `http://localhost:4000/`, and the health endpoint is `http://localhost:4000/api/v1/health`.

## Reverse Proxy

Run MIA behind HTTPS. Forward the original host and protocol headers from the proxy. Set `TRUST_PROXY=true` only when the service is behind a trusted proxy that supplies correct forwarded headers.

Example origin settings:

```bash
CORS_ORIGIN=https://mia.example.com,https://app.example.com
```

Include the console origin and every host application origin that will call the SDK APIs.

## First Admin

Create the first console admin from the console setup screen or with:

```bash
curl -X POST https://mia.example.com/api/v1/console/auth/setup \
  -H "content-type: application/json" \
  -H "x-bootstrap-admin-token: $BOOTSTRAP_ADMIN_TOKEN" \
  -d '{"name":"Admin","email":"admin@example.com","password":"long-random-password"}'
```

After the first admin exists, bootstrap setup is closed by the backend. Rotate or remove `BOOTSTRAP_ADMIN_TOKEN` after setup.

Generate secrets independently, for example with `openssl rand -hex 32`. Keep `MIA_SECRET_ENCRYPTION_KEY` stable across deploys and restores.

## Data And Backups

Back up the entire persistent data directory or Docker volume. A complete backup must include:

- the SQLite database, including WAL files when present;
- workflow video uploads;
- generated audio;
- the LanceDB semantic index.

For consistent SQLite backups, stop the container before copying the volume, or use SQLite's backup tooling against the live database. Restore by stopping the service, replacing the data directory or volume contents, and starting the same or newer application version.

## Upgrades

Database migrations run automatically on backend startup. Before upgrading:

- back up the persistent data volume;
- read `CHANGELOG.md`;
- deploy the new image;
- check `/api/v1/health` and the admin-only `/api/v1/system/readiness`;
- open the console and confirm the activation checklist still passes.

The migration ledger is stored in the `schema_migrations` table. See [Database operations](database.md) for details.

## UI Scanning In Production

Production scans reject private and reserved target networks by default. Keep `UI_SCAN_ALLOW_PRIVATE_NETWORKS=false` for public deployments. Set it to `true` only when MIA is intentionally deployed inside a trusted private network and is scanning owned private apps.

Browser scans also enforce the target URL policy on Playwright requests, including redirects and page subresources. For high-risk public deployments, keep the scanner container on a network segment that cannot reach cloud metadata endpoints or unrelated private services.

Use per-app scan profiles in the console instead of global `UI_SCAN_*` credentials. Saved per-app scan passwords require `MIA_SECRET_ENCRYPTION_KEY` and are encrypted at rest.

Use dedicated test or demo accounts for authenticated scans. Do not scan with broad production admin accounts unless that operational risk is explicitly accepted.

## Operations Checks

Use these checks after deploys and before releases:

```bash
npm run verify
curl https://mia.example.com/api/v1/health
curl -H "authorization: Bearer $ADMIN_API_KEY" https://mia.example.com/api/v1/system/readiness
```

The readiness route reports database/config/provider status and requires a console admin session token or an admin API key. Provider checks that require credentials fail explicitly when keys are missing.
