import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { buildApp, safeErrorLogPayload } from "../src/app.js";
import type { AppConfig } from "../src/config/env.js";
import { AppError } from "../src/utils/errors.js";

test("server error log payload omits private AppError details", () => {
  const payload = safeErrorLogPayload(new AppError("PROVIDER_JSON_ERROR", "Gemini returned invalid JSON.", 502, {
    text: "raw provider output with private content"
  }));

  assert.equal(payload.err.code, "PROVIDER_JSON_ERROR");
  assert.equal(JSON.stringify(payload).includes("raw provider output"), false);
  assert.equal(JSON.stringify(payload).includes("private content"), false);
});

test("server errors are sanitized before they reach clients", async () => {
  const dir = mkdtempSync(join(tmpdir(), "mia-error-handling-"));
  const app = await buildApp(testConfig(dir));

  try {
    app.get("/test/provider-error", async () => {
      throw new AppError("PROVIDER_JSON_ERROR", "Gemini returned invalid JSON.", 502, {
        text: "raw provider output with private content"
      });
    });
    app.get("/test/internal-error", async () => {
      throw new Error("database path /private/secret.db failed");
    });

    const provider = await app.inject({ method: "GET", url: "/test/provider-error" });
    assert.equal(provider.statusCode, 502);
    assert.deepEqual(provider.json(), {
      error: {
        code: "PROVIDER_JSON_ERROR",
        message: "Upstream provider request failed."
      }
    });

    const internal = await app.inject({ method: "GET", url: "/test/internal-error" });
    assert.equal(internal.statusCode, 500);
    assert.deepEqual(internal.json(), {
      error: {
        code: "INTERNAL_SERVER_ERROR",
        message: "Internal server error."
      }
    });
  } finally {
    await app.close();
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
    MIA_SECRET_ENCRYPTION_KEY: "test-secret-encryption-key",
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
