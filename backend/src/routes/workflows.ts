import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AppDependencies } from "../app.js";
import { workflowStepSchema } from "../schemas/domain.js";
import { ValidationAppError } from "../utils/errors.js";
import { requireApiKeyAppAccess, requireApiKeyScope } from "./auth.js";

const workflowUpdateSchema = z.object({
  name: z.string().trim().min(1).optional(),
  description: z.string().trim().min(1).optional(),
  triggerPhrases: z.array(z.string().trim().min(1)).min(1).optional()
}).strict();

const workflowVideoMetadataSchema = z.object({
  name: z.string().trim().min(1).optional(),
  description: z.string().trim().min(1).optional()
});

export async function registerWorkflowRoutes(app: FastifyInstance, dependencies: AppDependencies): Promise<void> {
  app.post("/api/v1/apps/:appId/workflow-videos", {
    preHandler: (request, reply) => requireApiKeyScope(request, reply, dependencies, ["admin"])
  }, async (request) => {
    const params = z.object({ appId: z.string() }).parse(request.params);
    const metadata: Record<string, string> = {};
    let file: { buffer: Buffer; filename: string; mimetype: string } | undefined;

    for await (const part of request.parts()) {
      if (part.type === "file") {
        const buffer = await part.toBuffer();
        file ??= { buffer, filename: part.filename, mimetype: part.mimetype };
        continue;
      }

      if (part.fieldname === "name" || part.fieldname === "description") {
        metadata[part.fieldname] = typeof part.value === "string" ? part.value : String(part.value ?? "");
      }
    }

    if (!file) {
      throw new ValidationAppError("Workflow video file is required.");
    }
    const parsedMetadata = workflowVideoMetadataSchema.parse(metadata);
    const saved = await dependencies.adapters.storage.saveBuffer({
      buffer: file.buffer,
      filename: file.filename,
      directory: dependencies.config.LOCAL_UPLOAD_DIR
    });
    return dependencies.repositories.createWorkflowVideo({
      appId: params.appId,
      filename: file.filename,
      localPath: saved.path,
      mimeType: file.mimetype,
      sizeBytes: saved.sizeBytes,
      workflowName: parsedMetadata.name,
      workflowDescription: parsedMetadata.description
    });
  });

  app.get("/api/v1/apps/:appId/workflow-jobs", {
    preHandler: (request, reply) => requireApiKeyScope(request, reply, dependencies, ["workflows:read"])
  }, async (request) => {
    const params = z.object({ appId: z.string() }).parse(request.params);
    requireApiKeyAppAccess(request, dependencies, params.appId);
    return { items: dependencies.repositories.listWorkflowJobs(params.appId) };
  });

  app.get("/api/v1/workflow-jobs/:jobId", {
    preHandler: (request, reply) => requireApiKeyScope(request, reply, dependencies, ["workflows:read"])
  }, async (request) => {
    const params = z.object({ jobId: z.string() }).parse(request.params);
    const job = dependencies.repositories.getWorkflowJob(params.jobId);
    requireApiKeyAppAccess(request, dependencies, String(job.app_id));
    return {
      id: job.id,
      appId: job.app_id,
      videoId: job.video_id,
      status: job.status,
      error: job.error ?? null
    };
  });

  app.post("/api/v1/workflow-jobs/:jobId/process", {
    preHandler: (request, reply) => requireApiKeyScope(request, reply, dependencies, ["admin"])
  }, async (request) => {
    const params = z.object({ jobId: z.string() }).parse(request.params);
    return dependencies.services.videoProcessing.startJob(params.jobId, (error) => request.log.error(error));
  });

  app.get("/api/v1/apps/:appId/workflows", {
    preHandler: (request, reply) => requireApiKeyScope(request, reply, dependencies, ["workflows:read"])
  }, async (request) => {
    const params = z.object({ appId: z.string() }).parse(request.params);
    const query = z.object({ status: z.string().optional() }).parse(request.query);
    requireApiKeyAppAccess(request, dependencies, params.appId);
    return { items: dependencies.repositories.listWorkflows(params.appId, query.status) };
  });

  app.get("/api/v1/workflows/:workflowId", {
    preHandler: (request, reply) => requireApiKeyScope(request, reply, dependencies, ["workflows:read"])
  }, async (request) => {
    const params = z.object({ workflowId: z.string() }).parse(request.params);
    const workflow = dependencies.repositories.getWorkflow(params.workflowId);
    requireApiKeyAppAccess(request, dependencies, workflow.appId);
    return workflow;
  });

  app.patch("/api/v1/workflows/:workflowId", {
    preHandler: (request, reply) => requireApiKeyScope(request, reply, dependencies, ["admin"])
  }, async (request) => {
    const params = z.object({ workflowId: z.string() }).parse(request.params);
    const body = workflowUpdateSchema.parse(request.body);
    await dependencies.services.workflow.updateWorkflow(params.workflowId, body);
    return { ok: true };
  });

  app.post("/api/v1/workflows/:workflowId/approve", {
    preHandler: (request, reply) => requireApiKeyScope(request, reply, dependencies, ["admin"])
  }, async (request) => {
    const params = z.object({ workflowId: z.string() }).parse(request.params);
    const body = z.object({ reviewedBy: z.string().min(1), notes: z.string().optional() }).parse(request.body);
    const workflow = await dependencies.services.workflow.approveWorkflow(params.workflowId, body);
    return { workflowId: workflow.workflowId, status: workflow.status };
  });

  app.post("/api/v1/workflows/:workflowId/publish", {
    preHandler: (request, reply) => requireApiKeyScope(request, reply, dependencies, ["admin"])
  }, async (request) => {
    const params = z.object({ workflowId: z.string() }).parse(request.params);
    const workflow = await dependencies.services.workflow.publishWorkflow(params.workflowId);
    return { workflowId: workflow.workflowId, status: workflow.status };
  });

  app.post("/api/v1/workflows/:workflowId/archive", {
    preHandler: (request, reply) => requireApiKeyScope(request, reply, dependencies, ["admin"])
  }, async (request) => {
    const params = z.object({ workflowId: z.string() }).parse(request.params);
    const workflow = await dependencies.services.workflow.archiveWorkflow(params.workflowId);
    return { workflowId: workflow.workflowId, status: workflow.status };
  });

  app.post("/api/v1/workflows/:workflowId/steps", {
    preHandler: (request, reply) => requireApiKeyScope(request, reply, dependencies, ["admin"])
  }, async (request) => {
    const params = z.object({ workflowId: z.string() }).parse(request.params);
    const body = workflowStepSchema.parse(request.body);
    return await dependencies.services.workflow.addStep(params.workflowId, body);
  });

  app.patch("/api/v1/workflows/:workflowId/steps/:stepId", {
    preHandler: (request, reply) => requireApiKeyScope(request, reply, dependencies, ["admin"])
  }, async (request) => {
    const params = z.object({ workflowId: z.string(), stepId: z.string() }).parse(request.params);
    const body = z.record(z.string(), z.unknown()).parse(request.body);
    return await dependencies.services.workflow.updateStep(params.workflowId, params.stepId, body);
  });

  app.delete("/api/v1/workflows/:workflowId/steps/:stepId", {
    preHandler: (request, reply) => requireApiKeyScope(request, reply, dependencies, ["admin"])
  }, async (request) => {
    const params = z.object({ workflowId: z.string(), stepId: z.string() }).parse(request.params);
    return await dependencies.services.workflow.deleteStep(params.workflowId, params.stepId);
  });

  app.post("/api/v1/workflows/:workflowId/steps/reorder", {
    preHandler: (request, reply) => requireApiKeyScope(request, reply, dependencies, ["admin"])
  }, async (request) => {
    const params = z.object({ workflowId: z.string() }).parse(request.params);
    const body = z.object({ stepIds: z.array(z.string()).min(1) }).parse(request.body);
    return await dependencies.services.workflow.reorderSteps(params.workflowId, body.stepIds);
  });
}
