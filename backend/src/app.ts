import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import fastifyStatic from "@fastify/static";
import helmet from "@fastify/helmet";
import Fastify, { type FastifyInstance } from "fastify";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { ZodError } from "zod";
import type { AppConfig } from "./config/env.js";
import { validateRuntimeConfig } from "./config/env.js";
import { AppError } from "./utils/errors.js";
import { createDatabase } from "./db/database.js";
import { Repositories } from "./db/repositories.js";
import { GeminiModelGatewayAdapter } from "./adapters/geminiModelGateway.js";
import { GeminiVideoUnderstandingAdapter } from "./adapters/geminiVideoUnderstanding.js";
import { LanceDbSemanticSearchAdapter } from "./adapters/lanceDbSemanticSearch.js";
import { LiveKitVoiceTransportAdapter } from "./adapters/livekit.js";
import { LocalFileStorageAdapter } from "./adapters/storage.js";
import { QwenTextToSpeechAdapter } from "./adapters/tts.js";
import { UiMapService } from "./services/ui-map/uiMapService.js";
import { InteractiveUiMapScanService } from "./services/ui-map/interactiveScanService.js";
import { WorkflowCompiler } from "./services/workflows/compiler.js";
import { VideoProcessingService } from "./services/workflows/videoProcessingService.js";
import { WorkflowService } from "./services/workflows/workflowService.js";
import { RuntimeService } from "./services/runtime/runtimeService.js";
import { SemanticIndexService } from "./services/semantic/semanticIndexService.js";
import { ApiKeyService } from "./services/auth/apiKeyService.js";
import { ConsoleAuthService } from "./services/auth/consoleAuthService.js";
import { RuntimeTokenService } from "./services/auth/runtimeTokenService.js";
import { UsageService } from "./services/metrics/usageService.js";
import { ReadinessService } from "./services/system/readinessService.js";
import { GeminiLiveTokenService } from "./services/gemini/geminiLiveTokenService.js";
import { RateLimitService } from "./services/security/rateLimitService.js";
import { TelemetryService } from "./services/privacy/telemetryService.js";
import { registerRoutes } from "./routes/index.js";

export type AppDependencies = ReturnType<typeof createDependencies>;

export async function buildApp(config: AppConfig): Promise<FastifyInstance> {
  validateRuntimeConfig(config);
  mkdirSync(config.LOCAL_UPLOAD_DIR, { recursive: true });

  const app = Fastify({ logger: true, trustProxy: config.TRUST_PROXY });
  const secureTransport = config.NODE_ENV === "production" && corsOriginsUseHttps(config.CORS_ORIGIN);
  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        baseUri: ["'none'"],
        connectSrc: ["'self'"],
        fontSrc: ["'self'", "data:"],
        formAction: ["'self'"],
        frameAncestors: ["'none'"],
        imgSrc: ["'self'", "data:", "blob:"],
        objectSrc: ["'none'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'"],
        upgradeInsecureRequests: secureTransport ? [] : null
      }
    },
    crossOriginResourcePolicy: { policy: "cross-origin" },
    hsts: secureTransport
      ? { maxAge: 31_536_000, includeSubDomains: true, preload: true }
      : false,
    referrerPolicy: { policy: "no-referrer" }
  });
  app.addHook("onSend", async (request, reply, payload) => {
    reply.header("permissions-policy", "camera=(), geolocation=(), microphone=(), payment=(), usb=()");
    if (request.url.startsWith("/api/")) reply.header("cache-control", "no-store");
    return payload;
  });
  await app.register(cors, {
    origin: corsOrigin(config.CORS_ORIGIN),
    methods: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["authorization", "content-type", "x-api-key", "x-bootstrap-admin-token"],
    exposedHeaders: ["retry-after"],
    maxAge: 600,
    strictPreflight: true
  });
  await app.register(multipart, { limits: { fileSize: config.WORKFLOW_VIDEO_MAX_BYTES } });

  const dependencies = createDependencies(config);
  dependencies.repositories.purgeExpiredData();
  const retentionTimer = setInterval(() => {
    try {
      dependencies.repositories.purgeExpiredData();
    } catch (error) {
      app.log.error(error, "Data retention sweep failed");
    }
  }, config.DATA_RETENTION_SWEEP_INTERVAL_MS ?? 60 * 60 * 1_000);
  retentionTimer.unref();
  app.addHook("onClose", async () => {
    clearInterval(retentionTimer);
    const results = await Promise.allSettled([
      dependencies.services.uiMap.closeAll(),
      dependencies.services.interactiveUiMap.closeAll(),
      dependencies.services.videoProcessing.close()
    ]);
    try {
      await dependencies.adapters.semanticSearch.close();
    } catch (error) {
      results.push({ status: "rejected", reason: error });
    } finally {
      dependencies.repositories.close();
    }
    const failures = results.filter((result): result is PromiseRejectedResult => result.status === "rejected");
    if (failures.length > 0) throw new AggregateError(failures.map((failure) => failure.reason), "Backend resource cleanup failed.");
  });
  registerErrorHandler(app);
  await registerRoutes(app, dependencies);
  await registerConsoleStatic(app, config);
  dependencies.services.uiMap.resumeUnfinishedScans((error) => app.log.error(error));
  dependencies.services.videoProcessing.resumeUnfinishedJobs((error) => app.log.error(error));
  return app;
}

