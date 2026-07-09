import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AppDependencies } from "../app.js";
import { sdkRuntimeContextSchema } from "../schemas/domain.js";
import { AppError } from "../utils/errors.js";
import { requireRuntimeCapability, requireRuntimeTokenAppAccess } from "./auth.js";

export async function registerRuntimeRoutes(app: FastifyInstance, dependencies: AppDependencies): Promise<void> {
  app.post("/api/v1/runtime/resolve", {
    preHandler: (request, reply) => requireRuntimeCapability(request, reply, dependencies, "runtime:resolve")
  }, async (request) => {
    const body = z.object({
      appId: z.string(),
      sessionId: z.string(),
      utterance: z.string().min(1),
      includeTts: z.boolean().optional(),
      context: sdkRuntimeContextSchema.omit({ appId: true, sessionId: true })
    }).parse(request.body);
    requireRuntimeTokenAppAccess(request, dependencies, body.appId, "runtime:resolve");
    return dependencies.services.runtime.resolve(body);
  });

  app.post("/api/v1/runtime/workflow-sessions", {
    preHandler: (request, reply) => requireRuntimeCapability(request, reply, dependencies, "runtime:workflow")
  }, async (request) => {
    const body = z.object({
      appId: z.string(),
      workflowId: z.string(),
      clientSessionId: z.string().optional(),
      userId: z.string().optional()
    }).parse(request.body);
    requireRuntimeTokenAppAccess(request, dependencies, body.appId, "runtime:workflow");
    const workflow = dependencies.repositories.getWorkflow(body.workflowId);
    if (workflow.appId !== body.appId) {
      throw new AppError("WORKFLOW_APP_MISMATCH", "Workflow does not belong to the requested app.", 403);
    }
    if (workflow.status !== "published") {
      throw new AppError("WORKFLOW_NOT_PUBLISHED", "Only published workflows can create runtime sessions.", 403);
    }
    return dependencies.repositories.createRuntimeSession({
      ...body,
      userId: request.runtimeToken?.userId ?? body.userId
    });
  });

  app.patch("/api/v1/runtime/workflow-sessions/:runtimeSessionId", {
    preHandler: (request, reply) => requireRuntimeCapability(request, reply, dependencies, "runtime:workflow")
  }, async (request) => {
    const params = z.object({ runtimeSessionId: z.string() }).parse(request.params);
    const body = z.object({
      status: z.enum(["pending", "running", "paused", "completed", "cancelled", "failed"]),
      currentStepId: z.string().optional(),
      error: z.string().optional()
    }).strict().parse(request.body);
    const session = dependencies.repositories.getRuntimeSession(params.runtimeSessionId);
    requireRuntimeTokenAppAccess(request, dependencies, session.appId, "runtime:workflow");
    if (request.runtimeToken && session.userId !== request.runtimeToken.userId) {
      throw new AppError("RUNTIME_SESSION_USER_FORBIDDEN", "Runtime session belongs to another user.", 403);
    }
    dependencies.repositories.updateRuntimeSession(params.runtimeSessionId, body);
    return { ok: true };
  });
}
