import assert from "node:assert/strict";
import test from "node:test";
import type { PlannerDecision } from "../src/v1/domain.js";
import type { V1Config } from "../src/v1/config.js";
import { V1AgentService } from "../src/v1/agent.js";
import { V1Database } from "../src/v1/db/database.js";
import { V1Repositories } from "../src/v1/db/repositories.js";

const databaseUrl = process.env.MIA_TEST_DATABASE_URL;

test("v1 agent persists an observe-act-verify run and enforces confirmations and receipts", {
  skip: databaseUrl ? false : "Set MIA_TEST_DATABASE_URL to run PostgreSQL integration tests."
}, async () => {
  assert.ok(databaseUrl);
  const parsed = new URL(databaseUrl);
  assert.match(parsed.pathname, /test/i, "Refusing to reset a database whose name does not contain test.");

  const database = new V1Database({ DATABASE_URL: databaseUrl, DATABASE_POOL_MAX: 3 });
  try {
    await database.query("DROP SCHEMA public CASCADE");
    await database.query("CREATE SCHEMA public");
    await database.connect();
    const repositories = new V1Repositories(database);
    await repositories.product.setup({
      product: {
        name: "Mia Test Product",
        origin: "http://localhost:3001",
        documentationOrigins: [],
        redactedSelectors: [],
        transcriptMode: "full",
        transcriptRetentionDays: 30
      },
      admin: { id: "admin_test", email: "admin@example.com", name: "Admin", passwordHash: "hash" }
    });

    const model = new FakeAgentModel();
    const agent = new V1AgentService(config(databaseUrl), repositories, model);
    const created = await agent.createSession("user_1", runtime());

    model.push(decision("actions", {
      message: "I will open the draft form.",
      actions: [
        planned("point", "live:create", "Point at Create draft"),
        planned("click", "live:create", "Open Create draft")
      ]
    }));
    const issued = await agent.submitTurn({
      sessionId: created.sessionId,
      userId: "user_1",
      revision: created.revision,
      utterance: "Create a draft lead",
      source: "text",
      runtime: runtime()
    });
    assert.equal(issued.status, "waiting_confirmation");
    assert.equal(issued.actions.length, 2);
    assert.ok(issued.actions[0]?.confirmation);
    assert.equal(issued.actions[1]?.confirmation, undefined);

    const receipts = issued.actions.map((action) => ({
      actionId: action.actionId,
      idempotencyKey: action.idempotencyKey,
      type: action.type,
      status: "completed" as const,
      message: `${action.type} completed`,
      targetRef: action.target?.ref,
      route: "/dashboard/crm",
      evidence: { verified: true }
    }));
    await assert.rejects(() => agent.continue({
      sessionId: created.sessionId,
      userId: "user_1",
      revision: issued.revision,
      receipts,
      runtime: runtime(2)
    }), /approved before it can be completed/i);

    const confirmation = issued.actions[0]!.confirmation!;
    await assert.rejects(() => agent.resolveConfirmation({
      sessionId: created.sessionId,
      confirmationId: confirmation.id,
      userId: "user_1",
      revision: issued.revision,
      binding: "wrong-binding",
      approved: true,
      source: "ui",
      observation: observation()
    }), /invalid, expired, or already resolved/i);
    const approved = await agent.resolveConfirmation({
      sessionId: created.sessionId,
      confirmationId: confirmation.id,
      userId: "user_1",
      revision: issued.revision,
      binding: confirmation.binding,
      approved: true,
      source: "voice",
      observation: observation()
    });
    assert.equal(approved.status, "active");

    await assert.rejects(() => agent.continue({
      sessionId: created.sessionId,
      userId: "user_1",
      revision: approved.revision,
      receipts: [{ ...receipts[0]!, idempotencyKey: "wrong" }, receipts[1]!],
      runtime: runtime(2)
    }), /did not match the issued action batch/i);

    model.push(decision("complete", { message: "The draft form is open." }));
    const completed = await agent.continue({
      sessionId: created.sessionId,
      userId: "user_1",
      revision: approved.revision,
      receipts,
      runtime: runtime(2)
    });
    assert.equal(completed.status, "completed");
    assert.equal(completed.type, "complete");
    assert.equal(model.judgeCalls, 1);

    const run = await repositories.diagnostics.getRun(created.sessionId);
    const steps = run.steps as Array<{ directive: { actions: Array<{ confirmation?: Record<string, unknown> }> } }>;
    assert.equal(steps.length, 2);
    assert.equal(steps[0]?.directive.actions[0]?.confirmation?.binding, undefined, "confirmation bindings must not be logged");
  } finally {
    await database.close();
  }
});

