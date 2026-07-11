import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { Readable } from "node:stream";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { V1AppDependencies } from "./app.js";
import {
  actionReceiptSchema,
  continueSessionSchema,
  createSessionSchema,
  resolveConfirmationSchema,
  resumeSessionSchema,
  riskLevelSchema,
  submitTurnSchema,
  uiActionPolicySchema,
  type AgentResponse
} from "./domain.js";
import {
  bearerToken,
  integrationKeyHeader,
  requestOrigin,
  runtimeCapabilities,
  type RuntimeCapability
} from "./auth.js";
import { parseWithSchema } from "../utils/zod.js";
import { AppError } from "../utils/errors.js";
import { removeStoredUpload, storeMultipartUpload } from "./uploads.js";
import { redactSensitiveJson } from "./redaction.js";

const setupSchema = z.object({
  setupToken: z.string().min(1),
  productName: z.string().trim().min(1).max(200),
  origin: originSchema(),
  adminEmail: z.string().email().max(320),
  adminName: z.string().trim().min(1).max(200),
  password: z.string().min(12).max(1_000)
});
const loginSchema = z.object({ email: z.string().email().max(320), password: z.string().min(1).max(1_000) });
const passwordSchema = z.object({ currentPassword: z.string().min(1).max(1_000), nextPassword: z.string().min(12).max(1_000) });
const integrationKeySchema = z.object({ name: z.string().trim().min(1).max(200) });
const runtimeTokenSchema = z.object({
  userId: z.string().trim().min(1).max(200),
  origin: originSchema(),
  capabilities: z.array(z.enum(runtimeCapabilities)).min(1).max(runtimeCapabilities.length).optional()
});
const productUpdateSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  origin: originSchema().optional(),
  documentationOrigins: z.array(z.string().url().refine((value) => new URL(value).protocol === "https:", "Documentation origins must use HTTPS.")).max(50).optional(),
  redactedSelectors: z.array(z.string().trim().min(1).max(1_000)).max(100).optional(),
  transcriptMode: z.enum(["full", "redacted", "disabled"]).optional(),
  transcriptRetentionDays: z.number().int().min(1).max(365).optional(),
  voiceConfig: z.object({
    enabled: z.boolean(),
    voice: z.string().trim().min(1).max(100).default("Aoede"),
    language: z.literal("en-US").default("en-US")
  }).optional()
}).refine((value) => Object.keys(value).length > 0, "At least one product setting is required.");
const geminiCredentialSchema = z.object({ apiKey: z.string().min(20).max(1_000) });
const hostActionReviewSchema = z.object({ status: z.enum(["published", "blocked"]), risk: riskLevelSchema });
const routeIdSchema = z.object({ sessionId: z.string().min(1).max(200) });
const confirmationParamsSchema = routeIdSchema.extend({ confirmationId: z.string().min(1).max(200) });
const cancelSchema = z.object({ revision: z.number().int().nonnegative().optional() });
const voiceTokenSchema = z.object({
  voice: z.string().trim().min(1).max(100).optional(),
  sessionHandle: z.string().min(1).max(16_384).optional()
});
const eventSchema = z.object({
  sessionId: z.string().max(200).optional(),
  eventType: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/),
  payload: z.record(z.string(), z.unknown()).default({})
});
const documentationSourceSchema = z.object({
  name: z.string().trim().min(1).max(200),
  url: z.string().url(),
  maxPages: z.number().int().min(1).max(100).optional()
});
const skillUpdateSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  description: z.string().trim().min(1).max(1_000).optional(),
  goal: z.string().trim().min(1).max(2_000).optional(),
  businessContext: z.string().max(4_000).optional(),
  steps: z.array(z.unknown()).min(1).max(100).optional(),
  constraints: z.array(z.string().min(1).max(1_000)).max(30).optional(),
  expectedOutcomes: z.array(z.string().min(1).max(1_000)).max(30).optional()
}).refine((value) => Object.keys(value).length > 0, "At least one skill field is required.");
const scanSchema = z.object({
  routes: z.array(z.string().min(1).max(2_000)).min(1).max(50).optional(),
  discover: z.boolean().default(true)
});
const mappedElementsQuerySchema = z.object({
  route: z.string().max(2_000).optional(),
  search: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
  offset: z.coerce.number().int().min(0).max(100_000).default(0)
});
const scanAuthSchema = z.object({
  authMode: z.enum(["none", "login_form"]),
  loginUrl: z.string().max(2_000).optional(),
  username: z.string().max(500).optional(),
  password: z.string().max(2_000).optional(),
  usernameSelector: z.string().max(1_000).optional(),
  passwordSelector: z.string().max(1_000).optional(),
  submitSelector: z.string().max(1_000).optional(),
  successUrlPattern: z.string().max(1_000).optional(),
  allowedResourceOrigins: z.array(originSchema()).max(50).default([]),
  waitAfterLoginMs: z.number().int().min(0).max(5_000).default(500)
});

