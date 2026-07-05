import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { AppConfig } from "../src/config/env.js";
import { createDatabase } from "../src/db/database.js";

test("database migrations are recorded and idempotent", () => {
  const dir = mkdtempSync(join(tmpdir(), "mia-db-migrations-"));

  try {
    const first = createDatabase(testConfig(dir));
    assert.deepEqual(
      first.prepare("SELECT id, name FROM schema_migrations ORDER BY id").all(),
      [{ id: 1, name: "initial_schema" }]
    );
    assert.equal(Number(first.pragma("user_version", { simple: true })), 1);
    first.close();

    const second = createDatabase(testConfig(dir));
    assert.deepEqual(
      second.prepare("SELECT id, name FROM schema_migrations ORDER BY id").all(),
      [{ id: 1, name: "initial_schema" }]
    );
    second.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

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
    RATE_LIMIT_WINDOW_MS: 60_000,
    RATE_LIMIT_MAX: 300,
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
