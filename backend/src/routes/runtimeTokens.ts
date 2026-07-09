import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AppDependencies } from "../app.js";
import { runtimeTokenCapabilities } from "../services/auth/runtimeTokenService.js";

const createRuntimeTokenSchema = z.object({
  appId: z.string().trim().min(1),
  userId: z.string().trim().min(1).max(200),
  origin: z.string().trim().url(),
  capabilities: z.array(z.enum(runtimeTokenCapabilities)).min(1).optional(),
  ttlSeconds: z.number().int().positive().optional(),
  maxUses: z.number().int().positive().optional()
});

export async function registerRuntimeTokenRoutes(app: FastifyInstance, dependencies: AppDependencies): Promise<void> {
  app.post("/api/v1/runtime/tokens", async (request) => {
    const body = createRuntimeTokenSchema.parse(request.body);
    const issuer = request.consoleSession?.role === "admin"
      ? undefined
      : dependencies.services.apiKeys.requireAppBinding(request.apiKey, body.appId);
    return dependencies.services.runtimeTokens.create(body, issuer);
  });

  app.delete("/api/v1/runtime/tokens/:tokenId", async (request) => {
    const params = z.object({ tokenId: z.string().trim().min(1) }).parse(request.params);
    const token = dependencies.repositories.getRuntimeAccessToken(params.tokenId);
    const issuer = request.consoleSession?.role === "admin"
      ? undefined
      : dependencies.services.apiKeys.requireAppBinding(request.apiKey, token.appId);
    return dependencies.services.runtimeTokens.revoke(params.tokenId, issuer);
  });
}
