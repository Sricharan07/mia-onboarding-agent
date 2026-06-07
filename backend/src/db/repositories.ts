import type { Db } from "./database.js";
import { createId, nowIso, slugToId } from "../utils/id.js";
import { NotFoundError } from "../utils/errors.js";
import type { AppRecord, UIElementRecord, Workflow } from "../schemas/domain.js";

type Row = Record<string, unknown>;

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

  createUiMapVersion(appId: string): { id: string; appId: string; version: string; status: string; createdAt: string } {
    const now = nowIso();
    const id = createId("ui_map");
    const version = `local-${Date.now()}`;
    this.db.prepare(`
      INSERT INTO ui_map_versions (id, app_id, version, source, status, created_at)
      VALUES (?, ?, ?, 'runtime_browser_scan', 'scanning', ?)
    `).run(id, appId, version, now);
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
    const id = createId("page");
    this.db.prepare(`
      INSERT INTO pages (id, app_id, ui_map_version_id, name, route, url, title, status, error, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, input.appId, input.uiMapVersionId, input.name, input.route, input.url, input.title ?? null, input.status, input.error ?? null, nowIso());
    return id;
  }

  listPages(uiMapVersionId: string): unknown[] {
    return this.db.prepare(`
      SELECT id, name, route, url, title, status, error, created_at as createdAt
      FROM pages WHERE ui_map_version_id = ? ORDER BY route
    `).all(uiMapVersionId);
  }

  saveUiElement(record: UIElementRecord): void {
    this.db.prepare(`
      INSERT INTO ui_elements (
        id, element_id, app_id, ui_map_version_id, page_id, route, page_name, element_type,
        role, label, visible_text, accessible_name, placeholder, aria_label, input_name, input_type,
        description, selector, selector_type, fallback_selectors_json, nearby_text_json, tags_json,
        selector_quality, selector_warnings_json, raw_json, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
      JSON.stringify(record),
      record.createdAt,
      record.updatedAt
    );
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
