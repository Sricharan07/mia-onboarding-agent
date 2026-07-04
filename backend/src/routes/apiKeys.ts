import type { FastifyInstance, FastifyRequest } from "fastify";
import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import type { AppDependencies } from "../app.js";
import { apiKeyScopes } from "../services/auth/apiKeyService.js";
import { AppError } from "../utils/errors.js";
import { requireApiKeyScope } from "./auth.js";

const apiKeyInputSchema = z.object({
  name: z.string().min(1),
  scopes: z.array(z.enum(apiKeyScopes)).min(1),
  appId: z.string().trim().min(1).optional(),
  allowedOrigins: z.array(z.string().trim().min(1)).optional()
});

export async function registerApiKeyRoutes(app: FastifyInstance, dependencies: AppDependencies): Promise<void> {
  app.get("/api/v1/api-keys", {
    preHandler: (request, reply) => requireApiKeyScope(request, reply, dependencies, ["admin"])
  }, async () => ({
    items: dependencies.services.apiKeys.list()
  }));

  app.post("/api/v1/api-keys", async (request) => {
    authorizeApiKeyCreate(request, dependencies);
    const body = apiKeyInputSchema.parse(request.body);
    return dependencies.services.apiKeys.create(body);
  });

  app.delete("/api/v1/api-keys/:keyId", {
    preHandler: (request, reply) => requireApiKeyScope(request, reply, dependencies, ["admin"])
  }, async (request) => {
    const params = z.object({ keyId: z.string().min(1) }).parse(request.params);
    return dependencies.services.apiKeys.revoke(params.keyId);
  });
}

function authorizeApiKeyCreate(request: FastifyRequest, dependencies: AppDependencies): void {
  if (request.consoleSession?.role === "admin") return;

  if (dependencies.services.apiKeys.hasActiveKeys()) {
    dependencies.services.apiKeys.requireScope(request.apiKey, ["admin"]);
    return;
  }

  const expected = dependencies.config.BOOTSTRAP_ADMIN_TOKEN;
  const actual = typeof request.headers["x-bootstrap-admin-token"] === "string" ? request.headers["x-bootstrap-admin-token"] : undefined;
  if (!expected) {
    throw new AppError("BOOTSTRAP_TOKEN_REQUIRED", "Set BOOTSTRAP_ADMIN_TOKEN before creating the first API key.", 401);
  }
  if (!actual || !secureEqual(actual, expected)) {
    throw new AppError("BOOTSTRAP_TOKEN_INVALID", "A valid x-bootstrap-admin-token header is required to create the first API key.", 401);
  }
}

function secureEqual(actual: string, expected: string): boolean {
  const actualBuffer = Buffer.from(actual);
  const expectedBuffer = Buffer.from(expected);
  return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer);
}
