import type { Repositories } from "../../db/repositories.js";
import type { ModelGatewayAdapter, SemanticSearchAdapter } from "../../adapters/interfaces.js";
import type { SDKRuntimeContext, Workflow } from "../../schemas/domain.js";
import { AppError, NotFoundError } from "../../utils/errors.js";

type RuntimeContextInput = Omit<SDKRuntimeContext, "appId" | "sessionId">;
type RuntimeElement = NonNullable<RuntimeContextInput["visibleElements"]>[number];
const WORKFLOW_MATCH_THRESHOLD = 0.72;
const TARGET_MATCH_THRESHOLD = 3.2;

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

    const target = findVisibleTarget(input.utterance, input.context);
    const elementAction = target ? parseElementAction(input.utterance) : undefined;
    if (target && elementAction) {
      return {
        type: "element_action",
        action: elementAction,
        target,
        executionPolicy: requiresConfirmation(input.utterance, target) ? "requires_confirmation" : "auto",
        message: elementAction === "click" ? `Clicking ${describeTarget(target)}.` : `Focusing ${describeTarget(target)}.`
      };
    }

    if (target && isPointingRequest(input.utterance)) {
      return {
        type: "answer",
        message: `Pointing to ${describeTarget(target)}.`,
        target
      };
    }

    const answer = await this.gateway.generateText({
      logContext: { appId: input.appId, purpose: "runtime_answer" },
      prompt: `Answer this product onboarding question briefly using the current page context. Do not create UI actions or selectors.

Question: ${input.utterance}
Current page context:
${summarizeRuntimeContext(input.context)}`
    });
    return target ? { type: "answer", message: answer.text, target } : { type: "answer", message: answer.text };
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

function findVisibleTarget(utterance: string, context: RuntimeContextInput): RuntimeElement | undefined {
  const referencedElement = findReferencedElement(utterance, context);
  if (referencedElement) return referencedElement;

  const terms = meaningfulTerms(utterance);
  if (terms.length === 0) return undefined;

  let best: { element: RuntimeElement; score: number } | undefined;
  for (const element of context.visibleElements ?? []) {
    if (!hasUsableBounds(element)) continue;
    const score = scoreElementMatch(element, terms, utterance);
    if (!best || score > best.score) best = { element, score };
  }

  const minimumScore = terms.length === 1 ? 2.1 : TARGET_MATCH_THRESHOLD;
  if (!best || best.score < minimumScore) return undefined;
  return best.element;
}

function findReferencedElement(utterance: string, context: RuntimeContextInput): RuntimeElement | undefined {
  if (!/\b(this|that|current|selected|focused|hovered)\b/i.test(utterance)) return undefined;
  if (context.hoveredElement && hasUsableBounds(context.hoveredElement)) return context.hoveredElement;
  if (context.focusedElement && hasUsableBounds(context.focusedElement)) return context.focusedElement;
  return undefined;
}

function scoreElementMatch(element: RuntimeElement, terms: string[], utterance: string): number {
  const normalizedUtterance = normalizeText(utterance);
  const primary = normalizeText([element.label, element.text].filter(Boolean).join(" "));
  const secondary = normalizeText([element.elementId, element.selector, element.role, element.tagName].filter(Boolean).join(" "));
  const primaryTokens = new Set(tokenize(primary));
  const secondaryTokens = new Set(tokenize(secondary));
  let score = 0;

  for (const term of terms) {
    if (primaryTokens.has(term)) score += 2.2;
    else if (primary.includes(term)) score += 1.1;

    if (secondaryTokens.has(term)) score += 1.4;
    else if (secondary.includes(term)) score += 0.7;
  }

  if (primary && normalizedUtterance.includes(primary)) score += Math.min(5, primaryTokens.size * 1.2);
  if (secondary && normalizedUtterance.includes(secondary)) score += Math.min(3, secondaryTokens.size * 0.8);
  if (roleMatchesRequest(element, terms)) score += 0.8;
  return score;
}

function meaningfulTerms(utterance: string): string[] {
  return tokenize(utterance).filter((term) => !TARGET_STOP_WORDS.has(term) && term.length > 1);
}

function tokenize(value: string): string[] {
  return normalizeText(value).split(" ").filter(Boolean);
}

function normalizeText(value: string): string {
  return value
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function roleMatchesRequest(element: RuntimeElement, terms: string[]): boolean {
  const role = normalizeText([element.role, element.tagName].filter(Boolean).join(" "));
  if (!role) return false;
  return terms.some((term) => {
    if (term === "button") return role.includes("button");
    if (term === "tab") return role.includes("tab");
    if (term === "link") return role.includes("link") || role.includes("anchor");
    if (["field", "input", "search"].includes(term)) return role.includes("input") || role.includes("textarea") || role.includes("select");
    return false;
  });
}

function hasUsableBounds(element: RuntimeElement): boolean {
  const box = element.boundingBox;
  return Boolean(box && box.width > 0 && box.height > 0);
}

function isPointingRequest(utterance: string): boolean {
  return /\b(point|show|highlight|locate|find)\b|\bwhere\s+(is|are|'s)\b/i.test(utterance);
}

function parseElementAction(utterance: string): "click" | "focus" | undefined {
  if (/\b(click|press|tap|open|select|choose)\b/i.test(utterance)) return "click";
  if (/\b(focus|put\s+(the\s+)?cursor|place\s+(the\s+)?cursor)\b/i.test(utterance)) return "focus";
  return undefined;
}

function requiresConfirmation(utterance: string, element: RuntimeElement): boolean {
  return /\b(delete|remove|archive|logout|log\s*out|sign\s*out|disable|deactivate|submit|send|pay|purchase|buy|confirm)\b/i.test([
    utterance,
    element.label,
    element.text,
    element.elementId,
    element.selector
  ].filter(Boolean).join(" "));
}

function describeTarget(element: RuntimeElement): string {
  return element.label ?? element.text ?? element.elementId ?? element.selector ?? "that item";
}

const TARGET_STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "at",
  "can",
  "could",
  "for",
  "from",
  "how",
  "i",
  "in",
  "is",
  "it",
  "find",
  "highlight",
  "locate",
  "me",
  "mia",
  "of",
  "on",
  "point",
  "please",
  "show",
  "tell",
  "that",
  "the",
  "this",
  "to",
  "where",
  "which",
  "you"
]);

function sanitizeWorkflowForRuntime(workflow: Workflow): Workflow {
  if (workflow.status !== "published") {
    throw new AppError("WORKFLOW_NOT_PUBLISHED", "Cannot send unpublished workflow to SDK.", 403);
  }
  return workflow;
}
