# Database Operations

MIA stores local product data in SQLite. The default Docker Compose deployment keeps the database in the `mia-data` volume at `/app/data/sqlite/local.db`.

## Migrations

Schema changes are applied at backend startup by the versioned migration runner in `backend/src/db/migrations.ts`.

Applied migrations are recorded in the `schema_migrations` table and mirrored to SQLite `PRAGMA user_version`. The current baseline is:

| ID | Name |
| --- | --- |
| 1 | `initial_schema` |

Migrations must be append-only. Do not edit an already-applied migration; add a new migration with the next integer ID.

## Backup

Stop writes before taking a file-level backup, or use SQLite's online backup API from the running container:

```bash
docker compose exec mia-backend node -e "const Database=require('better-sqlite3'); new Database('/app/data/sqlite/local.db').backup('/app/data/sqlite/backup.db').then(()=>process.exit(0),err=>{console.error(err);process.exit(1);})"
docker cp "$(docker compose ps -q mia-backend)":/app/data/sqlite/backup.db ./mia-backup.db
```

Also back up:

- `/app/data/uploads`
- `/app/data/lancedb`
- the `.env` values needed to decrypt scan credentials, especially `MIA_SECRET_ENCRYPTION_KEY`

## Restore

Stop the container, restore the database and data directories into the Docker volume, then start the backend:

```bash
docker compose down
docker run --rm -v mia-onboarding-agent_mia-data:/data -v "$PWD":/backup alpine sh -c "cp /backup/mia-backup.db /data/sqlite/local.db"
docker compose up -d
```

Keep `MIA_SECRET_ENCRYPTION_KEY` unchanged across restores. Changing it makes stored per-app scan passwords unreadable.
