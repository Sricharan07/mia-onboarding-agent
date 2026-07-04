import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { ModelGatewayAdapter, SemanticSearchAdapter, VideoUnderstandingAdapter } from "../src/adapters/interfaces.js";
import type { AppConfig } from "../src/config/env.js";
import { createDatabase } from "../src/db/database.js";
import { Repositories } from "../src/db/repositories.js";
import type { Workflow } from "../src/schemas/domain.js";
import { RuntimeService } from "../src/services/runtime/runtimeService.js";
import { SemanticIndexService } from "../src/services/semantic/semanticIndexService.js";
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
