import type { PoolClient } from "pg";
import type {
  ActionDirective,
  ActionReceipt,
  HostActionManifest,
  Observation,
  PlannerDecision,
  RiskLevel
} from "../domain.js";
import type { V1Database } from "./database.js";
import { AppError, NotFoundError } from "../../utils/errors.js";

type Json = Record<string, unknown> | unknown[];

export type ProductRecord = {
  name: string;
  origin: string;
  documentationOrigins: string[];
  redactedSelectors: string[];
  transcriptMode: "full" | "redacted" | "disabled";
  transcriptRetentionDays: number;
  createdAt: string;
  updatedAt: string;
};

export type AdminUserRecord = {
  id: string;
  email: string;
  name: string;
  passwordHash: string;
  createdAt: string;
  updatedAt: string;
  lastLoginAt: string | null;
};

export type AdminSessionRecord = {
  id: string;
  tokenHash: string;
  createdAt: string;
  expiresAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
};

export type IntegrationKeyRecord = {
  id: string;
  name: string;
  prefix: string;
  keyHash: string;
  allowedOrigin: string;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
};

export type RuntimeTokenRecord = {
  id: string;
  prefix: string;
  tokenHash: string;
  userId: string;
  allowedOrigin: string;
  capabilities: string[];
  expiresAt: string;
  maxUses: number;
  useCount: number;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
};

export type AgentSessionRecord = {
  id: string;
  resumeTokenHash: string;
  userId: string;
  status: "active" | "waiting_user" | "waiting_confirmation" | "completed" | "failed" | "cancelled";
  revision: number;
  goal: string;
  currentRoute: string | null;
  stepCount: number;
  consecutiveFailures: number;
  loopSignature: string | null;
  loopCount: number;
  pendingConfirmation: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  error: string | null;
};

export type AgentTurnRecord = {
  id: string;
  role: "user" | "assistant" | "system";
  source: "text" | "voice" | "runtime";
  content: string;
  createdAt: string;
};

export type AgentStepRecord = {
  id: string;
  sessionId: string;
  stepIndex: number;
  observationRevision: number;
  assessment: string;
  progress: string;
  directive: Record<string, unknown>;
  retrievedSources: Array<Record<string, unknown>>;
  model: string;
  latencyMs: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  status: "issued" | "completed" | "failed" | "cancelled";
  error: string | null;
  createdAt: string;
};

export type ConfirmationRecord = {
  id: string;
  sessionId: string;
  actionId: string;
  prompt: string;
  bindingHash: string;
  status: "pending" | "approved" | "denied" | "expired";
  source: "text" | "voice" | "ui" | null;
  expiresAt: string;
  createdAt: string;
  resolvedAt: string | null;
};

export type KnowledgeSourceRecord = {
  id: string;
  kind: "documentation_url" | "document_file" | "ui_map" | "recording" | "skill";
  name: string;
  sourceUrl: string | null;
  filePath: string | null;
  status: "pending" | "processing" | "ready" | "failed" | "archived";
  metadata: Record<string, unknown>;
  error: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
};

export type KnowledgeMatch = {
  id: string;
  sourceId: string;
  sourceName: string;
  kind: string;
  content: string;
  metadata: Record<string, unknown>;
  score: number;
};

export type SkillRecord = {
  id: string;
  name: string;
  description: string;
  goal: string;
  businessContext: string;
  steps: unknown[];
  constraints: string[];
  expectedOutcomes: string[];
  status: "draft" | "needs_review" | "published" | "archived";
  version: number;
  recordingId: string | null;
  createdAt: string;
  updatedAt: string;
  publishedAt: string | null;
};

export type HostActionRecord = HostActionManifest & {
  status: "detected" | "needs_review" | "published" | "blocked";
  manifestHash: string;
  firstSeenAt: string;
  lastSeenAt: string;
  reviewedAt: string | null;
};

export class V1Repositories {
  readonly product: ProductRepository;
  readonly auth: AuthRepository;
  readonly agent: AgentRepository;
  readonly knowledge: KnowledgeRepository;
  readonly diagnostics: DiagnosticsRepository;

  constructor(readonly database: V1Database) {
    this.product = new ProductRepository(database);
    this.auth = new AuthRepository(database);
    this.agent = new AgentRepository(database);
    this.knowledge = new KnowledgeRepository(database);
    this.diagnostics = new DiagnosticsRepository(database);
  }
}

export class ProductRepository {
  constructor(private readonly database: V1Database) {}

  async isSetup(): Promise<boolean> {
    const result = await this.database.query<{ configured: boolean }>(`
      SELECT EXISTS(SELECT 1 FROM product) AND EXISTS(SELECT 1 FROM admin_user) AS configured
    `);
    return result.rows[0]?.configured === true;
  }

  async get(): Promise<ProductRecord> {
    const result = await this.database.query<ProductRecord>(`
      SELECT name, origin,
             documentation_origins AS "documentationOrigins",
             redacted_selectors AS "redactedSelectors",
             transcript_mode AS "transcriptMode",
             transcript_retention_days AS "transcriptRetentionDays",
             created_at::text AS "createdAt", updated_at::text AS "updatedAt"
      FROM product WHERE singleton = TRUE
    `);
    if (!result.rows[0]) throw new NotFoundError("Product setup has not been completed.");
    return result.rows[0];
  }

