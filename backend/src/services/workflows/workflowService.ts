import type { Repositories } from "../../db/repositories.js";
import type { Workflow, WorkflowStep } from "../../schemas/domain.js";
import { workflowSchema, workflowStepSchema } from "../../schemas/domain.js";
import { AppError } from "../../utils/errors.js";
import { nowIso } from "../../utils/id.js";
import type { SemanticSearchAdapter } from "../../adapters/interfaces.js";
import { workflowToSemanticRecord } from "../semantic/semanticRecords.js";

const workflowJobStatuses = new Set(["needs_review", "approved", "published", "archived"]);

export type WorkflowReviewIssue = {
  id: string;
  severity: "blocker" | "warning" | "info";
  label: string;
  message: string;
  stepId?: string;
  fix?: string;
};

export type WorkflowReviewReport = {
  workflowId: string;
  publishable: boolean;
  blockerCount: number;
  warningCount: number;
  issues: WorkflowReviewIssue[];
};

export class WorkflowService {
  constructor(
    private readonly repositories: Repositories,
    private readonly semanticSearch: SemanticSearchAdapter
  ) {}

  async updateWorkflow(workflowId: string, patch: Partial<Workflow>): Promise<void> {
    const current = this.repositories.getWorkflow(workflowId);
    const next = workflowSchema.parse({ ...current, ...patch, workflowId: current.workflowId, appId: current.appId, updatedAt: nowIso() });
    await this.saveWorkflow(next);
  }

  async approveWorkflow(workflowId: string, input: { reviewedBy: string; notes?: string }): Promise<Workflow> {
    const workflow = this.repositories.getWorkflow(workflowId);
    this.assertReviewClean(workflow);
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
    await this.saveWorkflow(next);
    return next;
  }

  async publishWorkflow(workflowId: string): Promise<Workflow> {
    const workflow = this.repositories.getWorkflow(workflowId);
    if (workflow.status !== "approved") {
      throw new AppError("WORKFLOW_NOT_APPROVED", "Workflow must be approved before publishing.");
    }
    this.assertReviewClean(workflow);
    const next = workflowSchema.parse({ ...workflow, status: "published", updatedAt: nowIso() });
    await this.saveWorkflow(next);
    return next;
  }

  reviewWorkflow(workflowId: string): WorkflowReviewReport {
    return this.buildReviewReport(this.repositories.getWorkflow(workflowId));
  }

  async archiveWorkflow(workflowId: string): Promise<Workflow> {
    const workflow = this.repositories.getWorkflow(workflowId);
    const next = workflowSchema.parse({ ...workflow, status: "archived", updatedAt: nowIso() });
    await this.saveWorkflow(next);
    return next;
  }

  async addStep(workflowId: string, step: WorkflowStep): Promise<Workflow> {
    const workflow = this.repositories.getWorkflow(workflowId);
    const next = this.validateStepMutation({ ...workflow, steps: [...workflow.steps, workflowStepSchema.parse(step)] });
    await this.saveWorkflow(next);
    return next;
  }

  async updateStep(workflowId: string, stepId: string, patch: Partial<WorkflowStep>): Promise<Workflow> {
    const workflow = this.repositories.getWorkflow(workflowId);
    let found = false;
    const steps = workflow.steps.map((step) => {
      if (step.id !== stepId) return step;
      found = true;
      return workflowStepSchema.parse({ ...step, ...patch });
    });
    if (!found) throw new AppError("WORKFLOW_STEP_NOT_FOUND", `Workflow step not found: ${stepId}`, 404);
    const next = this.validateStepMutation({ ...workflow, steps });
    await this.saveWorkflow(next);
    return next;
  }

  async deleteStep(workflowId: string, stepId: string): Promise<Workflow> {
    const workflow = this.repositories.getWorkflow(workflowId);
    const steps = workflow.steps.filter((step) => step.id !== stepId);
    if (steps.length === workflow.steps.length) throw new AppError("WORKFLOW_STEP_NOT_FOUND", `Workflow step not found: ${stepId}`, 404);
    const next = this.validateStepMutation({ ...workflow, steps });
    await this.saveWorkflow(next);
    return next;
  }

  async reorderSteps(workflowId: string, stepIds: string[]): Promise<Workflow> {
    const workflow = this.repositories.getWorkflow(workflowId);
    const uniqueIds = new Set(stepIds);
    const currentById = new Map(workflow.steps.map((step) => [step.id, step]));
    if (uniqueIds.size !== workflow.steps.length || stepIds.length !== workflow.steps.length || stepIds.some((stepId) => !currentById.has(stepId))) {
      throw new AppError("INVALID_WORKFLOW_STEP_ORDER", "Step order must include every existing step exactly once.", 400);
    }
    const next = this.validateStepMutation({ ...workflow, steps: stepIds.map((stepId) => currentById.get(stepId)!) });
    await this.saveWorkflow(next);
    return next;
  }

  private async saveWorkflow(workflow: Workflow): Promise<void> {
    this.repositories.getActiveApp(workflow.appId);
    await this.syncWorkflowIndex(workflow);
    this.repositories.saveWorkflow(workflow);
    this.syncWorkflowJobStatus(workflow);
  }

