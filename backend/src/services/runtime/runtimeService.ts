import type { Repositories } from "../../db/repositories.js";
import type { ModelGatewayAdapter, SemanticSearchAdapter } from "../../adapters/interfaces.js";
import type { SDKRuntimeContext, TargetLocator, UIElementRecord, Workflow } from "../../schemas/domain.js";
import { AppError, NotFoundError } from "../../utils/errors.js";
import { assertWorkflowRuntimeBinding } from "../workflows/workflowService.js";

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
    const app = this.repositories.getActiveApp(input.appId);
    const workflowMode = app.uiScanConfig.runtimeMode === "workflow";
    const controlAction = parseControlAction(input.utterance);
    if (controlAction) {
      return { type: "control", action: controlAction, message: controlMessage(controlAction) };
    }

    if (workflowMode) {
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
    }

    const intent = classifyRuntimeIntent(input.utterance);
    const mappedTarget = findMappedVisibleTarget(
      input.utterance,
      input.context,
      this.repositories.listLatestUiElementsForApp(input.appId, 500)
    );
    const target = mappedTarget ?? findVisibleTarget(input.utterance, input.context);
    if (workflowMode && mappedTarget && intent.type === "action" && hasExecutableLiveLocator(mappedTarget)) {
      return {
        type: "element_action",
        action: intent.action,
        target: mappedTarget,
        executionPolicy: "requires_confirmation" as const,
        message: `Ready to ${intent.action} ${describeTarget(mappedTarget)} after your confirmation.`
      };
    }

    if (workflowMode && target && intent.type === "action") {
      return {
        type: "no_match",
        message: `I found ${describeTarget(target)}, but it is not verified against the current UI map, so I did not act on it.`,
        target
      };
    }

    if (target && intent.type === "point") {
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
        if (workflow.status === "published" && workflow.appId === appId) {
          assertWorkflowRuntimeBinding(this.repositories, workflow);
          return workflow;
        }
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

type RuntimeIntent =
  | { type: "point" }
  | { type: "action"; action: "click" | "focus" }
  | { type: "answer" };

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

function findMappedVisibleTarget(
  utterance: string,
  context: RuntimeContextInput,
  elements: UIElementRecord[]
): RuntimeElement | undefined {
  const visible = (context.visibleElements ?? []).filter(hasUsableBounds);
  const routeElements = elements.filter((element) => normalizeRoute(element.route) === normalizeRoute(context.currentRoute));
  const referenced = findReferencedElement(utterance, context);
  if (referenced) {
    const mapped = routeElements.find((element) => liveElementMatchesMap(referenced, element));
    if (mapped) return bindMappedTarget(referenced, mapped);
  }

  const terms = meaningfulTerms(utterance);
  if (terms.length === 0) return undefined;
  const ranked = routeElements
    .map((element) => ({ element, score: scoreMappedElement(element, terms, utterance) }))
    .sort((left, right) => right.score - left.score);
  const minimumScore = terms.length === 1 ? 2.1 : TARGET_MATCH_THRESHOLD;

  for (const candidate of ranked) {
    if (candidate.score < minimumScore) break;
    const live = visible.find((element) => liveElementMatchesMap(element, candidate.element));
    if (live) return bindMappedTarget(live, candidate.element);
  }
  return undefined;
}

function scoreMappedElement(element: UIElementRecord, terms: string[], utterance: string): number {
  return scoreElementMatch({
    tagName: element.elementType,
    role: element.role,
    label: element.label ?? element.accessibleName,
    text: element.visibleText,
    elementId: element.elementId,
    selector: element.selector
  }, terms, utterance);
}

function liveElementMatchesMap(live: RuntimeElement, mapped: UIElementRecord): boolean {
  if (live.elementId && live.elementId === mapped.elementId) return true;
  const mappedSelectors = new Set([mapped.selector, ...mapped.fallbackSelectors]);
  if (live.selector && mappedSelectors.has(live.selector)) return true;
  const liveLocators = new Set((live.locators ?? []).map(locatorKey));
  return (mapped.locators ?? []).some((locator) => liveLocators.has(locatorKey(locator)));
}

function bindMappedTarget(live: RuntimeElement, mapped: UIElementRecord): RuntimeElement {
  return {
    ...live,
    mappedElementId: mapped.elementId,
    uiMapVersionId: mapped.uiMapVersionId,
    fingerprint: mapped.fingerprint
  };
}

function locatorKey(locator: TargetLocator): string {
  return JSON.stringify(locator);
}

function normalizeRoute(route: string): string {
  const path = route.split(/[?#]/, 1)[0] || "/";
  return path.length > 1 ? path.replace(/\/+$/, "") : path;
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

function classifyRuntimeIntent(utterance: string): RuntimeIntent {
  const text = utterance.trim();
  if (
    /\bwhere\s+(?:is|are|'s|do|does|should|can|could|would)\b/i.test(text)
    || /\bwhich\s+.+\b(?:click|press|tap|choose|select)\b/i.test(text)
    || /^(?:please\s+)?(?:point(?:\s+me)?(?:\s+to)?|show(?:\s+me)?|highlight|locate|find)\b/i.test(text)
  ) return { type: "point" };

  const actionRequest = text.match(/^(?:(?:can|could|would|will)\s+you\s+)?(?:please\s+)?(click|press|tap|open|choose|select|focus)\b/i);
  if (actionRequest) return { type: "action", action: actionRequest[1]?.toLowerCase() === "focus" ? "focus" : "click" };
  if (/^(?:please\s+)?(?:put|place)\s+(?:the\s+)?cursor\b/i.test(text)) return { type: "action", action: "focus" };
  return { type: "answer" };
}

function hasExecutableLiveLocator(element: RuntimeElement): boolean {
  return Boolean(element.locators?.length || element.selector);
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
