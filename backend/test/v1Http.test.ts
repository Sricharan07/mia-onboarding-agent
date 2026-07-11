import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { PlannerDecision } from "../src/v1/domain.js";
import type { V1Config } from "../src/v1/config.js";
import { buildApp } from "../src/v1/app.js";
import { V1Database } from "../src/v1/db/database.js";

const databaseUrl = process.env.MIA_TEST_DATABASE_URL;

test("v1 HTTP API supports secure setup, runtime tokens, agent turns, and SSE", {
  skip: databaseUrl ? false : "Set MIA_TEST_DATABASE_URL to run PostgreSQL integration tests."
}, async () => {
  assert.ok(databaseUrl);
  const parsed = new URL(databaseUrl);
  assert.match(parsed.pathname, /test/i, "Refusing to reset a database whose name does not contain test.");
  const reset = new V1Database({ DATABASE_URL: databaseUrl, DATABASE_POOL_MAX: 2 });
  await reset.query("DROP SCHEMA public CASCADE");
  await reset.query("CREATE SCHEMA public");
  await reset.close();

  const directory = mkdtempSync(join(tmpdir(), "mia-v1-http-"));
  const model = new FakeModel();
  const app = await buildApp(config(databaseUrl, directory), { model });
  try {
    const health = await app.inject({ method: "GET", url: "/api/v1/health" });
    assert.equal(health.statusCode, 200);
    assert.equal(health.headers["cache-control"], "no-store");
    assert.match(health.headers["content-security-policy"] ?? "", /default-src 'self'/);

    const status = await app.inject({ method: "GET", url: "/api/v1/setup/status" });
    assert.deepEqual(status.json(), {
      setupRequired: true,
      authenticated: false,
      gemini: { configured: false }
    });

    const rejected = await app.inject({
      method: "POST",
      url: "/api/v1/setup",
      payload: setupPayload("wrong")
    });
    assert.equal(rejected.statusCode, 401);

    const setup = await app.inject({
      method: "POST",
      url: "/api/v1/setup",
      payload: setupPayload("setup-test-token")
    });
    assert.equal(setup.statusCode, 200, setup.body);
    const adminToken = setup.json<{ token: string }>().token;
    assert.match(adminToken, /^mia_admin_/);

    const credentials = await app.inject({
      method: "PUT",
      url: "/api/v1/product/gemini",
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { apiKey: "test-gemini-key-that-is-long-enough" }
    });
    assert.deepEqual(credentials.json(), { configured: true, source: "database" });
    const encrypted = await app.inject({
      method: "GET",
      url: "/api/v1/product/gemini",
      headers: { authorization: `Bearer ${adminToken}` }
    });
    assert.equal(encrypted.body.includes("test-gemini-key"), false);

    const keyResponse = await app.inject({
      method: "POST",
      url: "/api/v1/integration-keys",
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { name: "Demo CRM server" }
    });
    assert.equal(keyResponse.statusCode, 200, keyResponse.body);
    const integrationKey = keyResponse.json<{ key: string }>().key;
    assert.match(integrationKey, /^mia_key_/);

    const boundary = "mia-http-test-boundary";
    const documentResponse = await app.inject({
      method: "POST",
      url: "/api/v1/knowledge/files",
      headers: {
        authorization: `Bearer ${adminToken}`,
        "content-type": `multipart/form-data; boundary=${boundary}`
      },
      payload: multipartFile(boundary, "guide.txt", "text/plain", "Mia test product guide with enough indexable content.")
    });
    assert.equal(documentResponse.statusCode, 200, documentResponse.body);
    assert.equal("filePath" in documentResponse.json<Record<string, unknown>>(), false);
    assert.equal(documentResponse.body.includes(directory), false);
    const sourcesResponse = await app.inject({
      method: "GET",
      url: "/api/v1/knowledge",
      headers: { authorization: `Bearer ${adminToken}` }
    });
    const sources = sourcesResponse.json<{ items: Array<Record<string, unknown>> }>().items;
    assert.equal(sources.some((source) => "filePath" in source), false);
    assert.equal(sourcesResponse.body.includes(directory), false);

    const runtimeTokenResponse = await app.inject({
      method: "POST",
      url: "/api/v1/runtime/tokens",
      headers: { "x-mia-key": integrationKey },
      payload: { userId: "demo-user", origin: "http://localhost:3001" }
    });
    assert.equal(runtimeTokenResponse.statusCode, 200, runtimeTokenResponse.body);
    const runtimeToken = runtimeTokenResponse.json<{ token: string }>().token;

    const created = await app.inject({
      method: "POST",
      url: "/api/v1/runtime/sessions",
      headers: runtimeHeaders(runtimeToken),
      payload: runtimePayload()
    });
    assert.equal(created.statusCode, 200, created.body);
    const session = created.json<{ sessionId: string; revision: number; resumeToken: string }>();
    assert.match(session.resumeToken, /^mia_resume_/);

    model.push(answer("This page shows the CRM pipeline."));
    const turn = await app.inject({
      method: "POST",
      url: `/api/v1/runtime/sessions/${session.sessionId}/turns`,
      headers: runtimeHeaders(runtimeToken),
      payload: { ...runtimePayload(), revision: session.revision, utterance: "What is this page?", source: "text" }
    });
    assert.equal(turn.statusCode, 200, turn.body);
    assert.equal(turn.json<{ type: string }>().type, "answer");

    const sdkEvent = await app.inject({
      method: "POST",
      url: "/api/v1/runtime/events",
      headers: runtimeHeaders(runtimeToken),
      payload: {
        sessionId: session.sessionId,
        eventType: "sdk_ready",
        payload: { route: "/dashboard/crm", token: "abcdefghijklmnopqrstuvwxyz1234567890" }
      }
    });
    assert.equal(sdkEvent.statusCode, 200, sdkEvent.body);

    const checklist = await app.inject({
      method: "GET",
      url: "/api/v1/setup/checklist",
      headers: { authorization: `Bearer ${adminToken}` }
    });
    assert.equal(checklist.statusCode, 200, checklist.body);
    assert.equal(checklist.json<{ sdk: { detected: boolean; lastRoute: string } }>().sdk.detected, true);
    assert.equal(checklist.json<{ sdk: { detected: boolean; lastRoute: string } }>().sdk.lastRoute, "/dashboard/crm");
    const acceptance = checklist.json<{ acceptance: { answer: { passed: boolean }; point: { passed: boolean } } }>().acceptance;
    assert.equal(acceptance.answer.passed, true);
    assert.equal(acceptance.point.passed, false);

    const run = await app.inject({
      method: "GET",
      url: `/api/v1/runs/${session.sessionId}`,
      headers: { authorization: `Bearer ${adminToken}` }
    });
    assert.equal(run.statusCode, 200, run.body);
    assert.equal(run.body.includes("resumeTokenHash"), false);
    assert.equal(run.body.includes("bindingHash"), false);
    assert.equal(run.body.includes("abcdefghijklmnopqrstuvwxyz1234567890"), false);
    const sdkDiagnostic = run.json<{ events: Array<{ eventType: string; payload: { token?: string } }> }>()
      .events.find((event) => event.eventType === "sdk_ready");
    assert.equal(sdkDiagnostic?.payload.token, "[redacted]");

    const runList = await app.inject({
      method: "GET",
      url: "/api/v1/runs",
      headers: { authorization: `Bearer ${adminToken}` }
    });
    assert.equal(runList.statusCode, 200, runList.body);
    assert.equal(runList.json<{ items: Array<{ id: string }> }>().items[0]?.id, session.sessionId);

    await app.inject({
      method: "PATCH",
      url: "/api/v1/product",
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { transcriptMode: "disabled" }
    });
    const privacyDatabase = new V1Database({ DATABASE_URL: databaseUrl, DATABASE_POOL_MAX: 1 });
    const purgedTurns = await privacyDatabase.query<{ count: number }>("SELECT COUNT(*)::int AS count FROM agent_turns");
    assert.equal(purgedTurns.rows[0]?.count, 0);
    const hiddenRun = await app.inject({
      method: "GET",
      url: `/api/v1/runs/${session.sessionId}`,
      headers: { authorization: `Bearer ${adminToken}` }
    });
    const hidden = hiddenRun.json<{ transcriptAvailable: boolean; turns: unknown[]; session: { goal: string } }>();
    assert.equal(hidden.transcriptAvailable, false);
    assert.deepEqual(hidden.turns, []);
    assert.equal(hidden.session.goal, "Transcript logging disabled");

    const secondSession = await app.inject({
      method: "POST",
      url: "/api/v1/runtime/sessions",
      headers: runtimeHeaders(runtimeToken),
      payload: runtimePayload(2)
    });
    const second = secondSession.json<{ sessionId: string; revision: number }>();
    model.push(answer("The highlighted metric is monthly revenue."));
    const stream = await app.inject({
      method: "POST",
      url: `/api/v1/runtime/sessions/${second.sessionId}/turns/stream`,
      headers: runtimeHeaders(runtimeToken),
      payload: { ...runtimePayload(2), revision: second.revision, utterance: "Explain revenue", source: "voice" }
    });
    assert.equal(stream.statusCode, 200, stream.body);
    assert.match(stream.headers["content-type"] ?? "", /text\/event-stream/);
    assert.match(stream.body, /event: thinking/);
    assert.match(stream.body, /event: answer/);
    const disabledTurns = await privacyDatabase.query<{ count: number }>("SELECT COUNT(*)::int AS count FROM agent_turns");
    assert.equal(disabledTurns.rows[0]?.count, 0);
    await privacyDatabase.close();

    const interruptedSessionResponse = await app.inject({
      method: "POST",
      url: "/api/v1/runtime/sessions",
      headers: runtimeHeaders(runtimeToken),
      payload: runtimePayload(3)
    });
    const interruptedSession = interruptedSessionResponse.json<{ sessionId: string; revision: number }>();
    const blockedDecision = model.blockNextDecision();
    await app.listen({ host: "127.0.0.1", port: 0 });
    const address = app.server.address();
    assert.ok(address && typeof address === "object");
    const abort = new AbortController();
    const interruptedRequest = fetch(`http://127.0.0.1:${address.port}/api/v1/runtime/sessions/${interruptedSession.sessionId}/turns/stream`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${runtimeToken}`,
        origin: "http://localhost:3001",
        "content-type": "application/json",
        accept: "text/event-stream"
      },
      body: JSON.stringify({
        ...runtimePayload(3),
        revision: interruptedSession.revision,
        utterance: "Keep thinking until I stop",
        source: "text"
      }),
      signal: abort.signal
    }).then((response) => response.text());
    await blockedDecision.started;
    abort.abort();
    await assert.rejects(interruptedRequest, /abort/i);
    await withDeadline(blockedDecision.aborted, 2_000, "The disconnected SSE request did not abort its model call.");

    const removedCompatibility = await app.inject({
      method: "GET",
      url: "/api/v1/apps",
      headers: { authorization: `Bearer ${adminToken}` }
    });
    assert.equal(removedCompatibility.statusCode, 404);

    const ready = await app.inject({ method: "GET", url: "/api/v1/ready" });
    assert.equal(ready.statusCode, 200);
    assert.equal(ready.json<{ setupRequired: boolean; geminiConfigured: boolean }>().setupRequired, false);
    assert.equal(ready.json<{ setupRequired: boolean; geminiConfigured: boolean }>().geminiConfigured, true);
  } finally {
    await app.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

class FakeModel {
  private readonly decisions: PlannerDecision[] = [];
  private blocked?: { started: () => void; aborted: () => void };

  push(value: PlannerDecision): void {
    this.decisions.push(value);
  }

  blockNextDecision(): { started: Promise<void>; aborted: Promise<void> } {
    let start!: () => void;
    let abort!: () => void;
    const started = new Promise<void>((resolve) => { start = resolve; });
    const aborted = new Promise<void>((resolve) => { abort = resolve; });
    this.blocked = { started: start, aborted: abort };
    return { started, aborted };
  }

  async decide(input?: { signal?: AbortSignal }) {
    const blocked = this.blocked;
    if (blocked) {
      this.blocked = undefined;
      blocked.started();
      await new Promise<never>((_resolve, reject) => {
        const fail = () => {
          blocked.aborted();
          reject(input?.signal?.reason ?? new DOMException("Aborted", "AbortError"));
        };
        if (input?.signal?.aborted) fail();
        else input?.signal?.addEventListener("abort", fail, { once: true });
      });
    }
    const decision = this.decisions.shift();
    assert.ok(decision);
    return { decision, latencyMs: 1, usage: {} };
  }

  async judge() {
    return { satisfied: true, summary: "Verified", missingEvidence: [] };
  }

  async embed(texts: string[]) {
    return texts.map(() => Array(768).fill(0));
  }
}

async function withDeadline<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error(message)), timeoutMs); })
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function config(url: string, directory: string): V1Config {
  return {
    NODE_ENV: "test",
    BACKEND_HOST: "127.0.0.1",
    BACKEND_PORT: 4000,
    TRUST_PROXY: false,
    CORS_ORIGIN: "*",
    DATABASE_URL: url,
    DATABASE_POOL_MAX: 3,
    LOCAL_UPLOAD_DIR: join(directory, "uploads"),
    CONSOLE_DIST_DIR: join(directory, "console"),
    MIA_SECRET_ENCRYPTION_KEY: "test-encryption-key-with-more-than-32-characters",
    SETUP_TOKEN: "setup-test-token",
    CONSOLE_SESSION_TTL_SECONDS: 3_600,
    RATE_LIMIT_WINDOW_MS: 60_000,
    RATE_LIMIT_MAX: 300,
    RUNTIME_RATE_LIMIT_MAX: 180,
    RUNTIME_TOKEN_TTL_SECONDS: 900,
    RUNTIME_TOKEN_MAX_USES: 2_000,
    TRANSCRIPT_RETENTION_DAYS: 30,
    DATA_RETENTION_SWEEP_INTERVAL_MS: 3_600_000,
    MAX_UPLOAD_BYTES: 50_000_000,
    PROVIDER_REQUEST_TIMEOUT_MS: 90_000,
    PROVIDER_RETRY_ATTEMPTS: 3,
    SHUTDOWN_GRACE_PERIOD_MS: 30_000,
    GEMINI_BASE_URL: "https://generativelanguage.googleapis.com",
    GEMINI_PLANNER_MODEL: "gemini-3.5-flash",
    GEMINI_VISION_MODEL: "gemini-3.5-flash",
    GEMINI_EMBEDDING_MODEL: "gemini-embedding-2",
    GEMINI_EMBEDDING_DIMENSIONS: 768,
    GEMINI_LIVE_MODEL: "gemini-3.1-flash-live-preview",
    GEMINI_TOKEN_TTL_SECONDS: 1_800,
    GEMINI_NEW_SESSION_TTL_SECONDS: 60,
    UI_SCAN_HEADLESS: true,
    UI_SCAN_ALLOW_PRIVATE_NETWORKS: false
  };
}

function setupPayload(setupToken: string) {
  return {
    setupToken,
    productName: "Demo CRM",
    origin: "http://localhost:3001",
    adminEmail: "admin@example.com",
    adminName: "Mia Admin",
    password: "strong-test-password"
  };
}

function runtimeHeaders(token: string) {
  return { authorization: `Bearer ${token}`, origin: "http://localhost:3001" };
}

function runtimePayload(revision = 1) {
  return {
    observation: {
      id: `observation_${revision}`,
      revision,
      url: "http://localhost:3001/dashboard/crm",
      route: "/dashboard/crm",
      title: "CRM",
      viewport: { width: 1280, height: 800, scrollX: 0, scrollY: 0 },
      pageText: "CRM pipeline Monthly revenue",
      nodes: []
    },
    actions: [],
    context: []
  };
}

function answer(message: string): PlannerDecision {
  return {
    assessment: "The answer is grounded in the page.",
    progress: "Answer ready",
    type: "answer",
    message,
    actions: [],
    successEvidence: []
  };
}

function multipartFile(boundary: string, filename: string, mimeType: string, content: string): Buffer {
  return Buffer.from([
    `--${boundary}`,
    `Content-Disposition: form-data; name="file"; filename="${filename}"`,
    `Content-Type: ${mimeType}`,
    "",
    content,
    `--${boundary}--`,
    ""
  ].join("\r\n"));
}
