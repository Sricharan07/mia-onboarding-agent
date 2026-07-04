import type { Repositories } from "../../db/repositories.js";
import type { ModelGatewayAdapter, SemanticSearchAdapter } from "../../adapters/interfaces.js";
import type { SDKRuntimeContext, Workflow } from "../../schemas/domain.js";
import { AppError, NotFoundError } from "../../utils/errors.js";

type RuntimeContextInput = Omit<SDKRuntimeContext, "appId" | "sessionId">;
const WORKFLOW_MATCH_THRESHOLD = 0.72;

export class RuntimeService {
  constructor(
    private readonly repositories: Repositories,
    private readonly gateway: ModelGatewayAdapter,
    private readonly semanticSearch: SemanticSearchAdapter
  ) {}

  async resolve(input: {
    appId: string;
    sessionId: string;
    utterance: string;
    context: Omit<SDKRuntimeContext, "appId" | "sessionId">;
    includeTts?: boolean;
  }) {
    const controlAction = parseControlAction(input.utterance);
    if (controlAction) {
      return { type: "control", action: controlAction, message: controlMessage(controlAction) };
    }

    const matches = await this.semanticSearch.search({
      query: `${input.utterance}\nCurrent route: ${input.context.currentRoute}`,
      filters: { kind: "workflow", appId: input.appId, status: "published" },
      limit: 5
    });

    const workflow = this.findExecutableWorkflow(matches, input.appId);
    if (workflow) {
      return {
        type: "workflow",
        workflow: sanitizeWorkflowForRuntime(workflow),
        message: `I can help you with ${workflow.name}. Let's start.`
      };
    }

    const answer = await this.gateway.generateText({
      logContext: { appId: input.appId, purpose: "runtime_answer" },
      prompt: `Answer this product onboarding question briefly using the current page context. Do not create UI actions or selectors.

Question: ${input.utterance}
Current page context:
${summarizeRuntimeContext(input.context)}`
    });
    return { type: "answer", message: answer.text };
  }

  private findExecutableWorkflow(matches: Array<{ score: number; metadata?: Record<string, unknown> }>, appId: string): Workflow | undefined {
    for (const match of matches) {
      if (match.score < WORKFLOW_MATCH_THRESHOLD) continue;
      const workflowId = match.metadata?.workflowId;
      if (typeof workflowId !== "string") continue;

      try {
        const workflow = this.repositories.getWorkflow(workflowId);
        if (workflow.status === "published" && workflow.appId === appId) return workflow;
      } catch (error) {
        if (error instanceof NotFoundError) {
          console.warn(`[runtime] Semantic search returned stale workflowId=${workflowId}; skipping.`);
          continue;
        }
        throw error;
      }
    }
    return undefined;
  }
}

function controlMessage(action: "cancel" | "pause" | "resume"): string {
  if (action === "cancel") return "Okay, I stopped the current workflow.";
  if (action === "pause") return "Paused. Say resume when you want to continue.";
  return "Resuming the workflow.";
}

function parseControlAction(utterance: string): "cancel" | "pause" | "resume" | undefined {
  const text = utterance.trim().toLowerCase();
  if (/^(cancel|stop|end|abort)(\s+(this|the|current)\s+(workflow|task|guide|guidance))?[.!?]?$/.test(text)) return "cancel";
  if (/^(pause|hold)(\s+(this|the|current)\s+(workflow|task|guide|guidance))?[.!?]?$/.test(text)) return "pause";
  if (/^(resume|continue)(\s+(this|the|current)\s+(workflow|task|guide|guidance))?[.!?]?$/.test(text)) return "resume";
  return undefined;
}

function summarizeRuntimeContext(context: RuntimeContextInput): string {
  const lines = [
    `URL: ${context.currentUrl}`,
    `Route: ${context.currentRoute}`,
    `Title: ${context.pageTitle ?? "Untitled"}`
  ];
  if (context.focusedElement) lines.push(`Focused: ${summarizeElement(context.focusedElement)}`);
  if (context.hoveredElement) lines.push(`Hovered: ${summarizeElement(context.hoveredElement)}`);
  const visible = (context.visibleElements ?? []).slice(0, 20).map(summarizeElement);
  if (visible.length) lines.push(`Visible elements:\n${visible.map((element) => `- ${element}`).join("\n")}`);
  return lines.join("\n");
}

function summarizeElement(element: NonNullable<RuntimeContextInput["visibleElements"]>[number]): string {
  return [
    element.role ? `role=${element.role}` : undefined,
    element.label ? `label=${element.label}` : undefined,
    element.text ? `text=${element.text}` : undefined,
    element.elementId ? `id=${element.elementId}` : undefined,
    element.selector ? `selector=${element.selector}` : undefined
  ].filter(Boolean).join("; ") || element.tagName;
}

function sanitizeWorkflowForRuntime(workflow: Workflow): Workflow {
  if (workflow.status !== "published") {
    throw new AppError("WORKFLOW_NOT_PUBLISHED", "Cannot send unpublished workflow to SDK.", 403);
  }
  return workflow;
}