  async setup(input: {
    product: Pick<ProductRecord, "name" | "origin" | "documentationOrigins" | "redactedSelectors" | "transcriptMode" | "transcriptRetentionDays">;
    admin: { id: string; email: string; name: string; passwordHash: string };
  }): Promise<{ product: ProductRecord; admin: AdminUserRecord }> {
    return this.database.transaction(async (client) => {
      const configured = await client.query("SELECT EXISTS(SELECT 1 FROM product) OR EXISTS(SELECT 1 FROM admin_user) AS configured");
      if (configured.rows[0]?.configured) throw new AppError("SETUP_COMPLETE", "First-run setup has already been completed.", 409);
      await client.query(`
        INSERT INTO product (
          singleton, name, origin, documentation_origins, redacted_selectors,
          transcript_mode, transcript_retention_days
        ) VALUES (TRUE, $1, $2, $3::jsonb, $4::jsonb, $5, $6)
      `, [
        input.product.name,
        input.product.origin,
        JSON.stringify(input.product.documentationOrigins),
        JSON.stringify(input.product.redactedSelectors),
        input.product.transcriptMode,
        input.product.transcriptRetentionDays
      ]);
      await client.query(`
        INSERT INTO admin_user (singleton, id, email, name, password_hash)
        VALUES (TRUE, $1, $2, $3, $4)
      `, [input.admin.id, input.admin.email, input.admin.name, input.admin.passwordHash]);
      return {
        product: await productWithClient(client),
        admin: await adminWithClient(client)
      };
    });
  }

  async update(input: Partial<Pick<ProductRecord, "name" | "origin" | "documentationOrigins" | "redactedSelectors" | "transcriptMode" | "transcriptRetentionDays">>): Promise<ProductRecord> {
    const current = await this.get();
    await this.database.query(`
      UPDATE product SET
        name = $1, origin = $2, documentation_origins = $3::jsonb,
        redacted_selectors = $4::jsonb, transcript_mode = $5,
        transcript_retention_days = $6, updated_at = NOW()
      WHERE singleton = TRUE
    `, [
      input.name ?? current.name,
      input.origin ?? current.origin,
      JSON.stringify(input.documentationOrigins ?? current.documentationOrigins),
      JSON.stringify(input.redactedSelectors ?? current.redactedSelectors),
      input.transcriptMode ?? current.transcriptMode,
      input.transcriptRetentionDays ?? current.transcriptRetentionDays
    ]);
    return this.get();
  }
}

export class AuthRepository {
  constructor(private readonly database: V1Database) {}

  async getAdmin(): Promise<AdminUserRecord | undefined> {
    const result = await this.database.query<AdminUserRecord>(adminSelect());
    return result.rows[0];
  }

  async markAdminLogin(): Promise<void> {
    await this.database.query("UPDATE admin_user SET last_login_at = NOW(), updated_at = NOW() WHERE singleton = TRUE");
  }

  async updateAdmin(input: { email?: string; name?: string; passwordHash?: string }): Promise<AdminUserRecord> {
    const current = await this.getAdmin();
    if (!current) throw new NotFoundError("Administrator has not been configured.");
    await this.database.query(`
      UPDATE admin_user SET email = $1, name = $2, password_hash = $3, updated_at = NOW()
      WHERE singleton = TRUE
    `, [input.email ?? current.email, input.name ?? current.name, input.passwordHash ?? current.passwordHash]);
    return (await this.getAdmin())!;
  }

  async createAdminSession(input: { id: string; tokenHash: string; expiresAt: string }): Promise<AdminSessionRecord> {
    const result = await this.database.query<AdminSessionRecord>(`
      INSERT INTO admin_sessions (id, token_hash, expires_at)
      VALUES ($1, $2, $3) RETURNING id, token_hash AS "tokenHash",
        created_at::text AS "createdAt", expires_at::text AS "expiresAt",
        last_used_at::text AS "lastUsedAt", revoked_at::text AS "revokedAt"
    `, [input.id, input.tokenHash, input.expiresAt]);
    return result.rows[0]!;
  }

  async getAdminSession(id: string): Promise<AdminSessionRecord | undefined> {
    const result = await this.database.query<AdminSessionRecord>(`
      SELECT id, token_hash AS "tokenHash", created_at::text AS "createdAt",
             expires_at::text AS "expiresAt", last_used_at::text AS "lastUsedAt",
             revoked_at::text AS "revokedAt"
      FROM admin_sessions WHERE id = $1
    `, [id]);
    return result.rows[0];
  }

  async markAdminSessionUsed(id: string): Promise<void> {
    await this.database.query("UPDATE admin_sessions SET last_used_at = NOW() WHERE id = $1", [id]);
  }

  async revokeAdminSession(id: string): Promise<void> {
    await this.database.query("UPDATE admin_sessions SET revoked_at = COALESCE(revoked_at, NOW()) WHERE id = $1", [id]);
  }

  async createIntegrationKey(input: { id: string; name: string; prefix: string; keyHash: string; allowedOrigin: string }): Promise<IntegrationKeyRecord> {
    const result = await this.database.query<IntegrationKeyRecord>(`
      INSERT INTO integration_keys (id, name, prefix, key_hash, allowed_origin)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING id, name, prefix, key_hash AS "keyHash", allowed_origin AS "allowedOrigin",
        created_at::text AS "createdAt", last_used_at::text AS "lastUsedAt", revoked_at::text AS "revokedAt"
    `, [input.id, input.name, input.prefix, input.keyHash, input.allowedOrigin]);
    return result.rows[0]!;
  }