function corsOrigin(value: string): true | string[] {
  if (value.trim() === "*") return true;
  return value.split(",").map((origin) => origin.trim()).filter(Boolean);
}

function corsOriginsUseHttps(value: string): boolean {
  const origins = value.split(",").map((origin) => origin.trim()).filter(Boolean);
  return origins.length > 0 && origins.every((origin) => {
    try {
      return new URL(origin).protocol === "https:";
    } catch {
      return false;
    }
  });
}

async function registerConsoleStatic(app: FastifyInstance, config: AppConfig): Promise<void> {
  const indexPath = join(config.CONSOLE_DIST_DIR, "index.html");
  if (!existsSync(indexPath)) {
    app.log.warn({ consoleDistDir: config.CONSOLE_DIST_DIR }, "Console dist directory not found; serving API only.");
    return;
  }

  await app.register(fastifyStatic, {
    root: config.CONSOLE_DIST_DIR,
    prefix: "/",
    decorateReply: false
  });
}

function createDependencies(config: AppConfig) {
  const db = createDatabase(config);
  const repositories = new Repositories(db, config.MIA_SECRET_ENCRYPTION_KEY);
  const logAiRequest = repositories.insertAiLog.bind(repositories);
  const gateway = new GeminiModelGatewayAdapter(config, logAiRequest);
  const semanticSearch = new LanceDbSemanticSearchAdapter(config, logAiRequest);
  const videoUnderstanding = new GeminiVideoUnderstandingAdapter(config, gateway);
  const storage = new LocalFileStorageAdapter();
  const tts = new QwenTextToSpeechAdapter(config);
  const livekit = new LiveKitVoiceTransportAdapter(config);
  const compiler = new WorkflowCompiler(repositories, semanticSearch);
  const runtime = new RuntimeService(repositories, gateway, semanticSearch);

  return {
    config,
    repositories,
    adapters: { gateway, semanticSearch, videoUnderstanding, storage, tts, livekit },
    services: {
      uiMap: new UiMapService(config, repositories, semanticSearch),
      interactiveUiMap: new InteractiveUiMapScanService(config, repositories, semanticSearch),
      videoProcessing: new VideoProcessingService(repositories, videoUnderstanding, compiler),
      workflow: new WorkflowService(repositories, semanticSearch),
      semanticIndex: new SemanticIndexService(repositories, semanticSearch),
      runtime,
      apiKeys: new ApiKeyService(repositories),
      runtimeTokens: new RuntimeTokenService(config, repositories),
      consoleAuth: new ConsoleAuthService(config, repositories),
      usage: new UsageService(repositories),
      readiness: new ReadinessService(config, repositories),
      geminiLiveTokens: new GeminiLiveTokenService(config),
      rateLimit: new RateLimitService(config, repositories),
      telemetry: new TelemetryService(repositories)
    }
  };
}

