import assert from "node:assert/strict";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import type { AppConfig } from "../src/config/env.js";
import { validateRuntimeConfig } from "../src/config/env.js";
import { assertSafeTargetUrl, resolveSameOriginRouteUrl } from "../src/services/security/targetUrlPolicy.js";
import { validateWorkflowVideoUpload } from "../src/services/security/workflowVideoUploadPolicy.js";
import { ConfigError, ValidationAppError } from "../src/utils/errors.js";

test("production CORS requires explicit origins", () => {
  assert.throws(
    () => validateRuntimeConfig(config({ NODE_ENV: "production", CORS_ORIGIN: "*" })),
    (error) => error instanceof ConfigError && error.message.includes("CORS_ORIGIN")
  );

  assert.doesNotThrow(() => validateRuntimeConfig(config({ NODE_ENV: "production", CORS_ORIGIN: "https://app.example.com" })));
});

test("target URL policy blocks private networks in production while allowing local development scans", async () => {
  await assert.rejects(
    assertSafeTargetUrl("http://169.254.169.254/latest/meta-data", config({ NODE_ENV: "production" })),
    (error) => error instanceof ValidationAppError && error.message.includes("private or reserved")
  );

  await assert.doesNotReject(assertSafeTargetUrl("http://127.0.0.1:3000", config({ NODE_ENV: "development" })));
  await assert.doesNotReject(assertSafeTargetUrl("https://93.184.216.34", config({ NODE_ENV: "production" })));
});

test("UI scan routes must stay on the app origin", () => {
  assert.equal(resolveSameOriginRouteUrl("/dashboard", "https://app.example.com"), "https://app.example.com/dashboard");
  assert.throws(
    () => resolveSameOriginRouteUrl("//internal.example.test/admin", "https://app.example.com"),
    (error) => error instanceof ValidationAppError && error.message.includes("app origin")
  );
  assert.throws(
    () => resolveSameOriginRouteUrl("https://other.example.com/admin", "https://app.example.com"),
    (error) => error instanceof ValidationAppError && error.message.includes("app origin")
  );
});

test("workflow video upload policy rejects disguised non-video uploads", () => {
  const mp4 = Buffer.concat([Buffer.from([0x00, 0x00, 0x00, 0x18]), Buffer.from("ftypisom"), Buffer.alloc(16)]);

  assert.doesNotThrow(() => validateWorkflowVideoUpload({
    buffer: mp4,
    filename: "workflow.mp4",
    mimetype: "video/mp4"
  }));

  assert.throws(
    () => validateWorkflowVideoUpload({
      buffer: Buffer.from("not actually a video"),
      filename: "workflow.mp4",
      mimetype: "video/mp4"
    }),
    (error) => error instanceof ValidationAppError && error.message.includes("content")
  );

  assert.throws(
    () => validateWorkflowVideoUpload({
      buffer: mp4,
      filename: "workflow.txt",
      mimetype: "text/plain"
    }),
    (error) => error instanceof ValidationAppError && error.message.includes("video")
  );
});

function config(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    NODE_ENV: "test",
    BACKEND_HOST: "127.0.0.1",
    BACKEND_PORT: 4000,
    TRUST_PROXY: false,
    CORS_ORIGIN: "https://app.example.com",
    DATABASE_URL: `file:${join(tmpdir(), "mia-security-policy-test.db")}`,
    LOCAL_UPLOAD_DIR: join(tmpdir(), "mia-security-policy-uploads"),
    CONSOLE_DIST_DIR: join(tmpdir(), "mia-security-policy-console-dist"),
    MIA_SECRET_ENCRYPTION_KEY: "test-secret-encryption-key",
    BOOTSTRAP_ADMIN_TOKEN: "bootstrap-secret",
    CONSOLE_SESSION_TTL_SECONDS: 28800,
    CONSOLE_AUTH_RATE_LIMIT_MAX: 8,
    RATE_LIMIT_WINDOW_MS: 60_000,
    RATE_LIMIT_MAX: 300,
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
    SEMANTIC_INDEX_DIR: join(tmpdir(), "mia-security-policy-lancedb"),
    UI_SCAN_AUTH_MODE: "none",
    UI_SCAN_POST_LOGIN_WAIT_MS: 1000,
    UI_SCAN_HEADLESS: true,
    UI_SCAN_ALLOW_PRIVATE_NETWORKS: false,
    ...overrides
  };
}
