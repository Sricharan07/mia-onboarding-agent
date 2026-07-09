import type { Db } from "./database.js";
import { createId, nowIso, slugToId } from "../utils/id.js";
import { AppError, NotFoundError } from "../utils/errors.js";
import type { AppRecord, AppUiScanConfig, TelemetryMode, UIElementRecord, UiScanAuthMode, Workflow, WorkflowStep } from "../schemas/domain.js";
import { decryptSecret, encryptSecret, hasSecretEncryptionKey, isEncryptedSecret } from "../services/security/secretCrypto.js";

type Row = Record<string, unknown>;
export type ApiKeyScope = "apps:read" | "ui-map:read" | "workflows:read" | "runtime:tokens:create" | "logs:read" | "admin";

export type RuntimeTokenCapability = "runtime:resolve" | "runtime:workflow" | "logs:write" | "voice:live" | "voice:tts" | "voice:livekit";

export type ApiKeyRecord = {
  id: string;
  name: string;
  prefix: string;
  scopes: ApiKeyScope[];
  appId: string | null;
  allowedOrigins: string[];
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
};

export type ApiKeySecretRecord = ApiKeyRecord & {
  keyHash: string;
};

export type RuntimeAccessTokenRecord = {
  id: string;
  prefix: string;
  appId: string;
  userId: string;
  allowedOrigin: string;
  capabilities: RuntimeTokenCapability[];
  expiresAt: string;
  maxUses: number;
  useCount: number;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
};

export type RuntimeAccessTokenSecretRecord = RuntimeAccessTokenRecord & {
  tokenHash: string;
};

export type ConsoleUserRecord = {
  id: string;
  email: string;
  name: string;
  role: "admin";
  passwordHash: string;
  createdAt: string;
  updatedAt: string;
  lastLoginAt: string | null;
  disabledAt: string | null;
};

