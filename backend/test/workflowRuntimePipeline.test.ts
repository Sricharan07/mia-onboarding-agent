import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { ModelGatewayAdapter, SemanticSearchAdapter, VideoUnderstandingAdapter } from "../src/adapters/interfaces.js";
import type { AppConfig } from "../src/config/env.js";
import { createDatabase } from "../src/db/database.js";
import { Repositories } from "../src/db/repositories.js";
import type { UIElementRecord, Workflow } from "../src/schemas/domain.js";
import { RuntimeService } from "../src/services/runtime/runtimeService.js";
import { SemanticIndexService } from "../src/services/semantic/semanticIndexService.js";
import { InteractiveUiMapScanService } from "../src/services/ui-map/interactiveScanService.js";
import { ReadinessService } from "../src/services/system/readinessService.js";
import { WorkflowCompiler } from "../src/services/workflows/compiler.js";
import { VideoProcessingService } from "../src/services/workflows/videoProcessingService.js";
import { WorkflowService } from "../src/services/workflows/workflowService.js";
import { AppError } from "../src/utils/errors.js";

test("workflow compiler creates unique ids and review steps for unmatched recorded actions", async () => {
  const compiler = new WorkflowCompiler({} as unknown as Repositories, emptySearch);

  const first = await compiler.compile({
    appId: "app_one",
    videoId: "video_one",
    jobId: "job_one",
    timeline: {
      goal: "Invite teammate",
      steps: [
        { id: "step_wait", order: 1, action: "wait", observedElement: "Invite dialog" },
        { id: "step_unknown", order: 2, action: "unknown", observedElement: "Something changed" }
      ]
    }
  });
  const second = await compiler.compile({
    appId: "app_one",
    videoId: "video_two",
    jobId: "job_two",
    timeline: { goal: "Invite teammate", steps: [] }
  });

  assert.notEqual(first.workflowId, "invite_teammate");
  assert.notEqual(first.workflowId, second.workflowId);
  assert.equal(first.steps[0]?.type, "confirm");
  assert.equal(first.steps[1]?.type, "confirm");
});

test("workflow compiler honors requested upload metadata", async () => {
  const compiler = new WorkflowCompiler({} as unknown as Repositories, emptySearch);

  const compiled = await compiler.compile({
    appId: "app_one",
    videoId: "video_one",
    jobId: "job_one",
    requestedName: "Custom onboarding flow",
    requestedDescription: "A human supplied workflow description.",
    timeline: { goal: "Gemini extracted goal", summary: "Gemini extracted summary.", steps: [] }
  });

  assert.equal(compiled.name, "Custom onboarding flow");
  assert.equal(compiled.description, "A human supplied workflow description.");
  assert.deepEqual(compiled.triggerPhrases, ["custom onboarding flow"]);
});