  private syncWorkflowJobStatus(workflow: Workflow): void {
    const jobId = workflow.createdFrom?.jobId;
    if (!jobId || !workflowJobStatuses.has(workflow.status)) return;
    this.repositories.updateWorkflowJobStatus(jobId, workflow.status);
  }

  private async syncWorkflowIndex(workflow: Workflow): Promise<void> {
    if (workflow.status === "published") {
      await this.semanticSearch.index(workflowToSemanticRecord(workflow));
      return;
    }

    await this.semanticSearch.deleteByFilter({
      kind: "workflow",
      appId: workflow.appId,
      workflowId: workflow.workflowId
    });
  }

  private validateStepMutation(workflow: Workflow): Workflow {
    return workflowSchema.parse({
      ...workflow,
      status: workflow.status === "published" ? "needs_review" : workflow.status,
      updatedAt: nowIso()
    });
  }

  private assertReviewClean(workflow: Workflow): void {
    const report = this.buildReviewReport(workflow);
    if (!report.publishable) {
      throw new AppError("WORKFLOW_REVIEW_BLOCKED", "Workflow has blocking review issues.", 400, {
        issues: report.issues.filter((issue) => issue.severity === "blocker")
      });
    }
  }

  private buildReviewReport(workflow: Workflow): WorkflowReviewReport {
    const issues: WorkflowReviewIssue[] = [];
    const mappedRoutes = new Set(this.repositories.listUiElementsForApp(workflow.appId).map((element) => element.route));

    if (workflow.triggerPhrases.length === 0) {
      issues.push({
        id: "trigger-phrases",
        severity: "blocker",
        label: "Trigger phrases",
        message: "Workflow has no trigger phrases.",
        fix: "Add at least one phrase users can say or type to start this workflow."
      });
    }

    if (workflow.steps.length === 0) {
      issues.push({
        id: "steps",
        severity: "blocker",
        label: "Steps",
        message: "Workflow has no steps.",
        fix: "Add workflow steps before approval."
      });
    }

    for (const route of workflow.requiredContext.startingRoutes) {
      if (!mappedRoutes.has(route)) {
        issues.push({
          id: `route:${route}`,
          severity: "warning",
          label: "Starting route coverage",
          message: `Starting route ${route} is not present in the latest UI map.`,
          fix: "Run a UI map scan that includes this route."
        });
      }
    }

    for (const step of workflow.steps) {
      if (step.source?.matchConfidence !== undefined && step.source.matchConfidence < 0.7) {
        issues.push({
          id: `source-confidence:${step.id}`,
          severity: "warning",
          label: "Source confidence",
          message: `Step ${step.id} has low video match confidence (${step.source.matchConfidence.toFixed(2)}).`,
          stepId: step.id,
          fix: "Review the step instruction and target before approval."
        });
      }

      if (!isExecutableTargetStep(step)) continue;
      const element = this.repositories.getElementByElementId(workflow.appId, step.target.elementId);
      if (!element) {
        issues.push({
          id: `target-missing:${step.id}`,
          severity: "blocker",
          label: "Target missing",
          message: `Step ${step.id} targets ${step.target.elementId}, which is not in the UI map.`,
          stepId: step.id,
          fix: "Re-scan the UI map or choose a mapped target."
        });
      } else if (element.selectorQuality === "weak") {
        issues.push({
          id: `target-weak:${step.id}`,
          severity: step.executionPolicy === "auto" ? "blocker" : "warning",
          label: "Weak selector",
          message: `Step ${step.id} targets ${element.elementId} with a weak selector.`,
          stepId: step.id,
          fix: "Add a stable data attribute or keep the step behind confirmation/manual execution."
        });
      }

      if (step.executionPolicy === "blocked") {
        issues.push({
          id: `blocked-step:${step.id}`,
          severity: "blocker",
          label: "Blocked step",
          message: `Step ${step.id} is marked blocked.`,
          stepId: step.id,
          fix: "Resolve the step or remove it before approval."
        });
      } else if (step.executionPolicy === "manual_only") {
        issues.push({
          id: `manual-step:${step.id}`,
          severity: "warning",
          label: "Manual-only step",
          message: `Step ${step.id} requires manual execution.`,
          stepId: step.id,
          fix: "Confirm this is intentional for the published workflow."
        });
      }

      if (step.executionPolicy === "auto") {
        const selectors = [step.target.selector, ...(step.target.fallbackSelectors ?? [])];
        if (!selectors.some(isStableEnoughSelector)) {
          issues.push({
            id: `brittle-selector:${step.id}`,
            severity: "blocker",
            label: "Brittle selector",
            message: `${step.type} step ${step.id} only has brittle selectors.`,
            stepId: step.id,
            fix: "Re-scan the UI map or add a stable selector before publishing."
          });
        }
      }
    }

    const blockerCount = issues.filter((issue) => issue.severity === "blocker").length;
    const warningCount = issues.filter((issue) => issue.severity === "warning").length;
    return {
      workflowId: workflow.workflowId,
      publishable: blockerCount === 0,
      blockerCount,
      warningCount,
      issues
    };
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