  async listIntegrationKeys(): Promise<IntegrationKeyRecord[]> {
    const result = await this.database.query<IntegrationKeyRecord>(integrationKeySelect("ORDER BY created_at DESC"));
    return result.rows;
  }

  async getIntegrationKeyByPrefix(prefix: string): Promise<IntegrationKeyRecord | undefined> {
    const result = await this.database.query<IntegrationKeyRecord>(integrationKeySelect("WHERE prefix = $1"), [prefix]);
    return result.rows[0];
  }

  async markIntegrationKeyUsed(id: string): Promise<void> {
    await this.database.query("UPDATE integration_keys SET last_used_at = NOW() WHERE id = $1", [id]);
  }

  async revokeIntegrationKey(id: string): Promise<void> {
    const result = await this.database.query("UPDATE integration_keys SET revoked_at = COALESCE(revoked_at, NOW()) WHERE id = $1", [id]);
    if (result.rowCount === 0) throw new NotFoundError(`Integration key not found: ${id}`);
  }

  async createRuntimeToken(input: {
    id: string;
    prefix: string;
    tokenHash: string;
    userId: string;
    allowedOrigin: string;
    capabilities: string[];
    expiresAt: string;
    maxUses: number;
  }): Promise<RuntimeTokenRecord> {
    const result = await this.database.query<RuntimeTokenRecord>(`
      INSERT INTO runtime_tokens (
        id, prefix, token_hash, user_id, allowed_origin, capabilities, expires_at, max_uses
      ) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8)
      RETURNING ${runtimeTokenColumns()}
    `, [input.id, input.prefix, input.tokenHash, input.userId, input.allowedOrigin, JSON.stringify(input.capabilities), input.expiresAt, input.maxUses]);
    return result.rows[0]!;
  }

  async getRuntimeTokenByPrefix(prefix: string): Promise<RuntimeTokenRecord | undefined> {
    const result = await this.database.query<RuntimeTokenRecord>(`SELECT ${runtimeTokenColumns()} FROM runtime_tokens WHERE prefix = $1`, [prefix]);
    return result.rows[0];
  }

  async consumeRuntimeToken(id: string): Promise<boolean> {
    const result = await this.database.query(`
      UPDATE runtime_tokens SET use_count = use_count + 1, last_used_at = NOW()
      WHERE id = $1 AND revoked_at IS NULL AND expires_at > NOW() AND use_count < max_uses
    `, [id]);
    return result.rowCount === 1;
  }

  async revokeRuntimeToken(id: string): Promise<void> {
    const result = await this.database.query("UPDATE runtime_tokens SET revoked_at = COALESCE(revoked_at, NOW()) WHERE id = $1", [id]);
    if (result.rowCount === 0) throw new NotFoundError(`Runtime token not found: ${id}`);
  }
}

export class AgentRepository {
  constructor(private readonly database: V1Database) {}

  async createSession(input: { id: string; resumeTokenHash: string; userId: string; route: string }): Promise<AgentSessionRecord> {
    const result = await this.database.query<AgentSessionRecord>(`
      INSERT INTO agent_sessions (id, resume_token_hash, user_id, status, goal, current_route)
      VALUES ($1, $2, $3, 'active', '', $4)
      RETURNING ${agentSessionColumns()}
    `, [input.id, input.resumeTokenHash, input.userId, input.route]);
    return result.rows[0]!;
  }

  async getSession(id: string): Promise<AgentSessionRecord> {
    const result = await this.database.query<AgentSessionRecord>(`SELECT ${agentSessionColumns()} FROM agent_sessions WHERE id = $1`, [id]);
    if (!result.rows[0]) throw new NotFoundError(`Agent session not found: ${id}`);
    return result.rows[0];
  }

  async beginGoal(input: { id: string; expectedRevision: number; goal: string; route: string }): Promise<AgentSessionRecord> {
    const result = await this.database.query<AgentSessionRecord>(`
      UPDATE agent_sessions SET status = 'active', goal = $3, current_route = $4,
        revision = revision + 1, step_count = 0, consecutive_failures = 0,
        loop_signature = NULL, loop_count = 0, pending_confirmation = NULL,
        completed_at = NULL, error = NULL, updated_at = NOW()
      WHERE id = $1 AND revision = $2
      RETURNING ${agentSessionColumns()}
    `, [input.id, input.expectedRevision, input.goal, input.route]);
    return requireSessionUpdate(result.rows[0], input.expectedRevision);
  }

