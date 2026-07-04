import Database from "better-sqlite3";
import { dirname, resolve } from "node:path";
import { mkdirSync } from "node:fs";
import type { AppConfig } from "../config/env.js";

export type Db = Database.Database;

export function createDatabase(config: AppConfig): Db {
  const dbPath = resolveDatabasePath(config.DATABASE_URL);
  mkdirSync(dirname(dbPath), { recursive: true });

  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  migrate(db);
  return db;
}

function resolveDatabasePath(databaseUrl: string): string {
  if (databaseUrl.startsWith("file:")) {
    return resolve(process.cwd(), databaseUrl.slice("file:".length));
  }

  return resolve(process.cwd(), databaseUrl);
}

function migrate(db: Db): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS apps (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      base_url TEXT NOT NULL,
      ui_scan_config_json TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
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
      error TEXT
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
      created_at TEXT NOT NULL
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
      updated_at TEXT NOT NULL
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
      uploaded_at TEXT NOT NULL
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
      updated_at TEXT NOT NULL
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
      updated_at TEXT NOT NULL
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
      error TEXT
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
      revoked_at TEXT
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
      revoked_at TEXT
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

  ensureColumn(db, "ui_elements", "state_name", "TEXT NOT NULL DEFAULT 'default'");
  ensureColumn(db, "ui_elements", "state_reason", "TEXT");
  ensureColumn(db, "ui_elements", "discovered_by", "TEXT NOT NULL DEFAULT 'route_scan'");
  ensureColumn(db, "ui_elements", "fingerprint", "TEXT NOT NULL DEFAULT ''");
  ensureColumn(db, "apps", "ui_scan_config_json", "TEXT");
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

function ensureColumn(db: Db, table: string, column: string, definition: string): void {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (rows.some((row) => row.name === column)) return;
  db.prepare(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`).run();
}
