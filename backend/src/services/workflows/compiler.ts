import type { Repositories } from "../../db/repositories.js";
import type { ExtractedActionStep, ExtractedActionTimeline, UIElementRecord, Workflow, WorkflowStep, WorkflowTarget } from "../../schemas/domain.js";
import type { SemanticSearchAdapter } from "../../adapters/interfaces.js";
import { createId, nowIso } from "../../utils/id.js";

export class WorkflowCompiler {
  constructor(
    private readonly repositories: Repositories,
    private readonly semanticSearch: SemanticSearchAdapter
  ) {}

  async compile(input: {
    appId: string;
    timeline: ExtractedActionTimeline;
    videoId: string;
    jobId: string;
    requestedName?: string;
    requestedDescription?: string;
  }): Promise<Workflow> {
    const steps: WorkflowStep[] = [];
    const workflowName = input.requestedName ?? input.timeline.goal;
    const workflowDescription = input.requestedDescription ?? input.timeline.summary ?? `Guides the user through ${input.timeline.goal}.`;

    for (const extractedStep of [...input.timeline.steps].sort((a, b) => a.order - b.order)) {
      const compiled = await this.compileStep(input.appId, extractedStep);
      steps.push(...compiled);
    }

    if (!steps.some((step) => step.type === "complete")) {
      steps.push({ id: createId("step"), type: "complete", message: `${input.timeline.goal} complete.` });
    }

    const now = nowIso();
    return {
      workflowId: createId("workflow"),
      appId: input.appId,
      name: workflowName,
      description: workflowDescription,
      status: "needs_review",
      version: 1,
      triggerPhrases: [workflowName.toLowerCase()],
      requiredContext: {
        app: input.appId,
        startingRoutes: Array.from(new Set(input.timeline.steps.map((step) => step.route).filter(Boolean) as string[]))
      },
      steps,
      createdFrom: { videoId: input.videoId, jobId: input.jobId },
      review: {},
      createdAt: now,
      updatedAt: now
    };
  }

  private async compileStep(appId: string, step: ExtractedActionStep): Promise<WorkflowStep[]> {
    if (step.action === "navigate" && step.route) {
      return [{ id: createId("step"), type: "navigate", route: step.route }];
    }

    if (step.action === "wait") {
      const target = await this.matchTarget(appId, step);
      if (!target) return [createReviewStep(step, `I could not match "${step.observedElement ?? "wait target"}" automatically. Please review this step before publishing.`)];
      return [{ id: createId("step"), type: "wait_for_element", target, timeoutMs: 10000 }];
    }

    if (!["click", "focus", "fill", "select"].includes(step.action)) {
      return [createReviewStep(step, `I could not convert the recorded "${step.action}" action automatically. Please review this step before publishing.`)];
    }

    const target = await this.matchTarget(appId, step);
    if (!target) {
      return [{
        id: createId("step"),
        type: "confirm",
        message: `I could not match "${step.observedElement ?? step.action}" automatically. Please review this step before publishing.`,
        source: { extractedStepId: step.id, matchConfidence: 0 }
      }];
    }

    const source = { extractedStepId: step.id, matchConfidence: step.confidence };
    const executionPolicy = isDangerousAction(step, target) ? "requires_confirmation" : "auto";
    if (step.action === "click") return [{ id: createId("step"), type: "click", target, executionPolicy, source }];
    if (step.action === "focus") return [{ id: createId("step"), type: "focus", target, executionPolicy: "auto", source }];
    if (step.action === "fill") {
      const field = createFieldName(step.observedElement ?? target.label ?? target.elementId);
      const inputType = step.observedValueType && step.observedValueType !== "unknown" ? step.observedValueType : "text";
      const fillPolicy = sensitiveInputTypes.has(inputType) ? "manual_only" : executionPolicy;
      return [
        { id: createId("step"), type: "ask_user", field, prompt: `What value should I enter for ${target.label ?? target.elementId}?`, inputType },
        { id: createId("step"), type: "fill", target, valueFrom: field, executionPolicy: fillPolicy, source }
      ];
    }

    const field = createFieldName(step.observedElement ?? target.label ?? target.elementId);
    return [
      { id: createId("step"), type: "ask_user", field, prompt: `Which option should I select for ${target.label ?? target.elementId}?`, inputType: "text" },
      { id: createId("step"), type: "select", target, valueFrom: field, executionPolicy, source }
    ];
  }

  private async matchTarget(appId: string, step: ExtractedActionStep): Promise<WorkflowTarget | undefined> {
    const query = [step.action, step.observedElement, step.page, step.visualContext].filter(Boolean).join(" ");
    const filters: Record<string, string> = { appId, kind: "ui_element" };
    if (step.route) filters.route = step.route;
    const results = await this.semanticSearch.search({ query, filters, limit: 8 });

    for (const result of results) {
      const elementId = result.metadata?.elementId;
      if (result.score < 0.55 || typeof elementId !== "string") continue;
      const record = this.repositories.getElementByElementId(appId, elementId);
      if (!record || !hasExecutableSelector(record)) continue;
      return toWorkflowTarget(record);
    }

    return undefined;
  }
}

function toWorkflowTarget(record: UIElementRecord): WorkflowTarget {
  return {
    elementId: record.elementId,
    label: record.label,
    selector: record.selector,
    fallbackSelectors: record.fallbackSelectors,
    route: record.route,
    pageName: record.pageName
  };
}

const sensitiveInputTypes = new Set(["password", "credit_card", "api_key", "secret", "token", "ssn", "bank_account"]);
const dangerousActionPattern = /\b(delete|remove|archive|submit|send|pay|purchase|checkout|invite|publish|approve|revoke|disable|deactivate|confirm|transfer|refund|cancel)\b/i;

function createReviewStep(step: ExtractedActionStep, message: string): WorkflowStep {
  return {
    id: createId("step"),
    type: "confirm",
    message,
    source: { extractedStepId: step.id, matchConfidence: step.confidence ?? 0 }
  };
}

function createFieldName(label: string): string {
  return label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "field";
}

function isDangerousAction(step: ExtractedActionStep, target: WorkflowTarget): boolean {
  return dangerousActionPattern.test([
    step.action,
    step.observedElement,
    step.visualContext,
    target.label,
    target.elementId
  ].filter(Boolean).join(" "));
}

function hasExecutableSelector(record: UIElementRecord): boolean {
  if (record.selectorQuality !== "weak") return true;
  return [record.selector, ...record.fallbackSelectors].some((selector) => isStableEnoughSelector(selector));
}

function isStableEnoughSelector(selector: string): boolean {
  const trimmed = selector.trim();
  if (!trimmed) return false;
  if (trimmed.includes(":nth-of-type") || trimmed.includes(":nth-child")) return false;
  if (/^[a-z][a-z0-9-]*$/i.test(trimmed)) return false;
  return true;
}