function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((error, request, reply) => {
    request.log.error(safeErrorLogPayload(error), safeErrorLogMessage(error));

    if (error instanceof AppError) {
      if (error.statusCode === 429 && isRetryAfterDetails(error.details)) {
        reply.header("retry-after", String(Math.max(1, Math.ceil(error.details.retryAfterMs / 1_000))));
      }
      const payload: { code: string; message: string; details?: unknown } = {
        code: error.code,
        message: clientErrorMessage(error)
      };
      if (error.statusCode < 500 && error.details !== undefined) {
        payload.details = error.details;
      }
      return reply.status(error.statusCode).send({
        error: payload
      });
    }

    if (error instanceof ZodError) {
      return reply.status(400).send({
        error: {
          code: "VALIDATION_ERROR",
          message: "Request validation failed.",
          details: error.issues
        }
      });
    }

    const httpError = error as { statusCode?: unknown; code?: unknown; message?: unknown };
    const statusCode = typeof httpError.statusCode === "number" && httpError.statusCode >= 400 ? httpError.statusCode : undefined;
    const code = typeof httpError.code === "string" ? httpError.code : undefined;
    if (statusCode) {
      return reply.status(statusCode).send({
        error: {
          code: code ?? "REQUEST_ERROR",
          message: statusCode >= 500 ? "Internal server error." : typeof httpError.message === "string" ? httpError.message : "Request failed."
        }
      });
    }

    return reply.status(500).send({
      error: {
        code: "INTERNAL_SERVER_ERROR",
        message: "Internal server error."
      }
    });
  });
}

function isRetryAfterDetails(value: unknown): value is { retryAfterMs: number } {
  return Boolean(value && typeof value === "object" && "retryAfterMs" in value && typeof value.retryAfterMs === "number");
}

type SafeErrorLogPayload = {
  err: {
    type: string;
    code?: string;
    statusCode?: number;
    message: string;
    stack?: string;
    issues?: Array<{ code: string; path: Array<string | number>; message: string }>;
    issueCount?: number;
  };
};

export function safeErrorLogPayload(error: unknown): SafeErrorLogPayload {
  if (error instanceof AppError) {
    return {
      err: {
        type: error.name || "AppError",
        code: error.code,
        statusCode: error.statusCode,
        message: error.statusCode >= 500 ? clientErrorMessage(error) : error.message,
        stack: error.stack
      }
    };
  }

  if (error instanceof ZodError) {
    return {
      err: {
        type: "ZodError",
        message: "Request validation failed.",
        issueCount: error.issues.length,
        issues: error.issues.map((issue) => ({
          code: issue.code,
          path: issue.path.map((part) => typeof part === "symbol" ? part.toString() : part),
          message: issue.message
        }))
      }
    };
  }

  if (error instanceof Error) {
    return {
      err: {
        type: error.name || "Error",
        message: error.message,
        stack: error.stack
      }
    };
  }

  return {
    err: {
      type: "UnknownError",
      message: "Non-error value thrown."
    }
  };
}

function safeErrorLogMessage(error: unknown): string {
  if (error instanceof AppError) return `${error.code} request failed`;
  if (error instanceof ZodError) return "Request validation failed";
  return "Unhandled request error";
}

function clientErrorMessage(error: AppError): string {
  if (error.statusCode < 500) return error.message;
  if (error.statusCode === 502 || error.code.startsWith("PROVIDER_") || error.code.startsWith("OPENAI_") || error.code.startsWith("GEMINI_")) {
    return "Upstream provider request failed.";
  }
  return "Internal server error.";
}