test("repository rejects workflow id reuse across apps", () => {
  const dir = mkdtempSync(join(tmpdir(), "mia-workflows-"));
  const db = createDatabase(testConfig(dir));
  const repositories = new Repositories(db);

  try {
    repositories.saveWorkflow(workflow({ appId: "app_one", workflowId: "workflow_shared" }));
    assert.throws(
      () => repositories.saveWorkflow(workflow({ appId: "app_two", workflowId: "workflow_shared" })),
      (error) => error instanceof AppError && error.code === "WORKFLOW_ID_APP_MISMATCH"
    );
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("repository exposes UI elements from the latest completed UI map only", async () => {
  const dir = mkdtempSync(join(tmpdir(), "mia-ui-latest-"));
  const db = createDatabase(testConfig(dir));
  const repositories = new Repositories(db);

  try {
    repositories.upsertApp({ name: "Mapped app", slug: "mapped-app", baseUrl: "http://localhost:3000" });
    const appId = "app_mapped_app";

    const firstVersion = repositories.createUiMapVersion(appId);
    const firstPageId = repositories.createPage({
      appId,
      uiMapVersionId: firstVersion.id,
      name: "Home",
      route: "/",
      url: "http://localhost:3000/",
      status: "mapped"
    });
    repositories.saveUiElement(uiElement({ appId, uiMapVersionId: firstVersion.id, pageId: firstPageId, elementId: "old-button", label: "Old button" }));
    repositories.updateUiMapVersion(firstVersion.id, "completed");

    await wait(2);
    const secondVersion = repositories.createUiMapVersion(appId);
    const secondPageId = repositories.createPage({
      appId,
      uiMapVersionId: secondVersion.id,
      name: "Dashboard",
      route: "/dashboard",
      url: "http://localhost:3000/dashboard",
      status: "mapped"
    });
    repositories.saveUiElement(uiElement({ appId, uiMapVersionId: secondVersion.id, pageId: secondPageId, elementId: "new-button", label: "New button", route: "/dashboard" }));
    repositories.updateUiMapVersion(secondVersion.id, "completed");

    assert.deepEqual(repositories.listUiElementsForApp(appId).map((element) => element.elementId), ["new-button"]);
    assert.equal(repositories.getElementByElementId(appId, "old-button"), undefined);
    assert.equal(repositories.getElementByElementId(appId, "new-button")?.route, "/dashboard");
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("repository updates element metadata only on the latest completed app map", async () => {
  const dir = mkdtempSync(join(tmpdir(), "mia-ui-edit-scope-"));
  const db = createDatabase(testConfig(dir));
  const repositories = new Repositories(db);

  try {
    const firstAppId = repositories.upsertApp({ name: "First app", slug: "first-app", baseUrl: "http://localhost:3000" }).id;
    const secondAppId = repositories.upsertApp({ name: "Second app", slug: "second-app", baseUrl: "http://localhost:4000" }).id;

    const staleVersion = repositories.createUiMapVersion(firstAppId);
    const stalePageId = repositories.createPage({
      appId: firstAppId,
      uiMapVersionId: staleVersion.id,
      name: "Home",
      route: "/",
      url: "http://localhost:3000/",
      status: "mapped"
    });
    repositories.saveUiElement(uiElement({ id: "first_stale_row", appId: firstAppId, uiMapVersionId: staleVersion.id, pageId: stalePageId, elementId: "shared-button", label: "Stale" }));
    repositories.updateUiMapVersion(staleVersion.id, "completed");

    await wait(2);
    const latestVersion = repositories.createUiMapVersion(firstAppId);
    const latestPageId = repositories.createPage({
      appId: firstAppId,
      uiMapVersionId: latestVersion.id,
      name: "Home",
      route: "/",
      url: "http://localhost:3000/",
      status: "mapped"
    });
    repositories.saveUiElement(uiElement({ id: "first_latest_row", appId: firstAppId, uiMapVersionId: latestVersion.id, pageId: latestPageId, elementId: "shared-button", label: "Latest" }));
    repositories.updateUiMapVersion(latestVersion.id, "completed");

    const otherVersion = repositories.createUiMapVersion(secondAppId);
    const otherPageId = repositories.createPage({
      appId: secondAppId,
      uiMapVersionId: otherVersion.id,
      name: "Home",
      route: "/",
      url: "http://localhost:4000/",
      status: "mapped"
    });
    repositories.saveUiElement(uiElement({ id: "second_app_row", appId: secondAppId, uiMapVersionId: otherVersion.id, pageId: otherPageId, elementId: "shared-button", label: "Other" }));
    repositories.updateUiMapVersion(otherVersion.id, "completed");

    assert.throws(() => repositories.updateLatestElement(firstAppId, "first_stale_row", { description: "Wrong" }));
    assert.throws(() => repositories.updateLatestElement(firstAppId, "second_app_row", { description: "Wrong" }));

    repositories.updateLatestElement(firstAppId, "first_latest_row", { description: "Updated latest" });
    assert.equal(repositories.getElementByElementId(firstAppId, "shared-button")?.description, "Updated latest");
    assert.equal(repositories.getElementByElementId(secondAppId, "shared-button")?.description, "Other");
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("interactive scan cannot finish without captured UI elements", async () => {
  const dir = mkdtempSync(join(tmpdir(), "mia-empty-interactive-"));
  const db = createDatabase(testConfig(dir));
  const repositories = new Repositories(db);
  const service = new InteractiveUiMapScanService(testConfig(dir), repositories, emptySearch);

  try {
    const appId = repositories.upsertApp({ name: "Mapped app", slug: "mapped-app", baseUrl: "http://localhost:3000" }).id;
    const version = repositories.createUiMapVersion(appId, "interactive_browser_scan");
    (service as unknown as { sessions: Map<string, unknown> }).sessions.set("session_one", {
      sessionId: "session_one",
      appId,
      baseUrl: "http://localhost:3000",
      uiMapVersionId: version.id,
      browser: { isConnected: () => true, close: async () => undefined },
      context: { close: async () => undefined },
      page: {},
      createdAt: "2026-01-01T00:00:00.000Z",
      currentRoute: "/"
    });

    await assert.rejects(
      () => service.finish("session_one"),
      (error) => error instanceof AppError && error.code === "VALIDATION_ERROR"
    );
    assert.equal(String(repositories.getUiMapVersion(version.id).status), "scanning");
  } finally {
    await service.closeAll();
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("runtime session updates preserve omitted current step and values", () => {
  const dir = mkdtempSync(join(tmpdir(), "mia-runtime-session-"));
  const db = createDatabase(testConfig(dir));
  const repositories = new Repositories(db);

  try {
    const session = repositories.createRuntimeSession({ appId: "app_one", workflowId: "workflow_one" });
    repositories.updateRuntimeSession(session.runtimeSessionId, {
      status: "running",
      currentStepId: "step_one",
      values: { email: "user@example.com" }
    });
    repositories.updateRuntimeSession(session.runtimeSessionId, { status: "paused" });

    const row = db.prepare("SELECT current_step_id as currentStepId, values_json as valuesJson FROM runtime_sessions WHERE id = ?")
      .get(session.runtimeSessionId) as { currentStepId: string; valuesJson: string };
    assert.equal(row.currentStepId, "step_one");
    assert.deepEqual(JSON.parse(row.valuesJson), { email: "user@example.com" });
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("terminal runtime session updates clear current step", () => {
  const dir = mkdtempSync(join(tmpdir(), "mia-runtime-terminal-"));
  const db = createDatabase(testConfig(dir));
  const repositories = new Repositories(db);

  try {
    const session = repositories.createRuntimeSession({ appId: "app_one", workflowId: "workflow_one" });
    repositories.updateRuntimeSession(session.runtimeSessionId, {
      status: "running",
      currentStepId: "step_one",
      values: { email: "user@example.com" }
    });
    repositories.updateRuntimeSession(session.runtimeSessionId, { status: "completed", values: { email: "user@example.com" } });

    const row = db.prepare("SELECT current_step_id as currentStepId, values_json as valuesJson FROM runtime_sessions WHERE id = ?")
      .get(session.runtimeSessionId) as { currentStepId: string | null; valuesJson: string };
    assert.equal(row.currentStepId, null);
    assert.deepEqual(JSON.parse(row.valuesJson), { email: "user@example.com" });
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("runtime resolve returns control actions and includes screen context in answer prompts", async () => {
  const prompts: string[] = [];
  const gateway: ModelGatewayAdapter = {
    generateJson: async <T>() => ({ data: {} as T, raw: {} }),
    generateText: async (input) => {
      prompts.push(input.prompt);
      return { text: "Use the Invite button.", raw: {} };
    },
    analyzeImagesOrVideo: async <T>() => ({ data: {} as T, raw: {} })
  };
  const runtime = new RuntimeService({} as unknown as Repositories, gateway, emptySearch);

  const control = await runtime.resolve({
    appId: "app_one",
    sessionId: "session_one",
    utterance: "pause",
    context: runtimeContext()
  });
  assert.deepEqual(control, { type: "control", action: "pause", message: "Paused. Say resume when you want to continue." });

  const answer = await runtime.resolve({
    appId: "app_one",
    sessionId: "session_one",
    utterance: "What does this button do?",
    context: runtimeContext()
  });
  assert.equal(answer.type, "answer");
  assert.match(prompts[0] ?? "", /Invite teammate/);
  assert.match(prompts[0] ?? "", /role=button/);
});

test("video processing service starts and resumes unfinished jobs", async () => {
  const dir = mkdtempSync(join(tmpdir(), "mia-video-jobs-"));
  const db = createDatabase(testConfig(dir));
  const repositories = new Repositories(db);
  const errors: unknown[] = [];
  let extractionCalls = 0;
  const compiledGoals: string[] = [];
  const requestedNames: Array<string | undefined> = [];
  const videoUnderstanding: VideoUnderstandingAdapter = {
    extractActionTimeline: async () => {
      extractionCalls += 1;
      return {
        timeline: { goal: "Invite teammate", steps: [] },
        raw: { ok: true }
      };
    }
  };
  const compiler = {
    compile: async (input: { appId: string; videoId: string; jobId: string; timeline: { goal: string }; requestedName?: string }) => {
      compiledGoals.push(input.timeline.goal);
      requestedNames.push(input.requestedName);
      return workflow({
        appId: input.appId,
        workflowId: `workflow_${input.jobId}`,
        name: input.requestedName ?? input.timeline.goal,
        createdFrom: { videoId: input.videoId, jobId: input.jobId }
      });
    }
  } as unknown as WorkflowCompiler;
  const service = new VideoProcessingService(repositories, videoUnderstanding, compiler);

  try {
    repositories.upsertApp({ name: "Workflow app", slug: "one", baseUrl: "http://localhost:3000" });
    const first = repositories.createWorkflowVideo({
      appId: "app_one",
      filename: "first.mp4",
      localPath: join(dir, "first.mp4"),
      mimeType: "video/mp4",
      sizeBytes: 1,
      workflowName: "Custom uploaded workflow"
    });
    assert.deepEqual(service.startJob(first.jobId, (error) => errors.push(error)), { jobId: first.jobId, status: "analyzing" });
    await waitFor(() => String(repositories.getWorkflowJob(first.jobId).status) === "needs_review");

    const second = repositories.createWorkflowVideo({
      appId: "app_one",
      filename: "second.mp4",
      localPath: join(dir, "second.mp4"),
      mimeType: "video/mp4",
      sizeBytes: 1
    });
    service.resumeUnfinishedJobs((error) => errors.push(error));
    await waitFor(() => String(repositories.getWorkflowJob(second.jobId).status) === "needs_review");

    const third = repositories.createWorkflowVideo({
      appId: "app_one",
      filename: "third.mp4",
      localPath: join(dir, "third.mp4"),
      mimeType: "video/mp4",
      sizeBytes: 1
    });
    repositories.updateWorkflowJob(third.jobId, {
      status: "mapped",
      timeline: { goal: "Stored timeline", steps: [] },
      rawOutput: { ok: "stored" },
      error: null
    });
    service.resumeUnfinishedJobs((error) => errors.push(error));
    await waitFor(() => String(repositories.getWorkflowJob(third.jobId).status) === "needs_review");

    assert.equal(extractionCalls, 2);
    assert.deepEqual(compiledGoals, ["Invite teammate", "Invite teammate", "Stored timeline"]);
    assert.deepEqual(requestedNames, ["Custom uploaded workflow", undefined, undefined]);
    assert.equal(repositories.getWorkflow(`workflow_${first.jobId}`).name, "Custom uploaded workflow");
    assert.equal(errors.length, 0);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("workflow service syncs source job status across review lifecycle", async () => {
  const dir = mkdtempSync(join(tmpdir(), "mia-workflow-status-"));
  const db = createDatabase(testConfig(dir));
  const repositories = new Repositories(db);
  const service = new WorkflowService(repositories, emptySearch);

  try {
    repositories.upsertApp({ name: "Workflow app", slug: "one", baseUrl: "http://localhost:3000" });
    const video = repositories.createWorkflowVideo({
      appId: "app_one",
      filename: "workflow.mp4",
      localPath: join(dir, "workflow.mp4"),
      mimeType: "video/mp4",
      sizeBytes: 1
    });
    repositories.saveWorkflow(workflow({
      appId: "app_one",
      workflowId: "workflow_lifecycle",
      createdFrom: { videoId: video.videoId, jobId: video.jobId }
    }));
    repositories.updateWorkflowJob(video.jobId, { status: "needs_review", error: null });

    await service.approveWorkflow("workflow_lifecycle", { reviewedBy: "tester" });
    assert.equal(String(repositories.getWorkflowJob(video.jobId).status), "approved");

    await service.publishWorkflow("workflow_lifecycle");
    assert.equal(String(repositories.getWorkflowJob(video.jobId).status), "published");

    await service.addStep("workflow_lifecycle", { id: "complete_two", type: "complete", message: "All done." });
    assert.equal(String(repositories.getWorkflowJob(video.jobId).status), "needs_review");

    await service.approveWorkflow("workflow_lifecycle", { reviewedBy: "tester" });
    await service.archiveWorkflow("workflow_lifecycle");
    assert.equal(String(repositories.getWorkflowJob(video.jobId).status), "archived");
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("workflow service does not persist status changes when semantic sync fails", async () => {
  const dir = mkdtempSync(join(tmpdir(), "mia-workflow-semantic-fail-"));
  const db = createDatabase(testConfig(dir));
  const repositories = new Repositories(db);
  const failingSearch: SemanticSearchAdapter = {
    ...emptySearch,
    index: async () => {
      throw new Error("semantic index unavailable");
    }
  };
  const service = new WorkflowService(repositories, failingSearch);

  try {
    repositories.upsertApp({ name: "Workflow app", slug: "one", baseUrl: "http://localhost:3000" });
    repositories.saveWorkflow(workflow({ workflowId: "workflow_semantic_fail", status: "approved" }));

    await assert.rejects(
      () => service.publishWorkflow("workflow_semantic_fail"),
      /semantic index unavailable/
    );
    assert.equal(repositories.getWorkflow("workflow_semantic_fail").status, "approved");
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("workflow service rejects mutations for archived apps", async () => {
  const dir = mkdtempSync(join(tmpdir(), "mia-workflow-archived-"));
  const db = createDatabase(testConfig(dir));
  const repositories = new Repositories(db);
  const service = new WorkflowService(repositories, emptySearch);

  try {
    const appId = repositories.upsertApp({ name: "Workflow app", slug: "archived-workflow-app", baseUrl: "http://localhost:3000" }).id;
    repositories.saveWorkflow(workflow({ appId, workflowId: "workflow_archived_app", status: "needs_review" }));
    repositories.archiveApp(appId);

    await assert.rejects(
      () => service.updateWorkflow("workflow_archived_app", { name: "Should not save" }),
      (error) => error instanceof AppError && error.code === "NOT_FOUND"
    );
    assert.equal(repositories.getWorkflow("workflow_archived_app").name, "Invite teammate");
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("semantic rebuild deletes stale ids only after upsert succeeds", async () => {
  const calls: string[] = [];
  const repositories = {
    listUiElementsForApp: () => [],
    listFullWorkflows: () => [workflow({ workflowId: "workflow_one", status: "published" })]
  } as unknown as Repositories;
  const semanticSearch: SemanticSearchAdapter = {
    index: async () => undefined,
    upsertMany: async () => {
      calls.push("upsert");
    },
    search: async () => [],
    deleteByFilter: async () => undefined,
    deleteByIds: async (ids) => {
      calls.push(`delete:${ids.join(",")}`);
    },
    listIdsByFilter: async () => ["workflow_workflow_one", "stale_id"]
  };

  const result = await new SemanticIndexService(repositories, semanticSearch).rebuildApp("app_one");
  assert.equal(result.indexedRecords, 1);
  assert.deepEqual(calls, ["upsert", "delete:stale_id"]);
});

test("database readiness is independent from scan secret readability", async () => {
  const dir = mkdtempSync(join(tmpdir(), "mia-readiness-"));
  const config = { ...testConfig(dir), MIA_SECRET_ENCRYPTION_KEY: undefined };
  const db = createDatabase(config);
  const repositories = new Repositories(db, config.MIA_SECRET_ENCRYPTION_KEY);

  try {
    db.prepare(`
      INSERT INTO apps (id, name, slug, base_url, ui_scan_config_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      "app_secret_config",
      "Secret config app",
      "secret-config-app",
      "http://localhost:3000",
      JSON.stringify({ passwordSecret: "enc:v1:a:b:c" }),
      "2026-01-01T00:00:00.000Z",
      "2026-01-01T00:00:00.000Z"
    );

    const readiness = await new ReadinessService(config, repositories).check();
    assert.equal(readiness.database.status, "ok");
    assert.equal(readiness.secrets.status, "missing_config");
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

const emptySearch: SemanticSearchAdapter = {
  index: async () => undefined,
  upsertMany: async () => undefined,
  search: async () => [],
  deleteByFilter: async () => undefined,
  deleteByIds: async () => undefined,
  listIdsByFilter: async () => []
};

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

function runtimeContext() {
  return {
    currentUrl: "http://localhost:3000/team",
    currentRoute: "/team",
    pageTitle: "Team settings",
    focusedElement: { tagName: "button", role: "button", label: "Invite teammate", text: "Invite" },
    hoveredElement: null,
    visibleElements: [
      { tagName: "button", role: "button", label: "Invite teammate", text: "Invite" }
    ],
    userMetadata: {}
  };
}

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 25; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.fail("Timed out waiting for condition.");
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function uiElement(input: {
  id?: string;
  appId: string;
  uiMapVersionId: string;
  pageId: string;
  elementId: string;
  label: string;
  route?: string;
}): UIElementRecord {
  const now = "2026-01-01T00:00:00.000Z";
  return {
    id: input.id ?? `element_row_${input.elementId}`,
    elementId: input.elementId,
    appId: input.appId,
    uiMapVersionId: input.uiMapVersionId,
    pageId: input.pageId,
    pageName: input.route === "/dashboard" ? "Dashboard" : "Home",
    route: input.route ?? "/",
    elementType: "button",
    role: "button",
    label: input.label,
    visibleText: input.label,
    accessibleName: input.label,
    description: input.label,
    selector: `[data-testid="${input.elementId}"]`,
    selectorType: "data-testid",
    fallbackSelectors: [],
    nearbyText: [],
    tags: [],
    selectorQuality: "strong",
    selectorWarnings: [],
    stateName: "default",
    discoveredBy: "route_scan",
    fingerprint: input.elementId,
    createdAt: now,
    updatedAt: now
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
    CONSOLE_DIST_DIR: join(dir, "console-dist"),
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
    UI_SCAN_HEADLESS: true,
    UI_SCAN_ALLOW_PRIVATE_NETWORKS: false
  };
}
