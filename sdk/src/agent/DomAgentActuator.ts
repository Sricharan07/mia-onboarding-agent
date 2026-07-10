import { prefersReducedMotion } from "../accessibility/motion.js";
import type { AgentObservationCollector } from "../context/AgentObservationCollector.js";
import type { MiaShadowCursor } from "../cursor/MiaShadowCursor.js";
import type {
  ActionDirective,
  ActionReceipt,
  MiaActionDefinition,
  MiaOptions,
  MiaVisualContext,
  Observation,
  TargetLocator
} from "../types/index.js";

export type BatchResult = { receipts: ActionReceipt[]; visualContext: MiaVisualContext[] };

export class DomAgentActor {
  private readonly actions = new Map<string, MiaActionDefinition>();
  private readonly idempotentReceipts = new Map<string, ActionReceipt>();

  constructor(private readonly options: {
    collector: AgentObservationCollector;
    cursor: MiaShadowCursor;
    config: MiaOptions;
    onAction?: (action: ActionDirective, receipt?: ActionReceipt) => void;
  }) {
    for (const action of options.config.actions ?? []) this.actions.set(action.name, action);
  }

  async executeBatch(directives: ActionDirective[], observation: Observation, signal: AbortSignal): Promise<BatchResult> {
    const receipts: ActionReceipt[] = [];
    const visualContext: MiaVisualContext[] = [];
    for (let index = 0; index < directives.length; index += 1) {
      const directive = directives[index]!;
      if (signal.aborted) {
        receipts.push(...directives.slice(index).map((remaining) => receipt(remaining, "cancelled", "The action was cancelled.")));
        break;
      }
      this.options.onAction?.(directive);
      const result = await this.execute(directive, observation, signal);
      receipts.push(result.receipt);
      visualContext.push(...result.visualContext);
      this.options.onAction?.(directive, result.receipt);
      if (["failed", "unverified", "cancelled", "manual"].includes(result.receipt.status)) {
        receipts.push(...directives.slice(index + 1).map((remaining) => receipt(remaining, "cancelled", "The remaining batch was stopped after the previous action.")));
        break;
      }
    }
    return { receipts, visualContext };
  }

  private async execute(
    directive: ActionDirective,
    observation: Observation,
    signal: AbortSignal
  ): Promise<{ receipt: ActionReceipt; visualContext: MiaVisualContext[] }> {
    const cached = this.idempotentReceipts.get(directive.idempotencyKey);
    if (cached) return { receipt: cached, visualContext: [] };
    try {
      assertActive(signal);
      if (directive.risk === "blocked") return { receipt: receipt(directive, "failed", "This action is blocked by the product policy."), visualContext: [] };
      if (directive.type === "request_visual") return this.requestVisual(directive, observation, signal);
      if (directive.type === "host_action") return this.hostAction(directive, observation, signal);
      if (directive.type === "navigate") return { receipt: await this.navigate(directive, signal), visualContext: [] };
      if (directive.type === "go_back") return { receipt: await this.goBack(directive, signal), visualContext: [] };
      if (directive.type === "scroll_by") return { receipt: await this.scrollBy(directive, signal), visualContext: [] };
      if (directive.type === "wait") return { receipt: await this.wait(directive, signal), visualContext: [] };

      const target = resolveTarget(directive, this.options.collector);
      if (!target.element) return { receipt: receipt(directive, "failed", target.error ?? "The target is no longer available."), visualContext: [] };
      if (directive.target?.route && normalizeRoute(directive.target.route) !== normalizeRoute(location.pathname)) {
        return { receipt: receipt(directive, "failed", "The target belongs to a different page."), visualContext: [] };
      }
      await this.pointTo(target.element, directive.target?.label ?? directive.message, signal);
      const clearHighlight = showHighlight(target.element);
      try {
        if (directive.risk === "manual") {
          return { receipt: receipt(directive, "manual", "This protected step must be completed by the user.", { targetVisible: true }), visualContext: [] };
        }
        const before = snapshot(target.element, this.options.collector.getRevision());
        switch (directive.type) {
          case "point":
          case "highlight":
          case "scroll_to":
            return { receipt: receipt(directive, "completed", "Mia pointed to the target.", { inViewport: inViewport(topRect(target.element)) }), visualContext: [] };
          case "hover":
            dispatchHover(target.element);
            return { receipt: receipt(directive, "completed", "Mia hovered over the target.", { hoverEventsDispatched: true }), visualContext: [] };
          case "focus":
            target.element.focus({ preventScroll: true });
            break;
          case "click":
            target.element.click();
            break;
          case "fill":
            if (directive.value === undefined) throw new Error("The fill action did not include a value.");
            setControlValue(target.element, directive.value);
            break;
          case "clear":
            setControlValue(target.element, "");
            break;
          case "select":
            if (directive.value === undefined) throw new Error("The select action did not include a value.");
            selectValue(target.element, directive.value);
            break;
          case "toggle":
            target.element.click();
            break;
          case "press_key":
            pressKey(target.element, directive.key);
            break;
          default:
            throw new Error(`Unsupported DOM action: ${directive.type}.`);
        }
        await settle(signal);
        const after = snapshot(target.element, this.options.collector.getRevision());
        const verification = verify(directive, before, after);
        if (!["point", "highlight", "scroll_to", "hover"].includes(directive.type)) this.options.cursor.returnToCursor();
        const result = receipt(directive, verification.verified ? "completed" : "unverified", verification.message, verification.evidence);
        this.idempotentReceipts.set(directive.idempotencyKey, result);
        return { receipt: result, visualContext: [] };
      } finally {
        window.setTimeout(clearHighlight, 900);
      }
    } catch (error) {
      return {
        receipt: receipt(directive, signal.aborted ? "cancelled" : "failed", signal.aborted ? "The action was cancelled." : safeMessage(error)),
        visualContext: []
      };
    }
  }

