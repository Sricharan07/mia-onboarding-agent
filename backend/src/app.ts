import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import Fastify, { type FastifyInstance } from "fastify";
import { mkdirSync } from "node:fs";
import { ZodError } from "zod";
import type { AppConfig } from "./config/env.js";
import { AppError } from "./utils/errors.js";
import { createDatabase } from "./db/database.js";
import { Repositories } from "./db/repositories.js";
import { GeminiModelGatewayAdapter } from "./adapters/geminiModelGateway.js";
import { GeminiVideoUnderstandingAdapter } from "./adapters/geminiVideoUnderstanding.js";
import { LanceDbSemanticSearchAdapter } from "./adapters/lanceDbSemanticSearch.js";
import { LocalFileStorageAdapter } from "./adapters/storage.js";
import { UiMapService } from "./services/ui-map/uiMapService.js";
import { InteractiveUiMapScanService } from "./services/ui-map/interactiveScanService.js";
import { WorkflowCompiler } from "./services/workflows/compiler.js";
import { VideoProcessingService } from "./services/workflows/videoProcessingService.js";
import { WorkflowService } from "./services/workflows/workflowService.js";
import { RuntimeService } from "./services/runtime/runtimeService.js";
import { SemanticIndexService } from "./services/semantic/semanticIndexService.js";
import { ApiKeyService } from "./services/auth/apiKeyService.js";
import { UsageService } from "./services/metrics/usageService.js";
import { ReadinessService } from "./services/system/readinessService.js";
import { GeminiLiveTokenService } from "./services/gemini/geminiLiveTokenService.js";
import { RateLimitService } from "./services/security/rateLimitService.js";
import { registerRoutes } from "./routes/index.js";

export type AppDependencies = ReturnType<typeof createDependencies>;

export async function buildApp(config: AppConfig): Promise<FastifyInstance> {
  mkdirSync(config.LOCAL_UPLOAD_DIR, { recursive: true });

  const app = Fastify({ logger: true, trustProxy: config.TRUST_PROXY });
  await app.register(cors, { origin: corsOrigin(config.CORS_ORIGIN) });
  await app.register(multipart, { limits: { fileSize: 1024 * 1024 * 500 } });

  const dependencies = createDependencies(config);
  app.addHook("onClose", async () => {
    await dependencies.services.interactiveUiMap.closeAll();
  });
  registerErrorHandler(app);
  await registerRoutes(app, dependencies);
  return app;
}

function corsOrigin(value: string): true | string[] {
  if (value.trim() === "*") return true;
  return value.split(",").map((origin) => origin.trim()).filter(Boolean);
}

function createDependencies(config: AppConfig) {
  const db = createDatabase(config);
  const repositories = new Repositories(db);
  const gateway = new GeminiModelGatewayAdapter(config);
  const semanticSearch = new LanceDbSemanticSearchAdapter(config);
  const videoUnderstanding = new GeminiVideoUnderstandingAdapter(config, gateway);
  const storage = new LocalFileStorageAdapter();
  const compiler = new WorkflowCompiler(repositories, semanticSearch);
  const runtime = new RuntimeService(repositories, gateway, semanticSearch);

  return {
    config,
    repositories,
    adapters: { gateway, semanticSearch, videoUnderstanding, storage },
    services: {
      uiMap: new UiMapService(config, repositories, semanticSearch),
      interactiveUiMap: new InteractiveUiMapScanService(config, repositories, semanticSearch),
      videoProcessing: new VideoProcessingService(repositories, videoUnderstanding, compiler),
      workflow: new WorkflowService(repositories, semanticSearch),
      semanticIndex: new SemanticIndexService(repositories, semanticSearch),
      runtime,
      apiKeys: new ApiKeyService(repositories),
      usage: new UsageService(repositories),
      readiness: new ReadinessService(config, repositories),
      geminiLiveTokens: new GeminiLiveTokenService(config),
      rateLimit: new RateLimitService(config)
    }
  };
}

function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((error, request, reply) => {
    request.log.error(error);

    if (error instanceof AppError) {
      return reply.status(error.statusCode).send({
        error: {
          code: error.code,
          message: error.message,
          details: error.details
        }
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
          message: typeof httpError.message === "string" ? httpError.message : "Request failed."
        }
      });
    }

    return reply.status(500).send({
      error: {
        code: "INTERNAL_SERVER_ERROR",
        message: error instanceof Error ? error.message : "Internal server error."
      }
    });
  });
}
