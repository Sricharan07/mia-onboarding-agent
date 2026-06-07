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
    const next = workflowSchema.parse({ ...current, ...patch, workflowId: current.workflowId, appId: current.appId, updatedAt: nowIso() });
    this.repositories.saveWorkflow(next);
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
    return next;
  }

  async publishWorkflow(workflowId: string): Promise<Workflow> {
    const workflow = this.repositories.getWorkflow(workflowId);
    if (workflow.status !== "approved") {
      throw new AppError("WORKFLOW_NOT_APPROVED", "Workflow must be approved before publishing.");
    }
    this.assertPublishable(workflow);
    const next = workflowSchema.parse({ ...workflow, status: "published", updatedAt: nowIso() });
    this.repositories.saveWorkflow(next);
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
    return next;
  }

  addStep(workflowId: string, step: WorkflowStep): Workflow {
    const workflow = this.repositories.getWorkflow(workflowId);
    const next = this.validateStepMutation({ ...workflow, steps: [...workflow.steps, workflowStepSchema.parse(step)] });
    this.repositories.saveWorkflow(next);
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
    return next;
  }

  deleteStep(workflowId: string, stepId: string): Workflow {
    const workflow = this.repositories.getWorkflow(workflowId);
    const steps = workflow.steps.filter((step) => step.id !== stepId);
    if (steps.length === workflow.steps.length) throw new AppError("WORKFLOW_STEP_NOT_FOUND", `Workflow step not found: ${stepId}`, 404);
    const next = this.validateStepMutation({ ...workflow, steps });
    this.repositories.saveWorkflow(next);
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
    return next;
  }

  private validateStepMutation(workflow: Workflow): Workflow {
    return workflowSchema.parse({
      ...workflow,
      status: workflow.status === "published" ? "needs_review" : workflow.status,
      updatedAt: nowIso()
    });
  }

  private assertPublishable(workflow: Workflow): void {
    const issues: string[] = [];

    for (const step of workflow.steps) {
      if (!isExecutableTargetStep(step) || step.executionPolicy !== "auto") continue;
      const selectors = [step.target.selector, ...(step.target.fallbackSelectors ?? [])];
      if (!selectors.some(isStableEnoughSelector)) {
        issues.push(`${step.type} step "${step.id}" targets "${step.target.elementId}" with only brittle selectors.`);
      }
    }

    if (issues.length) {
      throw new AppError("WORKFLOW_SELECTOR_NOT_PUBLISHABLE", "Workflow has auto steps with brittle selectors. Re-scan the UI map or edit the target selector before publishing.", 400, { issues });
    }
  }
}

function isExecutableTargetStep(step: WorkflowStep): step is Extract<WorkflowStep, { type: "click" | "focus" | "fill" | "select" }> {
  return step.type === "click" || step.type === "focus" || step.type === "fill" || step.type === "select";
}

function isStableEnoughSelector(selector: string): boolean {
  const trimmed = selector.trim();
  if (!trimmed) return false;
  if (trimmed.includes(":nth-of-type") || trimmed.includes(":nth-child")) return false;
  if (/^[a-z][a-z0-9-]*$/i.test(trimmed)) return false;
  return true;
}