  private async requestVisual(
    directive: ActionDirective,
    observation: Observation,
    signal: AbortSignal
  ): Promise<{ receipt: ActionReceipt; visualContext: MiaVisualContext[] }> {
    const provider = this.options.config.visualContextProvider;
    if (!provider) return { receipt: receipt(directive, "failed", "This product has no visual context provider."), visualContext: [] };
    const provided = await provider({ reason: directive.message, signal, observation });
    let visualContext = (Array.isArray(provided) ? provided : provided ? [provided] : []).slice(0, 5);
    if (this.options.config.privacy?.transformVisualContext) {
      visualContext = (await this.options.config.privacy.transformVisualContext(visualContext)).slice(0, 5);
    }
    if (visualContext.length === 0) return { receipt: receipt(directive, "cancelled", "Visual context permission was not granted."), visualContext: [] };
    for (const visual of visualContext) {
      if (!visual.description && !visual.data) throw new Error("Visual context requires a description or image data.");
      if (visual.data && visual.data.length > 2_000_000) throw new Error("Visual context image exceeds the 2 MB encoded limit.");
    }
    return {
      receipt: receipt(directive, "completed", "Visual context was provided for the next reasoning step.", { contextCount: visualContext.length }),
      visualContext
    };
  }

  private async hostAction(
    directive: ActionDirective,
    observation: Observation,
    signal: AbortSignal
  ): Promise<{ receipt: ActionReceipt; visualContext: MiaVisualContext[] }> {
    const definition = directive.hostAction ? this.actions.get(directive.hostAction) : undefined;
    if (!definition) return { receipt: receipt(directive, "failed", "The requested host action is not registered."), visualContext: [] };
    if (definition.risk === "blocked") return { receipt: receipt(directive, "failed", "The requested host action is blocked."), visualContext: [] };
    const result = await definition.execute(directive.arguments ?? {}, {
      signal,
      observation,
      idempotencyKey: directive.idempotencyKey
    });
    const actionReceipt = receipt(directive, result.status, result.message, result.evidence);
    if (["completed", "manual"].includes(result.status)) this.idempotentReceipts.set(directive.idempotencyKey, actionReceipt);
    return { receipt: actionReceipt, visualContext: [] };
  }

  private async pointTo(element: HTMLElement, label: string, signal: AbortSignal): Promise<void> {
    element.scrollIntoView({ behavior: prefersReducedMotion() ? "auto" : "smooth", block: "center", inline: "nearest" });
    await delay(prefersReducedMotion() ? 0 : 220, signal);
    const rect = topRect(element);
    if (rect.width <= 0 || rect.height <= 0) throw new Error("The target disappeared before Mia could point to it.");
    this.options.cursor.navigateTo(rect.left + rect.width / 2, rect.top + rect.height / 2, label);
    await delay(prefersReducedMotion() ? 0 : 420, signal);
  }

