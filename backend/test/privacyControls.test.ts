import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { AppConfig } from "../src/config/env.js";
import { createDatabase } from "../src/db/database.js";
import { Repositories } from "../src/db/repositories.js";
import { TelemetryService } from "../src/services/privacy/telemetryService.js";

test("telemetry policy defaults to events and requires consent for full payloads", () => {
  const dir = mkdtempSync(join(tmpdir(), "mia-telemetry-"));
  const db = createDatabase(testConfig(dir));
  const repositories = new Repositories(db);
  const telemetry = new TelemetryService(repositories);

  try {
    repositories.upsertApp({ name: "Private app", slug: "private", baseUrl: "https://app.example.com" });
    const eventOnly = telemetry.prepareExecutionLog({
      appId: "app_private",
      requestedMode: "full",
      consent: true,
      payload: { text: "private transcript" }
    });
    assert.deepEqual(eventOnly, { telemetryLevel: "events_only", payload: {} });

    repositories.upsertApp({
      name: "Private app",
      slug: "private",
      baseUrl: "https://app.example.com",
      privacyPolicy: { telemetryMode: "redacted", retentionDays: 30 }
    });
    const redacted = telemetry.prepareExecutionLog({
      appId: "app_private",
      requestedMode: "full",
      consent: true,
      payload: { action: "click", text: "private transcript", authToken: "never-store-this" }
    });
    assert.equal(redacted.telemetryLevel, "redacted");
    assert.deepEqual(redacted.payload, { action: "click", text: "[redacted]", authToken: "[redacted]" });

    repositories.upsertApp({
      name: "Private app",
      slug: "private",
      baseUrl: "https://app.example.com",
      privacyPolicy: { telemetryMode: "full", retentionDays: 30 }
    });
    assert.deepEqual(telemetry.prepareExecutionLog({
      appId: "app_private",
      requestedMode: "full",
      consent: false,
      payload: { text: "private transcript" }
    }), { telemetryLevel: "events_only", payload: {} });
    assert.deepEqual(telemetry.prepareExecutionLog({
      appId: "app_private",
      requestedMode: "full",
      consent: true,
      payload: { text: "allowed transcript", password: "never-store-this" }
    }), { telemetryLevel: "full", payload: { text: "allowed transcript", password: "[redacted]" } });
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("user deletion and retention remove runtime records without workflow values", () => {
  const dir = mkdtempSync(join(tmpdir(), "mia-retention-"));
  const db = createDatabase(testConfig(dir));
  const repositories = new Repositories(db);

  try {
    repositories.upsertApp({
      name: "Retention app",
      slug: "retention",
      baseUrl: "https://app.example.com",
      privacyPolicy: { telemetryMode: "events_only", retentionDays: 1 }
    });
    repositories.insertExecutionLog({
      appId: "app_retention",
      userId: "user-delete",
      sessionId: "session-delete",
      eventType: "session_started",
      telemetryLevel: "events_only",
      payload: {}
    });
    const removed = repositories.deleteUserData("app_retention", "user-delete");
    assert.equal(removed.executionLogs, 1);

    repositories.insertExecutionLog({
      appId: "app_retention",
      userId: "user-old",
      sessionId: "session-old",
      eventType: "session_started",
      telemetryLevel: "events_only",
      payload: {}
    });
    repositories.insertAiLog({ appId: "app_retention", provider: "test", purpose: "test", inputSummary: "structural" });
    db.prepare("UPDATE execution_logs SET created_at = '2000-01-01T00:00:00.000Z' WHERE app_id = ?").run("app_retention");
    db.prepare("UPDATE ai_request_logs SET created_at = '2000-01-01T00:00:00.000Z' WHERE app_id = ?").run("app_retention");
    const purged = repositories.purgeExpiredData("app_retention");
    assert.equal(purged.executionLogs, 1);
    assert.equal(purged.aiRequestLogs, 1);
    assert.equal((repositories.exportAppData("app_retention").executionLogs as unknown[]).length, 0);
    assert.equal(columnNames(db, "runtime_sessions").includes("values_json"), false);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

function columnNames(db: ReturnType<typeof createDatabase>, table: string): string[] {
  return (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map((row) => row.name);
}

function testConfig(dir: string): AppConfig {
  return {
    NODE_ENV: "test",
    DATABASE_URL: `file:${join(dir, "local.db")}`,
    LOCAL_UPLOAD_DIR: join(dir, "uploads"),
    LOCAL_TTS_DIR: join(dir, "tts"),
    CONSOLE_DIST_DIR: join(dir, "console-dist"),
    SEMANTIC_INDEX_DIR: join(dir, "lancedb")
  } as AppConfig;
}
