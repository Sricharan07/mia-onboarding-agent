import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AppDependencies } from "../app.js";
import { requireApiKeyAppAccess, requireApiKeyScope } from "./auth.js";

export async function registerGeminiRoutes(app: FastifyInstance, dependencies: AppDependencies): Promise<void> {
  app.post("/api/v1/gemini/live-token", {
    preHandler: (request, reply) => requireApiKeyScope(request, reply, dependencies, ["runtime:write"])
  }, async (request) => {
    const body = z.object({
      appId: z.string().min(1),
      clientSessionId: z.string().min(1)
    }).parse(request.body);
    requireApiKeyAppAccess(request, dependencies, body.appId);
    return dependencies.services.geminiLiveTokens.create(body);
  });
}
