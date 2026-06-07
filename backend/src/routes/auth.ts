import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { AppDependencies } from "../app.js";
import type { ApiKeyScope } from "../db/repositories.js";
import { type AuthenticatedApiKey, extractApiKey } from "../services/auth/apiKeyService.js";

declare module "fastify" {
  interface FastifyRequest {
    apiKey?: AuthenticatedApiKey;
  }
}

export function registerApiKeyHook(app: FastifyInstance, dependencies: AppDependencies): void {
  app.addHook("preHandler", async (request) => {
    const rawKey = extractApiKey(request.headers);
    if (!rawKey) return;
    request.apiKey = dependencies.services.apiKeys.authenticate(rawKey);
  });
}

export async function requireApiKeyScope(
  request: FastifyRequest,
  _reply: FastifyReply,
  dependencies: AppDependencies,
  scopes: ApiKeyScope[]
): Promise<void> {
  dependencies.services.apiKeys.requireScope(request.apiKey, scopes);
}

export async function requireApiKeyScopeIfPresent(
  request: FastifyRequest,
  _reply: FastifyReply,
  dependencies: AppDependencies,
  scopes: ApiKeyScope[]
): Promise<void> {
  if (!request.apiKey) return;
  dependencies.services.apiKeys.requireScope(request.apiKey, scopes);
}