test("v1 agent keeps a goal across questions and blocks protected operations before confirmation", {
  skip: databaseUrl ? false : "Set MIA_TEST_DATABASE_URL to run PostgreSQL integration tests."
}, async () => {
  assert.ok(databaseUrl);
  const database = new V1Database({ DATABASE_URL: databaseUrl, DATABASE_POOL_MAX: 3 });
  try {
    await database.query("DROP SCHEMA public CASCADE");
    await database.query("CREATE SCHEMA public");
    await database.connect();
    const repositories = new V1Repositories(database);
    await repositories.product.setup({
      product: {
        name: "Mia Test Product",
        origin: "http://localhost:3001",
        documentationOrigins: [],
        redactedSelectors: [],
        transcriptMode: "full",
        transcriptRetentionDays: 30
      },
      admin: { id: "admin_test", email: "admin@example.com", name: "Admin", passwordHash: "hash" }
    });
    const model = new FakeAgentModel();
    const agent = new V1AgentService(config(databaseUrl), repositories, model);
    const created = await agent.createSession("user_2", runtime());

    model.push(decision("ask_user", { message: "What is the lead name?", field: "lead_name" }));
    const question = await agent.submitTurn({
      sessionId: created.sessionId,
      userId: "user_2",
      revision: created.revision,
      utterance: "Create a draft lead",
      source: "text",
      runtime: runtime()
    });
    assert.equal(question.status, "waiting_user");

    model.push(decision("answer", { message: "I have the name Avery." }));
    const answered = await agent.submitTurn({
      sessionId: created.sessionId,
      userId: "user_2",
      revision: question.revision,
      utterance: "Avery",
      source: "voice",
      runtime: runtime(2)
    });
    assert.equal(answered.status, "completed");
    assert.equal((await repositories.agent.getSession(created.sessionId)).goal, "Create a draft lead");

    model.push(decision("actions", {
      message: "I will delete the account.",
      actions: [planned("click", "live:delete", "Delete the account")]
    }));
    const blocked = await agent.submitTurn({
      sessionId: created.sessionId,
      userId: "user_2",
      revision: answered.revision,
      utterance: "Delete this account",
      source: "text",
      runtime: runtime(3)
    });
    assert.equal(blocked.type, "unable");
    assert.equal(blocked.status, "failed");
    const confirmationCount = await database.query<{ count: number }>("SELECT COUNT(*)::int AS count FROM confirmations");
    assert.equal(confirmationCount.rows[0]?.count, 0);
  } finally {
    await database.close();
  }
});

test("v1 agent resumes confirmations and navigation without persisting mutation values in browser storage", {
  skip: databaseUrl ? false : "Set MIA_TEST_DATABASE_URL to run PostgreSQL integration tests."
}, async () => {
  assert.ok(databaseUrl);
  const database = new V1Database({ DATABASE_URL: databaseUrl, DATABASE_POOL_MAX: 3 });
  try {
    await database.query("DROP SCHEMA public CASCADE");
    await database.query("CREATE SCHEMA public");
    await database.connect();
    const repositories = new V1Repositories(database);
    await repositories.product.setup({
      product: { name: "Resume Test", origin: "http://localhost:3001", documentationOrigins: [], redactedSelectors: [], transcriptMode: "full", transcriptRetentionDays: 30 },
      admin: { id: "admin", email: "admin@example.com", name: "Admin", passwordHash: "hash" }
    });
    const model = new FakeAgentModel();
    const agent = new V1AgentService(config(databaseUrl), repositories, model);
    const created = await agent.createSession("resume-user", runtime());
    model.push(decision("actions", { message: "Open the draft form", actions: [planned("click", "live:create", "Open Create draft")] }));
    const issued = await agent.submitTurn({
      sessionId: created.sessionId, userId: "resume-user", revision: created.revision,
      utterance: "Open the draft form", source: "text", runtime: runtime()
    });
    const firstBinding = issued.actions[0]?.confirmation?.binding;
    assert.ok(firstBinding);
    const reconfirm = await agent.resumeSession("resume-user", {
      ...runtime(2), sessionId: created.sessionId, resumeToken: created.resumeToken
    });
    assert.equal(reconfirm.pending?.recovery, "confirm");
    const refreshed = reconfirm.pending?.actions[0]?.confirmation;
    assert.ok(refreshed);
    assert.notEqual(refreshed.binding, firstBinding);
    const approved = await agent.resolveConfirmation({
      sessionId: created.sessionId, confirmationId: refreshed.id, userId: "resume-user",
      revision: reconfirm.revision, binding: refreshed.binding, approved: true, source: "ui", observation: observation(2)
    });
    const navigatedRuntime = runtime(3);
    navigatedRuntime.observation.route = "/dashboard/crm/new";
    navigatedRuntime.observation.url = "http://localhost:3001/dashboard/crm/new";
    const navigated = await agent.resumeSession("resume-user", {
      ...navigatedRuntime, sessionId: created.sessionId, resumeToken: created.resumeToken
    });
    assert.equal(navigated.revision, approved.revision);
    assert.equal(navigated.pending?.recovery, "verify_navigation");

    const fillSession = await agent.createSession("fill-user", runtime());
    model.push(decision("actions", {
      message: "Enter the name",
      actions: [{
        actionId: "model", type: "fill", targetRef: "live:create", value: "Avery",
        message: "Enter Avery", expectedOutcome: "The field contains Avery"
      }]
    }));
    const fillIssued = await agent.submitTurn({
      sessionId: fillSession.sessionId, userId: "fill-user", revision: fillSession.revision,
      utterance: "Enter Avery", source: "text", runtime: runtime()
    });
    assert.equal(fillIssued.status, "waiting_confirmation");
    const fillResumed = await agent.resumeSession("fill-user", {
      ...runtime(2), sessionId: fillSession.sessionId, resumeToken: fillSession.resumeToken
    });
    assert.equal(fillResumed.status, "active");
    assert.equal(fillResumed.pending?.recovery, "replan");
    assert.equal(fillResumed.pending?.actions[0]?.value, undefined);
  } finally {
    await database.close();
  }
});

