import type { Db } from "./database.js";
import { createId, nowIso, slugToId } from "../utils/id.js";
import { NotFoundError } from "../utils/errors.js";
import type { AppRecord, UIElementRecord, Workflow, WorkflowStep } from "../schemas/domain.js";

type Row = Record<string, unknown>;
export type ApiKeyScope = "apps:read" | "ui-map:read" | "workflows:read" | "runtime:write" | "logs:write" | "logs:read" | "admin";

export type ApiKeyRecord = {
  id: string;
  name: string;
  prefix: string;
  scopes: ApiKeyScope[];
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
};

export type ApiKeySecretRecord = ApiKeyRecord & {
  keyHash: string;
};

export type UsageSummary = {
  totals: {
    sdkEvents: number;
    workflowRuns: number;
    aiRequests: number;
    errors: number;
    averageAiLatencyMs: number | null;
  };
  eventCounts: Array<{ eventType: string; count: number }>;
  providerCounts: Array<{ provider: string; count: number }>;
};

export type UsageTimeseriesPoint = {
  bucket: string;
  sdkEvents: number;
  workflowRuns: number;
  aiRequests: number;
  errors: number;
};

export class Repositories {
  constructor(private readonly db: Db) {}

  listApps(): AppRecord[] {
    return (this.db.prepare("SELECT * FROM apps ORDER BY created_at DESC").all() as Row[]).map(mapApp);
  }

  upsertApp(input: { name: string; slug: string; baseUrl: string }): AppRecord {
    const existing = this.db.prepare("SELECT * FROM apps WHERE slug = ?").get(input.slug) as Row | undefined;
    const now = nowIso();
    const id = existing ? String(existing.id) : slugToId("app", input.slug);

    this.db.prepare(`
      INSERT INTO apps (id, name, slug, base_url, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(slug) DO UPDATE SET
        name = excluded.name,
        base_url = excluded.base_url,
        updated_at = excluded.updated_at
    `).run(id, input.name, input.slug, input.baseUrl, existing?.created_at ?? now, now);

    return this.getApp(id);
  }

  getApp(appId: string): AppRecord {
    const row = this.db.prepare("SELECT * FROM apps WHERE id = ?").get(appId) as Row | undefined;
    if (!row) throw new NotFoundError(`App not found: ${appId}`);
    return mapApp(row);
  }

  createUiMapVersion(appId: string, source = "runtime_browser_scan"): { id: string; appId: string; version: string; status: string; createdAt: string } {
    const now = nowIso();
    const id = createId("ui_map");
    const version = `local-${Date.now()}`;
    this.db.prepare(`
      INSERT INTO ui_map_versions (id, app_id, version, source, status, created_at)
      VALUES (?, ?, ?, ?, 'scanning', ?)
    `).run(id, appId, version, source, now);
    return { id, appId, version, status: "scanning", createdAt: now };
  }

  updateUiMapVersion(id: string, status: "completed" | "failed", error?: string): void {
    this.db.prepare("UPDATE ui_map_versions SET status = ?, completed_at = ?, error = ? WHERE id = ?")
      .run(status, nowIso(), error ?? null, id);
  }

  listUiMapVersions(appId: string): unknown[] {
    return this.db.prepare(`
      SELECT id, app_id as appId, version, source, status, created_at as createdAt, completed_at as completedAt, error
      FROM ui_map_versions WHERE app_id = ? ORDER BY created_at DESC
    `).all(appId);
  }

