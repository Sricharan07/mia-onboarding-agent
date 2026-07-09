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
    const next = workflowSchema.parse(invalidateReview({
      ...current,
      ...patch,
      workflowId: current.workflowId,
      appId: current.appId,
      updatedAt: nowIso()
    }));
    await this.saveWorkflow(next);
  }

  async approveWorkflow(workflowId: string, input: { reviewedBy: string; notes?: string }): Promise<Workflow> {
    const workflow = this.repositories.getWorkflow(workflowId);
    this.assertReviewClean(workflow);
    const latestMap = this.repositories.getLatestCompletedUiMapVersion(workflow.appId);
    if (!latestMap) throw new AppError("WORKFLOW_UI_MAP_REQUIRED", "A completed UI map is required before approval.", 400);
    const next = workflowSchema.parse({
      ...workflow,
      status: "approved",
      review: {
        reviewedBy: input.reviewedBy,
        reviewedAt: nowIso(),
        notes: input.notes,
        uiMapVersionId: latestMap.id
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
    return workflowSchema.parse(invalidateReview({
      ...workflow,
      updatedAt: nowIso()
    }));
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
    const latestMap = this.repositories.getLatestCompletedUiMapVersion(workflow.appId);
    const latestElements = this.repositories.listUiElementsForApp(workflow.appId);
    const mappedRoutes = new Set(latestElements.map((element) => element.route));

    if (!latestMap) {
      issues.push({
        id: "ui-map-missing",
        severity: "blocker",
        label: "UI map required",
        message: "No completed UI map is available for this workflow.",
        fix: "Complete a UI map scan before approval."
      });
    }

    if ((workflow.status === "approved" || workflow.status === "published") && workflow.review.uiMapVersionId !== latestMap?.id) {
      issues.push({
        id: "review-map-stale",
        severity: "blocker",
        label: "Approval is stale",
        message: "This workflow was not approved against the latest UI map.",
        fix: "Review every target again and re-approve the workflow."
      });
    }

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
          severity: "blocker",
          label: "Starting route coverage",
          message: `Starting route ${route} is not present in the latest UI map.`,
          fix: "Run a UI map scan that includes this route."
        });
      }
    }

    for (const step of workflow.steps) {
      if (step.type === "review_required") {
        issues.push({
          id: `review-required:${step.id}`,
          severity: "blocker",
          label: "Unresolved recorded action",
          message: step.message,
          stepId: step.id,
          fix: "Resolve this step to a mapped action or remove it."
        });
        continue;
      }

      if (step.source?.extractionConfidence !== undefined && step.source.extractionConfidence < 0.7) {
        issues.push({
          id: `extraction-confidence:${step.id}`,
          severity: "warning",
          label: "Video extraction confidence",
          message: `Step ${step.id} has low extraction confidence (${step.source.extractionConfidence.toFixed(2)}).`,
          stepId: step.id,
          fix: "Compare this step with the recording."
        });
      }

      if (step.source && (step.source.matchConfidence === undefined || step.source.matchConfidence < 0.7)) {
        issues.push({
          id: `match-confidence:${step.id}`,
          severity: "blocker",
          label: "Target match confidence",
          message: step.source.matchConfidence === undefined
            ? `Step ${step.id} has no target match confidence.`
            : `Step ${step.id} has low target match confidence (${step.source.matchConfidence.toFixed(2)}).`,
          stepId: step.id,
          fix: "Select and save the exact target from the latest UI map."
        });
      }

      if (!isTargetStep(step)) continue;
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
      } else {
        if (!latestMap || step.target.uiMapVersionId !== latestMap.id || step.target.uiMapVersionId !== element.uiMapVersionId) {
          issues.push({
            id: `target-map:${step.id}`,
            severity: "blocker",
            label: "Target map version",
            message: `Step ${step.id} is not bound to the latest UI map.`,
            stepId: step.id,
            fix: "Re-select this target from the latest map."
          });
        }
        if (!step.target.fingerprint || step.target.fingerprint !== element.fingerprint) {
          issues.push({
            id: `target-fingerprint:${step.id}`,
            severity: "blocker",
            label: "Target changed",
            message: `Step ${step.id} no longer matches the reviewed element fingerprint.`,
            stepId: step.id,
            fix: "Inspect and re-select the intended element."
          });
        }
        if (
          step.target.selector !== element.selector
          || step.target.elementType !== element.elementType
          || step.target.route !== element.route
          || !sameLocators(step.target.locators, element.locators)
        ) {
          issues.push({
            id: `target-definition:${step.id}`,
            severity: "blocker",
            label: "Target definition changed",
            message: `Step ${step.id} selector, type, or route differs from the latest map.`,
            stepId: step.id,
            fix: "Re-select the target from the latest map."
          });
        }
      }

      if (element?.selectorQuality === "weak") {
        issues.push({
          id: `target-weak:${step.id}`,
          severity: step.type === "wait_for_element" || step.executionPolicy === "auto" ? "blocker" : "warning",
          label: "Weak selector",
          message: `Step ${step.id} targets ${element.elementId} with a weak selector.`,
          stepId: step.id,
          fix: "Add a stable data attribute or keep the step behind confirmation/manual execution."
        });
      }

      if (element?.selectorWarnings.length) {
        issues.push({
          id: `target-warnings:${step.id}`,
          severity: step.type === "wait_for_element" || step.executionPolicy === "auto" ? "blocker" : "warning",
          label: "Selector warnings",
          message: `Step ${step.id} target has selector warnings: ${element.selectorWarnings.join(" ")}`,
          stepId: step.id,
          fix: "Resolve selector warnings or use a non-automatic policy."
        });
      }

      if (element && this.repositories.countLatestElementsBySelector(workflow.appId, element.selector) !== 1) {
        issues.push({
          id: `target-selector-unique:${step.id}`,
          severity: step.type === "wait_for_element" || step.executionPolicy === "auto" ? "blocker" : "warning",
          label: "Selector is not unique",
          message: `Step ${step.id} selector does not identify exactly one element in the latest map.`,
          stepId: step.id,
          fix: "Add a unique stable selector and re-scan."
        });
      }

      if (step.type !== "wait_for_element" && step.executionPolicy === "blocked") {
        issues.push({
          id: `blocked-step:${step.id}`,
          severity: "blocker",
          label: "Blocked step",
          message: `Step ${step.id} is marked blocked.`,
          stepId: step.id,
          fix: "Resolve the step or remove it before approval."
        });
      } else if (step.type !== "wait_for_element" && step.executionPolicy === "manual_only") {
        issues.push({
          id: `manual-step:${step.id}`,
          severity: "warning",
          label: "Manual-only step",
          message: `Step ${step.id} requires manual execution.`,
          stepId: step.id,
          fix: "Confirm this is intentional for the published workflow."
        });
      }

      if (step.type !== "wait_for_element" && step.executionPolicy === "auto") {
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

      if (step.type === "wait_for_element") {
        const selectors = [step.target.selector, ...(step.target.fallbackSelectors ?? [])];
        if (!selectors.some(isStableEnoughSelector)) {
          issues.push({
            id: `brittle-wait-selector:${step.id}`,
            severity: "blocker",
            label: "Brittle wait target",
            message: `Wait step ${step.id} only has brittle selectors.`,
            stepId: step.id,
            fix: "Re-scan or select a stable wait target."
          });
        }
      }

      if (step.type !== "wait_for_element" && step.type !== "focus" && step.executionPolicy === "auto" && isDangerousTarget(step)) {
        issues.push({
          id: `dangerous-auto:${step.id}`,
          severity: "blocker",
          label: "Dangerous automatic action",
          message: `Step ${step.id} is a consequential action configured to run automatically.`,
          stepId: step.id,
          fix: "Require confirmation or make the step manual-only."
        });
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

function sameLocators(
  left: import("../../schemas/domain.js").TargetLocator[] | undefined,
  right: import("../../schemas/domain.js").TargetLocator[] | undefined
): boolean {
  return JSON.stringify(left ?? []) === JSON.stringify(right ?? []);
}

function isTargetStep(step: WorkflowStep): step is Extract<WorkflowStep, { type: "click" | "focus" | "fill" | "select" | "wait_for_element" }> {
  return step.type === "click" || step.type === "focus" || step.type === "fill" || step.type === "select" || step.type === "wait_for_element";
}

function isStableEnoughSelector(selector: string): boolean {
  const trimmed = selector.trim();
  if (!trimmed) return false;
  if (trimmed.includes(":nth-of-type") || trimmed.includes(":nth-child")) return false;
  if (/^[a-z][a-z0-9-]*$/i.test(trimmed)) return false;
  return true;
}

function invalidateReview(workflow: Workflow): Workflow {
  if (workflow.status !== "approved" && workflow.status !== "published") return workflow;
  return { ...workflow, status: "needs_review", review: {} };
}

function isDangerousTarget(step: Extract<WorkflowStep, { type: "click" | "fill" | "select" }>): boolean {
  return /\b(delete|remove|archive|submit|send|pay|purchase|checkout|invite|publish|approve|revoke|disable|deactivate|transfer|refund|cancel)\b/i.test([
    step.type,
    step.label,
    step.description,
    step.target.label,
    step.target.elementId
  ].filter(Boolean).join(" "));
}

export function assertWorkflowRuntimeBinding(repositories: Repositories, workflow: Workflow): void {
  const latestMap = repositories.getLatestCompletedUiMapVersion(workflow.appId);
  if (!latestMap || workflow.review.uiMapVersionId !== latestMap.id) {
    throw new AppError("WORKFLOW_UI_MAP_STALE", "Workflow approval is not valid for the latest UI map.", 409);
  }
  for (const step of workflow.steps) {
    if (step.type === "review_required") {
      throw new AppError("WORKFLOW_REVIEW_REQUIRED", "Workflow contains an unresolved review step.", 409);
    }
    if (!isTargetStep(step)) continue;
    const current = repositories.getElementByElementId(workflow.appId, step.target.elementId);
    if (!current
      || step.target.uiMapVersionId !== latestMap.id
      || step.target.fingerprint !== current.fingerprint
      || step.target.selector !== current.selector
      || step.target.route !== current.route
      || step.target.elementType !== current.elementType
      || !sameLocators(step.target.locators, current.locators)
      || repositories.countLatestElementsBySelector(workflow.appId, step.target.selector) !== 1) {
      throw new AppError("WORKFLOW_TARGET_STALE", `Workflow target is stale: ${step.target.elementId}`, 409);
    }
    if (step.type !== "wait_for_element" && step.executionPolicy === "blocked") {
      throw new AppError("WORKFLOW_STEP_BLOCKED", `Workflow step is blocked: ${step.id}`, 409);
    }
  }
}
