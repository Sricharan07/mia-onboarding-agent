import type { Repositories } from "../../db/repositories.js";
import type { Workflow, WorkflowStep } from "../../schemas/domain.js";
import { workflowSchema, workflowStepSchema } from "../../schemas/domain.js";
import { AppError } from "../../utils/errors.js";
import { nowIso } from "../../utils/id.js";
import type { SemanticSearchAdapter } from "../../adapters/interfaces.js";

export class WorkflowService {
  constructor(
    private readonly repositories: Repositories,
    private readonly moss: SemanticSearchAdapter
  ) {}

  updateWorkflow(workflowId: string, patch: Partial<Workflow>): void {
    const current = this.repositories.getWorkflow(workflowId);
    const next = workflowSchema.parse({
      ...current,
      ...patch,
      workflowId: current.workflowId,
      appId: current.appId,
      status: patch.status ?? (current.status === "published" ? "needs_review" : current.status),
      updatedAt: nowIso()
    });
    this.repositories.saveWorkflow(next);
    this.syncWorkflowJobStatus(next, next.status);
  }

  approveWorkflow(workflowId: string, input: { reviewedBy: string; notes?: string }): Workflow {
    const workflow = this.repositories.getWorkflow(workflowId);
    const next = workflowSchema.parse({
      ...workflow,
      status: "approved",
      review: {
        reviewedBy: input.reviewedBy,
        reviewedAt: nowIso(),
        notes: input.notes
      },
      updatedAt: nowIso()
    });
    this.repositories.saveWorkflow(next);
    this.syncWorkflowJobStatus(next, "approved");
    return next;
  }

  async publishWorkflow(workflowId: string): Promise<Workflow> {
    const workflow = this.repositories.getWorkflow(workflowId);
    if (workflow.status !== "approved") {
      throw new AppError("WORKFLOW_NOT_APPROVED", "Workflow must be approved before publishing.");
    }
    const next = workflowSchema.parse({ ...workflow, status: "published", updatedAt: nowIso() });
    this.repositories.saveWorkflow(next);
    this.syncWorkflowJobStatus(next, "published");
    await this.moss.index({
      id: `workflow_${next.workflowId}`,
      kind: "workflow",
      appId: next.appId,
      searchableText: [
        `Workflow: ${next.name}`,
        `Description: ${next.description}`,
        `Trigger phrases: ${next.triggerPhrases.join(", ")}`,
        `Steps: ${next.steps.map((step) => step.label ?? step.type).join(", ")}`
      ].join("\n"),
      metadata: {
        kind: "workflow",
        appId: next.appId,
        workflowId: next.workflowId,
        name: next.name,
        status: next.status,
        triggerPhrases: next.triggerPhrases,
        routes: next.requiredContext.startingRoutes
      }
    });
    return next;
  }

  archiveWorkflow(workflowId: string): Workflow {
    const workflow = this.repositories.getWorkflow(workflowId);
    const next = workflowSchema.parse({ ...workflow, status: "archived", updatedAt: nowIso() });
    this.repositories.saveWorkflow(next);
    this.syncWorkflowJobStatus(next, "archived");
    return next;
  }

  addStep(workflowId: string, step: WorkflowStep): Workflow {
    const workflow = this.repositories.getWorkflow(workflowId);
    const next = this.validateStepMutation({ ...workflow, steps: [...workflow.steps, workflowStepSchema.parse(step)] });
    this.repositories.saveWorkflow(next);
    this.syncWorkflowJobStatus(next, next.status);
    return next;
  }

  updateStep(workflowId: string, stepId: string, patch: Partial<WorkflowStep>): Workflow {
    const workflow = this.repositories.getWorkflow(workflowId);
    let found = false;
    const steps = workflow.steps.map((step) => {
      if (step.id !== stepId) return step;
      found = true;
      return workflowStepSchema.parse({ ...step, ...patch });
    });
    if (!found) throw new AppError("WORKFLOW_STEP_NOT_FOUND", `Workflow step not found: ${stepId}`, 404);
    const next = this.validateStepMutation({ ...workflow, steps });
    this.repositories.saveWorkflow(next);
    this.syncWorkflowJobStatus(next, next.status);
    return next;
  }

  deleteStep(workflowId: string, stepId: string): Workflow {
    const workflow = this.repositories.getWorkflow(workflowId);
    const steps = workflow.steps.filter((step) => step.id !== stepId);
    if (steps.length === workflow.steps.length) throw new AppError("WORKFLOW_STEP_NOT_FOUND", `Workflow step not found: ${stepId}`, 404);
    const next = this.validateStepMutation({ ...workflow, steps });
    this.repositories.saveWorkflow(next);
    this.syncWorkflowJobStatus(next, next.status);
    return next;
  }

  reorderSteps(workflowId: string, stepIds: string[]): Workflow {
    const workflow = this.repositories.getWorkflow(workflowId);
    const uniqueIds = new Set(stepIds);
    const currentById = new Map(workflow.steps.map((step) => [step.id, step]));
    if (uniqueIds.size !== workflow.steps.length || stepIds.length !== workflow.steps.length || stepIds.some((stepId) => !currentById.has(stepId))) {
      throw new AppError("INVALID_WORKFLOW_STEP_ORDER", "Step order must include every existing step exactly once.", 400);
    }
    const next = this.validateStepMutation({ ...workflow, steps: stepIds.map((stepId) => currentById.get(stepId)!) });
    this.repositories.saveWorkflow(next);
    this.syncWorkflowJobStatus(next, next.status);
    return next;
  }

  private validateStepMutation(workflow: Workflow): Workflow {
    return workflowSchema.parse({
      ...workflow,
      status: workflow.status === "published" ? "needs_review" : workflow.status,
      updatedAt: nowIso()
    });
  }

  private syncWorkflowJobStatus(workflow: Workflow, status: string): void {
    const jobId = workflow.createdFrom?.jobId;
    if (!jobId) return;
    this.repositories.updateWorkflowJob(jobId, { status, error: null });
  }
}