export async function registerV1Routes(app: FastifyInstance, dependencies: V1AppDependencies): Promise<void> {
  app.get("/api/v1/health", async () => ({ ok: true, service: "mia-v1", time: new Date().toISOString() }));
  app.get("/api/v1/ready", async (_request, reply) => {
    const database = await dependencies.database.healthy();
    const setupRequired = !await dependencies.repositories.product.isSetup();
    const gemini = await dependencies.secrets.geminiStatus();
    return reply.status(database ? 200 : 503).send({ ok: database, database, setupRequired, geminiConfigured: gemini.configured });
  });

  app.get("/api/v1/setup/status", async (request) => {
    const token = bearerToken(request.headers.authorization);
    const auth = await dependencies.auth.status(token);
    return { ...auth, gemini: await dependencies.secrets.geminiStatus() };
  });
  app.get("/api/v1/setup/checklist", async (request) => {
    await requireAdmin(request, dependencies);
    const [product, gemini, keys, sources, skills, recordings, scans, actions, sdk, usage, acceptance] = await Promise.all([
      dependencies.repositories.product.get(),
      dependencies.secrets.geminiStatus(),
      dependencies.auth.listIntegrationKeys(),
      dependencies.repositories.knowledge.listSources(),
      dependencies.repositories.knowledge.listSkills(),
      dependencies.repositories.knowledge.listRecordings(),
      dependencies.repositories.knowledge.listMapVersions(),
      dependencies.repositories.agent.listHostActions(),
      dependencies.repositories.diagnostics.sdkActivity(),
      dependencies.repositories.diagnostics.usage(),
      dependencies.repositories.diagnostics.acceptanceEvidence()
    ]);
    const activeKeys = keys.filter((key) => !key.revokedAt);
    const documentation = sources.filter((source) => ["documentation_url", "document_file"].includes(source.kind) && source.status !== "archived");
    const latestScan = scans[0] ?? null;
    const pendingActions = actions.filter((action) => ["detected", "needs_review"].includes(action.status));
    const checks = [
      { id: "product", label: "Product configured", complete: Boolean(product.origin) },
      { id: "gemini", label: "Gemini connected", complete: gemini.configured },
      { id: "runtime_key", label: "Runtime key created", complete: activeKeys.length > 0 },
      { id: "knowledge", label: "Product knowledge ready", complete: documentation.some((source) => source.status === "ready") },
      { id: "ui_map", label: "UI map ready", complete: latestScan?.status === "ready" },
      { id: "sdk", label: "SDK detected", complete: sdk.detected },
      { id: "actions", label: "Detected actions reviewed", complete: actions.length > 0 && pendingActions.length === 0 },
      { id: "validation", label: "Live validation completed", complete: Object.values(acceptance).every((scenario) => scenario.passed) }
    ];
    return {
      checks,
      completed: checks.filter((check) => check.complete).length,
      total: checks.length,
      product,
      gemini,
      integrationKeys: { active: activeKeys.length, total: keys.length, lastUsedAt: activeKeys.map((key) => key.lastUsedAt).filter(Boolean).sort().at(-1) ?? null },
      knowledge: { total: documentation.length, ready: documentation.filter((source) => source.status === "ready").length },
      skills: { total: skills.length, published: skills.filter((skill) => skill.status === "published").length, needsReview: skills.filter((skill) => skill.status === "needs_review").length },
      recordings: { total: recordings.length, processing: recordings.filter((recording) => ["uploaded", "processing"].includes(recording.status)).length },
      scan: latestScan,
      sdk,
      acceptance,
      actions: { total: actions.length, published: actions.filter((action) => action.status === "published").length, pending: pendingActions.length, blocked: actions.filter((action) => action.status === "blocked").length },
      usage
    };
  });
  app.post("/api/v1/setup", async (request) => {
    dependencies.rateLimiter.consume(`setup:${request.ip}`, 8);
    return dependencies.auth.setup(parseWithSchema(setupSchema, request.body));
  });
  app.post("/api/v1/auth/login", async (request) => {
    dependencies.rateLimiter.consume(`login:${request.ip}`, 8);
    const body = parseWithSchema(loginSchema, request.body);
    return dependencies.auth.login(body.email, body.password);
  });
  app.post("/api/v1/auth/logout", async (request) => {
    await dependencies.auth.logout(bearerToken(request.headers.authorization));
    return { ok: true };
  });
  app.put("/api/v1/auth/password", async (request) => {
    await requireAdmin(request, dependencies);
    const body = parseWithSchema(passwordSchema, request.body);
    return { user: await dependencies.auth.changePassword(body.currentPassword, body.nextPassword) };
  });

  app.get("/api/v1/product", async (request) => {
    await requireAdmin(request, dependencies);
    return dependencies.repositories.product.get();
  });
  app.patch("/api/v1/product", async (request) => {
    await requireAdmin(request, dependencies);
    return dependencies.repositories.product.update(parseWithSchema(productUpdateSchema, request.body));
  });
  app.get("/api/v1/product/gemini", async (request) => {
    await requireAdmin(request, dependencies);
    return dependencies.secrets.geminiStatus();
  });
  app.put("/api/v1/product/gemini", async (request) => {
    await requireAdmin(request, dependencies);
    const body = parseWithSchema(geminiCredentialSchema, request.body);
    await dependencies.secrets.setGeminiApiKey(body.apiKey);
    return dependencies.secrets.geminiStatus();
  });
  app.delete("/api/v1/product/gemini", async (request) => {
    await requireAdmin(request, dependencies);
    await dependencies.secrets.clearGeminiApiKey();
    return { configured: false };
  });

  app.get("/api/v1/integration-keys", async (request) => {
    await requireAdmin(request, dependencies);
    return { items: await dependencies.auth.listIntegrationKeys() };
  });
  app.post("/api/v1/integration-keys", async (request) => {
    await requireAdmin(request, dependencies);
    return dependencies.auth.createIntegrationKey(parseWithSchema(integrationKeySchema, request.body).name);
  });
  app.delete("/api/v1/integration-keys/:id", async (request) => {
    await requireAdmin(request, dependencies);
    const { id } = parseWithSchema(z.object({ id: z.string().min(1).max(200) }), request.params);
    await dependencies.repositories.auth.revokeIntegrationKey(id);
    return { ok: true };
  });

  app.get("/api/v1/actions", async (request) => {
    await requireAdmin(request, dependencies);
    return { items: await dependencies.repositories.agent.listHostActions() };
  });

  app.get("/api/v1/knowledge", async (request) => {
    await requireAdmin(request, dependencies);
    return { items: (await dependencies.repositories.knowledge.listSources()).map(withoutFilePath) };
  });
  app.post("/api/v1/knowledge/urls", async (request) => {
    await requireAdmin(request, dependencies);
    return withoutFilePath(await dependencies.knowledge.createDocumentationSource(parseWithSchema(documentationSourceSchema, request.body)));
  });
  app.post("/api/v1/knowledge/files", async (request) => {
    await requireAdmin(request, dependencies);
    const upload = await storeMultipartUpload(request, dependencies.config.LOCAL_UPLOAD_DIR, "document", dependencies.config.MAX_UPLOAD_BYTES);
    try {
      return withoutFilePath(await dependencies.knowledge.createDocumentFileSource({
        ...upload,
        name: upload.fields.name?.trim() || upload.originalName
      }));
    } catch (error) {
      await removeStoredUpload(upload.filePath);
      throw error;
    }
  });
  app.post("/api/v1/knowledge/:id/retry", async (request) => {
    await requireAdmin(request, dependencies);
    const { id } = parseWithSchema(z.object({ id: z.string().min(1).max(200) }), request.params);
    return withoutFilePath(await dependencies.knowledge.retrySource(id));
  });
  app.delete("/api/v1/knowledge/:id", async (request) => {
    await requireAdmin(request, dependencies);
    const { id } = parseWithSchema(z.object({ id: z.string().min(1).max(200) }), request.params);
    return withoutFilePath(await dependencies.repositories.knowledge.archiveSource(id));
  });

  app.get("/api/v1/skills", async (request) => {
    await requireAdmin(request, dependencies);
    return { items: await dependencies.repositories.knowledge.listSkills() };
  });
  app.patch("/api/v1/skills/:id", async (request) => {
    await requireAdmin(request, dependencies);
    const { id } = parseWithSchema(z.object({ id: z.string().min(1).max(200) }), request.params);
    return dependencies.knowledge.updateSkill(id, parseWithSchema(skillUpdateSchema, request.body));
  });
  app.post("/api/v1/skills/:id/publish", async (request) => {
    await requireAdmin(request, dependencies);
    const { id } = parseWithSchema(z.object({ id: z.string().min(1).max(200) }), request.params);
    return dependencies.knowledge.setSkillStatus(id, "published");
  });
  app.post("/api/v1/skills/:id/archive", async (request) => {
    await requireAdmin(request, dependencies);
    const { id } = parseWithSchema(z.object({ id: z.string().min(1).max(200) }), request.params);
    return dependencies.knowledge.setSkillStatus(id, "archived");
  });

  app.get("/api/v1/recordings", async (request) => {
    await requireAdmin(request, dependencies);
    return { items: (await dependencies.repositories.knowledge.listRecordings()).map(withoutFilePath) };
  });
  app.post("/api/v1/recordings", async (request) => {
    await requireAdmin(request, dependencies);
    const upload = await storeMultipartUpload(request, dependencies.config.LOCAL_UPLOAD_DIR, "recording", dependencies.config.MAX_UPLOAD_BYTES);
    try {
      return withoutFilePath(await dependencies.knowledge.createRecording({
        ...upload,
        name: upload.fields.name?.trim() || upload.originalName,
        description: upload.fields.description?.trim() || undefined
      }));
    } catch (error) {
      await removeStoredUpload(upload.filePath);
      throw error;
    }
  });
  app.post("/api/v1/recordings/:id/retry", async (request) => {
    await requireAdmin(request, dependencies);
    const { id } = parseWithSchema(z.object({ id: z.string().min(1).max(200) }), request.params);
    void dependencies.knowledge.processRecording(id).catch(() => undefined);
    return withoutFilePath(await dependencies.repositories.knowledge.getRecording(id));
  });

  app.get("/api/v1/scans", async (request) => {
    await requireAdmin(request, dependencies);
    return { items: await dependencies.repositories.knowledge.listMapVersions() };
  });
  app.post("/api/v1/scans", async (request) => {
    await requireAdmin(request, dependencies);
    return dependencies.scanner.start(parseWithSchema(scanSchema, request.body ?? {}));
  });
  app.get("/api/v1/scans/elements", async (request) => {
    await requireAdmin(request, dependencies);
    const query = parseWithSchema(mappedElementsQuerySchema, request.query ?? {});
    return dependencies.repositories.knowledge.listMappedElementsPage(query);
  });
  app.get("/api/v1/scans/:id", async (request) => {
    await requireAdmin(request, dependencies);
    const { id } = parseWithSchema(z.object({ id: z.string().min(1).max(200) }), request.params);
    return dependencies.repositories.knowledge.getMapVersion(id);
  });
  app.patch("/api/v1/scans/elements/:elementKey/policy", async (request) => {
    await requireAdmin(request, dependencies);
    const { elementKey } = parseWithSchema(z.object({ elementKey: z.string().min(1).max(300) }), request.params);
    const { policy } = parseWithSchema(z.object({ policy: uiActionPolicySchema }), request.body);
    await dependencies.repositories.knowledge.updateMappedElementPolicy(elementKey, policy);
    return { ok: true };
  });
  app.get("/api/v1/product/scan-auth", async (request) => {
    await requireAdmin(request, dependencies);
    const product = await dependencies.repositories.product.get();
    return { config: product.scanConfig, passwordConfigured: await dependencies.secrets.scanPasswordConfigured() };
  });
  app.put("/api/v1/product/scan-auth", async (request) => {
    await requireAdmin(request, dependencies);
    const body = parseWithSchema(scanAuthSchema, request.body);
    if (body.authMode === "login_form" && (!body.loginUrl || !body.username || !body.usernameSelector || !body.passwordSelector || !body.submitSelector)) {
      throw new AppError("SCAN_AUTH_INCOMPLETE", "Login URL, username, and selectors are required for login-form scanning.", 400);
    }
    if (body.password) await dependencies.secrets.setScanPassword(body.password);
    if (body.authMode === "none") await dependencies.secrets.clearScanPassword();
    const { password: _password, ...scanConfig } = body;
    const product = await dependencies.repositories.product.update({ scanConfig });
    return { config: product.scanConfig, passwordConfigured: await dependencies.secrets.scanPasswordConfigured() };
  });
  app.patch("/api/v1/actions/:name", async (request) => {
    await requireAdmin(request, dependencies);
    const { name } = parseWithSchema(z.object({ name: z.string().min(1).max(64) }), request.params);
    const body = parseWithSchema(hostActionReviewSchema, request.body);
    if (body.status === "published" && body.risk === "blocked") {
      throw new AppError("ACTION_REVIEW_INVALID", "Blocked actions cannot be published.", 400);
    }
    return dependencies.repositories.agent.reviewHostAction(name, body);
  });

  app.get("/api/v1/runs", async (request) => {
    await requireAdmin(request, dependencies);
    const product = await dependencies.repositories.product.get();
    return { items: await dependencies.repositories.diagnostics.listRuns(100, product.transcriptMode), transcriptMode: product.transcriptMode };
  });
  app.get("/api/v1/runs/:id", async (request) => {
    await requireAdmin(request, dependencies);
    const { id } = parseWithSchema(z.object({ id: z.string().min(1).max(200) }), request.params);
    const product = await dependencies.repositories.product.get();
    return dependencies.repositories.diagnostics.getRun(id, product.transcriptMode);
  });
  app.get("/api/v1/usage", async (request) => {
    await requireAdmin(request, dependencies);
    return dependencies.repositories.diagnostics.usage();
  });

  app.post("/api/v1/runtime/tokens", async (request) => {
    dependencies.rateLimiter.consume(`token:${request.ip}`, dependencies.config.RATE_LIMIT_MAX);
    const rawKey = integrationKeyHeader(request.headers["x-mia-key"]);
    if (!rawKey) throw new AppError("INTEGRATION_KEY_REQUIRED", "A server-side integration key is required.", 401);
    const key = await dependencies.auth.authenticateIntegrationKey(rawKey);
    return dependencies.auth.mintRuntimeToken(parseWithSchema(runtimeTokenSchema, request.body), key);
  });

  app.post("/api/v1/runtime/sessions", async (request) => {
    const runtime = await requireRuntime(request, dependencies, "agent:run");
    return dependencies.agent.createSession(runtime.userId, parseWithSchema(createSessionSchema, request.body));
  });
  app.post("/api/v1/runtime/sessions/resume", async (request) => {
    const runtime = await requireRuntime(request, dependencies, "agent:run");
    return dependencies.agent.resumeSession(runtime.userId, parseWithSchema(resumeSessionSchema, request.body));
  });
  app.post("/api/v1/runtime/sessions/:sessionId/turns", async (request) => {
    const runtime = await requireRuntime(request, dependencies, "agent:run");
    const { sessionId } = parseWithSchema(routeIdSchema, request.params);
    const body = parseWithSchema(submitTurnSchema, request.body);
    return dependencies.agent.submitTurn({ sessionId, userId: runtime.userId, ...body, runtime: body });
  });
  app.post("/api/v1/runtime/sessions/:sessionId/turns/stream", async (request, reply) => {
    const runtime = await requireRuntime(request, dependencies, "agent:run");
    const { sessionId } = parseWithSchema(routeIdSchema, request.params);
    const body = parseWithSchema(submitTurnSchema, request.body);
    return sendAgentEvents(request, reply, (signal) => dependencies.agent.submitTurn({
      sessionId, userId: runtime.userId, ...body, runtime: body, signal
    }));
  });
  app.post("/api/v1/runtime/sessions/:sessionId/continue", async (request) => {
    const runtime = await requireRuntime(request, dependencies, "agent:run");
    const { sessionId } = parseWithSchema(routeIdSchema, request.params);
    const body = parseWithSchema(continueSessionSchema, request.body);
    return dependencies.agent.continue({ sessionId, userId: runtime.userId, ...body, runtime: body });
  });
  app.post("/api/v1/runtime/sessions/:sessionId/continue/stream", async (request, reply) => {
    const runtime = await requireRuntime(request, dependencies, "agent:run");
    const { sessionId } = parseWithSchema(routeIdSchema, request.params);
    const body = parseWithSchema(continueSessionSchema, request.body);
    return sendAgentEvents(request, reply, (signal) => dependencies.agent.continue({
      sessionId, userId: runtime.userId, ...body, runtime: body, signal
    }));
  });
  app.post("/api/v1/runtime/sessions/:sessionId/confirmations/:confirmationId", async (request) => {
    const runtime = await requireRuntime(request, dependencies, "agent:run");
    const params = parseWithSchema(confirmationParamsSchema, request.params);
    const body = parseWithSchema(resolveConfirmationSchema, request.body);
    return dependencies.agent.resolveConfirmation({ ...params, userId: runtime.userId, ...body });
  });
  app.post("/api/v1/runtime/sessions/:sessionId/cancel", async (request) => {
    const runtime = await requireRuntime(request, dependencies, "agent:run");
    const { sessionId } = parseWithSchema(routeIdSchema, request.params);
    const body = parseWithSchema(cancelSchema, request.body ?? {});
    return dependencies.agent.cancel(sessionId, runtime.userId, body.revision);
  });
  app.post("/api/v1/runtime/voice/token", async (request) => {
    await requireRuntime(request, dependencies, "voice:live");
    const product = await dependencies.repositories.product.get();
    if (!product.voiceConfig.enabled) {
      throw new AppError("VOICE_DISABLED", "Voice is disabled for this product.", 403);
    }
    const requested = parseWithSchema(voiceTokenSchema, request.body ?? {});
    return dependencies.gemini.createLiveToken(
      requested.voice ?? product.voiceConfig.voice,
      product.voiceConfig.language,
      requested.sessionHandle
    );
  });
  app.post("/api/v1/runtime/events", async (request) => {
    const runtime = await requireRuntime(request, dependencies, "events:write");
    const event = parseWithSchema(eventSchema, request.body);
    await dependencies.repositories.agent.addEvent({
      id: randomUUID(),
      sessionId: event.sessionId,
      userId: runtime.userId,
      eventType: event.eventType,
      payload: redactSensitiveJson(event.payload)
    });
    return { ok: true };
  });
}

