import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { AppDependencies } from "../app.js";
import type { ApiKeyScope } from "../db/repositories.js";
import type { RuntimeTokenCapability } from "../db/repositories.js";
import { type AuthenticatedApiKey, extractApiKey } from "../services/auth/apiKeyService.js";
import { type AuthenticatedConsoleSession, extractConsoleSessionToken } from "../services/auth/consoleAuthService.js";
import { type AuthenticatedRuntimeToken, extractRuntimeToken } from "../services/auth/runtimeTokenService.js";

declare module "fastify" {
  interface FastifyRequest {
    apiKey?: AuthenticatedApiKey;
    consoleSession?: AuthenticatedConsoleSession;
    runtimeToken?: AuthenticatedRuntimeToken;
  }
}

export function registerApiKeyHook(app: FastifyInstance, dependencies: AppDependencies): void {
  app.addHook("preHandler", async (request) => {
    const rawConsoleToken = extractConsoleSessionToken(request.headers);
    if (rawConsoleToken) {
      request.consoleSession = dependencies.services.consoleAuth.authenticate(rawConsoleToken);
    }

    const rawKey = extractApiKey(request.headers);
    if (rawKey) request.apiKey = dependencies.services.apiKeys.authenticate(rawKey);

    const rawRuntimeToken = extractRuntimeToken(request.headers);
    if (rawRuntimeToken) {
      request.runtimeToken = dependencies.services.runtimeTokens.authenticate(rawRuntimeToken, request.headers);
    }
  });
}

export async function requireRuntimeCapability(
  request: FastifyRequest,
  _reply: FastifyReply,
  dependencies: AppDependencies,
  capability: RuntimeTokenCapability
): Promise<void> {
  if (request.consoleSession?.role === "admin") return;
  dependencies.services.runtimeTokens.requireCapability(request.runtimeToken, capability);
}

export function requireRuntimeTokenAppAccess(
  request: FastifyRequest,
  dependencies: AppDependencies,
  appId: string,
  capability: RuntimeTokenCapability
): void {
  dependencies.repositories.getActiveApp(appId);
  if (request.consoleSession?.role === "admin") return;
  const token = dependencies.services.runtimeTokens.requireCapability(request.runtimeToken, capability);
  dependencies.services.runtimeTokens.requireAppAccess(token, appId);
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
  if (appId) dependencies.repositories.getActiveApp(appId);
  if (request.consoleSession?.role === "admin") return;
  dependencies.services.apiKeys.requireAppAccess(request.apiKey, appId, {
    origin: request.headers.origin,
    referer: request.headers.referer
  });
}
