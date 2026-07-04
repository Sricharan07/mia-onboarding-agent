import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { buildApp } from "../src/app.js";
import type { AppConfig } from "../src/config/env.js";
import { createDatabase } from "../src/db/database.js";
import { Repositories } from "../src/db/repositories.js";
import type { Workflow } from "../src/schemas/domain.js";

test("admin routes require an admin API key after bootstrap", async () => {
  const dir = mkdtempSync(join(tmpdir(), "mia-auth-"));
  const app = await buildApp(testConfig(dir));

  try {
    const unauthenticatedCreate = await app.inject({
      method: "POST",
      url: "/api/v1/apps",
      payload: { name: "Local app", slug: "local-app", baseUrl: "http://localhost:3000" }
    });
    assert.equal(unauthenticatedCreate.statusCode, 401);

    const bootstrap = await app.inject({
      method: "POST",
      url: "/api/v1/api-keys",
      headers: { "x-bootstrap-admin-token": "bootstrap-secret" },
      payload: { name: "admin", scopes: ["admin"] }
    });
    assert.equal(bootstrap.statusCode, 200);
    const adminKey = bootstrap.json<{ key: string }>().key;

    const authenticatedCreate = await app.inject({
      method: "POST",
      url: "/api/v1/apps",
      headers: { authorization: `Bearer ${adminKey}` },
      payload: { name: "Local app", slug: "local-app", baseUrl: "http://localhost:3000" }
    });
    assert.equal(authenticatedCreate.statusCode, 200);

    const unauthenticatedList = await app.inject({ method: "GET", url: "/api/v1/apps" });
    assert.equal(unauthenticatedList.statusCode, 401);

    const authenticatedList = await app.inject({
      method: "GET",
      url: "/api/v1/apps",
      headers: { authorization: `Bearer ${adminKey}` }
    });
    assert.equal(authenticatedList.statusCode, 200);
    assert.equal(authenticatedList.json<{ items: unknown[] }>().items.length, 1);
  } finally {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("workflow metadata patch accepts only editable fields", async () => {
  const dir = mkdtempSync(join(tmpdir(), "mia-workflow-routes-"));
  const config = testConfig(dir);
  const app = await buildApp(config);
  const db = createDatabase(config);
  const repositories = new Repositories(db);

  try {
    const bootstrap = await app.inject({
      method: "POST",
      url: "/api/v1/api-keys",
      headers: { "x-bootstrap-admin-token": "bootstrap-secret" },
      payload: { name: "admin", scopes: ["admin"] }
    });
    const adminKey = bootstrap.json<{ key: string }>().key;

    repositories.saveWorkflow(workflow({
      workflowId: "workflow_patchable",
      appId: "app_route"
    }));

    const patch = await app.inject({
      method: "PATCH",
      url: "/api/v1/workflows/workflow_patchable",
      headers: { authorization: `Bearer ${adminKey}` },
      payload: {
        name: "Updated workflow",
        description: "Updated workflow description.",
        triggerPhrases: ["updated workflow"]
      }
    });
    assert.equal(patch.statusCode, 200);
    const updated = repositories.getWorkflow("workflow_patchable");
    assert.equal(updated.name, "Updated workflow");
    assert.equal(updated.description, "Updated workflow description.");
    assert.deepEqual(updated.triggerPhrases, ["updated workflow"]);
    assert.equal(updated.status, "needs_review");

    const statusPatch = await app.inject({
      method: "PATCH",
      url: "/api/v1/workflows/workflow_patchable",
      headers: { authorization: `Bearer ${adminKey}` },
      payload: { status: "published" }
    });
    assert.equal(statusPatch.statusCode, 400);
    assert.equal(repositories.getWorkflow("workflow_patchable").status, "needs_review");
  } finally {
    db.close();
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("CORS preflight allows console mutation methods", async () => {
  const dir = mkdtempSync(join(tmpdir(), "mia-cors-"));
  const app = await buildApp(testConfig(dir));

  try {
    for (const method of ["PATCH", "DELETE"]) {
      const preflight = await app.inject({
        method: "OPTIONS",
        url: method === "PATCH" ? "/api/v1/workflows/workflow_one" : "/api/v1/api-keys/key_one",
        headers: {
          origin: "http://127.0.0.1:5191",
          "access-control-request-method": method,
          "access-control-request-headers": "authorization,content-type"
        }
      });
      assert.equal(preflight.statusCode, 204);
      assert.match(String(preflight.headers["access-control-allow-methods"]), new RegExp(method));
    }
  } finally {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("non-admin API keys are bound to one app and allowed origins", async () => {
  const dir = mkdtempSync(join(tmpdir(), "mia-app-key-"));
  const app = await buildApp(testConfig(dir));

  try {
    const bootstrap = await app.inject({
      method: "POST",
      url: "/api/v1/api-keys",
      headers: { "x-bootstrap-admin-token": "bootstrap-secret" },
      payload: { name: "admin", scopes: ["admin"] }
    });
    const adminKey = bootstrap.json<{ key: string }>().key;

    const createdApp = await app.inject({
      method: "POST",
      url: "/api/v1/apps",
      headers: { authorization: `Bearer ${adminKey}` },
      payload: { name: "Bound app", slug: "bound-app", baseUrl: "http://localhost:3000" }
    });
    const appId = createdApp.json<{ id: string }>().id;

    const unknownAppKey = await app.inject({
      method: "POST",
      url: "/api/v1/api-keys",
      headers: { authorization: `Bearer ${adminKey}` },
      payload: {
        name: "bad SDK key",
        scopes: ["logs:write"],
        appId: "app_missing",
        allowedOrigins: ["http://localhost:3000"]
      }
    });
    assert.equal(unknownAppKey.statusCode, 404);

    const keyResponse = await app.inject({
      method: "POST",
      url: "/api/v1/api-keys",
      headers: { authorization: `Bearer ${adminKey}` },
      payload: {
        name: "SDK key",
        scopes: ["logs:write"],
        appId,
        allowedOrigins: ["http://localhost:3000"]
      }
    });
    assert.equal(keyResponse.statusCode, 200);
    const sdkKey = keyResponse.json<{ key: string }>().key;

    const ok = await app.inject({
      method: "POST",
      url: "/api/v1/logs/execution",
      headers: { authorization: `Bearer ${sdkKey}`, origin: "http://localhost:3000" },
      payload: { appId, eventType: "session_started" }
    });
    assert.equal(ok.statusCode, 200);

    const wrongOrigin = await app.inject({
      method: "POST",
      url: "/api/v1/logs/execution",
      headers: { authorization: `Bearer ${sdkKey}`, origin: "http://evil.test" },
      payload: { appId, eventType: "session_started" }
    });
    assert.equal(wrongOrigin.statusCode, 403);

    const missingApp = await app.inject({
      method: "POST",
      url: "/api/v1/logs/execution",
      headers: { authorization: `Bearer ${sdkKey}`, origin: "http://localhost:3000" },
      payload: { eventType: "session_started" }
    });
    assert.equal(missingApp.statusCode, 403);
  } finally {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("non-admin read API keys can only read their bound app", async () => {
  const dir = mkdtempSync(join(tmpdir(), "mia-read-key-"));
  const app = await buildApp(testConfig(dir));

  try {
    const bootstrap = await app.inject({
      method: "POST",
      url: "/api/v1/api-keys",
      headers: { "x-bootstrap-admin-token": "bootstrap-secret" },
      payload: { name: "admin", scopes: ["admin"] }
    });
    const adminKey = bootstrap.json<{ key: string }>().key;

    const firstApp = await app.inject({
      method: "POST",
      url: "/api/v1/apps",
      headers: { authorization: `Bearer ${adminKey}` },
      payload: { name: "First app", slug: "first-app", baseUrl: "http://localhost:3000" }
    });
    const firstAppId = firstApp.json<{ id: string }>().id;

    const secondApp = await app.inject({
      method: "POST",
      url: "/api/v1/apps",
      headers: { authorization: `Bearer ${adminKey}` },
      payload: { name: "Second app", slug: "second-app", baseUrl: "http://localhost:4000" }
    });
    const secondAppId = secondApp.json<{ id: string }>().id;

    const keyResponse = await app.inject({
      method: "POST",
      url: "/api/v1/api-keys",
      headers: { authorization: `Bearer ${adminKey}` },
      payload: {
        name: "read key",
        scopes: ["apps:read", "workflows:read"],
        appId: firstAppId,
        allowedOrigins: ["http://localhost:3000"]
      }
    });
    assert.equal(keyResponse.statusCode, 200);
    const readKey = keyResponse.json<{ key: string }>().key;

    const visibleApps = await app.inject({
      method: "GET",
      url: "/api/v1/apps",
      headers: { authorization: `Bearer ${readKey}`, origin: "http://localhost:3000" }
    });
    assert.equal(visibleApps.statusCode, 200);
    assert.deepEqual(visibleApps.json<{ items: Array<{ id: string }> }>().items.map((item) => item.id), [firstAppId]);

    const ownWorkflows = await app.inject({
      method: "GET",
      url: `/api/v1/apps/${firstAppId}/workflows`,
      headers: { authorization: `Bearer ${readKey}`, origin: "http://localhost:3000" }
    });
    assert.equal(ownWorkflows.statusCode, 200);

    const otherWorkflows = await app.inject({
      method: "GET",
      url: `/api/v1/apps/${secondAppId}/workflows`,
      headers: { authorization: `Bearer ${readKey}`, origin: "http://localhost:3000" }
    });
    assert.equal(otherWorkflows.statusCode, 403);
  } finally {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

function workflow(input: Partial<Workflow> = {}): Workflow {
  const now = "2026-01-01T00:00:00.000Z";
  return {
    workflowId: input.workflowId ?? "workflow_one",
    appId: input.appId ?? "app_one",
    name: input.name ?? "Invite teammate",
    description: input.description ?? "Invite a teammate.",
    status: input.status ?? "needs_review",
    version: input.version ?? 1,
    triggerPhrases: input.triggerPhrases ?? ["invite teammate"],
    requiredContext: input.requiredContext ?? { app: input.appId ?? "app_one", startingRoutes: [] },
    steps: input.steps ?? [{ id: "complete", type: "complete", message: "Done." }],
    createdFrom: input.createdFrom,
    review: input.review ?? {},
    createdAt: input.createdAt ?? now,
    updatedAt: input.updatedAt ?? now
  };
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
    BOOTSTRAP_ADMIN_TOKEN: "bootstrap-secret",
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
    UI_SCAN_HEADLESS: true
  };
}