  private async navigate(directive: ActionDirective, signal: AbortSignal): Promise<ActionReceipt> {
    if (!directive.route) return receipt(directive, "failed", "The navigation action did not include a route.");
    const destination = new URL(directive.route, location.origin);
    if (destination.origin !== location.origin) return receipt(directive, "failed", "Mia can navigate only within this product.");
    const before = location.href;
    if (this.options.config.navigate) {
      await this.options.config.navigate(`${destination.pathname}${destination.search}${destination.hash}`);
      await waitFor(() => location.href !== before || normalizeRoute(location.pathname) === normalizeRoute(destination.pathname), 5_000, signal);
      return receipt(directive, "completed", "Mia navigated to the requested page.", { from: before, to: location.href, routeChanged: before !== location.href });
    }
    assertActive(signal);
    location.assign(destination.href);
    return new Promise<ActionReceipt>(() => undefined);
  }

  private async goBack(directive: ActionDirective, signal: AbortSignal): Promise<ActionReceipt> {
    const before = location.href;
    history.back();
    await waitFor(() => location.href !== before, 5_000, signal);
    return receipt(directive, "completed", "Mia returned to the previous page.", { from: before, to: location.href });
  }

  private async scrollBy(directive: ActionDirective, signal: AbortSignal): Promise<ActionReceipt> {
    const before = { x: scrollX, y: scrollY };
    window.scrollBy({ left: directive.deltaX ?? 0, top: directive.deltaY ?? 0, behavior: prefersReducedMotion() ? "auto" : "smooth" });
    await delay(prefersReducedMotion() ? 0 : 300, signal);
    return receipt(directive, "completed", "Mia scrolled the page.", { before, after: { x: scrollX, y: scrollY } });
  }

  private async wait(directive: ActionDirective, signal: AbortSignal): Promise<ActionReceipt> {
    const waitMs = Math.min(Math.max(directive.waitMs ?? 300, 1), 10_000);
    await delay(waitMs, signal);
    return receipt(directive, "completed", "Mia waited for the page state.", { waitMs });
  }
}

function resolveTarget(directive: ActionDirective, collector: AgentObservationCollector): { element?: HTMLElement; error?: string } {
  const target = directive.target;
  if (!target) return { error: "The action did not include a target." };
  if (target.nodeId) {
    const live = collector.resolveNode(target.nodeId);
    if (live) return { element: live };
  }
  for (const locator of target.locators) {
    const matches = resolveLocator(locator);
    if (matches.length === 1) return { element: matches[0] };
  }
  return { error: "The target changed and could not be resolved uniquely." };
}

function resolveLocator(locator: TargetLocator): HTMLElement[] {
  const roots = allRoots();
  const found: HTMLElement[] = [];
  for (const root of roots) {
    if (locator.strategy === "css") {
      try { found.push(...root.querySelectorAll<HTMLElement>(locator.selector)); } catch { continue; }
    } else {
      for (const element of root.querySelectorAll<HTMLElement>("*")) {
        if (!visible(element)) continue;
        const name = normalize(element.getAttribute("aria-label") || labelText(element) || element.textContent || "");
        if (locator.strategy === "role" && roleOf(element) === locator.role && (!locator.name || name === normalize(locator.name))) found.push(element);
        if (locator.strategy === "label" && labelText(element) === normalize(locator.label)) found.push(element);
        if (locator.strategy === "text" && name === normalize(locator.text) && (!locator.tagName || element.tagName.toLowerCase() === locator.tagName.toLowerCase())) found.push(element);
      }
    }
  }
  return [...new Set(found)].filter((element) => !element.closest("[data-mia-sdk-root],[data-mia-assistant-panel],[data-mia-shadow-cursor]"));
}

function allRoots(): Array<Document | ShadowRoot> {
  const roots: Array<Document | ShadowRoot> = [];
  const visit = (root: Document | ShadowRoot) => {
    roots.push(root);
    for (const element of root.querySelectorAll<HTMLElement>("*")) {
      if (element.closest("[data-mia-sdk-root],[data-mia-assistant-panel],[data-mia-shadow-cursor]")) continue;
      if (element.shadowRoot) visit(element.shadowRoot);
      if (element.tagName === "IFRAME") {
        try {
          const frame = (element as HTMLIFrameElement).contentDocument;
          if (frame && (element as HTMLIFrameElement).contentWindow?.location.origin === location.origin) visit(frame);
        } catch { /* Cross-origin frames are opaque. */ }
      }
    }
  };
  visit(document);
  return roots;
}

type ElementSnapshot = {
  url: string;
  focused: boolean;
  value?: string;
  checked?: boolean;
  selectedIndex?: number;
  expanded?: string | null;
  pressed?: string | null;
  open?: boolean;
  revision: number;
};

