import type { Repositories } from "../../db/repositories.js";
import type { Workflow } from "../../schemas/domain.js";
import { workflowSchema } from "../../schemas/domain.js";
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
}