  async advanceSession(input: {
    id: string;
    expectedRevision: number;
    status: AgentSessionRecord["status"];
    route?: string;
    incrementStep?: boolean;
    consecutiveFailures?: number;
    loopSignature?: string | null;
    loopCount?: number;
    pendingConfirmation?: Record<string, unknown> | null;
    error?: string | null;
  }): Promise<AgentSessionRecord> {
    const completed = ["completed", "failed", "cancelled"].includes(input.status);
    const result = await this.database.query<AgentSessionRecord>(`
      UPDATE agent_sessions SET
        status = $3,
        revision = revision + 1,
        current_route = COALESCE($4, current_route),
        step_count = step_count + $5,
        consecutive_failures = COALESCE($6, consecutive_failures),
        loop_signature = CASE WHEN $7::boolean THEN $8 ELSE loop_signature END,
        loop_count = COALESCE($9, loop_count),
        pending_confirmation = CASE WHEN $10::boolean THEN $11::jsonb ELSE pending_confirmation END,
        error = $12,
        completed_at = CASE WHEN $13 THEN NOW() ELSE NULL END,
        updated_at = NOW()
      WHERE id = $1 AND revision = $2
      RETURNING ${agentSessionColumns()}
    `, [
      input.id,
      input.expectedRevision,
      input.status,
      input.route ?? null,
      input.incrementStep ? 1 : 0,
      input.consecutiveFailures ?? null,
      input.loopSignature !== undefined,
      input.loopSignature ?? null,
      input.loopCount ?? null,
      input.pendingConfirmation !== undefined,
      input.pendingConfirmation === undefined ? null : JSON.stringify(input.pendingConfirmation),
      input.error ?? null,
      completed
    ]);
    return requireSessionUpdate(result.rows[0], input.expectedRevision);
  }

  async addTurn(input: { id: string; sessionId: string; role: AgentTurnRecord["role"]; source: AgentTurnRecord["source"]; content: string }): Promise<AgentTurnRecord> {
    const result = await this.database.query<AgentTurnRecord>(`
      INSERT INTO agent_turns (id, session_id, role, source, content)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING id, role, source, content, created_at::text AS "createdAt"
    `, [input.id, input.sessionId, input.role, input.source, input.content]);
    return result.rows[0]!;
  }

  async listTurns(sessionId: string, limit = 40): Promise<AgentTurnRecord[]> {
    const result = await this.database.query<AgentTurnRecord>(`
      SELECT id, role, source, content, created_at::text AS "createdAt" FROM (
        SELECT id, role, source, content, created_at
        FROM agent_turns WHERE session_id = $1 ORDER BY created_at DESC LIMIT $2
      ) recent ORDER BY created_at
    `, [sessionId, limit]);
    return result.rows;
  }

  async insertStep(input: {
    id: string;
    sessionId: string;
    stepIndex: number;
    observationRevision: number;
    decision: PlannerDecision;
    directive: Record<string, unknown>;
    retrievedSources: Array<Record<string, unknown>>;
    model: string;
    latencyMs?: number;
    inputTokens?: number;
    outputTokens?: number;
  }): Promise<AgentStepRecord> {
    const result = await this.database.query<AgentStepRecord>(`
      INSERT INTO agent_steps (
        id, session_id, step_index, observation_revision, assessment, progress,
        directive, retrieved_sources, model, latency_ms, input_tokens, output_tokens, status
      ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9, $10, $11, $12, 'issued')
      RETURNING ${agentStepColumns()}
    `, [
      input.id, input.sessionId, input.stepIndex, input.observationRevision,
      input.decision.assessment, input.decision.progress, JSON.stringify(input.directive),
      JSON.stringify(input.retrievedSources), input.model, input.latencyMs ?? null,
      input.inputTokens ?? null, input.outputTokens ?? null
    ]);
    return result.rows[0]!;
  }

  async listRecentSteps(sessionId: string, limit = 24): Promise<AgentStepRecord[]> {
    const result = await this.database.query<AgentStepRecord>(`
      SELECT ${agentStepColumns()} FROM agent_steps
      WHERE session_id = $1 ORDER BY step_index DESC LIMIT $2
    `, [sessionId, limit]);
    return result.rows.reverse();
  }

  async updateStepStatus(id: string, status: AgentStepRecord["status"], error?: string): Promise<void> {
    await this.database.query("UPDATE agent_steps SET status = $2, error = $3 WHERE id = $1", [id, status, error ?? null]);
  }

  async insertReceipt(input: ActionReceipt & { sessionId: string; stepId?: string }): Promise<ActionReceipt> {
    const result = await this.database.query<ActionReceipt>(`
      INSERT INTO action_receipts (
        action_id, session_id, step_id, idempotency_key, action_type, target_ref, status, message, evidence
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)
      ON CONFLICT (idempotency_key) DO UPDATE SET idempotency_key = EXCLUDED.idempotency_key
      RETURNING action_id AS "actionId", idempotency_key AS "idempotencyKey", action_type AS type,
        status, message, target_ref AS "targetRef", evidence
    `, [
      input.actionId, input.sessionId, input.stepId ?? null, input.idempotencyKey, input.type,
      input.targetRef ?? null, input.status, input.message, JSON.stringify(input.evidence)
    ]);
    return { ...result.rows[0]!, route: input.route };
  }

  async listReceipts(sessionId: string, limit = 24): Promise<ActionReceipt[]> {
    const result = await this.database.query<ActionReceipt>(`
      SELECT action_id AS "actionId", idempotency_key AS "idempotencyKey", action_type AS type,
             status, message, target_ref AS "targetRef", evidence
      FROM action_receipts WHERE session_id = $1 ORDER BY created_at DESC LIMIT $2
    `, [sessionId, limit]);
    return result.rows.reverse();
  }

