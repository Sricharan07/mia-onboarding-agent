# Database Operations

Mia v1 requires PostgreSQL with the `vector` extension. Docker Compose uses `pgvector/pgvector:pg17` and stores database files in the `mia-postgres` volume. Uploaded documents and recordings are separate filesystem data in `mia-uploads`.

## Stored Data

PostgreSQL contains:

- the singleton product and administrator;
- hashed administrator sessions, integration keys, runtime tokens, and resume tokens;
- encrypted Gemini and scanner credentials;
- knowledge sources, extracted chunks, PostgreSQL full-text vectors, and pgvector embeddings;
- UI map versions and reviewed element policies;
- recordings and reviewed skills;
- detected host-action manifests and review state;
- agent sessions, revisions, turns, steps, confirmations, receipts, events, and provider request metadata.

Files in `LOCAL_UPLOAD_DIR` contain original approved documents and recordings. Protect and back up both stores as one consistency set.

## Migrations

Migrations run automatically before the HTTP server starts. Applied IDs and names are recorded in `schema_migrations`.

| ID | Name |
| --- | --- |
| 1 | `mia_v1_initial` |
| 2 | `encrypted_product_settings` |
| 3 | `diagnostic_lookup_indexes` |
| 4 | `stable_goal_run_identity` |
| 5 | `separate_host_action_risk_review` |
| 6 | `constrain_mia_voice` |
| 7 | `typed_host_action_effects` |
| 8 | `append_only_action_attempts` |

Migration 1 enables `vector`; the database role must be allowed to create that extension or an operator must install it before startup.

Migrations are append-only. Never edit SQL that may have run in another deployment. Add the next numeric ID, make the change transactional and restart-safe, and test both a fresh database and an upgrade copy.

## Backup Compose

Choose a quiet period, pause the backend, and capture PostgreSQL plus uploads:

```bash
mkdir -p backups
docker compose stop mia-backend
docker compose exec -T postgres sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --format=custom --no-owner --no-acl' > backups/mia.dump
docker compose run --rm --no-deps -T mia-backend tar -C /app/data/uploads -czf - . > backups/mia-uploads.tar.gz
docker compose start mia-backend
```

Also back up, outside the same storage boundary:

- `MIA_SECRET_ENCRYPTION_KEY`;
- deployment configuration and product DNS/TLS details;
- the integration key held by each host backend, or a plan to rotate it after restore.

`SETUP_TOKEN` is not needed to decrypt data. If setup is already complete, a restored deployment can start without it when not using the stock Compose requirement.

## Restore Compose

Restoring replaces the current database and uploads. Test this procedure in an isolated project before an incident.

```bash
docker compose stop mia-backend
docker compose exec -T postgres sh -c 'dropdb -U "$POSTGRES_USER" --if-exists --force "$POSTGRES_DB" && createdb -U "$POSTGRES_USER" "$POSTGRES_DB"'
docker compose exec -T postgres sh -c 'pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --no-owner --no-acl --exit-on-error' < backups/mia.dump
docker compose run --rm --no-deps -T mia-backend sh -c 'find /app/data/uploads -mindepth 1 -delete && tar -xzf - -C /app/data/uploads' < backups/mia-uploads.tar.gz
docker compose start mia-backend
curl -fsS http://localhost:4000/api/v1/ready
```

Use the same `MIA_SECRET_ENCRYPTION_KEY` that protected the backup. If the key is lost, encrypted provider and scan credentials are intentionally unrecoverable; configure new credentials after restoring the remaining data.

After restore, sign in, check Knowledge and Skills file availability, inspect a known Run, mint a fresh runtime token, and complete one Test Mia scenario.

## External PostgreSQL

Set `DATABASE_URL` to a `postgres://` or `postgresql://` connection URL. Requirements:

- PostgreSQL 17 is the tested release;
- `vector` extension compatible with `VECTOR(768)` and HNSW indexes;
- TLS appropriate to the network boundary;
- automated snapshots and point-in-time recovery appropriate to the operator's recovery objective;
- a connection allowance above `DATABASE_POOL_MAX` plus operational clients;
- one database dedicated to Mia.

Do not place credentials in command history or source control. Prefer the deployment platform's secret manager and a URL-encoded password.

## Retention And Deletion

The product transcript mode controls diagnostic content:

- `full`: retains product-grounded transcript text after mandatory secret redaction;
- `redacted`: stores redacted transcript content;
- `disabled`: excludes transcript content from administrator diagnostics.

Recognized credentials, tokens, payment data, and configured sensitive values are redacted in every mode. The retention sweep removes expired diagnostic data based on `transcriptRetentionDays`; its interval is controlled by `DATA_RETENTION_SWEEP_INTERVAL_MS`.

Archiving a knowledge source removes it from retrieval but retains its original upload for administrator audit; include a reviewed upload-retention and secure-deletion procedure in product privacy operations. PostgreSQL foreign keys cascade session-owned steps, turns, receipts, and confirmations.

## Test Database Guard

Backend integration tests reset the `public` schema. They require `MIA_TEST_DATABASE_URL`, and the database name must contain `test`:

```bash
MIA_TEST_DATABASE_URL=postgres://mia:password@127.0.0.1:5432/mia_test npm --workspace backend test
```

Never point this variable at a production or development database containing needed data.
