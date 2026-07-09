import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AppDependencies } from "../app.js";
import { telemetryModeSchema } from "../schemas/domain.js";
import { requireApiKeyAppAccess, requireApiKeyScope, requireRuntimeCapability, requireRuntimeTokenAppAccess } from "./auth.js";

export async function registerLogRoutes(app: FastifyInstance, dependencies: AppDependencies): Promise<void> {
  app.post("/api/v1/logs/execution", {
    preHandler: (request, reply) => requireRuntimeCapability(request, reply, dependencies, "logs:write")
  }, async (request) => {
    const body = z.object({
      appId: z.string(),
      sessionId: z.string().optional(),
      workflowId: z.string().optional(),
      stepId: z.string().optional(),
      eventType: z.string().min(1),
      payload: z.unknown().optional(),
      telemetry: z.object({
        mode: telemetryModeSchema,
        consent: z.boolean().optional()
      }).optional()
    }).parse(request.body);
    requireRuntimeTokenAppAccess(request, dependencies, body.appId, "logs:write");
    const prepared = dependencies.services.telemetry.prepareExecutionLog({
      appId: body.appId,
      requestedMode: body.telemetry?.mode,
      consent: body.telemetry?.consent,
      payload: body.payload ?? {}
    });
    dependencies.repositories.insertExecutionLog({
      appId: body.appId,
      userId: request.runtimeToken?.userId,
      sessionId: body.sessionId,
      workflowId: body.workflowId,
      stepId: body.stepId,
      eventType: body.eventType,
      telemetryLevel: prepared.telemetryLevel,
      payload: prepared.payload
    });
    return { ok: true };
  });

  app.get("/api/v1/logs", {
    preHandler: (request, reply) => requireApiKeyScope(request, reply, dependencies, ["logs:read"])
  }, async (request) => {
    const query = z.object({
      appId: z.string().optional(),
      workflowId: z.string().optional(),
      sessionId: z.string().optional()
    }).parse(request.query);
    requireApiKeyAppAccess(request, dependencies, query.appId);
    return { items: dependencies.repositories.listExecutionLogs(query) };
  });
}