  async createConfirmation(input: {
    id: string;
    sessionId: string;
    actionId: string;
    prompt: string;
    bindingHash: string;
    expiresAt: string;
  }): Promise<ConfirmationRecord> {
    const result = await this.database.query<ConfirmationRecord>(`
      INSERT INTO confirmations (id, session_id, action_id, prompt, binding_hash, status, expires_at)
      VALUES ($1, $2, $3, $4, $5, 'pending', $6)
      RETURNING ${confirmationColumns()}
    `, [input.id, input.sessionId, input.actionId, input.prompt, input.bindingHash, input.expiresAt]);
    return result.rows[0]!;
  }

  async getConfirmation(id: string): Promise<ConfirmationRecord> {
    const result = await this.database.query<ConfirmationRecord>(`SELECT ${confirmationColumns()} FROM confirmations WHERE id = $1`, [id]);
    if (!result.rows[0]) throw new NotFoundError(`Confirmation not found: ${id}`);
    return result.rows[0];
  }

  async resolveConfirmation(input: {
    id: string;
    sessionId: string;
    bindingHash: string;
    approved: boolean;
    source: "text" | "voice" | "ui";
  }): Promise<ConfirmationRecord> {
    const result = await this.database.query<ConfirmationRecord>(`
      UPDATE confirmations SET status = $5, source = $4, resolved_at = NOW()
      WHERE id = $1 AND session_id = $2 AND binding_hash = $3 AND status = 'pending' AND expires_at > NOW()
      RETURNING ${confirmationColumns()}
    `, [input.id, input.sessionId, input.bindingHash, input.source, input.approved ? "approved" : "denied"]);
    if (!result.rows[0]) throw new AppError("CONFIRMATION_INVALID", "The confirmation is invalid, expired, or already resolved.", 409);
    return result.rows[0];
  }

  async syncHostActions(manifests: Array<HostActionManifest & { manifestHash: string }>): Promise<HostActionRecord[]> {
    await this.database.transaction(async (client) => {
      for (const manifest of manifests) {
        await client.query(`
          INSERT INTO host_actions (name, description, input_schema, risk, status, manifest_hash)
          VALUES ($1, $2, $3::jsonb, $4, $5, $6)
          ON CONFLICT (name) DO UPDATE SET
            description = EXCLUDED.description,
            input_schema = EXCLUDED.input_schema,
            risk = EXCLUDED.risk,
            status = CASE
              WHEN EXCLUDED.risk = 'blocked' THEN 'blocked'
              WHEN host_actions.manifest_hash = EXCLUDED.manifest_hash THEN host_actions.status
              ELSE 'needs_review'
            END,
            manifest_hash = EXCLUDED.manifest_hash,
            last_seen_at = NOW(),
            reviewed_at = CASE WHEN host_actions.manifest_hash = EXCLUDED.manifest_hash THEN host_actions.reviewed_at ELSE NULL END
        `, [
          manifest.name,
          manifest.description,
          JSON.stringify(manifest.inputSchema),
          manifest.risk,
          manifest.risk === "blocked" ? "blocked" : "needs_review",
          manifest.manifestHash
        ]);
      }
    });
    return this.listHostActions();
  }

  async listHostActions(): Promise<HostActionRecord[]> {
    const result = await this.database.query<HostActionRecord>(hostActionSelect("ORDER BY name"));
    return result.rows;
  }

  async getPublishedHostActions(names: string[]): Promise<HostActionRecord[]> {
    if (names.length === 0) return [];
    const result = await this.database.query<HostActionRecord>(hostActionSelect("WHERE name = ANY($1::text[]) AND status = 'published'"), [names]);
    return result.rows;
  }

  async reviewHostAction(name: string, input: { status: "published" | "blocked"; risk: RiskLevel }): Promise<HostActionRecord> {
    const result = await this.database.query<HostActionRecord>(`
      UPDATE host_actions SET status = $2, risk = $3, reviewed_at = NOW(), last_seen_at = NOW()
      WHERE name = $1 RETURNING ${hostActionColumns()}
    `, [name, input.status, input.risk]);
    if (!result.rows[0]) throw new NotFoundError(`Host action not found: ${name}`);
    return result.rows[0];
  }

  async addEvent(input: { id: string; sessionId?: string; userId?: string; eventType: string; payload?: Record<string, unknown> }): Promise<void> {
    await this.database.query(`
      INSERT INTO runtime_events (id, session_id, user_id, event_type, payload)
      VALUES ($1, $2, $3, $4, $5::jsonb)
    `, [input.id, input.sessionId ?? null, input.userId ?? null, input.eventType, JSON.stringify(input.payload ?? {})]);
  }
}

export class KnowledgeRepository {
  constructor(private readonly database: V1Database) {}

  async createSource(input: {
    id: string;
    kind: KnowledgeSourceRecord["kind"];
    name: string;
    sourceUrl?: string;
    filePath?: string;
    metadata?: Record<string, unknown>;
  }): Promise<KnowledgeSourceRecord> {
    const result = await this.database.query<KnowledgeSourceRecord>(`
      INSERT INTO knowledge_sources (id, kind, name, source_url, file_path, status, metadata)
      VALUES ($1, $2, $3, $4, $5, 'pending', $6::jsonb)
      RETURNING ${knowledgeSourceColumns()}
    `, [input.id, input.kind, input.name, input.sourceUrl ?? null, input.filePath ?? null, JSON.stringify(input.metadata ?? {})]);
    return result.rows[0]!;
  }

