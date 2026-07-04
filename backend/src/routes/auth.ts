import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { AppDependencies } from "../app.js";
import type { ApiKeyScope } from "../db/repositories.js";
import { type AuthenticatedApiKey, extractApiKey } from "../services/auth/apiKeyService.js";
import { type AuthenticatedConsoleSession, extractConsoleSessionToken } from "../services/auth/consoleAuthService.js";

declare module "fastify" {
  interface FastifyRequest {
    apiKey?: AuthenticatedApiKey;
    consoleSession?: AuthenticatedConsoleSession;
  }
}

export function registerApiKeyHook(app: FastifyInstance, dependencies: AppDependencies): void {
  app.addHook("preHandler", async (request) => {
    const rawConsoleToken = extractConsoleSessionToken(request.headers);
    if (rawConsoleToken) {
      request.consoleSession = dependencies.services.consoleAuth.authenticate(rawConsoleToken);
    }

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
  if (request.consoleSession?.role === "admin") return;
  dependencies.services.apiKeys.requireScope(request.apiKey, scopes);
}

export function requireApiKeyAppAccess(request: FastifyRequest, dependencies: AppDependencies, appId: string | undefined): void {
  if (request.consoleSession?.role === "admin") return;
  dependencies.services.apiKeys.requireAppAccess(request.apiKey, appId, {
    origin: request.headers.origin,
    referer: request.headers.referer
  });
}
