import type { Db } from "./database.js";

type Migration = {
  id: number;
  name: string;
  up: (db: Db) => void;
};

const migrations: Migration[] = [
  {
    id: 1,
    name: "initial_schema",
    up: migrateInitialSchema
  },
  {
    id: 2,
    name: "schema_hardening_columns",
    up: migrateSchemaHardeningColumns
  },
  {
    id: 3,
    name: "foreign_key_constraints",
    up: migrateForeignKeyConstraints
  }
];

export function runMigrations(db: Db): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL
    );
  `);

  assertUniqueMigrationIds();
  const appliedRows = db.prepare("SELECT id, name FROM schema_migrations").all() as Array<{ id: number; name: string }>;
  assertAppliedMigrationNames(appliedRows);
  const appliedIds = new Set(appliedRows.map((row) => row.id));
  const pending = migrations.filter((migration) => !appliedIds.has(migration.id));
  if (pending.length === 0) return;

  const applyPending = db.transaction(() => {
    for (const migration of pending) {
      migration.up(db);
      db.prepare("INSERT INTO schema_migrations (id, name, applied_at) VALUES (?, ?, ?)")
        .run(migration.id, migration.name, new Date().toISOString());
      db.pragma(`user_version = ${migration.id}`);
    }
  });

  applyPending();
}

function migrateInitialSchema(db: Db): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS apps (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      base_url TEXT NOT NULL,
      ui_scan_config_json TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      archived_at TEXT
    );

    CREATE TABLE IF NOT EXISTS ui_map_versions (
      id TEXT PRIMARY KEY,
      app_id TEXT NOT NULL,
      version TEXT NOT NULL,
      source TEXT NOT NULL,
      status TEXT NOT NULL,
      scan_config_json TEXT,
      locked_by TEXT,
      locked_until TEXT,
      attempts INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      completed_at TEXT,
      error TEXT,
      FOREIGN KEY (app_id) REFERENCES apps(id)
    );

    CREATE TABLE IF NOT EXISTS pages (
      id TEXT PRIMARY KEY,
      app_id TEXT NOT NULL,
      ui_map_version_id TEXT NOT NULL,
      name TEXT NOT NULL,
      route TEXT NOT NULL,
      url TEXT NOT NULL,
      title TEXT,
      status TEXT NOT NULL,
      error TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (app_id) REFERENCES apps(id),
      FOREIGN KEY (ui_map_version_id) REFERENCES ui_map_versions(id)
    );

    CREATE TABLE IF NOT EXISTS ui_elements (
      id TEXT PRIMARY KEY,
      element_id TEXT NOT NULL,
      app_id TEXT NOT NULL,
      ui_map_version_id TEXT NOT NULL,
      page_id TEXT NOT NULL,
      route TEXT NOT NULL,
      page_name TEXT NOT NULL,
      element_type TEXT NOT NULL,
      role TEXT,
      label TEXT,
      visible_text TEXT,
      accessible_name TEXT,
      placeholder TEXT,
      aria_label TEXT,
      input_name TEXT,
      input_type TEXT,
      description TEXT NOT NULL,
      selector TEXT NOT NULL,
      selector_type TEXT NOT NULL,
      fallback_selectors_json TEXT NOT NULL,
      nearby_text_json TEXT NOT NULL,
      tags_json TEXT NOT NULL,
      selector_quality TEXT NOT NULL,
      selector_warnings_json TEXT NOT NULL,
      state_name TEXT NOT NULL DEFAULT 'default',
      state_reason TEXT,
      discovered_by TEXT NOT NULL DEFAULT 'route_scan',
      fingerprint TEXT NOT NULL DEFAULT '',
      raw_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (app_id) REFERENCES apps(id),
      FOREIGN KEY (ui_map_version_id) REFERENCES ui_map_versions(id),
      FOREIGN KEY (page_id) REFERENCES pages(id)
    );

    CREATE TABLE IF NOT EXISTS workflow_videos (
      id TEXT PRIMARY KEY,
      app_id TEXT NOT NULL,
      filename TEXT NOT NULL,
      local_path TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      size_bytes INTEGER NOT NULL,
      workflow_name TEXT,
      workflow_description TEXT,
      status TEXT NOT NULL,
      uploaded_at TEXT NOT NULL,
      FOREIGN KEY (app_id) REFERENCES apps(id)
    );

    CREATE TABLE IF NOT EXISTS workflow_jobs (
      id TEXT PRIMARY KEY,
      app_id TEXT NOT NULL,
      video_id TEXT NOT NULL,
      status TEXT NOT NULL,
      provider_raw_output_json TEXT,
      extracted_action_timeline_json TEXT,
      error TEXT,
      locked_by TEXT,
      locked_until TEXT,
      attempts INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (app_id) REFERENCES apps(id),
      FOREIGN KEY (video_id) REFERENCES workflow_videos(id)
    );

    CREATE TABLE IF NOT EXISTS workflows (
      id TEXT PRIMARY KEY,
      workflow_id TEXT NOT NULL UNIQUE,
      app_id TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT NOT NULL,
      status TEXT NOT NULL,
      version INTEGER NOT NULL,
      workflow_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (app_id) REFERENCES apps(id)
    );

    CREATE TABLE IF NOT EXISTS runtime_sessions (
      id TEXT PRIMARY KEY,
      app_id TEXT NOT NULL,
      workflow_id TEXT NOT NULL,
      client_session_id TEXT,
      user_id TEXT,
      status TEXT NOT NULL,
      current_step_id TEXT,
      values_json TEXT NOT NULL,
      started_at TEXT NOT NULL,
      completed_at TEXT,
      error TEXT,
      FOREIGN KEY (app_id) REFERENCES apps(id),
      FOREIGN KEY (workflow_id) REFERENCES workflows(workflow_id)
    );

    CREATE TABLE IF NOT EXISTS execution_logs (
      id TEXT PRIMARY KEY,
      app_id TEXT,
      session_id TEXT,
      workflow_id TEXT,
      step_id TEXT,
      event_type TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS ai_request_logs (
      id TEXT PRIMARY KEY,
      provider TEXT NOT NULL,
      purpose TEXT NOT NULL,
      input_summary TEXT NOT NULL,
      output_summary TEXT,
      latency_ms INTEGER,
      error TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS api_keys (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      prefix TEXT NOT NULL UNIQUE,
      key_hash TEXT NOT NULL,
      scopes_json TEXT NOT NULL,
      app_id TEXT,
      allowed_origins_json TEXT,
      created_at TEXT NOT NULL,
      last_used_at TEXT,
      revoked_at TEXT,
      FOREIGN KEY (app_id) REFERENCES apps(id)
    );

    CREATE TABLE IF NOT EXISTS console_users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      role TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      last_login_at TEXT,
      disabled_at TEXT
    );

    CREATE TABLE IF NOT EXISTS console_sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      last_used_at TEXT,
      revoked_at TEXT,
      FOREIGN KEY (user_id) REFERENCES console_users(id)
    );

    CREATE INDEX IF NOT EXISTS idx_ui_elements_app_route ON ui_elements(app_id, route);
    CREATE INDEX IF NOT EXISTS idx_workflows_app_status ON workflows(app_id, status);
    CREATE INDEX IF NOT EXISTS idx_execution_logs_filters ON execution_logs(app_id, workflow_id, session_id);
    CREATE INDEX IF NOT EXISTS idx_ai_request_logs_created_at ON ai_request_logs(created_at);
    CREATE INDEX IF NOT EXISTS idx_api_keys_prefix ON api_keys(prefix);
    CREATE INDEX IF NOT EXISTS idx_api_keys_active ON api_keys(prefix, revoked_at);
    CREATE INDEX IF NOT EXISTS idx_console_users_email ON console_users(email);
    CREATE INDEX IF NOT EXISTS idx_console_sessions_token ON console_sessions(token_hash);
  `);

  ensureCurrentSchemaAdditions(db);
}