class FakeAgentModel {
  readonly decisions: PlannerDecision[] = [];
  judgeCalls = 0;

  push(value: PlannerDecision): void {
    this.decisions.push(value);
  }

  async decide(): Promise<{ decision: PlannerDecision; latencyMs: number; usage: Record<string, never> }> {
    const next = this.decisions.shift();
    assert.ok(next, "Fake model ran out of decisions.");
    return { decision: next, latencyMs: 1, usage: {} };
  }

  async judge(): Promise<{ satisfied: boolean; summary: string; missingEvidence: string[] }> {
    this.judgeCalls += 1;
    return { satisfied: true, summary: "Verified", missingEvidence: [] };
  }

  async embed(texts: string[]): Promise<number[][]> {
    return texts.map(() => Array(768).fill(0));
  }
}

function config(url: string): V1Config {
  return {
    NODE_ENV: "test",
    BACKEND_HOST: "127.0.0.1",
    BACKEND_PORT: 4000,
    TRUST_PROXY: false,
    CORS_ORIGIN: "*",
    DATABASE_URL: url,
    DATABASE_POOL_MAX: 3,
    LOCAL_UPLOAD_DIR: "/tmp/mia-v1-test",
    CONSOLE_DIST_DIR: "/tmp/mia-v1-console",
    SETUP_TOKEN: "test-setup-token",
    CONSOLE_SESSION_TTL_SECONDS: 3600,
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

function observation(revision = 1) {
  return {
    id: `observation_${revision}`,
    revision,
    url: "http://localhost:3001/dashboard/crm",
    route: "/dashboard/crm",
    title: "CRM",
    viewport: { width: 1280, height: 800, scrollX: 0, scrollY: 0 },
    pageText: "Create draft lead Delete account",
    nodes: [
      {
        nodeId: "create",
        tagName: "button",
        role: "button",
        name: "Create draft lead",
        locators: [{ strategy: "role" as const, role: "button", name: "Create draft lead" }],
        bounds: { x: 20, y: 20, width: 160, height: 40 },
        viewportVisible: true,
        sensitive: false
      },
      {
        nodeId: "delete",
        tagName: "button",
        role: "button",
        name: "Delete account",
        locators: [{ strategy: "role" as const, role: "button", name: "Delete account" }],
        bounds: { x: 200, y: 20, width: 140, height: 40 },
        viewportVisible: true,
        sensitive: false
      }
    ]
  };
}

function runtime(revision = 1) {
  return { observation: observation(revision), actions: [], context: [] };
}

function planned(type: "point" | "click", targetRef: string, message: string) {
  return { actionId: "from_model", type, targetRef, message, expectedOutcome: "The control responds as expected." };
}

function decision(
  type: PlannerDecision["type"],
  values: Partial<PlannerDecision> & Pick<PlannerDecision, "message">
): PlannerDecision {
  return {
    assessment: "The next step is clear.",
    progress: "Working on it",
    type,
    message: values.message,
    actions: values.actions ?? [],
    field: values.field,
    inputType: values.inputType,
    choices: values.choices,
    successEvidence: []
  };
}
