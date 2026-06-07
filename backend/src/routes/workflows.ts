import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AppDependencies } from "../app.js";
import { workflowSchema, workflowStepSchema } from "../schemas/domain.js";
import { ValidationAppError } from "../utils/errors.js";
import { requireApiKeyScopeIfPresent } from "./auth.js";

export async function registerWorkflowRoutes(app: FastifyInstance, dependencies: AppDependencies): Promise<void> {
  app.post("/api/v1/apps/:appId/workflow-videos", async (request) => {
    const params = z.object({ appId: z.string() }).parse(request.params);
    const file = await request.file();
    if (!file) {
      throw new ValidationAppError("Workflow video file is required.");
    }
    const buffer = await file.toBuffer();
    const saved = await dependencies.adapters.storage.saveBuffer({
      buffer,
      filename: file.filename,
      directory: dependencies.config.LOCAL_UPLOAD_DIR
    });
    return dependencies.repositories.createWorkflowVideo({
      appId: params.appId,
      filename: file.filename,
      localPath: saved.path,
      mimeType: file.mimetype,
      sizeBytes: saved.sizeBytes
    });
  });

  app.get("/api/v1/apps/:appId/workflow-jobs", {
    preHandler: (request, reply) => requireApiKeyScopeIfPresent(request, reply, dependencies, ["workflows:read"])
  }, async (request) => {
    const params = z.object({ appId: z.string() }).parse(request.params);
    return { items: dependencies.repositories.listWorkflowJobs(params.appId) };
  });

  app.get("/api/v1/workflow-jobs/:jobId", {
    preHandler: (request, reply) => requireApiKeyScopeIfPresent(request, reply, dependencies, ["workflows:read"])
  }, async (request) => {
    const params = z.object({ jobId: z.string() }).parse(request.params);
    const job = dependencies.repositories.getWorkflowJob(params.jobId);
    const metadata = dependencies.repositories.getWorkflowMetadataByJobId(String(job.app_id), params.jobId);
    return {
      id: job.id,
      appId: job.app_id,
      videoId: job.video_id,
      status: metadata.workflowStatus ?? job.status,
      error: job.error ?? null
    };
  });

  app.post("/api/v1/workflow-jobs/:jobId/process", async (request) => {
    const params = z.object({ jobId: z.string() }).parse(request.params);
    void dependencies.services.videoProcessing.processJob(params.jobId).catch((error) => {
      request.log.error(error);
    });
    return { jobId: params.jobId, status: "analyzing" };
  });

  app.get("/api/v1/apps/:appId/workflows", {
    preHandler: (request, reply) => requireApiKeyScopeIfPresent(request, reply, dependencies, ["workflows:read"])
  }, async (request) => {
    const params = z.object({ appId: z.string() }).parse(request.params);
    const query = z.object({ status: z.string().optional() }).parse(request.query);
    return { items: dependencies.repositories.listWorkflows(params.appId, query.status) };
  });

  app.get("/api/v1/workflows/:workflowId", {
    preHandler: (request, reply) => requireApiKeyScopeIfPresent(request, reply, dependencies, ["workflows:read"])
  }, async (request) => {
    const params = z.object({ workflowId: z.string() }).parse(request.params);
    return dependencies.repositories.getWorkflow(params.workflowId);
  });

  app.patch("/api/v1/workflows/:workflowId", async (request) => {
    const params = z.object({ workflowId: z.string() }).parse(request.params);
    const body = workflowSchema.partial().parse(request.body);
    dependencies.services.workflow.updateWorkflow(params.workflowId, body);
    return { ok: true };
  });

  app.post("/api/v1/workflows/:workflowId/approve", async (request) => {
    const params = z.object({ workflowId: z.string() }).parse(request.params);
    const body = z.object({ reviewedBy: z.string().min(1), notes: z.string().optional() }).parse(request.body);
    const workflow = dependencies.services.workflow.approveWorkflow(params.workflowId, body);
    return { workflowId: workflow.workflowId, status: workflow.status };
  });

  app.post("/api/v1/workflows/:workflowId/publish", async (request) => {
    const params = z.object({ workflowId: z.string() }).parse(request.params);
    const workflow = await dependencies.services.workflow.publishWorkflow(params.workflowId);
    return { workflowId: workflow.workflowId, status: workflow.status };
  });

  app.post("/api/v1/workflows/:workflowId/archive", async (request) => {
    const params = z.object({ workflowId: z.string() }).parse(request.params);
    const workflow = dependencies.services.workflow.archiveWorkflow(params.workflowId);
    return { workflowId: workflow.workflowId, status: workflow.status };
  });

  app.post("/api/v1/workflows/:workflowId/steps", async (request) => {
    const params = z.object({ workflowId: z.string() }).parse(request.params);
    const body = workflowStepSchema.parse(request.body);
    return dependencies.services.workflow.addStep(params.workflowId, body);
  });

  app.patch("/api/v1/workflows/:workflowId/steps/:stepId", async (request) => {
    const params = z.object({ workflowId: z.string(), stepId: z.string() }).parse(request.params);
    const body = z.record(z.string(), z.unknown()).parse(request.body);
    return dependencies.services.workflow.updateStep(params.workflowId, params.stepId, body);
  });

  app.delete("/api/v1/workflows/:workflowId/steps/:stepId", async (request) => {
    const params = z.object({ workflowId: z.string(), stepId: z.string() }).parse(request.params);
    return dependencies.services.workflow.deleteStep(params.workflowId, params.stepId);
  });

  app.post("/api/v1/workflows/:workflowId/steps/reorder", async (request) => {
    const params = z.object({ workflowId: z.string() }).parse(request.params);
    const body = z.object({ stepIds: z.array(z.string()).min(1) }).parse(request.body);
    return dependencies.services.workflow.reorderSteps(params.workflowId, body.stepIds);
  });
}