function migrateSchemaHardeningColumns(db: Db): void {
  ensureCurrentSchemaAdditions(db);
}

function ensureCurrentSchemaAdditions(db: Db): void {
  ensureColumn(db, "ui_elements", "state_name", "TEXT NOT NULL DEFAULT 'default'");
  ensureColumn(db, "ui_elements", "state_reason", "TEXT");
  ensureColumn(db, "ui_elements", "discovered_by", "TEXT NOT NULL DEFAULT 'route_scan'");
  ensureColumn(db, "ui_elements", "fingerprint", "TEXT NOT NULL DEFAULT ''");
  ensureColumn(db, "apps", "ui_scan_config_json", "TEXT");
  ensureColumn(db, "apps", "archived_at", "TEXT");
  ensureColumn(db, "ui_map_versions", "scan_config_json", "TEXT");
  ensureColumn(db, "ui_map_versions", "locked_by", "TEXT");
  ensureColumn(db, "ui_map_versions", "locked_until", "TEXT");
  ensureColumn(db, "ui_map_versions", "attempts", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn(db, "workflow_jobs", "provider_raw_output_json", "TEXT");
  ensureColumn(db, "workflow_jobs", "locked_by", "TEXT");
  ensureColumn(db, "workflow_jobs", "locked_until", "TEXT");
  ensureColumn(db, "workflow_jobs", "attempts", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn(db, "workflow_videos", "workflow_name", "TEXT");
  ensureColumn(db, "workflow_videos", "workflow_description", "TEXT");
  ensureColumn(db, "api_keys", "app_id", "TEXT");
  ensureColumn(db, "api_keys", "allowed_origins_json", "TEXT");

  db.exec("CREATE INDEX IF NOT EXISTS idx_ui_elements_fingerprint ON ui_elements(ui_map_version_id, fingerprint);");
}

type TableRebuild = {
  table: string;
  expectedForeignKeys: number;
  columns: string[];
  createSql: string;
  indexes?: string[];
};

function migrateForeignKeyConstraints(db: Db): void {
  for (const rebuild of foreignKeyRebuilds()) {
    if (foreignKeyCount(db, rebuild.table) >= rebuild.expectedForeignKeys) continue;
    rebuildTableWithForeignKeys(db, rebuild);
  }

  const violations = db.prepare("PRAGMA foreign_key_check").all();
  if (violations.length > 0) {
    throw new Error(`Foreign key migration found ${violations.length} existing relational violation(s).`);
  }
}

function rebuildTableWithForeignKeys(db: Db, rebuild: TableRebuild): void {
  const oldTable = `${rebuild.table}__migration_old`;
  const columns = rebuild.columns.map(quoteIdentifier).join(", ");

  db.exec(`DROP TABLE IF EXISTS ${quoteIdentifier(oldTable)};`);
  db.exec(`ALTER TABLE ${quoteIdentifier(rebuild.table)} RENAME TO ${quoteIdentifier(oldTable)};`);
  db.exec(rebuild.createSql);
  db.exec(`INSERT INTO ${quoteIdentifier(rebuild.table)} (${columns}) SELECT ${columns} FROM ${quoteIdentifier(oldTable)};`);
  db.exec(`DROP TABLE ${quoteIdentifier(oldTable)};`);
  for (const indexSql of rebuild.indexes ?? []) {
    db.exec(indexSql);
  }
}

function foreignKeyCount(db: Db, table: string): number {
  return db.prepare(`PRAGMA foreign_key_list(${quoteIdentifier(table)})`).all().length;
}

function quoteIdentifier(value: string): string {
  return `"${value.replace(/"/g, "\"\"")}"`;
}

function foreignKeyRebuilds(): TableRebuild[] {
  return [
    {
      table: "ui_map_versions",
      expectedForeignKeys: 1,
      columns: ["id", "app_id", "version", "source", "status", "scan_config_json", "locked_by", "locked_until", "attempts", "created_at", "completed_at", "error"],
      createSql: `
        CREATE TABLE ui_map_versions (
          id TEXT PRIMARY KEY,
          app_id TEXT NOT NULL,
          version TEXT NOT NULL,
          source TEXT NOT NULL,
          status TEXT NOT NULL,
          scan_config_json TEXT,
          locked_by TEXT,
          locked_until TEXT,
          attempts INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL,
          completed_at TEXT,
          error TEXT,
          FOREIGN KEY (app_id) REFERENCES apps(id)
        );
      `
    },
    {
      table: "pages",
      expectedForeignKeys: 2,
      columns: ["id", "app_id", "ui_map_version_id", "name", "route", "url", "title", "status", "error", "created_at"],
      createSql: `
        CREATE TABLE pages (
          id TEXT PRIMARY KEY,
          app_id TEXT NOT NULL,
          ui_map_version_id TEXT NOT NULL,
          name TEXT NOT NULL,
          route TEXT NOT NULL,
          url TEXT NOT NULL,
          title TEXT,
          status TEXT NOT NULL,
          error TEXT,
          created_at TEXT NOT NULL,
          FOREIGN KEY (app_id) REFERENCES apps(id),
          FOREIGN KEY (ui_map_version_id) REFERENCES ui_map_versions(id)
        );
      `
    },
    {
      table: "ui_elements",
      expectedForeignKeys: 3,
      columns: [
        "id",
        "element_id",
        "app_id",
        "ui_map_version_id",
        "page_id",
        "route",
        "page_name",
        "element_type",
        "role",
        "label",
        "visible_text",
        "accessible_name",
        "placeholder",
        "aria_label",
        "input_name",
        "input_type",
        "description",
        "selector",
        "selector_type",
        "fallback_selectors_json",
        "nearby_text_json",
        "tags_json",
        "selector_quality",
        "selector_warnings_json",
        "state_name",
        "state_reason",
        "discovered_by",
        "fingerprint",
        "raw_json",
        "created_at",
        "updated_at"
      ],
      createSql: `
        CREATE TABLE ui_elements (
          id TEXT PRIMARY KEY,
          element_id TEXT NOT NULL,
          app_id TEXT NOT NULL,
          ui_map_version_id TEXT NOT NULL,
          page_id TEXT NOT NULL,
          route TEXT NOT NULL,
          page_name TEXT NOT NULL,
          element_type TEXT NOT NULL,
          role TEXT,
          label TEXT,
          visible_text TEXT,
          accessible_name TEXT,
          placeholder TEXT,
          aria_label TEXT,
          input_name TEXT,
          input_type TEXT,
          description TEXT NOT NULL,
          selector TEXT NOT NULL,
          selector_type TEXT NOT NULL,
          fallback_selectors_json TEXT NOT NULL,
          nearby_text_json TEXT NOT NULL,
          tags_json TEXT NOT NULL,
          selector_quality TEXT NOT NULL,
          selector_warnings_json TEXT NOT NULL,
          state_name TEXT NOT NULL DEFAULT 'default',
          state_reason TEXT,
          discovered_by TEXT NOT NULL DEFAULT 'route_scan',
          fingerprint TEXT NOT NULL DEFAULT '',
          raw_json TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          FOREIGN KEY (app_id) REFERENCES apps(id),
          FOREIGN KEY (ui_map_version_id) REFERENCES ui_map_versions(id),
          FOREIGN KEY (page_id) REFERENCES pages(id)
        );
      `,
      indexes: [
        "CREATE INDEX IF NOT EXISTS idx_ui_elements_app_route ON ui_elements(app_id, route);",
        "CREATE INDEX IF NOT EXISTS idx_ui_elements_fingerprint ON ui_elements(ui_map_version_id, fingerprint);"
      ]
    },
    {
      table: "workflow_videos",
      expectedForeignKeys: 1,
      columns: ["id", "app_id", "filename", "local_path", "mime_type", "size_bytes", "workflow_name", "workflow_description", "status", "uploaded_at"],
      createSql: `
        CREATE TABLE workflow_videos (
          id TEXT PRIMARY KEY,
          app_id TEXT NOT NULL,
          filename TEXT NOT NULL,
          local_path TEXT NOT NULL,
          mime_type TEXT NOT NULL,
          size_bytes INTEGER NOT NULL,
          workflow_name TEXT,
          workflow_description TEXT,
          status TEXT NOT NULL,
          uploaded_at TEXT NOT NULL,
          FOREIGN KEY (app_id) REFERENCES apps(id)
        );
      `
    },
    {
      table: "workflow_jobs",
      expectedForeignKeys: 2,
      columns: ["id", "app_id", "video_id", "status", "provider_raw_output_json", "extracted_action_timeline_json", "error", "locked_by", "locked_until", "attempts", "created_at", "updated_at"],
      createSql: `
        CREATE TABLE workflow_jobs (
          id TEXT PRIMARY KEY,
          app_id TEXT NOT NULL,
          video_id TEXT NOT NULL,
          status TEXT NOT NULL,
          provider_raw_output_json TEXT,
          extracted_action_timeline_json TEXT,
          error TEXT,
          locked_by TEXT,
          locked_until TEXT,
          attempts INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          FOREIGN KEY (app_id) REFERENCES apps(id),
          FOREIGN KEY (video_id) REFERENCES workflow_videos(id)
        );
      `
    },
    {
      table: "workflows",
      expectedForeignKeys: 1,
      columns: ["id", "workflow_id", "app_id", "name", "description", "status", "version", "workflow_json", "created_at", "updated_at"],
      createSql: `
        CREATE TABLE workflows (
          id TEXT PRIMARY KEY,
          workflow_id TEXT NOT NULL UNIQUE,
          app_id TEXT NOT NULL,
          name TEXT NOT NULL,
          description TEXT NOT NULL,
          status TEXT NOT NULL,
          version INTEGER NOT NULL,
          workflow_json TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          FOREIGN KEY (app_id) REFERENCES apps(id)
        );
      `,
      indexes: ["CREATE INDEX IF NOT EXISTS idx_workflows_app_status ON workflows(app_id, status);"]
    },
    {
      table: "runtime_sessions",
      expectedForeignKeys: 2,
      columns: ["id", "app_id", "workflow_id", "client_session_id", "user_id", "status", "current_step_id", "values_json", "started_at", "completed_at", "error"],
      createSql: `
        CREATE TABLE runtime_sessions (
          id TEXT PRIMARY KEY,
          app_id TEXT NOT NULL,
          workflow_id TEXT NOT NULL,
          client_session_id TEXT,
          user_id TEXT,
          status TEXT NOT NULL,
          current_step_id TEXT,
          values_json TEXT NOT NULL,
          started_at TEXT NOT NULL,
          completed_at TEXT,
          error TEXT,
          FOREIGN KEY (app_id) REFERENCES apps(id),
          FOREIGN KEY (workflow_id) REFERENCES workflows(workflow_id)
        );
      `
    },
    {
      table: "api_keys",
      expectedForeignKeys: 1,
      columns: ["id", "name", "prefix", "key_hash", "scopes_json", "app_id", "allowed_origins_json", "created_at", "last_used_at", "revoked_at"],
      createSql: `
        CREATE TABLE api_keys (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          prefix TEXT NOT NULL UNIQUE,
          key_hash TEXT NOT NULL,
          scopes_json TEXT NOT NULL,
          app_id TEXT,
          allowed_origins_json TEXT,
          created_at TEXT NOT NULL,
          last_used_at TEXT,
          revoked_at TEXT,
          FOREIGN KEY (app_id) REFERENCES apps(id)
        );
      `,
      indexes: [
        "CREATE INDEX IF NOT EXISTS idx_api_keys_prefix ON api_keys(prefix);",
        "CREATE INDEX IF NOT EXISTS idx_api_keys_active ON api_keys(prefix, revoked_at);"
      ]
    },
    {
      table: "console_sessions",
      expectedForeignKeys: 1,
      columns: ["id", "user_id", "token_hash", "created_at", "expires_at", "last_used_at", "revoked_at"],
      createSql: `
        CREATE TABLE console_sessions (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL,
          token_hash TEXT NOT NULL UNIQUE,
          created_at TEXT NOT NULL,
          expires_at TEXT NOT NULL,
          last_used_at TEXT,
          revoked_at TEXT,
          FOREIGN KEY (user_id) REFERENCES console_users(id)
        );
      `,
      indexes: ["CREATE INDEX IF NOT EXISTS idx_console_sessions_token ON console_sessions(token_hash);"]
    }
  ];
}

function ensureColumn(db: Db, table: string, column: string, definition: string): void {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (rows.some((row) => row.name === column)) return;
  db.prepare(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`).run();
}

function assertUniqueMigrationIds(): void {
  const seen = new Set<number>();
  for (const migration of migrations) {
    if (seen.has(migration.id)) throw new Error(`Duplicate database migration id: ${migration.id}`);
    seen.add(migration.id);
  }
}

function assertAppliedMigrationNames(appliedRows: Array<{ id: number; name: string }>): void {
  for (const row of appliedRows) {
    const migration = migrations.find((candidate) => candidate.id === row.id);
    if (migration && migration.name !== row.name) {
      throw new Error(`Database migration ${row.id} is recorded as ${row.name}, expected ${migration.name}.`);
    }
  }
}
