import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AppDependencies } from "../app.js";
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
      payload: z.unknown().optional()
    }).parse(request.body);
    requireRuntimeTokenAppAccess(request, dependencies, body.appId, "logs:write");
    dependencies.repositories.insertExecutionLog({ ...body, payload: body.payload ?? {} });
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
