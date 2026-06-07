import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AppDependencies } from "../app.js";

export async function registerVoiceRoutes(app: FastifyInstance, dependencies: AppDependencies): Promise<void> {
  app.post("/api/v1/tts", async (request) => {
    const body = z.object({ text: z.string().min(1), voice: z.string().optional() }).parse(request.body);
    return dependencies.adapters.tts.synthesize(body);
  });

  app.post("/api/v1/livekit/token", async (request) => {
    const body = z.object({
      appId: z.string(),
      sessionId: z.string(),
      identity: z.string()
    }).parse(request.body);
    return dependencies.adapters.livekit.createSession(body);
  });
}
