import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import Fastify, { type FastifyInstance } from "fastify";
import { createReadStream, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { ZodError, z } from "zod";
import type { AppConfig } from "./config/env.js";
import { AppError } from "./utils/errors.js";
import { createDatabase } from "./db/database.js";
import { Repositories } from "./db/repositories.js";
import { QwenModelGatewayAdapter } from "./adapters/qwenGateway.js";
import { QwenVideoUnderstandingAdapter } from "./adapters/qwen.js";
import { MossSemanticSearchAdapter } from "./adapters/moss.js";
import { LiveKitVoiceTransportAdapter } from "./adapters/livekit.js";
import { QwenTextToSpeechAdapter } from "./adapters/tts.js";
import { LocalFileStorageAdapter } from "./adapters/storage.js";
import { UiMapService } from "./services/ui-map/uiMapService.js";
import { WorkflowCompiler } from "./services/workflows/compiler.js";
import { VideoProcessingService } from "./services/workflows/videoProcessingService.js";
import { WorkflowService } from "./services/workflows/workflowService.js";
import { RuntimeService } from "./services/runtime/runtimeService.js";
import { ApiKeyService } from "./services/auth/apiKeyService.js";
import { UsageService } from "./services/metrics/usageService.js";
import { ReadinessService } from "./services/system/readinessService.js";
import { registerRoutes } from "./routes/index.js";

export type AppDependencies = ReturnType<typeof createDependencies>;

export async function buildApp(config: AppConfig): Promise<FastifyInstance> {
  mkdirSync(config.LOCAL_UPLOAD_DIR, { recursive: true });
  mkdirSync(config.LOCAL_TTS_DIR, { recursive: true });

  const app = Fastify({ logger: true });
  await app.register(cors, { origin: true });
  await app.register(multipart, { limits: { fileSize: 1024 * 1024 * 500 } });

  const dependencies = createDependencies(config);
  registerErrorHandler(app);
  registerLocalFileRoute(app, config);
  await registerRoutes(app, dependencies);
  return app;
}

function createDependencies(config: AppConfig) {
  const db = createDatabase(config);
  const repositories = new Repositories(db);
  const gateway = new QwenModelGatewayAdapter(config);
  const moss = new MossSemanticSearchAdapter(config);
  const videoUnderstanding = new QwenVideoUnderstandingAdapter(config, gateway);
  const livekit = new LiveKitVoiceTransportAdapter(config);
  const tts = new QwenTextToSpeechAdapter(config);
  const storage = new LocalFileStorageAdapter();
  const compiler = new WorkflowCompiler(repositories, moss);

  return {
    config,
    repositories,
    adapters: { gateway, moss, videoUnderstanding, livekit, tts, storage },
    services: {
      uiMap: new UiMapService(repositories, moss),
      videoProcessing: new VideoProcessingService(repositories, videoUnderstanding, compiler),
      workflow: new WorkflowService(repositories, moss),
      runtime: new RuntimeService(repositories, gateway, moss, tts),
      apiKeys: new ApiKeyService(repositories),
      usage: new UsageService(repositories),
      readiness: new ReadinessService(config, repositories)
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

function registerLocalFileRoute(app: FastifyInstance, config: AppConfig): void {
  app.get("/local-files/tts/:filename", async (request, reply) => {
    const params = z.object({ filename: z.string().regex(/^[a-zA-Z0-9._-]+$/) }).parse(request.params);
    const path = join(config.LOCAL_TTS_DIR, params.filename);
    if (!existsSync(path)) {
      return reply.status(404).send({ error: { code: "FILE_NOT_FOUND", message: "TTS file not found." } });
    }
    return reply.type("audio/wav").send(createReadStream(path));
  });
}
