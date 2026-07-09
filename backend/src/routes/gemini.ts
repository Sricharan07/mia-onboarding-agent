import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AppDependencies } from "../app.js";
import { requireRuntimeCapability, requireRuntimeTokenAppAccess } from "./auth.js";

export async function registerGeminiRoutes(app: FastifyInstance, dependencies: AppDependencies): Promise<void> {
  app.post("/api/v1/gemini/live-token", {
    preHandler: (request, reply) => requireRuntimeCapability(request, reply, dependencies, "voice:live")
  }, async (request) => {
    const body = z.object({
      appId: z.string().min(1),
      clientSessionId: z.string().min(1)
    }).parse(request.body);
    requireRuntimeTokenAppAccess(request, dependencies, body.appId, "voice:live");
    return dependencies.services.geminiLiveTokens.create(body);
  });
}
