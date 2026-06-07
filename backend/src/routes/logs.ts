import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AppDependencies } from "../app.js";

export async function registerLogRoutes(app: FastifyInstance, dependencies: AppDependencies): Promise<void> {
  app.post("/api/v1/logs/execution", async (request) => {
    const body = z.object({
      appId: z.string().optional(),
      sessionId: z.string().optional(),
      workflowId: z.string().optional(),
      stepId: z.string().optional(),
      eventType: z.string().min(1),
      payload: z.unknown().optional()
    }).parse(request.body);
    dependencies.repositories.insertExecutionLog({ ...body, payload: body.payload ?? {} });
    return { ok: true };
  });

  app.get("/api/v1/logs", async (request) => {
    const query = z.object({
      appId: z.string().optional(),
      workflowId: z.string().optional(),
      sessionId: z.string().optional()
    }).parse(request.query);
    return { items: dependencies.repositories.listExecutionLogs(query) };
  });
}
