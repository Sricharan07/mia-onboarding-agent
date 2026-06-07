import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AppDependencies } from "../app.js";
import { sdkRuntimeContextSchema } from "../schemas/domain.js";
import { requireApiKeyScope } from "./auth.js";

export async function registerVoiceSessionRoutes(app: FastifyInstance, dependencies: AppDependencies): Promise<void> {
  app.get("/api/v1/voice/sessions", {
    preHandler: (request, reply) => requireApiKeyScope(request, reply, dependencies, ["runtime:write"])
  }, async () => dependencies.services.voiceSessions.listDebug());

  app.post("/api/v1/voice/sessions", {
    preHandler: (request, reply) => requireApiKeyScope(request, reply, dependencies, ["runtime:write"])
  }, async (request) => {
    const body = z.object({
      appId: z.string().min(1),
      clientSessionId: z.string().min(1),
      identity: z.string().min(1),
      context: sdkRuntimeContextSchema.omit({ appId: true, sessionId: true }),
      userMetadata: z.record(z.string(), z.unknown()).optional()
    }).parse(request.body);
    return dependencies.services.voiceSessions.create(body);
  });

  app.get("/api/v1/voice/sessions/:voiceSessionId/events", {
    preHandler: (request, reply) => requireApiKeyScope(request, reply, dependencies, ["runtime:write"])
  }, async (request, reply) => {
    const params = z.object({ voiceSessionId: z.string().min(1) }).parse(request.params);
    const origin = typeof request.headers.origin === "string" ? request.headers.origin : "*";
    reply.hijack();
    reply.raw.writeHead(200, {
      "content-type": "application/x-ndjson; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
      "access-control-allow-origin": origin,
      vary: "origin"
    });
    const unsubscribe = dependencies.services.voiceSessions.subscribe(params.voiceSessionId, (event) => {
      reply.raw.write(`${JSON.stringify(event)}\n`);
    });
    request.raw.on("close", unsubscribe);
  });

  app.post("/api/v1/voice/sessions/:voiceSessionId/resolve", {
    preHandler: (request, reply) => requireApiKeyScope(request, reply, dependencies, ["runtime:write"])
  }, async (request) => {
    const params = z.object({ voiceSessionId: z.string().min(1) }).parse(request.params);
    const body = z.object({
      utterance: z.string().min(1)
    }).parse(request.body);
    return dependencies.services.voiceSessions.resolveUtterance(params.voiceSessionId, body);
  });

  app.post("/api/v1/voice/sessions/:voiceSessionId/transcript", {
    preHandler: (request, reply) => requireApiKeyScope(request, reply, dependencies, ["runtime:write"])
  }, async (request) => {
    const params = z.object({ voiceSessionId: z.string().min(1) }).parse(request.params);
    const body = z.object({
      text: z.string().min(1)
    }).parse(request.body);
    return dependencies.services.voiceSessions.recordTranscript(params.voiceSessionId, body);
  });

  app.post("/api/v1/voice/sessions/:voiceSessionId/input-capture", {
    preHandler: (request, reply) => requireApiKeyScope(request, reply, dependencies, ["runtime:write"])
  }, async (request) => {
    const params = z.object({ voiceSessionId: z.string().min(1) }).parse(request.params);
    const body = z.object({
      prompt: z.string().min(1)
    }).parse(request.body);
    return dependencies.services.voiceSessions.beginInputCapture(params.voiceSessionId, body);
  });

  app.delete("/api/v1/voice/sessions/:voiceSessionId/input-capture", {
    preHandler: (request, reply) => requireApiKeyScope(request, reply, dependencies, ["runtime:write"])
  }, async (request) => {
    const params = z.object({ voiceSessionId: z.string().min(1) }).parse(request.params);
    return dependencies.services.voiceSessions.endInputCapture(params.voiceSessionId);
  });

  app.post("/api/v1/voice/sessions/:voiceSessionId/end", {
    preHandler: (request, reply) => requireApiKeyScope(request, reply, dependencies, ["runtime:write"])
  }, async (request) => {
    const params = z.object({ voiceSessionId: z.string().min(1) }).parse(request.params);
    return dependencies.services.voiceSessions.end(params.voiceSessionId);
  });
}
