import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AppDependencies } from "../app.js";
import { sdkRuntimeContextSchema } from "../schemas/domain.js";
import { AppError } from "../utils/errors.js";
import { requireApiKeyAppAccess, requireApiKeyScope } from "./auth.js";

export async function registerRuntimeRoutes(app: FastifyInstance, dependencies: AppDependencies): Promise<void> {
  app.post("/api/v1/runtime/resolve", {
    preHandler: (request, reply) => requireApiKeyScope(request, reply, dependencies, ["runtime:write"])
  }, async (request) => {
    const body = z.object({
      appId: z.string(),
      sessionId: z.string(),
      utterance: z.string().min(1),
      includeTts: z.boolean().optional(),
      context: sdkRuntimeContextSchema.omit({ appId: true, sessionId: true })
    }).parse(request.body);
    requireApiKeyAppAccess(request, dependencies, body.appId);
    return dependencies.services.runtime.resolve(body);
  });

  app.post("/api/v1/runtime/workflow-sessions", {
    preHandler: (request, reply) => requireApiKeyScope(request, reply, dependencies, ["runtime:write"])
  }, async (request) => {
    const body = z.object({
      appId: z.string(),
      workflowId: z.string(),
      clientSessionId: z.string().optional(),
      userId: z.string().optional()
    }).parse(request.body);
    requireApiKeyAppAccess(request, dependencies, body.appId);
    const workflow = dependencies.repositories.getWorkflow(body.workflowId);
    if (workflow.appId !== body.appId) {
      throw new AppError("WORKFLOW_APP_MISMATCH", "Workflow does not belong to the requested app.", 403);
    }
    if (workflow.status !== "published") {
      throw new AppError("WORKFLOW_NOT_PUBLISHED", "Only published workflows can create runtime sessions.", 403);
    }
    return dependencies.repositories.createRuntimeSession(body);
  });

  app.patch("/api/v1/runtime/workflow-sessions/:runtimeSessionId", {
    preHandler: (request, reply) => requireApiKeyScope(request, reply, dependencies, ["runtime:write"])
  }, async (request) => {
    const params = z.object({ runtimeSessionId: z.string() }).parse(request.params);
    const body = z.object({
      status: z.enum(["pending", "running", "paused", "completed", "cancelled", "failed"]),
      currentStepId: z.string().optional(),
      values: z.record(z.string(), z.unknown()).optional(),
      error: z.string().optional()
    }).parse(request.body);
    const session = dependencies.repositories.getRuntimeSession(params.runtimeSessionId);
    requireApiKeyAppAccess(request, dependencies, session.appId);
    dependencies.repositories.updateRuntimeSession(params.runtimeSessionId, body);
    return { ok: true };
  });
}