async function requireAdmin(request: FastifyRequest, dependencies: V1AppDependencies) {
  const token = bearerToken(request.headers.authorization);
  if (!token) throw new AppError("ADMIN_SESSION_REQUIRED", "Administrator sign-in is required.", 401);
  return dependencies.auth.authenticateAdmin(token);
}

async function requireRuntime(request: FastifyRequest, dependencies: V1AppDependencies, capability: RuntimeCapability) {
  dependencies.rateLimiter.consume(`runtime:${request.ip}`, dependencies.config.RUNTIME_RATE_LIMIT_MAX);
  const token = bearerToken(request.headers.authorization);
  if (!token) throw new AppError("RUNTIME_TOKEN_REQUIRED", "A runtime token is required.", 401);
  return dependencies.auth.authenticateRuntime(token, requestOrigin(request.headers), capability);
}

function sendAgentEvents(request: FastifyRequest, reply: FastifyReply, work: (signal: AbortSignal) => Promise<AgentResponse>) {
  const controller = new AbortController();
  const abort = () => {
    if (!controller.signal.aborted) controller.abort(new DOMException("Client disconnected", "AbortError"));
  };
  const onResponseClose = () => {
    if (!reply.raw.writableFinished) abort();
  };
  request.raw.once("aborted", abort);
  reply.raw.once("close", onResponseClose);
  reply.headers({
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive",
    "x-accel-buffering": "no"
  });
  const stream = Readable.from((async function* () {
    try {
      yield encodeEvent("thinking", { message: "Understanding your request" });
      const response = await work(controller.signal);
      yield encodeEvent("progress", { assessment: response.assessment, progress: response.progress });
      if (response.status === "waiting_confirmation") yield encodeEvent("confirmation_required", response);
      else if (response.type === "actions") yield encodeEvent("action_requested", response);
      else if (response.type === "answer") yield encodeEvent("answer", response);
      else if (response.status === "completed") yield encodeEvent("completed", response);
      else yield encodeEvent(response.type, response);
    } catch (error) {
      if (controller.signal.aborted) return;
      const appError = error instanceof AppError ? error : undefined;
      yield encodeEvent("error", {
        error: {
          code: appError?.code ?? "INTERNAL_SERVER_ERROR",
          message: appError && appError.statusCode < 500 ? appError.message : "The agent request failed."
        }
      });
    } finally {
      request.raw.off("aborted", abort);
      reply.raw.off("close", onResponseClose);
    }
  })());
  return reply.send(stream);
}

function encodeEvent(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

function originSchema() {
  return z.string().url().transform((value, context) => {
    const url = new URL(value);
    const normalized = value.replace(/\/$/, "");
    const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    if (!["http:", "https:"].includes(url.protocol) || url.origin !== normalized || (url.protocol !== "https:" && !local)) {
      context.addIssue({ code: "custom", message: "Origin must be an HTTPS origin without a path, except localhost may use HTTP." });
      return z.NEVER;
    }
    return url.origin;
  });
}

function withoutFilePath<T extends { filePath: unknown }>(record: T): Omit<T, "filePath"> {
  const { filePath: _filePath, ...safe } = record;
  return safe;
}