export type ConsoleSessionRecord = {
  id: string;
  userId: string;
  tokenHash: string;
  createdAt: string;
  expiresAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
  user: Omit<ConsoleUserRecord, "passwordHash">;
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

export type AppUiScanConfigInput = Partial<Omit<AppUiScanConfigWithSecrets, "passwordConfigured">> & {
  clearPassword?: boolean;
};

export type AppUiScanConfigWithSecrets = AppUiScanConfig & {
  password?: string;
  passwordSecret?: string;
};

export type UiMapScanConfig = {
  baseUrl: string;
  routes: string[];
  auth?: AppUiScanConfigWithSecrets;
  ignoredSelectors: string[];
  redactedSelectors: string[];
  routeDiscovery: AppUiScanConfig["routeDiscovery"];
};

export type UiMapVersionSummary = {
  id: string;
  appId: string;
  version: string;
  source: string;
  status: string;
  createdAt: string;
  completedAt: string | null;
  error: string | null;
  routes: string[];
  routeCount: number;
  pageCount: number;
  failedPageCount: number;
  elementCount: number;
  strongSelectorCount: number;
  mediumSelectorCount: number;
  weakSelectorCount: number;
};

export class Repositories {
  constructor(
    private readonly db: Db,
    private readonly secretEncryptionKey?: string
  ) {}

  ping(): void {
    this.db.prepare("SELECT 1").get();
  }

  close(): void {
    if (this.db.open) this.db.close();
  }

  listApps(): AppRecord[] {
    return (this.db.prepare("SELECT * FROM apps WHERE archived_at IS NULL ORDER BY created_at DESC").all() as Row[])
      .map((row) => mapApp(row, this.secretEncryptionKey));
  }

  upsertApp(input: {
    name: string;
    slug: string;
    baseUrl: string;
    uiScanConfig?: AppUiScanConfigInput;
    privacyPolicy?: { telemetryMode: TelemetryMode; retentionDays: number };
  }): AppRecord {
    const existing = this.db.prepare("SELECT * FROM apps WHERE slug = ?").get(input.slug) as Row | undefined;
    if (existing?.archived_at) {
      throw new AppError("APP_ARCHIVED", "Archived apps cannot be updated. Create a new app slug instead.", 409);
    }
    const now = nowIso();
    const id = existing ? String(existing.id) : slugToId("app", input.slug);
    const currentScanConfig = parseStoredUiScanConfig(existing?.ui_scan_config_json, this.secretEncryptionKey);
    const nextScanConfig = mergeUiScanConfig(currentScanConfig, input.uiScanConfig, this.secretEncryptionKey);

    this.db.prepare(`
      INSERT INTO apps (
        id, name, slug, base_url, ui_scan_config_json,
        telemetry_mode, telemetry_retention_days, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(slug) DO UPDATE SET
        name = excluded.name,
        base_url = excluded.base_url,
        ui_scan_config_json = excluded.ui_scan_config_json,
        telemetry_mode = excluded.telemetry_mode,
        telemetry_retention_days = excluded.telemetry_retention_days,
        updated_at = excluded.updated_at
    `).run(
      id,
      input.name,
      input.slug,
      input.baseUrl,
      JSON.stringify(serializeUiScanConfig(nextScanConfig, this.secretEncryptionKey)),
      input.privacyPolicy?.telemetryMode ?? existing?.telemetry_mode ?? "events_only",
      input.privacyPolicy?.retentionDays ?? existing?.telemetry_retention_days ?? 30,
      existing?.created_at ?? now,
      now
    );

    return this.getApp(id);
  }

  getApp(appId: string): AppRecord {
    const row = this.db.prepare("SELECT * FROM apps WHERE id = ?").get(appId) as Row | undefined;
    if (!row) throw new NotFoundError(`App not found: ${appId}`);
    return mapApp(row, this.secretEncryptionKey);
  }

  getActiveApp(appId: string): AppRecord {
    const app = this.getApp(appId);
    if (app.archivedAt) throw new NotFoundError(`App not found: ${appId}`);
    return app;
  }

  getAppUiScanConfig(appId: string): AppUiScanConfigWithSecrets {
    const row = this.db.prepare("SELECT ui_scan_config_json FROM apps WHERE id = ?").get(appId) as Row | undefined;
    if (!row) throw new NotFoundError(`App not found: ${appId}`);
    return parseStoredUiScanConfig(row.ui_scan_config_json, this.secretEncryptionKey);
  }

  archiveApp(appId: string): AppRecord {
    const now = nowIso();
    let changes = 0;
    const tx = this.db.transaction(() => {
      const result = this.db.prepare("UPDATE apps SET archived_at = COALESCE(archived_at, ?), updated_at = ? WHERE id = ?")
        .run(now, now, appId);
      changes = result.changes;
      this.db.prepare("UPDATE api_keys SET revoked_at = COALESCE(revoked_at, ?) WHERE app_id = ?")
        .run(now, appId);
      this.db.prepare("UPDATE runtime_access_tokens SET revoked_at = COALESCE(revoked_at, ?) WHERE app_id = ?")
        .run(now, appId);
    });
    tx();
    const result = { changes };
    if (result.changes === 0) throw new NotFoundError(`App not found: ${appId}`);
    return this.getAppIncludingArchived(appId);
  }

  private getAppIncludingArchived(appId: string): AppRecord {
    const row = this.db.prepare("SELECT * FROM apps WHERE id = ?").get(appId) as Row | undefined;
    if (!row) throw new NotFoundError(`App not found: ${appId}`);
    return mapApp(row, this.secretEncryptionKey);
  }

  createUiMapVersion(appId: string, source = "runtime_browser_scan", scanConfig?: UiMapScanConfig): { id: string; appId: string; version: string; status: string; createdAt: string } {
    const now = nowIso();
    const id = createId("ui_map");
    const version = `local-${Date.now()}`;
    this.db.prepare(`
      INSERT INTO ui_map_versions (id, app_id, version, source, status, scan_config_json, created_at)
      VALUES (?, ?, ?, ?, 'scanning', ?, ?)
    `).run(id, appId, version, source, scanConfig ? JSON.stringify(scanConfig) : null, now);
    return { id, appId, version, status: "scanning", createdAt: now };
  }

  updateUiMapVersion(id: string, status: "completed" | "failed", error?: string): void {
    const version = this.getUiMapVersion(id);
    this.db.prepare("UPDATE ui_map_versions SET status = ?, completed_at = ?, error = ?, locked_by = NULL, locked_until = NULL WHERE id = ?")
      .run(status, nowIso(), error ?? null, id);
    if (status === "completed") this.invalidateWorkflowsForUiMap(String(version.app_id), id);
  }

  private invalidateWorkflowsForUiMap(appId: string, uiMapVersionId: string): void {
    const rows = this.db.prepare(`
      SELECT workflow_id, workflow_json FROM workflows
      WHERE app_id = ? AND status IN ('approved', 'published')
    `).all(appId) as Array<{ workflow_id: string; workflow_json: string }>;
    const invalidate = this.db.transaction(() => {
      for (const row of rows) {
        const workflow = JSON.parse(row.workflow_json) as Workflow;
        if (workflow.review.uiMapVersionId === uiMapVersionId) continue;
        const next: Workflow = { ...workflow, status: "needs_review", review: {}, updatedAt: nowIso() };
        this.db.prepare(`
          UPDATE workflows SET status = 'needs_review', workflow_json = ?, updated_at = ? WHERE workflow_id = ?
        `).run(JSON.stringify(next), next.updatedAt, row.workflow_id);
        if (next.createdFrom?.jobId) this.updateWorkflowJobStatus(next.createdFrom.jobId, "needs_review");
      }
    });
    invalidate();
  }

  getUiMapVersion(id: string): Row {
    const row = this.db.prepare("SELECT * FROM ui_map_versions WHERE id = ?").get(id) as Row | undefined;
    if (!row) throw new NotFoundError(`UI map version not found: ${id}`);
    return row;
  }

  claimUiMapVersion(id: string, workerId: string, leaseUntil: string): boolean {
    const now = nowIso();
    const result = this.db.prepare(`
      UPDATE ui_map_versions
      SET locked_by = ?, locked_until = ?, attempts = attempts + 1
      WHERE id = ?
        AND status = 'scanning'
        AND scan_config_json IS NOT NULL
        AND (locked_until IS NULL OR locked_until <= ? OR locked_by = ?)
    `).run(workerId, leaseUntil, id, now, workerId);
    return result.changes > 0;
  }

  refreshUiMapVersionLease(id: string, workerId: string, leaseUntil: string): void {
    this.db.prepare("UPDATE ui_map_versions SET locked_until = ? WHERE id = ? AND locked_by = ?")
      .run(leaseUntil, id, workerId);
  }

  listUnfinishedUiMapScans(): Array<{ id: string }> {
    const now = nowIso();
    return this.db.prepare(`
      SELECT id
      FROM ui_map_versions
      WHERE status = 'scanning'
        AND source = 'runtime_browser_scan'
        AND scan_config_json IS NOT NULL
        AND (locked_until IS NULL OR locked_until <= ?)
      ORDER BY created_at ASC
    `).all(now) as Array<{ id: string }>;
  }

  listUiMapVersions(appId: string): UiMapVersionSummary[] {
    const rows = this.db.prepare(`
      SELECT
        v.id,
        v.app_id as appId,
        v.version,
        v.source,
        v.status,
        v.scan_config_json as scanConfigJson,
        v.created_at as createdAt,
        v.completed_at as completedAt,
        v.error,
        (SELECT COUNT(*) FROM pages p WHERE p.ui_map_version_id = v.id) as pageCount,
        (SELECT COUNT(*) FROM pages p WHERE p.ui_map_version_id = v.id AND p.status = 'failed') as failedPageCount,
        (SELECT COUNT(*) FROM ui_elements e WHERE e.ui_map_version_id = v.id) as elementCount,
        (SELECT COUNT(*) FROM ui_elements e WHERE e.ui_map_version_id = v.id AND e.selector_quality = 'strong') as strongSelectorCount,
        (SELECT COUNT(*) FROM ui_elements e WHERE e.ui_map_version_id = v.id AND e.selector_quality = 'medium') as mediumSelectorCount,
        (SELECT COUNT(*) FROM ui_elements e WHERE e.ui_map_version_id = v.id AND e.selector_quality = 'weak') as weakSelectorCount
      FROM ui_map_versions v
      WHERE v.app_id = ?
      ORDER BY v.created_at DESC
    `).all(appId) as Row[];
    return rows.map(mapUiMapVersionSummary);
  }

  getLatestCompletedUiMapVersion(appId: string): { id: string; appId: string; version: string; status: string; createdAt: string; completedAt: string | null } | undefined {
    return this.db.prepare(`
      SELECT id, app_id as appId, version, status, created_at as createdAt, completed_at as completedAt
      FROM ui_map_versions
      WHERE app_id = ? AND status = 'completed'
      ORDER BY completed_at DESC, created_at DESC
      LIMIT 1
    `).get(appId) as { id: string; appId: string; version: string; status: string; createdAt: string; completedAt: string | null } | undefined;
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

  getPage(pageId: string): { id: string; appId: string; uiMapVersionId: string } {
    const row = this.db.prepare(`
      SELECT id, app_id as appId, ui_map_version_id as uiMapVersionId
      FROM pages WHERE id = ?
    `).get(pageId) as { id: string; appId: string; uiMapVersionId: string } | undefined;
    if (!row) throw new NotFoundError(`Page not found: ${pageId}`);
    return row;
  }

  listPages(uiMapVersionId: string): unknown[] {
    return this.db.prepare(`
      SELECT
        p.id,
        p.name,
        p.route,
        p.url,
        p.title,
        p.status,
        p.error,
        p.created_at as createdAt,
        (SELECT COUNT(*) FROM ui_elements e WHERE e.page_id = p.id) as elementCount,
        (SELECT COUNT(DISTINCT e.state_name) FROM ui_elements e WHERE e.page_id = p.id) as stateCount,
        (SELECT COUNT(*) FROM ui_elements e WHERE e.page_id = p.id AND e.selector_quality = 'strong') as strongSelectorCount,
        (SELECT COUNT(*) FROM ui_elements e WHERE e.page_id = p.id AND e.selector_quality = 'medium') as mediumSelectorCount,
        (SELECT COUNT(*) FROM ui_elements e WHERE e.page_id = p.id AND e.selector_quality = 'weak') as weakSelectorCount
      FROM pages p
      WHERE p.ui_map_version_id = ?
      ORDER BY p.route
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

  countUiElementsForVersion(uiMapVersionId: string): number {
    const row = this.db.prepare("SELECT COUNT(*) as count FROM ui_elements WHERE ui_map_version_id = ?")
      .get(uiMapVersionId) as { count: number };
    return Number(row.count);
  }

  listUiElementsForVersion(uiMapVersionId: string, limit: number, offset: number): UIElementRecord[] {
    const rows = this.db.prepare(`
      SELECT raw_json
      FROM ui_elements
      WHERE ui_map_version_id = ?
      ORDER BY page_name, label, id
      LIMIT ? OFFSET ?
    `).all(uiMapVersionId, limit, offset) as Array<{ raw_json: string }>;
    return rows.map((row) => JSON.parse(row.raw_json) as UIElementRecord);
  }

  getElementByElementId(appId: string, elementId: string): UIElementRecord | undefined {
    const latestVersion = this.getLatestCompletedUiMapVersion(appId);
    if (!latestVersion) return undefined;
    const row = this.db.prepare("SELECT raw_json FROM ui_elements WHERE app_id = ? AND ui_map_version_id = ? AND element_id = ? ORDER BY created_at DESC LIMIT 1")
      .get(appId, latestVersion.id, elementId) as { raw_json: string } | undefined;
    return row ? JSON.parse(row.raw_json) as UIElementRecord : undefined;
  }

  countLatestElementsBySelector(appId: string, selector: string): number {
    const latestVersion = this.getLatestCompletedUiMapVersion(appId);
    if (!latestVersion) return 0;
    const row = this.db.prepare(`
      SELECT COUNT(*) as count FROM ui_elements
      WHERE app_id = ? AND ui_map_version_id = ? AND selector = ?
    `).get(appId, latestVersion.id, selector) as { count: number };
    return Number(row.count);
  }

  listLatestUiElementsForApp(appId: string, limit = 200): UIElementRecord[] {
    const latestVersion = this.getLatestCompletedUiMapVersion(appId);
    if (!latestVersion) return [];
    const rows = this.db.prepare(`
      SELECT raw_json
      FROM ui_elements
      WHERE app_id = ?
      AND ui_map_version_id = ?
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
    `).all(appId, latestVersion.id, limit) as Array<{ raw_json: string }>;
    return rows.map((row) => JSON.parse(row.raw_json) as UIElementRecord);
  }

  listUiElementsForApp(appId: string): UIElementRecord[] {
    const latestVersion = this.getLatestCompletedUiMapVersion(appId);
    if (!latestVersion) return [];
    const rows = this.db.prepare(`
      SELECT raw_json
      FROM ui_elements
      WHERE app_id = ? AND ui_map_version_id = ?
      ORDER BY updated_at DESC
    `).all(appId, latestVersion.id) as Array<{ raw_json: string }>;
    return rows.map((row) => JSON.parse(row.raw_json) as UIElementRecord);
  }

  updateLatestElement(appId: string, elementRowId: string, input: { description?: string; tags?: string[] }): void {
    const latestVersion = this.getLatestCompletedUiMapVersion(appId);
    if (!latestVersion) throw new NotFoundError(`Element not found: ${elementRowId}`);
    const row = this.db.prepare(`
      SELECT id, raw_json
      FROM ui_elements
      WHERE id = ? AND app_id = ? AND ui_map_version_id = ?
      LIMIT 1
    `).get(elementRowId, appId, latestVersion.id) as { id: string; raw_json: string } | undefined;
    if (!row) throw new NotFoundError(`Element not found: ${elementRowId}`);
    const record = JSON.parse(row.raw_json) as UIElementRecord;
    const updated: UIElementRecord = { ...record, ...input, updatedAt: nowIso() };
    this.db.prepare(`
      UPDATE ui_elements
      SET description = ?, tags_json = ?, raw_json = ?, updated_at = ?
      WHERE id = ? AND app_id = ? AND ui_map_version_id = ?
    `).run(updated.description, JSON.stringify(updated.tags), JSON.stringify(updated), updated.updatedAt, row.id, appId, latestVersion.id);
  }

  createWorkflowVideo(input: {
    appId: string;
    filename: string;
    localPath: string;
    mimeType: string;
    sizeBytes: number;
    workflowName?: string;
    workflowDescription?: string;
  }): { videoId: string; jobId: string; status: string } {
    const now = nowIso();
    const videoId = createId("video");
    const jobId = createId("job");
    const tx = this.db.transaction(() => {
      this.db.prepare(`
        INSERT INTO workflow_videos (id, app_id, filename, local_path, mime_type, size_bytes, workflow_name, workflow_description, status, uploaded_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'uploaded', ?)
      `).run(videoId, input.appId, input.filename, input.localPath, input.mimeType, input.sizeBytes, input.workflowName ?? null, input.workflowDescription ?? null, now);
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

  listUnfinishedWorkflowJobs(): Array<{ id: string; status: string }> {
    const now = nowIso();
    return this.db.prepare(`
      SELECT id, status
      FROM workflow_jobs
      WHERE status IN ('uploaded', 'analyzing', 'mapped')
        AND (locked_until IS NULL OR locked_until <= ?)
      ORDER BY created_at ASC
    `).all(now) as Array<{ id: string; status: string }>;
  }

  claimWorkflowJob(jobId: string, workerId: string, leaseUntil: string): boolean {
    const now = nowIso();
    const result = this.db.prepare(`
      UPDATE workflow_jobs
      SET status = 'analyzing', error = NULL, locked_by = ?, locked_until = ?, attempts = attempts + 1, updated_at = ?
      WHERE id = ?
        AND status IN ('uploaded', 'analyzing', 'mapped', 'failed')
        AND (locked_until IS NULL OR locked_until <= ? OR locked_by = ?)
    `).run(workerId, leaseUntil, now, jobId, now, workerId);
    return result.changes > 0;
  }

  refreshWorkflowJobLease(jobId: string, workerId: string, leaseUntil: string): void {
    this.db.prepare("UPDATE workflow_jobs SET locked_until = ?, updated_at = ? WHERE id = ? AND locked_by = ?")
      .run(leaseUntil, nowIso(), jobId, workerId);
  }

  releaseWorkflowJob(jobId: string, workerId: string): void {
    this.db.prepare(`
      UPDATE workflow_jobs
      SET status = CASE WHEN extracted_action_timeline_json IS NULL THEN 'uploaded' ELSE 'mapped' END,
          error = 'Processing interrupted by backend shutdown. The job will resume automatically.',
          locked_by = NULL,
          locked_until = NULL,
          updated_at = ?
      WHERE id = ? AND locked_by = ?
    `).run(nowIso(), jobId, workerId);
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
      SET status = ?, provider_raw_output_json = COALESCE(?, provider_raw_output_json),
          extracted_action_timeline_json = COALESCE(?, extracted_action_timeline_json),
          error = ?, updated_at = ?,
          locked_by = CASE WHEN ? IN ('needs_review', 'failed', 'approved', 'published', 'archived') THEN NULL ELSE locked_by END,
          locked_until = CASE WHEN ? IN ('needs_review', 'failed', 'approved', 'published', 'archived') THEN NULL ELSE locked_until END
      WHERE id = ?
    `).run(
      patch.status,
      patch.rawOutput === undefined ? null : JSON.stringify(patch.rawOutput),
      patch.timeline === undefined ? null : JSON.stringify(patch.timeline),
      patch.error ?? null,
      nowIso(),
      patch.status,
      patch.status,
      jobId
    );
  }

  updateWorkflowJobStatus(jobId: string, status: string): void {
    this.db.prepare(`
      UPDATE workflow_jobs
      SET status = ?, error = NULL, updated_at = ?,
          locked_by = CASE WHEN ? IN ('needs_review', 'failed', 'approved', 'published', 'archived') THEN NULL ELSE locked_by END,
          locked_until = CASE WHEN ? IN ('needs_review', 'failed', 'approved', 'published', 'archived') THEN NULL ELSE locked_until END
      WHERE id = ?
    `).run(status, nowIso(), status, status, jobId);
  }

  saveWorkflow(workflow: Workflow): void {
    const existing = this.db.prepare("SELECT app_id FROM workflows WHERE workflow_id = ?").get(workflow.workflowId) as { app_id: string } | undefined;
    if (existing && existing.app_id !== workflow.appId) {
      throw new AppError("WORKFLOW_ID_APP_MISMATCH", `Workflow id ${workflow.workflowId} already belongs to another app.`, 409);
    }

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

  listFullWorkflows(appId: string, status?: string): Workflow[] {
    const rows = status
      ? this.db.prepare("SELECT workflow_json FROM workflows WHERE app_id = ? AND status = ? ORDER BY updated_at DESC").all(appId, status)
      : this.db.prepare("SELECT workflow_json FROM workflows WHERE app_id = ? ORDER BY updated_at DESC").all(appId);
    return (rows as Array<{ workflow_json: string }>).map((row) => JSON.parse(row.workflow_json) as Workflow);
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
      INSERT INTO runtime_sessions (id, app_id, workflow_id, client_session_id, user_id, status, started_at)
      VALUES (?, ?, ?, ?, ?, 'pending', ?)
    `).run(id, input.appId, input.workflowId, input.clientSessionId ?? null, input.userId ?? null, nowIso());
    return { runtimeSessionId: id, status: "pending" };
  }

  updateRuntimeSession(id: string, input: { status: string; currentStepId?: string; error?: string }): void {
    const result = this.db.prepare(`
      UPDATE runtime_sessions
      SET status = ?,
          current_step_id = CASE WHEN ? IN ('completed', 'cancelled', 'failed') THEN NULL ELSE COALESCE(?, current_step_id) END,
          completed_at = CASE WHEN ? IN ('completed', 'cancelled', 'failed') THEN ? ELSE completed_at END,
          error = ?
      WHERE id = ?
    `).run(input.status, input.status, input.currentStepId ?? null, input.status, nowIso(), input.error ?? null, id);

    if (result.changes === 0) {
      throw new NotFoundError(`Runtime session not found: ${id}`);
    }
  }

  getRuntimeSession(id: string): { id: string; appId: string; workflowId: string; userId: string | null; status: string } {
    const row = this.db.prepare(`
      SELECT id, app_id as appId, workflow_id as workflowId, user_id as userId, status
      FROM runtime_sessions WHERE id = ?
    `).get(id) as { id: string; appId: string; workflowId: string; userId: string | null; status: string } | undefined;
    if (!row) throw new NotFoundError(`Runtime session not found: ${id}`);
    return row;
  }

  insertExecutionLog(input: {
    appId: string;
    userId?: string;
    sessionId?: string;
    workflowId?: string;
    stepId?: string;
    eventType: string;
    telemetryLevel: TelemetryMode;
    payload: unknown;
  }): void {
    this.db.prepare(`
      INSERT INTO execution_logs (
        id, app_id, user_id, session_id, workflow_id, step_id,
        event_type, telemetry_level, payload_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      createId("log"),
      input.appId,
      input.userId ?? null,
      input.sessionId ?? null,
      input.workflowId ?? null,
      input.stepId ?? null,
      input.eventType,
      input.telemetryLevel,
      JSON.stringify(input.payload ?? {}),
      nowIso()
    );
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
      SELECT id,
             app_id as appId,
             user_id as userId,
             session_id as sessionId,
             workflow_id as workflowId,
             step_id as stepId,
             event_type as eventType,
             telemetry_level as telemetryLevel,
             created_at as createdAt,
             payload_json as payload
      FROM execution_logs ${where} ORDER BY created_at DESC LIMIT 200
    `).all(...params).map((row) => ({ ...(row as Row), payload: JSON.parse(String((row as Row).payload)) }));
  }

  insertAiLog(input: { appId?: string; provider: string; purpose: string; inputSummary: string; outputSummary?: string; latencyMs?: number; error?: string }): void {
    this.db.prepare(`
      INSERT INTO ai_request_logs (id, app_id, provider, purpose, input_summary, output_summary, latency_ms, error, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(createId("ai_log"), input.appId ?? null, input.provider, input.purpose, input.inputSummary, input.outputSummary ?? null, input.latencyMs ?? null, input.error ?? null, nowIso());
  }

  purgeExpiredData(appId?: string): { executionLogs: number; runtimeSessions: number; aiRequestLogs: number; runtimeTokens: number } {
    const apps = appId
      ? [this.getApp(appId)]
      : (this.db.prepare("SELECT * FROM apps").all() as Row[]).map((row) => mapApp(row, this.secretEncryptionKey));
    const totals = { executionLogs: 0, runtimeSessions: 0, aiRequestLogs: 0, runtimeTokens: 0 };
    const purge = this.db.transaction(() => {
      for (const app of apps) {
        const cutoff = new Date(Date.now() - app.privacyPolicy.retentionDays * 86_400_000).toISOString();
        totals.executionLogs += this.db.prepare("DELETE FROM execution_logs WHERE app_id = ? AND created_at < ?").run(app.id, cutoff).changes;
        totals.runtimeSessions += this.db.prepare(`
          DELETE FROM runtime_sessions
          WHERE app_id = ? AND completed_at IS NOT NULL AND completed_at < ?
        `).run(app.id, cutoff).changes;
        totals.aiRequestLogs += this.db.prepare("DELETE FROM ai_request_logs WHERE app_id = ? AND created_at < ?").run(app.id, cutoff).changes;
        totals.runtimeTokens += this.db.prepare(`
          DELETE FROM runtime_access_tokens
          WHERE app_id = ? AND (expires_at < ? OR (revoked_at IS NOT NULL AND revoked_at < ?))
        `).run(app.id, cutoff, cutoff).changes;
      }
    });
    purge();
    return totals;
  }

  exportAppData(appId: string): Record<string, unknown> {
    const app = this.getApp(appId);
    const runtimeSessions = this.db.prepare(`
      SELECT id, app_id as appId, workflow_id as workflowId, client_session_id as clientSessionId,
             user_id as userId, status, current_step_id as currentStepId, started_at as startedAt,
             completed_at as completedAt, error
      FROM runtime_sessions WHERE app_id = ? ORDER BY started_at DESC
    `).all(appId);
    const aiRequestLogs = this.db.prepare(`
      SELECT id, app_id as appId, provider, purpose, input_summary as inputSummary,
             output_summary as outputSummary, latency_ms as latencyMs, error, created_at as createdAt
      FROM ai_request_logs WHERE app_id = ? ORDER BY created_at DESC
    `).all(appId);
    const executionLogs = (this.db.prepare(`
      SELECT id, app_id as appId, user_id as userId, session_id as sessionId,
             workflow_id as workflowId, step_id as stepId, event_type as eventType,
             telemetry_level as telemetryLevel, payload_json as payload, created_at as createdAt
      FROM execution_logs WHERE app_id = ? ORDER BY created_at DESC
    `).all(appId) as Row[]).map((row) => ({ ...row, payload: JSON.parse(String(row.payload)) }));
    return {
      exportedAt: nowIso(),
      app,
      runtimeSessions,
      executionLogs,
      aiRequestLogs
    };
  }

  deleteUserData(appId: string, userId: string): { executionLogs: number; runtimeSessions: number; runtimeTokens: number } {
    this.getApp(appId);
    const totals = { executionLogs: 0, runtimeSessions: 0, runtimeTokens: 0 };
    const remove = this.db.transaction(() => {
      totals.executionLogs = this.db.prepare("DELETE FROM execution_logs WHERE app_id = ? AND user_id = ?").run(appId, userId).changes;
      totals.runtimeSessions = this.db.prepare("DELETE FROM runtime_sessions WHERE app_id = ? AND user_id = ?").run(appId, userId).changes;
      totals.runtimeTokens = this.db.prepare("DELETE FROM runtime_access_tokens WHERE app_id = ? AND user_id = ?").run(appId, userId).changes;
    });
    remove();
    return totals;
  }

  createApiKey(input: { name: string; prefix: string; keyHash: string; scopes: ApiKeyScope[]; appId?: string | null; allowedOrigins?: string[] }): ApiKeyRecord {
    const now = nowIso();
    const id = createId("api_key");
    this.db.prepare(`
      INSERT INTO api_keys (id, name, prefix, key_hash, scopes_json, app_id, allowed_origins_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, input.name, input.prefix, input.keyHash, JSON.stringify(input.scopes), input.appId ?? null, JSON.stringify(input.allowedOrigins ?? []), now);
    return this.getApiKeyById(id);
  }

  listApiKeys(): ApiKeyRecord[] {
    return (this.db.prepare(`
      SELECT id, name, prefix, scopes_json, app_id, allowed_origins_json, created_at, last_used_at, revoked_at
      FROM api_keys ORDER BY created_at DESC
    `).all() as Row[]).map(mapApiKey);
  }

  getApiKeyById(id: string): ApiKeyRecord {
    const row = this.db.prepare(`
      SELECT id, name, prefix, scopes_json, app_id, allowed_origins_json, created_at, last_used_at, revoked_at
      FROM api_keys WHERE id = ?
    `).get(id) as Row | undefined;
    if (!row) throw new NotFoundError(`API key not found: ${id}`);
    return mapApiKey(row);
  }

  getApiKeySecretByPrefix(prefix: string): ApiKeySecretRecord | undefined {
    const row = this.db.prepare(`
      SELECT id, name, prefix, key_hash, scopes_json, app_id, allowed_origins_json, created_at, last_used_at, revoked_at
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

  createRuntimeAccessToken(input: {
    prefix: string;
    tokenHash: string;
    appId: string;
    userId: string;
    allowedOrigin: string;
    capabilities: RuntimeTokenCapability[];
    expiresAt: string;
    maxUses: number;
  }): RuntimeAccessTokenRecord {
    const id = createId("runtime_token");
    this.db.prepare(`
      INSERT INTO runtime_access_tokens (
        id, prefix, token_hash, app_id, user_id, allowed_origin,
        capabilities_json, expires_at, max_uses, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      input.prefix,
      input.tokenHash,
      input.appId,
      input.userId,
      input.allowedOrigin,
      JSON.stringify(input.capabilities),
      input.expiresAt,
      input.maxUses,
      nowIso()
    );
    return this.getRuntimeAccessToken(id);
  }

  getRuntimeAccessToken(id: string): RuntimeAccessTokenRecord {
    const row = this.db.prepare("SELECT * FROM runtime_access_tokens WHERE id = ?").get(id) as Row | undefined;
    if (!row) throw new NotFoundError(`Runtime access token not found: ${id}`);
    return mapRuntimeAccessToken(row);
  }

  getRuntimeAccessTokenSecretByPrefix(prefix: string): RuntimeAccessTokenSecretRecord | undefined {
    const row = this.db.prepare("SELECT * FROM runtime_access_tokens WHERE prefix = ? LIMIT 1").get(prefix) as Row | undefined;
    return row ? mapRuntimeAccessTokenSecret(row) : undefined;
  }

  consumeRuntimeAccessToken(id: string, usedAt: string): boolean {
    const result = this.db.prepare(`
      UPDATE runtime_access_tokens
      SET use_count = use_count + 1, last_used_at = ?
      WHERE id = ?
        AND revoked_at IS NULL
        AND expires_at > ?
        AND use_count < max_uses
    `).run(usedAt, id, usedAt);
    return result.changes === 1;
  }

  revokeRuntimeAccessToken(id: string): RuntimeAccessTokenRecord {
    const result = this.db.prepare("UPDATE runtime_access_tokens SET revoked_at = COALESCE(revoked_at, ?) WHERE id = ?")
      .run(nowIso(), id);
    if (result.changes === 0) throw new NotFoundError(`Runtime access token not found: ${id}`);
    return this.getRuntimeAccessToken(id);
  }

  consumeRateLimitBucket(key: string, limit: number, windowMs: number, now: number): { allowed: boolean; retryAfterMs: number; remaining: number } {
    const consume = this.db.transaction(() => {
      const row = this.db.prepare("SELECT request_count, reset_at FROM rate_limit_buckets WHERE bucket_key = ?")
        .get(key) as { request_count: number; reset_at: number } | undefined;
      if (!row || row.reset_at <= now) {
        this.db.prepare(`
          INSERT INTO rate_limit_buckets (bucket_key, request_count, reset_at)
          VALUES (?, 1, ?)
          ON CONFLICT(bucket_key) DO UPDATE SET request_count = 1, reset_at = excluded.reset_at
        `).run(key, now + windowMs);
        return { allowed: true, retryAfterMs: windowMs, remaining: Math.max(0, limit - 1) };
      }
      if (row.request_count >= limit) {
        return { allowed: false, retryAfterMs: Math.max(0, row.reset_at - now), remaining: 0 };
      }
      this.db.prepare("UPDATE rate_limit_buckets SET request_count = request_count + 1 WHERE bucket_key = ?").run(key);
      return { allowed: true, retryAfterMs: Math.max(0, row.reset_at - now), remaining: Math.max(0, limit - row.request_count - 1) };
    });
    return consume();
  }

  deleteExpiredRateLimitBuckets(now: number): void {
    this.db.prepare("DELETE FROM rate_limit_buckets WHERE reset_at <= ?").run(now);
  }

  countConsoleUsers(): number {
    const row = this.db.prepare("SELECT COUNT(*) as count FROM console_users").get() as { count: number };
    return Number(row.count);
  }

  createConsoleUser(input: { email: string; name: string; passwordHash: string; role: "admin" }): ConsoleUserRecord {
    const now = nowIso();
    const id = createId("console_user");
    this.db.prepare(`
      INSERT INTO console_users (id, email, name, role, password_hash, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(id, input.email, input.name, input.role, input.passwordHash, now, now);
    return this.getConsoleUserById(id);
  }

  getConsoleUserById(id: string): ConsoleUserRecord {
    const row = this.db.prepare("SELECT * FROM console_users WHERE id = ?").get(id) as Row | undefined;
    if (!row) throw new NotFoundError(`Console user not found: ${id}`);
    return mapConsoleUser(row);
  }

  getConsoleUserByEmail(email: string): ConsoleUserRecord | undefined {
    const row = this.db.prepare("SELECT * FROM console_users WHERE email = ?").get(email) as Row | undefined;
    return row ? mapConsoleUser(row) : undefined;
  }

  listConsoleUsers(): Array<Omit<ConsoleUserRecord, "passwordHash">> {
    return (this.db.prepare("SELECT * FROM console_users ORDER BY created_at ASC").all() as Row[])
      .map((row) => stripConsolePassword(mapConsoleUser(row)));
  }

  updateConsoleUserPassword(userId: string, passwordHash: string): Omit<ConsoleUserRecord, "passwordHash"> {
    const result = this.db.prepare("UPDATE console_users SET password_hash = ?, updated_at = ? WHERE id = ? AND disabled_at IS NULL")
      .run(passwordHash, nowIso(), userId);
    if (result.changes === 0) throw new NotFoundError(`Console user not found: ${userId}`);
    return stripConsolePassword(this.getConsoleUserById(userId));
  }

  disableConsoleUser(userId: string): Omit<ConsoleUserRecord, "passwordHash"> {
    const result = this.db.prepare("UPDATE console_users SET disabled_at = COALESCE(disabled_at, ?), updated_at = ? WHERE id = ?")
      .run(nowIso(), nowIso(), userId);
    if (result.changes === 0) throw new NotFoundError(`Console user not found: ${userId}`);
    this.db.prepare("UPDATE console_sessions SET revoked_at = COALESCE(revoked_at, ?) WHERE user_id = ?").run(nowIso(), userId);
    return stripConsolePassword(this.getConsoleUserById(userId));
  }

  markConsoleUserLogin(userId: string): void {
    this.db.prepare("UPDATE console_users SET last_login_at = ?, updated_at = ? WHERE id = ?")
      .run(nowIso(), nowIso(), userId);
  }

  createConsoleSession(input: { id: string; userId: string; tokenHash: string; expiresAt: string }): ConsoleSessionRecord {
    this.db.prepare(`
      INSERT INTO console_sessions (id, user_id, token_hash, created_at, expires_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(input.id, input.userId, input.tokenHash, nowIso(), input.expiresAt);
    return this.getConsoleSession(input.id);
  }

  getConsoleSession(id: string): ConsoleSessionRecord {
    const row = this.db.prepare(`
      SELECT
        console_sessions.id,
        console_sessions.user_id,
        console_sessions.token_hash,
        console_sessions.created_at,
        console_sessions.expires_at,
        console_sessions.last_used_at,
        console_sessions.revoked_at,
        console_users.id as user_id_value,
        console_users.email as user_email,
        console_users.name as user_name,
        console_users.role as user_role,
        console_users.created_at as user_created_at,
        console_users.updated_at as user_updated_at,
        console_users.last_login_at as user_last_login_at,
        console_users.disabled_at as user_disabled_at
      FROM console_sessions
      INNER JOIN console_users ON console_users.id = console_sessions.user_id
      WHERE console_sessions.id = ?
    `).get(id) as Row | undefined;
    if (!row) throw new NotFoundError(`Console session not found: ${id}`);
    return mapConsoleSession(row);
  }

  listConsoleSessions(): Array<Omit<ConsoleSessionRecord, "tokenHash">> {
    const rows = this.db.prepare(`
      SELECT
        console_sessions.id,
        console_sessions.user_id,
        console_sessions.token_hash,
        console_sessions.created_at,
        console_sessions.expires_at,
        console_sessions.last_used_at,
        console_sessions.revoked_at,
        console_users.id as user_id_value,
        console_users.email as user_email,
        console_users.name as user_name,
        console_users.role as user_role,
        console_users.created_at as user_created_at,
        console_users.updated_at as user_updated_at,
        console_users.last_login_at as user_last_login_at,
        console_users.disabled_at as user_disabled_at
      FROM console_sessions
      INNER JOIN console_users ON console_users.id = console_sessions.user_id
      ORDER BY console_sessions.created_at DESC
      LIMIT 100
    `).all() as Row[];
    return rows.map((row) => stripConsoleSessionToken(mapConsoleSession(row)));
  }

  markConsoleSessionUsed(id: string): void {
    this.db.prepare("UPDATE console_sessions SET last_used_at = ? WHERE id = ?").run(nowIso(), id);
  }

  revokeConsoleSession(id: string): void {
    this.db.prepare("UPDATE console_sessions SET revoked_at = COALESCE(revoked_at, ?) WHERE id = ?")
      .run(nowIso(), id);
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

  assertUiScanConfigsReadable(): void {
    const rows = this.db.prepare("SELECT ui_scan_config_json FROM apps WHERE ui_scan_config_json IS NOT NULL").all() as Row[];
    for (const row of rows) {
      parseStoredUiScanConfig(row.ui_scan_config_json, this.secretEncryptionKey);
    }
  }
}

function mapApp(row: Row, secretEncryptionKey?: string): AppRecord {
  const scanConfig = parseStoredUiScanConfig(row.ui_scan_config_json, secretEncryptionKey);
  return {
    id: String(row.id),
    name: String(row.name),
    slug: String(row.slug),
    baseUrl: String(row.base_url),
    uiScanConfig: sanitizeUiScanConfig(scanConfig),
    privacyPolicy: {
      telemetryMode: normalizeTelemetryMode(row.telemetry_mode),
      retentionDays: validPositiveInteger(row.telemetry_retention_days) ? Number(row.telemetry_retention_days) : 30
    },
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    archivedAt: row.archived_at ? String(row.archived_at) : null
  };
}

function normalizeTelemetryMode(value: unknown): TelemetryMode {
  return value === "redacted" || value === "full" ? value : "events_only";
}

function validPositiveInteger(value: unknown): boolean {
  return Number.isInteger(Number(value)) && Number(value) > 0;
}

function mapUiMapVersionSummary(row: Row): UiMapVersionSummary {
  const routes = parseStoredUiMapVersionRoutes(row.scanConfigJson);
  return {
    id: String(row.id),
    appId: String(row.appId),
    version: String(row.version),
    source: String(row.source),
    status: String(row.status),
    createdAt: String(row.createdAt),
    completedAt: row.completedAt ? String(row.completedAt) : null,
    error: row.error ? String(row.error) : null,
    routes,
    routeCount: routes.length,
    pageCount: Number(row.pageCount ?? 0),
    failedPageCount: Number(row.failedPageCount ?? 0),
    elementCount: Number(row.elementCount ?? 0),
    strongSelectorCount: Number(row.strongSelectorCount ?? 0),
    mediumSelectorCount: Number(row.mediumSelectorCount ?? 0),
    weakSelectorCount: Number(row.weakSelectorCount ?? 0)
  };
}

function parseStoredUiMapVersionRoutes(value: unknown): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(String(value)) as { routes?: unknown };
    if (!Array.isArray(parsed.routes)) return [];
    return normalizeStringList(parsed.routes).map((route) => route.startsWith("/") ? route : `/${route}`);
  } catch {
    return [];
  }
}

function mergeUiScanConfig(current: AppUiScanConfigWithSecrets, input?: AppUiScanConfigInput, secretEncryptionKey?: string): AppUiScanConfigWithSecrets {
  if (!input) return current;
  const nextPassword = input.password !== undefined ? normalizeOptionalString(input.password) : undefined;
  let password = current.password;
  let passwordSecret = current.passwordSecret;

  if (input.clearPassword) {
    password = undefined;
    passwordSecret = undefined;
  } else if (input.password !== undefined) {
    if (nextPassword && !hasSecretEncryptionKey(secretEncryptionKey)) {
      throw new AppError(
        "SCAN_SECRET_ENCRYPTION_REQUIRED",
        "Set MIA_SECRET_ENCRYPTION_KEY before saving per-app scan passwords.",
        400
      );
    }
    password = nextPassword;
    passwordSecret = nextPassword ? encryptSecret(nextPassword, secretEncryptionKey) : undefined;
  }

  return {
    runtimeMode: input.runtimeMode === "qa_only" || input.runtimeMode === "workflow" ? input.runtimeMode : current.runtimeMode,
    routes: input.routes ? normalizeRouteList(input.routes) : current.routes,
    authMode: normalizeAuthMode(input.authMode) ?? current.authMode,
    loginUrl: input.loginUrl !== undefined ? normalizeOptionalString(input.loginUrl) : current.loginUrl,
    username: input.username !== undefined ? normalizeOptionalString(input.username) : current.username,
    passwordConfigured: Boolean(password || passwordSecret),
    password,
    passwordSecret,
    usernameSelector: input.usernameSelector !== undefined ? normalizeOptionalString(input.usernameSelector) : current.usernameSelector,
    passwordSelector: input.passwordSelector !== undefined ? normalizeOptionalString(input.passwordSelector) : current.passwordSelector,
    submitSelector: input.submitSelector !== undefined ? normalizeOptionalString(input.submitSelector) : current.submitSelector,
    successUrlPattern: input.successUrlPattern !== undefined ? normalizeOptionalString(input.successUrlPattern) : current.successUrlPattern,
    postLoginWaitMs: validNonnegativeInteger(input.postLoginWaitMs) ? input.postLoginWaitMs : current.postLoginWaitMs,
    ignoredSelectors: input.ignoredSelectors ? normalizeStringList(input.ignoredSelectors) : current.ignoredSelectors,
    redactedSelectors: input.redactedSelectors ? normalizeStringList(input.redactedSelectors) : current.redactedSelectors,
    routeDiscovery: input.routeDiscovery
      ? {
        enabled: Boolean(input.routeDiscovery.enabled),
        maxRoutes: normalizeMaxRoutes(input.routeDiscovery.maxRoutes)
      }
      : current.routeDiscovery
  };
}

function parseStoredUiScanConfig(value: unknown, secretEncryptionKey?: string): AppUiScanConfigWithSecrets {
  const fallback = defaultUiScanConfig();
  if (!value) return fallback;

  let parsed: Partial<AppUiScanConfigWithSecrets>;
  try {
    parsed = JSON.parse(String(value)) as Partial<AppUiScanConfigWithSecrets>;
  } catch {
    throw new AppError("SCAN_CONFIG_INVALID", "Stored UI scan config is not valid JSON.", 500);
  }

  const legacyPassword = normalizeOptionalString(parsed.password);
  const passwordSecret = normalizeOptionalString(parsed.passwordSecret);
  const password = passwordSecret
    ? decryptSecret(passwordSecret, secretEncryptionKey)
    : legacyPassword && isEncryptedSecret(legacyPassword)
      ? decryptSecret(legacyPassword, secretEncryptionKey)
      : legacyPassword;
  return {
    runtimeMode: parsed.runtimeMode === "qa_only" || parsed.runtimeMode === "workflow" ? parsed.runtimeMode : fallback.runtimeMode,
    routes: parsed.routes ? normalizeRouteList(parsed.routes) : fallback.routes,
    authMode: normalizeAuthMode(parsed.authMode) ?? fallback.authMode,
    loginUrl: normalizeOptionalString(parsed.loginUrl),
    username: normalizeOptionalString(parsed.username),
    passwordConfigured: Boolean(password || passwordSecret),
    password,
    passwordSecret,
    usernameSelector: normalizeOptionalString(parsed.usernameSelector),
    passwordSelector: normalizeOptionalString(parsed.passwordSelector),
    submitSelector: normalizeOptionalString(parsed.submitSelector),
    successUrlPattern: normalizeOptionalString(parsed.successUrlPattern),
    postLoginWaitMs: validNonnegativeInteger(parsed.postLoginWaitMs) ? parsed.postLoginWaitMs : fallback.postLoginWaitMs,
    ignoredSelectors: parsed.ignoredSelectors ? normalizeStringList(parsed.ignoredSelectors) : fallback.ignoredSelectors,
    redactedSelectors: parsed.redactedSelectors ? normalizeStringList(parsed.redactedSelectors) : fallback.redactedSelectors,
    routeDiscovery: {
      enabled: Boolean(parsed.routeDiscovery?.enabled),
      maxRoutes: normalizeMaxRoutes(parsed.routeDiscovery?.maxRoutes)
    }
  };
}

function defaultUiScanConfig(): AppUiScanConfigWithSecrets {
  return {
    runtimeMode: "workflow",
    routes: ["/"],
    authMode: "none",
    passwordConfigured: false,
    postLoginWaitMs: 1000,
    ignoredSelectors: [],
    redactedSelectors: [],
    routeDiscovery: { enabled: false, maxRoutes: 25 }
  };
}

function serializeUiScanConfig(config: AppUiScanConfigWithSecrets, secretEncryptionKey?: string): Record<string, unknown> {
  const {
    password: _password,
    passwordSecret: currentPasswordSecret,
    passwordConfigured: _passwordConfigured,
    ...safeConfig
  } = config;
  let passwordSecret = currentPasswordSecret;
  let legacyPassword: string | undefined;

  if (config.password) {
    if (hasSecretEncryptionKey(secretEncryptionKey)) {
      passwordSecret = currentPasswordSecret ?? encryptSecret(config.password, secretEncryptionKey);
    } else {
      legacyPassword = config.password;
    }
  }

  return {
    ...safeConfig,
    ...(passwordSecret ? { passwordSecret } : {}),
    ...(legacyPassword ? { password: legacyPassword } : {})
  };
}

function sanitizeUiScanConfig(config: AppUiScanConfigWithSecrets): AppUiScanConfig {
  const { password: _password, passwordSecret: _passwordSecret, ...safeConfig } = config;
  return {
    ...safeConfig,
    passwordConfigured: Boolean(config.password || config.passwordSecret)
  };
}

function normalizeAuthMode(value: unknown): UiScanAuthMode | undefined {
  return value === "none" || value === "login_form" || value === "manual" ? value : undefined;
}

function normalizeRouteList(routes: unknown): string[] {
  const values = Array.isArray(routes) ? routes : [];
  const normalized = normalizeStringList(values).map((route) => route.startsWith("/") ? route : `/${route}`);
  return normalized.length ? normalized : ["/"];
}

function normalizeStringList(values: unknown[]): string[] {
  return [...new Set(values.map((value) => typeof value === "string" ? value.trim() : "").filter(Boolean))];
}

function normalizeOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function normalizeMaxRoutes(value: unknown): number {
  return Number.isInteger(value) && Number(value) > 0 ? Math.min(Number(value), 200) : 25;
}

function validNonnegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function mapApiKey(row: Row): ApiKeyRecord {
  return {
    id: String(row.id),
    name: String(row.name),
    prefix: String(row.prefix),
    scopes: JSON.parse(String(row.scopes_json)) as ApiKeyScope[],
    appId: row.app_id ? String(row.app_id) : null,
    allowedOrigins: parseStringArray(row.allowed_origins_json),
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

function mapRuntimeAccessToken(row: Row): RuntimeAccessTokenRecord {
  return {
    id: String(row.id),
    prefix: String(row.prefix),
    appId: String(row.app_id),
    userId: String(row.user_id),
    allowedOrigin: String(row.allowed_origin),
    capabilities: parseStringArray(row.capabilities_json) as RuntimeTokenCapability[],
    expiresAt: String(row.expires_at),
    maxUses: Number(row.max_uses),
    useCount: Number(row.use_count),
    createdAt: String(row.created_at),
    lastUsedAt: row.last_used_at ? String(row.last_used_at) : null,
    revokedAt: row.revoked_at ? String(row.revoked_at) : null
  };
}

function mapRuntimeAccessTokenSecret(row: Row): RuntimeAccessTokenSecretRecord {
  return {
    ...mapRuntimeAccessToken(row),
    tokenHash: String(row.token_hash)
  };
}

function mapConsoleUser(row: Row): ConsoleUserRecord {
  return {
    id: String(row.id),
    email: String(row.email),
    name: String(row.name),
    role: mapConsoleRole(row.role),
    passwordHash: String(row.password_hash),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    lastLoginAt: row.last_login_at ? String(row.last_login_at) : null,
    disabledAt: row.disabled_at ? String(row.disabled_at) : null
  };
}

function mapConsoleSession(row: Row): ConsoleSessionRecord {
  return {
    id: String(row.id),
    userId: String(row.user_id),
    tokenHash: String(row.token_hash),
    createdAt: String(row.created_at),
    expiresAt: String(row.expires_at),
    lastUsedAt: row.last_used_at ? String(row.last_used_at) : null,
    revokedAt: row.revoked_at ? String(row.revoked_at) : null,
    user: {
      id: String(row.user_id_value),
      email: String(row.user_email),
      name: String(row.user_name),
      role: mapConsoleRole(row.user_role),
      createdAt: String(row.user_created_at),
      updatedAt: String(row.user_updated_at),
      lastLoginAt: row.user_last_login_at ? String(row.user_last_login_at) : null,
      disabledAt: row.user_disabled_at ? String(row.user_disabled_at) : null
    }
  };
}

function mapConsoleRole(value: unknown): "admin" {
  if (value === "admin") return "admin";
  throw new AppError("CONSOLE_ROLE_INVALID", `Invalid console user role: ${String(value)}`, 500);
}

function stripConsolePassword(user: ConsoleUserRecord): Omit<ConsoleUserRecord, "passwordHash"> {
  const { passwordHash: _passwordHash, ...safeUser } = user;
  return safeUser;
}

function stripConsoleSessionToken(session: ConsoleSessionRecord): Omit<ConsoleSessionRecord, "tokenHash"> {
  const { tokenHash: _tokenHash, ...safeSession } = session;
  return safeSession;
}

function parseStringArray(value: unknown): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(String(value));
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
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
    clauses.push("app_id = ?");
    params.push(filters.appId);
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