  createPage(input: { appId: string; uiMapVersionId: string; name: string; route: string; url: string; title?: string; status: string; error?: string }): string {
    const existing = this.getPageByVersionAndRoute(input.uiMapVersionId, input.route);
    if (existing) return existing.id;

    const id = createId("page");
    this.db.prepare(`
      INSERT INTO pages (id, app_id, ui_map_version_id, name, route, url, title, status, error, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, input.appId, input.uiMapVersionId, input.name, input.route, input.url, input.title ?? null, input.status, input.error ?? null, nowIso());
    return id;
  }

  getPageByVersionAndRoute(uiMapVersionId: string, route: string): { id: string; route: string; name: string } | undefined {
    return this.db.prepare(`
      SELECT id, route, name FROM pages
      WHERE ui_map_version_id = ? AND route = ?
      ORDER BY created_at ASC LIMIT 1
    `).get(uiMapVersionId, route) as { id: string; route: string; name: string } | undefined;
  }

  listPages(uiMapVersionId: string): unknown[] {
    return this.db.prepare(`
      SELECT id, name, route, url, title, status, error, created_at as createdAt
      FROM pages WHERE ui_map_version_id = ? ORDER BY route
    `).all(uiMapVersionId);
  }

  saveUiElement(record: UIElementRecord): boolean {
    if (record.fingerprint) {
      const existing = this.db.prepare("SELECT id FROM ui_elements WHERE ui_map_version_id = ? AND fingerprint = ? LIMIT 1")
        .get(record.uiMapVersionId, record.fingerprint) as { id: string } | undefined;
      if (existing) return false;
    }

    this.db.prepare(`
      INSERT INTO ui_elements (
        id, element_id, app_id, ui_map_version_id, page_id, route, page_name, element_type,
        role, label, visible_text, accessible_name, placeholder, aria_label, input_name, input_type,
        description, selector, selector_type, fallback_selectors_json, nearby_text_json, tags_json,
        selector_quality, selector_warnings_json, state_name, state_reason, discovered_by, fingerprint,
        raw_json, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      record.id,
      record.elementId,
      record.appId,
      record.uiMapVersionId,
      record.pageId,
      record.route,
      record.pageName,
      record.elementType,
      record.role ?? null,
      record.label ?? null,
      record.visibleText ?? null,
      record.accessibleName ?? null,
      record.placeholder ?? null,
      record.ariaLabel ?? null,
      record.inputName ?? null,
      record.inputType ?? null,
      record.description,
      record.selector,
      record.selectorType,
      JSON.stringify(record.fallbackSelectors),
      JSON.stringify(record.nearbyText),
      JSON.stringify(record.tags),
      record.selectorQuality,
      JSON.stringify(record.selectorWarnings),
      record.stateName,
      record.stateReason ?? null,
      record.discoveredBy,
      record.fingerprint,
      JSON.stringify(record),
      record.createdAt,
      record.updatedAt
    );
    return true;
  }

  listElements(pageId: string, filters: { selectorQuality?: string; elementType?: string }): UIElementRecord[] {
    const clauses = ["page_id = ?"];
    const params: unknown[] = [pageId];
    if (filters.selectorQuality) {
      clauses.push("selector_quality = ?");
      params.push(filters.selectorQuality);
    }
    if (filters.elementType) {
      clauses.push("element_type = ?");
      params.push(filters.elementType);
    }
    const rows = this.db.prepare(`SELECT raw_json FROM ui_elements WHERE ${clauses.join(" AND ")} ORDER BY page_name, label`).all(...params) as Array<{ raw_json: string }>;
    return rows.map((row) => JSON.parse(row.raw_json) as UIElementRecord);
  }

  getElementByElementId(appId: string, elementId: string): UIElementRecord | undefined {
    const row = this.db.prepare("SELECT raw_json FROM ui_elements WHERE app_id = ? AND element_id = ? ORDER BY created_at DESC LIMIT 1")
      .get(appId, elementId) as { raw_json: string } | undefined;
    return row ? JSON.parse(row.raw_json) as UIElementRecord : undefined;
  }

  listLatestUiElementsForApp(appId: string, limit = 200): UIElementRecord[] {
    const latestVersion = this.db.prepare(`
      SELECT id
      FROM ui_map_versions
      WHERE app_id = ? AND status = 'completed'
      ORDER BY created_at DESC
      LIMIT 1
    `).get(appId) as { id: string } | undefined;

    const params: unknown[] = latestVersion ? [appId, latestVersion.id, limit] : [appId, limit];
    const versionClause = latestVersion ? "AND ui_map_version_id = ?" : "";
    const rows = this.db.prepare(`
      SELECT raw_json
      FROM ui_elements
      WHERE app_id = ?
      ${versionClause}
      ORDER BY
        CASE selector_quality
          WHEN 'strong' THEN 0
          WHEN 'medium' THEN 1
          ELSE 2
        END,
        updated_at DESC,
        route,
        label
      LIMIT ?
    `).all(...params) as Array<{ raw_json: string }>;
    return rows.map((row) => JSON.parse(row.raw_json) as UIElementRecord);
  }

  updateElement(elementId: string, input: { description?: string; tags?: string[] }): void {
    const row = this.db.prepare("SELECT id, raw_json FROM ui_elements WHERE element_id = ? ORDER BY created_at DESC LIMIT 1").get(elementId) as { id: string; raw_json: string } | undefined;
    if (!row) throw new NotFoundError(`Element not found: ${elementId}`);
    const record = JSON.parse(row.raw_json) as UIElementRecord;
    const updated: UIElementRecord = { ...record, ...input, updatedAt: nowIso() };
    this.db.prepare(`
      UPDATE ui_elements
      SET description = ?, tags_json = ?, raw_json = ?, updated_at = ?
      WHERE id = ?
    `).run(updated.description, JSON.stringify(updated.tags), JSON.stringify(updated), updated.updatedAt, row.id);
  }

  createWorkflowVideo(input: { appId: string; filename: string; localPath: string; mimeType: string; sizeBytes: number }): { videoId: string; jobId: string; status: string } {
    const now = nowIso();
    const videoId = createId("video");
    const jobId = createId("job");
    const tx = this.db.transaction(() => {
      this.db.prepare(`
        INSERT INTO workflow_videos (id, app_id, filename, local_path, mime_type, size_bytes, status, uploaded_at)
        VALUES (?, ?, ?, ?, ?, ?, 'uploaded', ?)
      `).run(videoId, input.appId, input.filename, input.localPath, input.mimeType, input.sizeBytes, now);
      this.db.prepare(`
        INSERT INTO workflow_jobs (id, app_id, video_id, status, created_at, updated_at)
        VALUES (?, ?, ?, 'uploaded', ?, ?)
      `).run(jobId, input.appId, videoId, now, now);
    });
    tx();
    return { videoId, jobId, status: "uploaded" };
  }

  getWorkflowVideo(videoId: string): Row {
    const row = this.db.prepare("SELECT * FROM workflow_videos WHERE id = ?").get(videoId) as Row | undefined;
    if (!row) throw new NotFoundError(`Workflow video not found: ${videoId}`);
    return row;
  }

  getWorkflowJob(jobId: string): Row {
    const row = this.db.prepare("SELECT * FROM workflow_jobs WHERE id = ?").get(jobId) as Row | undefined;
    if (!row) throw new NotFoundError(`Workflow job not found: ${jobId}`);
    return row;
  }

  listWorkflowJobs(appId: string): Array<{
    id: string;
    appId: string;
    videoId: string;
    filename: string;
    status: string;
    error: string | null;
    createdAt: string;
    updatedAt: string;
    workflowId?: string;
  }> {
    const rows = this.db.prepare(`
      SELECT
        workflow_jobs.id,
        workflow_jobs.app_id as appId,
        workflow_jobs.video_id as videoId,
        workflow_videos.filename as filename,
        workflow_jobs.status,
        workflow_jobs.error,
        workflow_jobs.created_at as createdAt,
        workflow_jobs.updated_at as updatedAt
      FROM workflow_jobs
      INNER JOIN workflow_videos ON workflow_videos.id = workflow_jobs.video_id
      WHERE workflow_jobs.app_id = ?
      ORDER BY workflow_jobs.created_at DESC
    `).all(appId) as Array<{
      id: string;
      appId: string;
      videoId: string;
      filename: string;
      status: string;
      error: string | null;
      createdAt: string;
      updatedAt: string;
    }>;

    const workflowByJobId = new Map<string, string>();
    const workflowRows = this.db.prepare("SELECT workflow_json FROM workflows WHERE app_id = ?").all(appId) as Array<{ workflow_json: string }>;
    for (const row of workflowRows) {
      const workflow = JSON.parse(row.workflow_json) as Workflow;
      if (workflow.createdFrom?.jobId) {
        workflowByJobId.set(workflow.createdFrom.jobId, workflow.workflowId);
      }
    }

    return rows.map((row) => ({ ...row, workflowId: workflowByJobId.get(row.id) }));
  }

  updateWorkflowJob(jobId: string, patch: { status: string; rawOutput?: unknown; timeline?: unknown; error?: string | null }): void {
    this.db.prepare(`
      UPDATE workflow_jobs
      SET status = ?, qwen_raw_output_json = COALESCE(?, qwen_raw_output_json),
          extracted_action_timeline_json = COALESCE(?, extracted_action_timeline_json),
          error = ?, updated_at = ?
      WHERE id = ?
    `).run(
      patch.status,
      patch.rawOutput === undefined ? null : JSON.stringify(patch.rawOutput),
      patch.timeline === undefined ? null : JSON.stringify(patch.timeline),
      patch.error ?? null,
      nowIso(),
      jobId
    );
  }

  saveWorkflow(workflow: Workflow): void {
    this.db.prepare(`
      INSERT INTO workflows (id, workflow_id, app_id, name, description, status, version, workflow_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(workflow_id) DO UPDATE SET
        name = excluded.name,
        description = excluded.description,
        status = excluded.status,
        version = excluded.version,
        workflow_json = excluded.workflow_json,
        updated_at = excluded.updated_at
    `).run(
      createId("workflow_row"),
      workflow.workflowId,
      workflow.appId,
      workflow.name,
      workflow.description,
      workflow.status,
      workflow.version,
      JSON.stringify(workflow),
      workflow.createdAt,
      workflow.updatedAt
    );
  }

  listWorkflows(appId: string, status?: string): Array<Pick<Workflow, "workflowId" | "name" | "description" | "status" | "version">> {
    const rows = status
      ? this.db.prepare("SELECT workflow_json FROM workflows WHERE app_id = ? AND status = ? ORDER BY updated_at DESC").all(appId, status)
      : this.db.prepare("SELECT workflow_json FROM workflows WHERE app_id = ? ORDER BY updated_at DESC").all(appId);
    return (rows as Array<{ workflow_json: string }>).map((row) => {
      const workflow = JSON.parse(row.workflow_json) as Workflow;
      return {
        workflowId: workflow.workflowId,
        name: workflow.name,
        description: workflow.description,
        status: workflow.status,
        version: workflow.version
      };
    });
  }

  getWorkflow(workflowId: string): Workflow {
    const row = this.db.prepare("SELECT workflow_json FROM workflows WHERE workflow_id = ?").get(workflowId) as { workflow_json: string } | undefined;
    if (!row) throw new NotFoundError(`Workflow not found: ${workflowId}`);
    return JSON.parse(row.workflow_json) as Workflow;
  }

  addWorkflowStep(workflowId: string, step: WorkflowStep): Workflow {
    const workflow = this.getWorkflow(workflowId);
    return this.saveMutatedWorkflow({ ...workflow, steps: [...workflow.steps, step] });
  }

  updateWorkflowStep(workflowId: string, stepId: string, patch: Partial<WorkflowStep>): Workflow {
    const workflow = this.getWorkflow(workflowId);
    let found = false;
    const steps = workflow.steps.map((step) => {
      if (step.id !== stepId) return step;
      found = true;
      return { ...step, ...patch } as WorkflowStep;
    });
    if (!found) throw new NotFoundError(`Workflow step not found: ${stepId}`);
    return this.saveMutatedWorkflow({ ...workflow, steps });
  }

  deleteWorkflowStep(workflowId: string, stepId: string): Workflow {
    const workflow = this.getWorkflow(workflowId);
    const steps = workflow.steps.filter((step) => step.id !== stepId);
    if (steps.length === workflow.steps.length) throw new NotFoundError(`Workflow step not found: ${stepId}`);
    return this.saveMutatedWorkflow({ ...workflow, steps });
  }

  reorderWorkflowSteps(workflowId: string, stepIds: string[]): Workflow {
    const workflow = this.getWorkflow(workflowId);
    const currentById = new Map(workflow.steps.map((step) => [step.id, step]));
    if (stepIds.length !== workflow.steps.length || stepIds.some((stepId) => !currentById.has(stepId))) {
      throw new NotFoundError("Workflow step reorder payload must include every existing step exactly once.");
    }
    return this.saveMutatedWorkflow({ ...workflow, steps: stepIds.map((stepId) => currentById.get(stepId)!) });
  }

  private saveMutatedWorkflow(workflow: Workflow): Workflow {
    const next: Workflow = {
      ...workflow,
      status: workflow.status === "published" ? "needs_review" : workflow.status,
      updatedAt: nowIso()
    };
    this.saveWorkflow(next);
    return next;
  }

  createRuntimeSession(input: { appId: string; workflowId: string; clientSessionId?: string; userId?: string }): { runtimeSessionId: string; status: string } {
    const id = createId("workflow_runtime");
    this.db.prepare(`
      INSERT INTO runtime_sessions (id, app_id, workflow_id, client_session_id, user_id, status, values_json, started_at)
      VALUES (?, ?, ?, ?, ?, 'pending', '{}', ?)
    `).run(id, input.appId, input.workflowId, input.clientSessionId ?? null, input.userId ?? null, nowIso());
    return { runtimeSessionId: id, status: "pending" };
  }

  updateRuntimeSession(id: string, input: { status: string; currentStepId?: string; values?: Record<string, unknown>; error?: string }): void {
    const result = this.db.prepare(`
      UPDATE runtime_sessions
      SET status = ?, current_step_id = ?, values_json = ?, completed_at = CASE WHEN ? IN ('completed', 'cancelled', 'failed') THEN ? ELSE completed_at END, error = ?
      WHERE id = ?
    `).run(input.status, input.currentStepId ?? null, JSON.stringify(input.values ?? {}), input.status, nowIso(), input.error ?? null, id);

    if (result.changes === 0) {
      throw new NotFoundError(`Runtime session not found: ${id}`);
    }
  }

  insertExecutionLog(input: { appId?: string; sessionId?: string; workflowId?: string; stepId?: string; eventType: string; payload: unknown }): void {
    this.db.prepare(`
      INSERT INTO execution_logs (id, app_id, session_id, workflow_id, step_id, event_type, payload_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(createId("log"), input.appId ?? null, input.sessionId ?? null, input.workflowId ?? null, input.stepId ?? null, input.eventType, JSON.stringify(input.payload ?? {}), nowIso());
  }

  listExecutionLogs(filters: { appId?: string; workflowId?: string; sessionId?: string }): unknown[] {
    const clauses: string[] = [];
    const params: unknown[] = [];
    for (const [column, value] of [["app_id", filters.appId], ["workflow_id", filters.workflowId], ["session_id", filters.sessionId]] as const) {
      if (value) {
        clauses.push(`${column} = ?`);
        params.push(value);
      }
    }
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    return this.db.prepare(`
      SELECT id, event_type as eventType, created_at as createdAt, payload_json as payload
      FROM execution_logs ${where} ORDER BY created_at DESC LIMIT 200
    `).all(...params).map((row) => ({ ...(row as Row), payload: JSON.parse(String((row as Row).payload)) }));
  }

  insertAiLog(input: { provider: string; purpose: string; inputSummary: string; outputSummary?: string; latencyMs?: number; error?: string }): void {
    this.db.prepare(`
      INSERT INTO ai_request_logs (id, provider, purpose, input_summary, output_summary, latency_ms, error, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(createId("ai_log"), input.provider, input.purpose, input.inputSummary, input.outputSummary ?? null, input.latencyMs ?? null, input.error ?? null, nowIso());
  }

  createApiKey(input: { name: string; prefix: string; keyHash: string; scopes: ApiKeyScope[] }): ApiKeyRecord {
    const now = nowIso();
    const id = createId("api_key");
    this.db.prepare(`
      INSERT INTO api_keys (id, name, prefix, key_hash, scopes_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, input.name, input.prefix, input.keyHash, JSON.stringify(input.scopes), now);
    return this.getApiKeyById(id);
  }

  listApiKeys(): ApiKeyRecord[] {
    return (this.db.prepare(`
      SELECT id, name, prefix, scopes_json, created_at, last_used_at, revoked_at
      FROM api_keys ORDER BY created_at DESC
    `).all() as Row[]).map(mapApiKey);
  }

  getApiKeyById(id: string): ApiKeyRecord {
    const row = this.db.prepare(`
      SELECT id, name, prefix, scopes_json, created_at, last_used_at, revoked_at
      FROM api_keys WHERE id = ?
    `).get(id) as Row | undefined;
    if (!row) throw new NotFoundError(`API key not found: ${id}`);
    return mapApiKey(row);
  }

  getApiKeySecretByPrefix(prefix: string): ApiKeySecretRecord | undefined {
    const row = this.db.prepare(`
      SELECT id, name, prefix, key_hash, scopes_json, created_at, last_used_at, revoked_at
      FROM api_keys WHERE prefix = ? LIMIT 1
    `).get(prefix) as Row | undefined;
    return row ? mapApiKeySecret(row) : undefined;
  }

  revokeApiKey(id: string): ApiKeyRecord {
    const result = this.db.prepare("UPDATE api_keys SET revoked_at = COALESCE(revoked_at, ?) WHERE id = ?")
      .run(nowIso(), id);
    if (result.changes === 0) throw new NotFoundError(`API key not found: ${id}`);
    return this.getApiKeyById(id);
  }

  markApiKeyUsed(id: string): void {
    this.db.prepare("UPDATE api_keys SET last_used_at = ? WHERE id = ?").run(nowIso(), id);
  }

  getUsageSummary(filters: { appId?: string; from?: string; to?: string }): UsageSummary {
    const executionWhere = buildLogWhere("execution_logs", filters);
    const aiWhere = buildAiWhere(filters);
    const executionRows = this.db.prepare(`
      SELECT event_type as eventType, COUNT(*) as count
      FROM execution_logs ${executionWhere.where}
      GROUP BY event_type ORDER BY count DESC
    `).all(...executionWhere.params) as Array<{ eventType: string; count: number }>;
    const providerRows = this.db.prepare(`
      SELECT provider, COUNT(*) as count
      FROM ai_request_logs ${aiWhere.where}
      GROUP BY provider ORDER BY count DESC
    `).all(...aiWhere.params) as Array<{ provider: string; count: number }>;
    const executionTotals = this.db.prepare(`
      SELECT
        COUNT(*) as sdkEvents,
        SUM(CASE WHEN event_type LIKE 'workflow_%' THEN 1 ELSE 0 END) as workflowRuns,
        SUM(CASE WHEN event_type LIKE '%error%' OR event_type LIKE '%failed%' THEN 1 ELSE 0 END) as errors
      FROM execution_logs ${executionWhere.where}
    `).get(...executionWhere.params) as Row;
    const aiTotals = this.db.prepare(`
      SELECT
        COUNT(*) as aiRequests,
        AVG(latency_ms) as averageAiLatencyMs,
        SUM(CASE WHEN error IS NOT NULL AND error != '' THEN 1 ELSE 0 END) as errors
      FROM ai_request_logs ${aiWhere.where}
    `).get(...aiWhere.params) as Row;

    return {
      totals: {
        sdkEvents: Number(executionTotals.sdkEvents ?? 0),
        workflowRuns: Number(executionTotals.workflowRuns ?? 0),
        aiRequests: Number(aiTotals.aiRequests ?? 0),
        errors: Number(executionTotals.errors ?? 0) + Number(aiTotals.errors ?? 0),
        averageAiLatencyMs: aiTotals.averageAiLatencyMs === null || aiTotals.averageAiLatencyMs === undefined ? null : Math.round(Number(aiTotals.averageAiLatencyMs))
      },
      eventCounts: executionRows.map((row) => ({ eventType: row.eventType, count: Number(row.count) })),
      providerCounts: providerRows.map((row) => ({ provider: row.provider, count: Number(row.count) }))
    };
  }

  getUsageTimeseries(filters: { appId?: string; from?: string; to?: string; bucket?: "day" }): UsageTimeseriesPoint[] {
    const executionWhere = buildLogWhere("execution_logs", filters);
    const aiWhere = buildAiWhere(filters);
    const points = new Map<string, UsageTimeseriesPoint>();
    const ensure = (bucket: string) => {
      const existing = points.get(bucket);
      if (existing) return existing;
      const point = { bucket, sdkEvents: 0, workflowRuns: 0, aiRequests: 0, errors: 0 };
      points.set(bucket, point);
      return point;
    };

    const executionRows = this.db.prepare(`
      SELECT substr(created_at, 1, 10) as bucket, event_type as eventType, COUNT(*) as count
      FROM execution_logs ${executionWhere.where}
      GROUP BY bucket, event_type
    `).all(...executionWhere.params) as Array<{ bucket: string; eventType: string; count: number }>;
    for (const row of executionRows) {
      const point = ensure(row.bucket);
      point.sdkEvents += Number(row.count);
      if (row.eventType.startsWith("workflow_")) point.workflowRuns += Number(row.count);
      if (row.eventType.includes("error") || row.eventType.includes("failed")) point.errors += Number(row.count);
    }

    const aiRows = this.db.prepare(`
      SELECT substr(created_at, 1, 10) as bucket, COUNT(*) as count,
        SUM(CASE WHEN error IS NOT NULL AND error != '' THEN 1 ELSE 0 END) as errors
      FROM ai_request_logs ${aiWhere.where}
      GROUP BY bucket
    `).all(...aiWhere.params) as Array<{ bucket: string; count: number; errors: number }>;
    for (const row of aiRows) {
      const point = ensure(row.bucket);
      point.aiRequests += Number(row.count);
      point.errors += Number(row.errors ?? 0);
    }

    return [...points.values()].sort((a, b) => a.bucket.localeCompare(b.bucket));
  }
}

function mapApp(row: Row): AppRecord {
  return {
    id: String(row.id),
    name: String(row.name),
    slug: String(row.slug),
    baseUrl: String(row.base_url),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  };
}

function mapApiKey(row: Row): ApiKeyRecord {
  return {
    id: String(row.id),
    name: String(row.name),
    prefix: String(row.prefix),
    scopes: JSON.parse(String(row.scopes_json)) as ApiKeyScope[],
    createdAt: String(row.created_at),
    lastUsedAt: row.last_used_at ? String(row.last_used_at) : null,
    revokedAt: row.revoked_at ? String(row.revoked_at) : null
  };
}

function mapApiKeySecret(row: Row): ApiKeySecretRecord {
  return {
    ...mapApiKey(row),
    keyHash: String(row.key_hash)
  };
}

function buildLogWhere(table: "execution_logs", filters: { appId?: string; from?: string; to?: string }): { where: string; params: unknown[] } {
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (filters.appId) {
    clauses.push(`${table}.app_id = ?`);
    params.push(filters.appId);
  }
  if (filters.from) {
    clauses.push(`${table}.created_at >= ?`);
    params.push(filters.from);
  }
  if (filters.to) {
    clauses.push(`${table}.created_at <= ?`);
    params.push(filters.to);
  }
  return { where: clauses.length ? `WHERE ${clauses.join(" AND ")}` : "", params };
}

function buildAiWhere(filters: { appId?: string; from?: string; to?: string }): { where: string; params: unknown[] } {
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (filters.appId) {
    clauses.push("(input_summary LIKE ? OR output_summary LIKE ?)");
    params.push(`%${filters.appId}%`, `%${filters.appId}%`);
  }
  if (filters.from) {
    clauses.push("created_at >= ?");
    params.push(filters.from);
  }
  if (filters.to) {
    clauses.push("created_at <= ?");
    params.push(filters.to);
  }
  return { where: clauses.length ? `WHERE ${clauses.join(" AND ")}` : "", params };
}
