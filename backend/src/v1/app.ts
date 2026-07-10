import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import multipart from "@fastify/multipart";
import fastifyStatic from "@fastify/static";
import Fastify, { type FastifyInstance } from "fastify";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { ZodError } from "zod";
import type { V1Config } from "./config.js";
import { corsOrigins, validateV1Config } from "./config.js";
import { V1Database } from "./db/database.js";
import { V1Repositories } from "./db/repositories.js";
import { V1AuthService } from "./auth.js";
import { V1AgentService, type AgentModel } from "./agent.js";
import { V1Gemini } from "./gemini.js";
import { V1SecretService } from "./secrets.js";
import { V1RateLimiter } from "./rateLimit.js";
import { registerV1Routes } from "./routes.js";
import { AppError } from "../utils/errors.js";

export type V1AppDependencies = ReturnType<typeof createDependencies>;

export async function buildApp(config: V1Config, overrides: { model?: AgentModel } = {}): Promise<FastifyInstance> {
  validateV1Config(config);
  mkdirSync(config.LOCAL_UPLOAD_DIR, { recursive: true, mode: 0o700 });

  const app = Fastify({
    logger: config.NODE_ENV === "test" ? false : true,
    trustProxy: config.TRUST_PROXY,
    bodyLimit: Math.min(config.MAX_UPLOAD_BYTES, 12 * 1024 * 1024)
  });
  const secureTransport = config.NODE_ENV === "production" && configuredOrigins(config.CORS_ORIGIN).every((origin) => origin.startsWith("https://"));
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
        styleSrc: ["'self'", "'unsafe-inline'"],
        upgradeInsecureRequests: secureTransport ? [] : null
      }
    },
    crossOriginResourcePolicy: { policy: "cross-origin" },
    hsts: secureTransport ? { maxAge: 31_536_000, includeSubDomains: true, preload: true } : false,
    referrerPolicy: { policy: "no-referrer" }
  });
  app.addHook("onSend", async (request, reply, payload) => {
    reply.header("permissions-policy", "camera=(), geolocation=(), microphone=(), payment=(), usb=()");
    if (request.url.startsWith("/api/")) reply.header("cache-control", "no-store");
    return payload;
  });
  await app.register(cors, {
    origin: corsOrigins(config.CORS_ORIGIN),
    methods: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["authorization", "content-type", "x-mia-key"],
    exposedHeaders: ["retry-after"],
    maxAge: 600,
    strictPreflight: true
  });
  await app.register(multipart, {
    limits: { files: 1, fileSize: config.MAX_UPLOAD_BYTES, fields: 20, parts: 21 }
  });

  const database = new V1Database(config);
  await database.connect();
  const dependencies = createDependencies(config, database, overrides.model);
  registerErrorHandler(app);
  await registerV1Routes(app, dependencies);
  await registerConsole(app, config);

  let sweeping = false;
  const sweep = async () => {
    if (sweeping) return;
    sweeping = true;
    try {
      const retention = await dependencies.repositories.product.get()
        .then((product) => product.transcriptRetentionDays)
        .catch(() => config.TRANSCRIPT_RETENTION_DAYS);
      await dependencies.repositories.diagnostics.purgeExpired(retention);
    } catch (error) {
      app.log.error(error, "Data retention sweep failed");
    } finally {
      sweeping = false;
    }
  };
  void sweep();
  const retentionTimer = setInterval(() => void sweep(), config.DATA_RETENTION_SWEEP_INTERVAL_MS);
  retentionTimer.unref();
  app.addHook("onClose", async () => {
    clearInterval(retentionTimer);
    await database.close();
  });
  return app;
}

function createDependencies(config: V1Config, database: V1Database, model?: AgentModel) {
  const repositories = new V1Repositories(database);
  const secrets = new V1SecretService(config, repositories.secrets);
  const gemini = new V1Gemini(config, repositories.diagnostics, () => secrets.getGeminiApiKey());
  return {
    config,
    database,
    repositories,
    secrets,
    gemini,
    auth: new V1AuthService(config, repositories),
    agent: new V1AgentService(config, repositories, model ?? gemini),
    rateLimiter: new V1RateLimiter(config.RATE_LIMIT_WINDOW_MS)
  };
}

async function registerConsole(app: FastifyInstance, config: V1Config): Promise<void> {
  const indexPath = join(config.CONSOLE_DIST_DIR, "index.html");
  if (!existsSync(indexPath)) {
    app.log.warn({ consoleDistDir: config.CONSOLE_DIST_DIR }, "Console build not found; serving the API only.");
    return;
  }
  await app.register(fastifyStatic, { root: config.CONSOLE_DIST_DIR, prefix: "/" });
  app.setNotFoundHandler((request, reply) => {
    if (request.method === "GET" && !request.url.startsWith("/api/")) return reply.type("text/html").sendFile("index.html");
    return reply.status(404).send({ error: { code: "NOT_FOUND", message: "Route not found." } });
  });
}

function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((error, request, reply) => {
    request.log.error(safeErrorLogPayload(error), safeErrorLogMessage(error));
    if (error instanceof AppError) {
      if (error.statusCode === 429 && retryDetails(error.details)) {
        reply.header("retry-after", String(Math.max(1, Math.ceil(error.details.retryAfterMs / 1_000))));
      }
      return reply.status(error.statusCode).send({
        error: {
          code: error.code,
          message: clientErrorMessage(error),
          ...(error.statusCode < 500 && error.details !== undefined ? { details: error.details } : {})
        }
      });
    }
    if (error instanceof ZodError) {
      return reply.status(400).send({ error: { code: "VALIDATION_ERROR", message: "Request validation failed.", details: error.issues } });
    }
    const status = typeof (error as { statusCode?: unknown }).statusCode === "number" ? (error as { statusCode: number }).statusCode : 500;
    return reply.status(status).send({
      error: {
        code: status >= 500 ? "INTERNAL_SERVER_ERROR" : "REQUEST_ERROR",
        message: status >= 500 ? "Internal server error." : error instanceof Error ? error.message : "Request failed."
      }
    });
  });
}

export function safeErrorLogPayload(error: unknown): { err: Record<string, unknown> } {
  if (error instanceof AppError) {
    return { err: { type: error.name || "AppError", code: error.code, statusCode: error.statusCode, message: clientErrorMessage(error), stack: error.stack } };
  }
  if (error instanceof ZodError) {
    return { err: { type: "ZodError", message: "Request validation failed.", issueCount: error.issues.length } };
  }
  if (error instanceof Error) return { err: { type: error.name || "Error", message: error.message, stack: error.stack } };
  return { err: { type: "UnknownError", message: "Non-error value thrown." } };
}

function safeErrorLogMessage(error: unknown): string {
  return error instanceof AppError ? `${error.code} request failed` : "Unhandled request error";
}

function clientErrorMessage(error: AppError): string {
  if (error.statusCode < 500) return error.message;
  if (error.statusCode === 502 || error.code.startsWith("GEMINI_")) return "Upstream provider request failed.";
  return "Internal server error.";
}

function retryDetails(value: unknown): value is { retryAfterMs: number } {
  return Boolean(value && typeof value === "object" && "retryAfterMs" in value && typeof value.retryAfterMs === "number");
}

function configuredOrigins(value: string): string[] {
  return value.split(",").map((origin) => origin.trim()).filter(Boolean);
}