  async getSource(id: string): Promise<KnowledgeSourceRecord> {
    const result = await this.database.query<KnowledgeSourceRecord>(`SELECT ${knowledgeSourceColumns()} FROM knowledge_sources WHERE id = $1`, [id]);
    if (!result.rows[0]) throw new NotFoundError(`Knowledge source not found: ${id}`);
    return result.rows[0];
  }

  async listSources(): Promise<KnowledgeSourceRecord[]> {
    const result = await this.database.query<KnowledgeSourceRecord>(`SELECT ${knowledgeSourceColumns()} FROM knowledge_sources ORDER BY created_at DESC`);
    return result.rows;
  }

  async updateSource(id: string, input: { status: KnowledgeSourceRecord["status"]; error?: string | null; metadata?: Record<string, unknown> }): Promise<KnowledgeSourceRecord> {
    const current = await this.getSource(id);
    const result = await this.database.query<KnowledgeSourceRecord>(`
      UPDATE knowledge_sources SET status = $2, error = $3, metadata = $4::jsonb,
        updated_at = NOW(), completed_at = CASE WHEN $2 IN ('ready', 'failed') THEN NOW() ELSE NULL END
      WHERE id = $1 RETURNING ${knowledgeSourceColumns()}
    `, [id, input.status, input.error ?? null, JSON.stringify(input.metadata ?? current.metadata)]);
    return result.rows[0]!;
  }

  async replaceChunks(sourceId: string, chunks: Array<{
    id: string;
    kind: string;
    content: string;
    contentHash: string;
    metadata?: Record<string, unknown>;
    embedding?: number[];
  }>): Promise<void> {
    await this.database.transaction(async (client) => {
      await client.query("DELETE FROM knowledge_chunks WHERE source_id = $1", [sourceId]);
      for (const chunk of chunks) {
        await client.query(`
          INSERT INTO knowledge_chunks (id, source_id, kind, content, content_hash, metadata, embedding)
          VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::vector)
        `, [
          chunk.id, sourceId, chunk.kind, chunk.content, chunk.contentHash,
          JSON.stringify(chunk.metadata ?? {}), chunk.embedding ? vector(chunk.embedding) : null
        ]);
      }
    });
  }

  async search(input: { query: string; embedding?: number[]; limit?: number }): Promise<KnowledgeMatch[]> {
    const limit = Math.min(Math.max(input.limit ?? 12, 1), 50);
    const embedding = input.embedding ? vector(input.embedding) : null;
    const result = await this.database.query<KnowledgeMatch>(`
      SELECT chunks.id,
             chunks.source_id AS "sourceId",
             sources.name AS "sourceName",
             chunks.kind,
             chunks.content,
             chunks.metadata,
             (
               ts_rank_cd(chunks.search_vector, websearch_to_tsquery('english', $1)) * 0.45
               + CASE WHEN $2::vector IS NULL OR chunks.embedding IS NULL THEN 0
                      ELSE (1 - (chunks.embedding <=> $2::vector)) * 0.55 END
             )::float8 AS score
      FROM knowledge_chunks chunks
      JOIN knowledge_sources sources ON sources.id = chunks.source_id
      WHERE sources.status = 'ready'
        AND (chunks.search_vector @@ websearch_to_tsquery('english', $1) OR $2::vector IS NOT NULL)
      ORDER BY score DESC
      LIMIT $3
    `, [input.query, embedding, limit]);
    return result.rows;
  }

  async createSkill(input: {
    id: string;
    name: string;
    description: string;
    goal: string;
    businessContext?: string;
    steps: unknown[];
    constraints?: string[];
    expectedOutcomes?: string[];
    recordingId?: string;
  }): Promise<SkillRecord> {
    const result = await this.database.query<SkillRecord>(`
      INSERT INTO skills (
        id, name, description, goal, business_context, steps, constraints,
        expected_outcomes, status, recording_id
      ) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8::jsonb, 'needs_review', $9)
      RETURNING ${skillColumns()}
    `, [
      input.id, input.name, input.description, input.goal, input.businessContext ?? "",
      JSON.stringify(input.steps), JSON.stringify(input.constraints ?? []),
      JSON.stringify(input.expectedOutcomes ?? []), input.recordingId ?? null
    ]);
    return result.rows[0]!;
  }

  async listSkills(status?: SkillRecord["status"]): Promise<SkillRecord[]> {
    const result = status
      ? await this.database.query<SkillRecord>(`SELECT ${skillColumns()} FROM skills WHERE status = $1 ORDER BY updated_at DESC`, [status])
      : await this.database.query<SkillRecord>(`SELECT ${skillColumns()} FROM skills ORDER BY updated_at DESC`);
    return result.rows;
  }

  async getSkill(id: string): Promise<SkillRecord> {
    const result = await this.database.query<SkillRecord>(`SELECT ${skillColumns()} FROM skills WHERE id = $1`, [id]);
    if (!result.rows[0]) throw new NotFoundError(`Skill not found: ${id}`);
    return result.rows[0];
  }

  async setSkillStatus(id: string, status: "needs_review" | "published" | "archived"): Promise<SkillRecord> {
    const result = await this.database.query<SkillRecord>(`
      UPDATE skills SET status = $2, version = version + 1, updated_at = NOW(),
        published_at = CASE WHEN $2 = 'published' THEN NOW() ELSE published_at END
      WHERE id = $1 RETURNING ${skillColumns()}
    `, [id, status]);
    if (!result.rows[0]) throw new NotFoundError(`Skill not found: ${id}`);
    return result.rows[0];
  }

