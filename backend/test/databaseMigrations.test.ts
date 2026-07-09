import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { AppConfig } from "../src/config/env.js";
import { createDatabase } from "../src/db/database.js";
import { runMigrations } from "../src/db/migrations.js";

const currentMigrations = [
  { id: 1, name: "initial_schema" },
  { id: 2, name: "schema_hardening_columns" },
  { id: 3, name: "foreign_key_constraints" },
  { id: 4, name: "runtime_access_tokens_and_quotas" },
  { id: 5, name: "privacy_controls_and_data_minimization" }
];

test("database migrations are recorded and idempotent", () => {
  const dir = mkdtempSync(join(tmpdir(), "mia-db-migrations-"));

  try {
    const first = createDatabase(testConfig(dir));
    assert.deepEqual(
      first.prepare("SELECT id, name FROM schema_migrations ORDER BY id").all(),
      currentMigrations
    );
    assert.equal(Number(first.pragma("user_version", { simple: true })), 5);
    assert.equal(columnNames(first, "runtime_sessions").includes("values_json"), false);
    first.close();

    const second = createDatabase(testConfig(dir));
    assert.deepEqual(
      second.prepare("SELECT id, name FROM schema_migrations ORDER BY id").all(),
      currentMigrations
    );
    second.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("database schema enforces core foreign key relationships", () => {
  const dir = mkdtempSync(join(tmpdir(), "mia-db-foreign-keys-"));

  try {
    const db = createDatabase(testConfig(dir));
    const expected = new Map([
      ["ui_map_versions", 1],
      ["pages", 2],
      ["ui_elements", 3],
      ["workflow_videos", 1],
      ["workflow_jobs", 2],
      ["workflows", 1],
      ["runtime_sessions", 2],
      ["api_keys", 1],
      ["runtime_access_tokens", 1],
      ["console_sessions", 1]
    ]);

    for (const [table, count] of expected) {
      assert.equal(foreignKeyCount(db, table), count, table);
    }

    db.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("database hardening columns migrate when only the initial migration was recorded", () => {
  const dir = mkdtempSync(join(tmpdir(), "mia-db-hardening-"));
  const db = createDatabase(testConfig(dir));

  try {
    db.exec(`
      DROP INDEX IF EXISTS idx_ui_elements_fingerprint;
      ALTER TABLE ui_elements DROP COLUMN fingerprint;
      DELETE FROM schema_migrations WHERE id IN (2, 3, 4, 5);
      PRAGMA user_version = 1;
    `);

    runMigrations(db);

    assert.ok(columnNames(db, "ui_elements").includes("fingerprint"));
    assert.deepEqual(
      db.prepare("SELECT id, name FROM schema_migrations ORDER BY id").all(),
      currentMigrations
    );
    assert.equal(Number(db.pragma("user_version", { simple: true })), 5);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("foreign key migration rebuilds legacy tables without constraints", () => {
  const dir = mkdtempSync(join(tmpdir(), "mia-db-legacy-fks-"));
  const db = createDatabase(testConfig(dir));

  try {
    db.exec(`
      ALTER TABLE api_keys RENAME TO api_keys_without_fk;
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
        revoked_at TEXT
      );
      INSERT INTO api_keys (id, name, prefix, key_hash, scopes_json, app_id, allowed_origins_json, created_at, last_used_at, revoked_at)
      SELECT id, name, prefix, key_hash, scopes_json, app_id, allowed_origins_json, created_at, last_used_at, revoked_at FROM api_keys_without_fk;
      DROP TABLE api_keys_without_fk;
      DELETE FROM schema_migrations WHERE id IN (3, 4, 5);
      PRAGMA user_version = 2;
    `);
    assert.equal(foreignKeyCount(db, "api_keys"), 0);

    runMigrations(db);

    assert.equal(foreignKeyCount(db, "api_keys"), 1);
    assert.deepEqual(
      db.prepare("SELECT id, name FROM schema_migrations ORDER BY id").all(),
      currentMigrations
    );
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

function foreignKeyCount(db: Database.Database, table: string): number {
  return db.prepare(`PRAGMA foreign_key_list(${table})`).all().length;
}

function columnNames(db: Database.Database, table: string): string[] {
  return (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map((row) => row.name);
}

function testConfig(dir: string): AppConfig {
  return {
    NODE_ENV: "test",
    BACKEND_HOST: "127.0.0.1",
    BACKEND_PORT: 4000,
    TRUST_PROXY: false,
    CORS_ORIGIN: "*",
    DATABASE_URL: `file:${join(dir, "local.db")}`,
    LOCAL_UPLOAD_DIR: join(dir, "uploads"),
    CONSOLE_DIST_DIR: join(dir, "console-dist"),
    BOOTSTRAP_ADMIN_TOKEN: "bootstrap-secret",
    CONSOLE_SESSION_TTL_SECONDS: 28800,
    CONSOLE_AUTH_RATE_LIMIT_MAX: 8,
    RATE_LIMIT_WINDOW_MS: 60_000,
    RATE_LIMIT_MAX: 300,
    RUNTIME_TOKEN_TTL_SECONDS: 900,
    RUNTIME_TOKEN_MAX_USES: 2_000,
    RUNTIME_RATE_LIMIT_MAX: 180,
    APP_RATE_LIMIT_MAX: 1_200,
    APP_VOICE_RATE_LIMIT_MAX: 120,
    WORKFLOW_VIDEO_MAX_BYTES: 50 * 1024 * 1024,
    GEMINI_LIVE_TOKEN_RATE_LIMIT_MAX: 30,
    GEMINI_BASE_URL: "https://generativelanguage.googleapis.com",
    GEMINI_TEXT_MODEL: "gemini-2.5-flash",
    GEMINI_VISION_MODEL: "gemini-2.5-flash",
    GEMINI_LIVE_MODEL: "gemini-3.1-flash-live-preview",
    GEMINI_TOKEN_TTL_SECONDS: 1800,
    GEMINI_NEW_SESSION_TTL_SECONDS: 60,
    OPENAI_BASE_URL: "https://api.openai.com/v1",
    OPENAI_EMBEDDING_MODEL: "text-embedding-3-small",
    OPENAI_EMBEDDING_DIMENSIONS: 1536,
    SEMANTIC_INDEX_DIR: join(dir, "lancedb"),
    UI_SCAN_AUTH_MODE: "none",
    UI_SCAN_POST_LOGIN_WAIT_MS: 1000,
    UI_SCAN_HEADLESS: true,
    UI_SCAN_ALLOW_PRIVATE_NETWORKS: false
  };
}
