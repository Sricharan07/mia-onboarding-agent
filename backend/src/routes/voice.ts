import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AppDependencies } from "../app.js";
import { requireRuntimeCapability, requireRuntimeTokenAppAccess } from "./auth.js";

export async function registerVoiceRoutes(app: FastifyInstance, dependencies: AppDependencies): Promise<void> {
  app.post("/api/v1/tts", {
    preHandler: (request, reply) => requireRuntimeCapability(request, reply, dependencies, "voice:tts")
  }, async (request) => {
    const body = z.object({ appId: z.string().min(1), text: z.string().min(1), voice: z.string().optional() }).parse(request.body);
    requireRuntimeTokenAppAccess(request, dependencies, body.appId, "voice:tts");
    return dependencies.adapters.tts.synthesize(body);
  });

  app.post("/api/v1/livekit/token", {
    preHandler: (request, reply) => requireRuntimeCapability(request, reply, dependencies, "voice:livekit")
  }, async (request) => {
    const body = z.object({
      appId: z.string(),
      sessionId: z.string()
    }).parse(request.body);
    requireRuntimeTokenAppAccess(request, dependencies, body.appId, "voice:livekit");
    return dependencies.adapters.livekit.createSession({
      ...body,
      identity: `mia-${request.runtimeToken?.userId ?? "console"}`
    });
  });
}
