# Production Deployment

## Supported Topology

Mia v1 supports one backend process for one product. The process serves the administrator console, runtime API, knowledge workers, retention sweep, and Playwright scanner. PostgreSQL with pgvector and the upload directory are persistent dependencies.

Run one backend replica. Authentication and agent state are PostgreSQL-backed, but rate limiting and background-work coordination are process-local. Multiple replicas require a reviewed distributed limiter, job ownership/leases, shared object storage, and equivalent cancellation semantics.

Place the backend behind a TLS-terminating reverse proxy or managed ingress. The product SDK may be served by a different exact origin included in `CORS_ORIGIN`.

## Required Configuration

Production startup validates:

- `NODE_ENV=production`;
- PostgreSQL `DATABASE_URL` using `postgres:` or `postgresql:`;
- explicit comma-separated `CORS_ORIGIN` entries, never `*`;
- `MIA_SECRET_ENCRYPTION_KEY` with at least 32 characters;
- `SETUP_TOKEN` with at least 32 characters when the database has not completed first-run setup.

Generate independent hexadecimal values to avoid URL-encoding problems:

```bash
openssl rand -hex 32
```

Use separate outputs for PostgreSQL, encryption, and setup. Do not reuse provider or host integration credentials.

The encryption key protects Gemini and scan credentials stored in PostgreSQL. Keep it stable, outside the database backup, and available on every restart. After setup, custom deployments may remove `SETUP_TOKEN`; the stock Compose file continues to require it so a newly recreated empty database cannot start with an unprotected setup endpoint. Rotating it is safe because setup is single-use.

## Docker Compose

```bash
cp .env.example .env
# Fill POSTGRES_PASSWORD, MIA_SECRET_ENCRYPTION_KEY, SETUP_TOKEN, and CORS_ORIGIN.
docker compose config
docker compose up --build -d
docker compose ps
curl -fsS http://localhost:4000/api/v1/ready
```

Compose waits for PostgreSQL, applies migrations, installs the `vector` extension, starts the non-root backend, and exposes the bundled console on `MIA_PORT` (default `4000`). It uses separate `mia-postgres` and `mia-uploads` volumes and a temporary filesystem for browser work.

No administrator or database password is supplied by the repository. Compose fails configuration when required secrets are absent.

## First-Run Setup

Open the backend origin and enter:

- deployment `SETUP_TOKEN`;
- product name;
- exact production origin that embeds the SDK;
- administrator email and name;
- a unique password of at least 12 characters.

Setup creates the singleton product and administrator in one transaction. After success, repeated setup attempts are rejected. Configure Gemini in the Setup workflow or set `GEMINI_API_KEY` in the environment. An environment key takes precedence and cannot be removed through the console.

Complete all eight readiness checks before production use:

1. Product configured.
2. Gemini connected.
3. Runtime integration key created.
4. Product knowledge indexed.
5. UI map ready.
6. SDK detected on the exact origin.
7. Detected host actions reviewed.
8. Q&A, pointing, navigation, confirmed mutation, and voice validation passed.

## Reverse Proxy

Forward HTTP and server-sent events without buffering. Preserve `Origin`, `Referer`, `Authorization`, `x-mia-key`, and forwarding headers. Set `TRUST_PROXY=true` only when requests always pass through a trusted proxy that sanitizes forwarding headers.

Representative Nginx location:

```nginx
location / {
    proxy_pass http://mia-backend:4000;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header Origin $http_origin;
    proxy_buffering off;
    proxy_read_timeout 300s;
}
```

Apply request-body limits at least as strict as `MAX_UPLOAD_BYTES`, protect the console with network or identity controls appropriate to the organization, and do not rewrite the SDK product origin.

## CORS And Origins

List the public backend/console origin and each exact host-product origin:

```bash
CORS_ORIGIN=https://mia.example.com,https://app.example.com
```

Production non-local origins must use HTTPS and contain no path, credentials, query, or fragment. Runtime tokens are separately bound to the product origin. CORS is not authentication.

Changing the configured product origin revokes integration keys and runtime tokens. Create a new host key and update the trusted host token endpoint after an intentional origin migration.

## Gemini Models

Locked v1 defaults are:

```text
GEMINI_PLANNER_MODEL=gemini-3.5-flash
GEMINI_VISION_MODEL=gemini-3.5-flash
GEMINI_EMBEDDING_MODEL=gemini-embedding-2
GEMINI_EMBEDDING_DIMENSIONS=768
GEMINI_LIVE_MODEL=gemini-3.1-flash-live-preview
```

Changing the embedding model or dimensions requires a migration and full re-embedding. Do not point production model settings at incompatible previews without running the complete benchmark and voice acceptance suite.

## Storage And Resources

- Back up PostgreSQL and uploads together using [Database operations](database.md).
- Size PostgreSQL for document chunks, UI-map elements, transcripts, and vector indexes.
- Keep at least `MAX_UPLOAD_BYTES` plus extraction overhead free for each concurrent upload.
- Playwright scanning requires shared memory and temporary disk. The stock container uses headless Chromium and a 1 GiB `/tmp` filesystem.
- Do not mount the upload volume read-only; ingestion and recording processing need writes.
- Restrict direct PostgreSQL access to the backend and operator network.

## Health And Monitoring

- `/api/v1/health` proves the process can answer HTTP.
- `/api/v1/ready` returns `200` only when PostgreSQL is reachable and also reports `setupRequired` and `geminiConfigured`.
- Container health checks use `/api/v1/ready`.

Monitor:

- restarts, readiness failures, request latency, `429` and `5xx` rates;
- PostgreSQL connections, storage, backup age, locks, and query latency;
- provider errors, latency, and token usage in Runs/Overview;
- failed knowledge sources, recordings, and UI scans;
- repeated agent failures, loops, blocked actions, and confirmation denial rates;
- upload-volume capacity and retention-sweep errors.

Application logs are structured. Error payloads are sanitized before logging, but operators should still route logs to access-controlled storage and avoid enabling infrastructure request-body logging.

## Scanner Network Policy

The scanner accepts only the configured product origin and administrator-approved HTTPS documentation origins. It resolves DNS, checks redirects and resources, and blocks private/reserved networks by default in production.

Set `UI_SCAN_ALLOW_PRIVATE_NETWORKS=true` only when the backend is intentionally inside a trusted network and the target is owned. Use a dedicated least-privilege scan account. Redact secrets and private regions before scanning.

## Shutdown And Upgrade

The backend handles `SIGTERM`/`SIGINT`, stops accepting work, closes scanner/knowledge workers, and drains PostgreSQL connections within `SHUTDOWN_GRACE_PERIOD_MS`.

Upgrade procedure:

1. Read `CHANGELOG.md` and migration notes.
2. Back up PostgreSQL, uploads, and the encryption key.
3. Build the exact release commit and run its verification suite.
4. Stop the backend, keep PostgreSQL available, and start the new image.
5. Wait for migrations and `/api/v1/ready`.
6. Sign in, inspect Setup and Overview, then run one live Test Mia scenario.

Database migrations are forward-only. Rollback means restoring the pre-upgrade database and uploads together, then starting the previous image. Do not run an older binary against a newer schema unless that release explicitly documents compatibility.