  async listPublishedSkills(): Promise<SkillRecord[]> {
    return this.listSkills("published");
  }

  async listMappedElements(route?: string, limit = 500): Promise<Array<{
    elementKey: string;
    route: string;
    role: string | null;
    name: string | null;
    description: string | null;
    locators: unknown[];
    fingerprint: string;
    actionPolicy: RiskLevel;
  }>> {
    const result = route
      ? await this.database.query(`
          SELECT elements.element_key AS "elementKey", elements.route, elements.role, elements.name,
                 elements.description, elements.locators, elements.fingerprint,
                 elements.action_policy AS "actionPolicy"
          FROM ui_elements elements JOIN ui_map_versions versions ON versions.id = elements.map_version_id
          WHERE versions.status = 'ready' AND elements.route = $1
          ORDER BY versions.completed_at DESC LIMIT $2
        `, [route, limit])
      : await this.database.query(`
          SELECT elements.element_key AS "elementKey", elements.route, elements.role, elements.name,
                 elements.description, elements.locators, elements.fingerprint,
                 elements.action_policy AS "actionPolicy"
          FROM ui_elements elements JOIN ui_map_versions versions ON versions.id = elements.map_version_id
          WHERE versions.status = 'ready' ORDER BY versions.completed_at DESC LIMIT $1
        `, [limit]);
    return result.rows as Array<{
      elementKey: string; route: string; role: string | null; name: string | null;
      description: string | null; locators: unknown[]; fingerprint: string; actionPolicy: RiskLevel;
    }>;
  }
}

export class DiagnosticsRepository {
  constructor(private readonly database: V1Database) {}

  async logAiRequest(input: {
    id: string;
    sessionId?: string;
    purpose: string;
    model: string;
    latencyMs?: number;
    inputTokens?: number;
    outputTokens?: number;
    error?: string;
  }): Promise<void> {
    await this.database.query(`
      INSERT INTO ai_requests (id, session_id, purpose, model, latency_ms, input_tokens, output_tokens, error)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    `, [input.id, input.sessionId ?? null, input.purpose, input.model, input.latencyMs ?? null, input.inputTokens ?? null, input.outputTokens ?? null, input.error ?? null]);
  }

  async listRuns(limit = 100): Promise<Array<Record<string, unknown>>> {
    const result = await this.database.query(`
      SELECT sessions.id, sessions.user_id AS "userId", sessions.status, sessions.goal,
             sessions.current_route AS "currentRoute", sessions.step_count AS "stepCount",
             sessions.consecutive_failures AS "consecutiveFailures",
             sessions.created_at::text AS "createdAt", sessions.updated_at::text AS "updatedAt",
             sessions.completed_at::text AS "completedAt", sessions.error,
             (SELECT COUNT(*)::int FROM agent_turns turns WHERE turns.session_id = sessions.id) AS "turnCount"
      FROM agent_sessions sessions ORDER BY sessions.updated_at DESC LIMIT $1
    `, [limit]);
    return result.rows;
  }

  async getRun(id: string): Promise<Record<string, unknown>> {
    const session = await this.database.query(`SELECT ${agentSessionColumns()} FROM agent_sessions WHERE id = $1`, [id]);
    if (!session.rows[0]) throw new NotFoundError(`Agent session not found: ${id}`);
    const turns = await this.database.query(`
      SELECT id, role, source, content, created_at::text AS "createdAt"
      FROM agent_turns WHERE session_id = $1 ORDER BY created_at
    `, [id]);
    const steps = await this.database.query(`SELECT ${agentStepColumns()} FROM agent_steps WHERE session_id = $1 ORDER BY step_index`, [id]);
    const receipts = await this.database.query(`
      SELECT action_id AS "actionId", idempotency_key AS "idempotencyKey", action_type AS type,
             target_ref AS "targetRef", status, message, evidence, created_at::text AS "createdAt"
      FROM action_receipts WHERE session_id = $1 ORDER BY created_at
    `, [id]);
    return { session: session.rows[0], turns: turns.rows, steps: steps.rows, receipts: receipts.rows };
  }

  async usage(): Promise<Record<string, number>> {
    const result = await this.database.query<{
      sessions: number;
      completed: number;
      failed: number;
      actions: number;
      aiRequests: number;
    }>(`
      SELECT
        (SELECT COUNT(*)::int FROM agent_sessions) AS sessions,
        (SELECT COUNT(*)::int FROM agent_sessions WHERE status = 'completed') AS completed,
        (SELECT COUNT(*)::int FROM agent_sessions WHERE status = 'failed') AS failed,
        (SELECT COUNT(*)::int FROM action_receipts) AS actions,
        (SELECT COUNT(*)::int FROM ai_requests) AS "aiRequests"
    `);
    return result.rows[0] ?? { sessions: 0, completed: 0, failed: 0, actions: 0, aiRequests: 0 };
  }