function snapshot(element: HTMLElement, revision: number): ElementSnapshot {
  const control = element as HTMLElement & { value?: string; checked?: boolean; selectedIndex?: number; open?: boolean };
  return {
    url: location.href,
    focused: deepActive(element.ownerDocument) === element,
    value: typeof control.value === "string" ? control.value : undefined,
    checked: typeof control.checked === "boolean" ? control.checked : undefined,
    selectedIndex: typeof control.selectedIndex === "number" ? control.selectedIndex : undefined,
    expanded: element.getAttribute("aria-expanded"),
    pressed: element.getAttribute("aria-pressed"),
    open: typeof control.open === "boolean" ? control.open : undefined,
    revision
  };
}

function verify(directive: ActionDirective, before: ElementSnapshot, after: ElementSnapshot): { verified: boolean; message: string; evidence: Record<string, unknown> } {
  const evidence = {
    routeChanged: before.url !== after.url,
    focusChanged: before.focused !== after.focused,
    valueChanged: before.value !== after.value,
    checkedChanged: before.checked !== after.checked,
    selectedIndexChanged: before.selectedIndex !== after.selectedIndex,
    expandedChanged: before.expanded !== after.expanded,
    pressedChanged: before.pressed !== after.pressed,
    openChanged: before.open !== after.open,
    domChanged: after.revision !== before.revision
  };
  const exact = directive.type === "focus" ? after.focused
    : directive.type === "fill" ? after.value === directive.value
      : directive.type === "clear" ? after.value === ""
        : directive.type === "select" ? after.value === directive.value
          : directive.type === "toggle" ? evidence.checkedChanged || evidence.pressedChanged
            : Object.values(evidence).some(Boolean);
  return {
    verified: exact,
    message: exact ? "The page state confirms the action completed." : "The action was dispatched, but the page exposed no confirming state change.",
    evidence
  };
}

function setControlValue(element: HTMLElement, value: string): void {
  const view = element.ownerDocument.defaultView ?? window;
  const tag = element.tagName.toLowerCase();
  if (tag === "input" || tag === "textarea") {
    const prototype = tag === "input" ? view.HTMLInputElement.prototype : view.HTMLTextAreaElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
    if (!setter) throw new Error("The target does not expose a writable value.");
    setter.call(element, value);
    element.dispatchEvent(new view.Event("input", { bubbles: true, composed: true }));
    element.dispatchEvent(new view.Event("change", { bubbles: true, composed: true }));
    return;
  }
  if (element.isContentEditable) {
    element.textContent = value;
    element.dispatchEvent(new view.InputEvent("input", { bubbles: true, composed: true, inputType: "insertText", data: value }));
    return;
  }
  throw new Error("The target is not an editable control.");
}

function selectValue(element: HTMLElement, value: string): void {
  if (element.tagName.toLowerCase() !== "select") throw new Error("The target is not a select control.");
  const select = element as HTMLSelectElement;
  if (![...select.options].some((option) => option.value === value)) throw new Error("The requested option is not available.");
  select.value = value;
  const view = element.ownerDocument.defaultView ?? window;
  select.dispatchEvent(new view.Event("input", { bubbles: true, composed: true }));
  select.dispatchEvent(new view.Event("change", { bubbles: true, composed: true }));
}