  async purgeExpired(retentionDays: number): Promise<{ sessions: number; events: number; aiRequests: number; tokens: number; adminSessions: number }> {
    return this.database.transaction(async (client) => {
      const interval = `${retentionDays} days`;
      const sessions = await client.query("DELETE FROM agent_sessions WHERE updated_at < NOW() - $1::interval", [interval]);
      const events = await client.query("DELETE FROM runtime_events WHERE created_at < NOW() - $1::interval", [interval]);
      const ai = await client.query("DELETE FROM ai_requests WHERE created_at < NOW() - $1::interval", [interval]);
      const tokens = await client.query("DELETE FROM runtime_tokens WHERE expires_at < NOW() OR revoked_at IS NOT NULL");
      const admin = await client.query("DELETE FROM admin_sessions WHERE expires_at < NOW() OR revoked_at IS NOT NULL");
      return {
        sessions: sessions.rowCount ?? 0,
        events: events.rowCount ?? 0,
        aiRequests: ai.rowCount ?? 0,
        tokens: tokens.rowCount ?? 0,
        adminSessions: admin.rowCount ?? 0
      };
    });
  }
}

async function productWithClient(client: PoolClient): Promise<ProductRecord> {
  const result = await client.query<ProductRecord>(`
    SELECT name, origin, documentation_origins AS "documentationOrigins",
           redacted_selectors AS "redactedSelectors", transcript_mode AS "transcriptMode",
           transcript_retention_days AS "transcriptRetentionDays",
           created_at::text AS "createdAt", updated_at::text AS "updatedAt"
    FROM product WHERE singleton = TRUE
  `);
  return result.rows[0]!;
}

async function adminWithClient(client: PoolClient): Promise<AdminUserRecord> {
  const result = await client.query<AdminUserRecord>(adminSelect());
  return result.rows[0]!;
}

function adminSelect(): string {
  return `SELECT id, email, name, password_hash AS "passwordHash", created_at::text AS "createdAt",
    updated_at::text AS "updatedAt", last_login_at::text AS "lastLoginAt" FROM admin_user WHERE singleton = TRUE`;
}

function integrationKeySelect(suffix: string): string {
  return `SELECT id, name, prefix, key_hash AS "keyHash", allowed_origin AS "allowedOrigin",
    created_at::text AS "createdAt", last_used_at::text AS "lastUsedAt", revoked_at::text AS "revokedAt"
    FROM integration_keys ${suffix}`;
}

function runtimeTokenColumns(): string {
  return `id, prefix, token_hash AS "tokenHash", user_id AS "userId", allowed_origin AS "allowedOrigin",
    capabilities, expires_at::text AS "expiresAt", max_uses AS "maxUses", use_count AS "useCount",
    created_at::text AS "createdAt", last_used_at::text AS "lastUsedAt", revoked_at::text AS "revokedAt"`;
}

function agentSessionColumns(): string {
  return `id, resume_token_hash AS "resumeTokenHash", user_id AS "userId", status, revision, goal,
    current_route AS "currentRoute", step_count AS "stepCount", consecutive_failures AS "consecutiveFailures",
    loop_signature AS "loopSignature", loop_count AS "loopCount", pending_confirmation AS "pendingConfirmation",
    created_at::text AS "createdAt", updated_at::text AS "updatedAt", completed_at::text AS "completedAt", error`;
}

function agentStepColumns(): string {
  return `id, session_id AS "sessionId", step_index AS "stepIndex", observation_revision AS "observationRevision",
    assessment, progress, directive, retrieved_sources AS "retrievedSources", model, latency_ms AS "latencyMs",
    input_tokens AS "inputTokens", output_tokens AS "outputTokens", status, error, created_at::text AS "createdAt"`;
}

function confirmationColumns(): string {
  return `id, session_id AS "sessionId", action_id AS "actionId", prompt, binding_hash AS "bindingHash",
    status, source, expires_at::text AS "expiresAt", created_at::text AS "createdAt", resolved_at::text AS "resolvedAt"`;
}

function hostActionColumns(): string {
  return `name, description, input_schema AS "inputSchema", risk, status, manifest_hash AS "manifestHash",
    first_seen_at::text AS "firstSeenAt", last_seen_at::text AS "lastSeenAt", reviewed_at::text AS "reviewedAt"`;
}

function hostActionSelect(suffix: string): string {
  return `SELECT ${hostActionColumns()} FROM host_actions ${suffix}`;
}

function knowledgeSourceColumns(): string {
  return `id, kind, name, source_url AS "sourceUrl", file_path AS "filePath", status, metadata, error,
    created_at::text AS "createdAt", updated_at::text AS "updatedAt", completed_at::text AS "completedAt"`;
}

function skillColumns(): string {
  return `id, name, description, goal, business_context AS "businessContext", steps, constraints,
    expected_outcomes AS "expectedOutcomes", status, version, recording_id AS "recordingId",
    created_at::text AS "createdAt", updated_at::text AS "updatedAt", published_at::text AS "publishedAt"`;
}

function requireSessionUpdate(session: AgentSessionRecord | undefined, expectedRevision: number): AgentSessionRecord {
  if (!session) throw new AppError("SESSION_CONFLICT", "The agent session changed while the request was running.", 409, { expectedRevision });
  return session;
}

function vector(values: number[]): string {
  return `[${values.map((value) => Number.isFinite(value) ? value : 0).join(",")}]`;
}

export function safeDirectiveJson(actions: ActionDirective[]): Json {
  return actions.map(({ value: _value, arguments: _arguments, ...action }) => action) as Json;
}

export function safeObservationSummary(observation: Observation): Record<string, unknown> {
  return {
    id: observation.id,
    revision: observation.revision,
    route: observation.route,
    nodeCount: observation.nodes.length
  };
}