function pressKey(element: HTMLElement, key: string | undefined): void {
  const normalized = key?.trim();
  if (!normalized || !["Enter", "Escape", "Tab", " ", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Home", "End"].includes(normalized)) {
    throw new Error("The requested key is not supported.");
  }
  const view = element.ownerDocument.defaultView ?? window;
  element.focus({ preventScroll: true });
  const init = { key: normalized, bubbles: true, cancelable: true, composed: true };
  const accepted = element.dispatchEvent(new view.KeyboardEvent("keydown", init));
  element.dispatchEvent(new view.KeyboardEvent("keyup", init));
  if (accepted && (normalized === "Enter" || normalized === " ") && ["button", "a"].includes(element.tagName.toLowerCase())) element.click();
}

function dispatchHover(element: HTMLElement): void {
  const view = element.ownerDocument.defaultView ?? window;
  const rect = element.getBoundingClientRect();
  const init = { bubbles: true, cancelable: true, composed: true, clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2 };
  element.dispatchEvent(new view.MouseEvent("mouseover", init));
  element.dispatchEvent(new view.MouseEvent("mouseenter", { ...init, bubbles: false }));
  element.dispatchEvent(new view.MouseEvent("mousemove", init));
}

function showHighlight(element: HTMLElement): () => void {
  const overlay = document.createElement("div");
  overlay.dataset.miaSdkRoot = "highlight";
  const rect = topRect(element);
  overlay.style.cssText = `position:fixed;z-index:2147483644;pointer-events:none;left:${rect.left - 4}px;top:${rect.top - 4}px;width:${rect.width + 8}px;height:${rect.height + 8}px;border:2px solid #35d6b2;border-radius:6px;box-shadow:0 0 0 4px rgba(53,214,178,.18),0 10px 34px rgba(4,16,24,.22);transition:opacity .22s ease`;
  document.body.append(overlay);
  return () => { overlay.style.opacity = "0"; window.setTimeout(() => overlay.remove(), 240); };
}

function topRect(element: HTMLElement): DOMRect {
  const rect = element.getBoundingClientRect();
  let left = rect.left;
  let top = rect.top;
  let view = element.ownerDocument.defaultView;
  while (view && view !== window) {
    const frame = view.frameElement as HTMLElement | null;
    if (!frame) break;
    const frameRect = frame.getBoundingClientRect();
    left += frameRect.left;
    top += frameRect.top;
    view = frame.ownerDocument.defaultView;
  }
  return new DOMRect(left, top, rect.width, rect.height);
}

function roleOf(element: HTMLElement): string | undefined {
  const explicit = element.getAttribute("role")?.trim();
  if (explicit) return explicit;
  const tag = element.tagName.toLowerCase();
  if (tag === "button") return "button";
  if (tag === "a" && element.hasAttribute("href")) return "link";
  if (tag === "textarea" || tag === "input") return "textbox";
  if (tag === "select") return "combobox";
  return undefined;
}

function labelText(element: HTMLElement): string {
  const labels = (element as HTMLInputElement).labels;
  return normalize(labels?.[0]?.textContent || "");
}

function visible(element: HTMLElement): boolean {
  const view = element.ownerDocument.defaultView ?? window;
  const style = view.getComputedStyle(element);
  const rect = element.getBoundingClientRect();
  return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
}

function deepActive(document_: Document): Element | null {
  let active = document_.activeElement;
  while (isHtmlElement(active) && active.shadowRoot?.activeElement) active = active.shadowRoot.activeElement;
  return active;
}

function isHtmlElement(value: unknown): value is HTMLElement {
  if (!value || typeof value !== "object") return false;
  const candidate = value as { nodeType?: unknown; tagName?: unknown; ownerDocument?: unknown };
  return candidate.nodeType === 1 && typeof candidate.tagName === "string" && Boolean(candidate.ownerDocument);
}

function inViewport(rect: DOMRect): boolean {
  return rect.right > 0 && rect.bottom > 0 && rect.left < innerWidth && rect.top < innerHeight;
}

function receipt(directive: ActionDirective, status: ActionReceipt["status"], message: string, evidence: Record<string, unknown> = {}): ActionReceipt {
  return {
    actionId: directive.actionId,
    idempotencyKey: directive.idempotencyKey,
    type: directive.type,
    status,
    message: message.slice(0, 2_000),
    targetRef: directive.target?.ref,
    route: `${location.pathname}${location.search}`,
    evidence
  };
}

function settle(signal: AbortSignal): Promise<void> {
  return delay(prefersReducedMotion() ? 50 : 250, signal);
}

function delay(ms: number, signal: AbortSignal): Promise<void> {
  assertActive(signal);
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(resolve, ms);
    signal.addEventListener("abort", () => { window.clearTimeout(timer); reject(signal.reason ?? new DOMException("Aborted", "AbortError")); }, { once: true });
  });
}

async function waitFor(predicate: () => boolean, timeoutMs: number, signal: AbortSignal): Promise<void> {
  const deadline = performance.now() + timeoutMs;
  while (!predicate()) {
    if (performance.now() >= deadline) throw new Error("The page did not reach the expected state in time.");
    await delay(50, signal);
  }
}

function assertActive(signal: AbortSignal): void {
  if (signal.aborted) throw signal.reason ?? new DOMException("Aborted", "AbortError");
}

function normalizeRoute(value: string): string {
  const path = value.split(/[?#]/, 1)[0] || "/";
  return path.length > 1 ? path.replace(/\/+$/, "") : path;
}

function normalize(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function safeMessage(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).replace(/\b[A-Za-z0-9_-]{32,}\b/g, "[redacted]").slice(0, 2_000);
}
