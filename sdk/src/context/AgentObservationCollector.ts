import type { MiaOptions, Observation, ObservationNode, RiskLevel, TargetLocator } from "../types/index.js";

const MAX_NODES = 500;
const MAX_PAGE_TEXT = 20_000;
const CANDIDATE_SELECTOR = [
  "a[href]", "button", "input:not([type='hidden'])", "textarea", "select", "option", "summary",
  "[contenteditable='true']", "[role]", "[tabindex]:not([tabindex='-1'])", "[aria-label]",
  "[aria-labelledby]", "[data-mia-key]", "[data-testid]", "h1", "h2", "h3", "h4", "main",
  "nav", "aside", "section", "form", "table", "dialog", "canvas", "img"
].join(",");
const DEFAULT_SECRET_PATTERNS = [
  /\b(?:bearer\s+)?[A-Za-z0-9_-]{32,}\b/gi,
  /\b(?:\d[ -]*?){13,19}\b/g,
  /((?:password|passcode|secret|token|api.?key|cvv|cvc|ssn)\s*[:=]\s*)\S+/gi
];

type RootContext = { root: Document | ShadowRoot; frameId: string; offsetX: number; offsetY: number };

export class AgentObservationCollector {
  private readonly elementsByNodeId = new Map<string, HTMLElement>();
  private readonly idByElement = new WeakMap<Element, string>();
  private readonly observers = new Map<Node, MutationObserver>();
  private readonly rootListeners = new Map<Node, () => void>();
  private readonly listeners: Array<() => void> = [];
  private hovered?: HTMLElement;
  private revision = 0;
  private destroyed = false;

  private readonly options: MiaOptions;
  private readonly localRedactedSelectors: string[];

  constructor(options: MiaOptions) {
    this.localRedactedSelectors = [...(options.privacy?.redactedSelectors ?? [])];
    this.options = {
      ...options,
      privacy: {
        ...options.privacy,
        redactedSelectors: this.localRedactedSelectors
      }
    };
    this.installTracking();
  }

  setRuntimeRedactedSelectors(selectors: string[]): void {
    const effective = [...new Set([...this.localRedactedSelectors, ...selectors.map((selector) => selector.trim()).filter(Boolean)])];
    this.options.privacy = { ...this.options.privacy, redactedSelectors: effective };
  }

  collect(): Observation {
    this.assertActive();
    this.revision += 1;
    this.elementsByNodeId.clear();
    const roots = collectRoots();
    this.pruneRoots(new Set(roots.map(({ root }) => root)));
    for (const context of roots) this.observe(context.root);
    const focused = deepActiveElement(document);
    const counts = new Map<string, number>();
    const candidates: Array<{ element: HTMLElement; context: RootContext }> = [];
    for (const context of roots) {
      for (const element of context.root.querySelectorAll<HTMLElement>(CANDIDATE_SELECTOR)) {
        if (this.canObserve(element)) candidates.push({ element, context });
      }
    }
    if (focused && this.canObserve(focused) && !candidates.some((candidate) => candidate.element === focused)) {
      candidates.push({ element: focused, context: contextForElement(focused, roots) });
    }
    if (this.hovered && this.canObserve(this.hovered) && !candidates.some((candidate) => candidate.element === this.hovered)) {
      candidates.push({ element: this.hovered, context: contextForElement(this.hovered, roots) });
    }
    const nodes = candidates
      .map(({ element, context }) => this.inspect(element, context, counts))
      .filter((node): node is ObservationNode => Boolean(node))
      .sort((left, right) => priority(right, focused, this.hovered, this.elementsByNodeId) - priority(left, focused, this.hovered, this.elementsByNodeId))
      .slice(0, MAX_NODES);
    const included = new Set(nodes.map((node) => node.nodeId));
    for (const nodeId of [...this.elementsByNodeId.keys()]) if (!included.has(nodeId)) this.elementsByNodeId.delete(nodeId);
    const route = `${window.location.pathname}${this.options.privacy?.includeUrlQuery ? window.location.search : ""}`;
    const observation: Observation = {
      id: `observation_${randomId()}`,
      revision: this.revision,
      url: this.options.privacy?.includeUrlQuery ? window.location.href : `${window.location.origin}${window.location.pathname}`,
      route: route || "/",
      title: this.options.privacy?.includePageTitle === true ? redact(document.title, this.options) : undefined,
      viewport: { width: window.innerWidth, height: window.innerHeight, scrollX: window.scrollX, scrollY: window.scrollY },
      focusedNodeId: focused ? this.idByElement.get(focused) : undefined,
      hoveredNodeId: this.hovered ? this.idByElement.get(this.hovered) : undefined,
      selectedText: selectedText(roots, this.options),
      pageText: this.options.privacy?.includePageText === false ? undefined : collectPageText(roots, this.options),
      nodes
    };
    return this.options.privacy?.transformObservation?.(observation) ?? observation;
  }

  resolveNode(nodeId: string): HTMLElement | undefined {
    const element = this.elementsByNodeId.get(nodeId);
    if (!element?.isConnected || !this.canObserve(element)) {
      this.elementsByNodeId.delete(nodeId);
      return undefined;
    }
    return element;
  }

  getRevision(): number {
    return this.revision;
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    for (const observer of this.observers.values()) observer.disconnect();
    this.observers.clear();
    for (const remove of this.rootListeners.values()) remove();
    this.rootListeners.clear();
    for (const remove of this.listeners.splice(0)) remove();
    this.elementsByNodeId.clear();
  }

  private inspect(element: HTMLElement, context: RootContext, counts: Map<string, number>): ObservationNode | undefined {
    const view = element.ownerDocument.defaultView;
    if (!view) return undefined;
    const rect = element.getBoundingClientRect();
    const bounds = { x: rect.x + context.offsetX, y: rect.y + context.offsetY, width: rect.width, height: rect.height };
    const role = element.getAttribute("role")?.trim() || implicitRole(element);
    const name = redact(accessibleName(element), this.options).slice(0, 500) || undefined;
    const description = redact(describedText(element), this.options).slice(0, 1_000) || undefined;
    const sensitive = isSensitive(element, this.options);
    const text = sensitive ? undefined : redact(readElementText(element), this.options).slice(0, 2_000) || undefined;
    const fingerprint = stableElementFingerprint(element, role, name, context.frameId);
    const ordinal = counts.get(fingerprint) ?? 0;
    counts.set(fingerprint, ordinal + 1);
    const nodeId = this.idByElement.get(element) ?? `node_${fnv1a(`${fingerprint}|${ordinal}`)}`;
    this.idByElement.set(element, nodeId);
    this.elementsByNodeId.set(nodeId, element);
    return {
      nodeId,
      frameId: context.frameId === "top" ? undefined : context.frameId,
      tagName: element.tagName.toLowerCase(),
      role,
      name,
      description,
      text,
      value: sensitive ? undefined : redact(readValue(element), this.options).slice(0, 2_000) || undefined,
      inputType: inputTypeForElement(element),
      formAssociated: isFormAssociated(element),
      formSubmitter: isFormSubmitter(element),
      route: routeForElement(element),
      elementKey: element.dataset.miaKey?.slice(0, 300),
      locators: buildLocators(element, role, name),
      bounds,
      viewportVisible: intersectsViewport(bounds),
      disabled: booleanProperty(element, "disabled", "aria-disabled"),
      checked: checkedState(element),
      selected: booleanProperty(element, "selected", "aria-selected"),
      expanded: ariaBoolean(element, "aria-expanded"),
      hasPopup: element.getAttribute("aria-haspopup")?.slice(0, 50) || undefined,
      pressed: ariaBoolean(element, "aria-pressed"),
      required: booleanProperty(element, "required", "aria-required"),
      readOnly: booleanProperty(element, "readOnly", "aria-readonly"),
      sensitive,
      actionPolicy: readActionPolicy(element)
    };
  }

  private canObserve(element: HTMLElement): boolean {
    if (!element.isConnected || isSdkElement(element) || isRedacted(element, this.options)) return false;
    const view = element.ownerDocument.defaultView;
    if (!view) return false;
    const style = view.getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return style.display !== "none" && style.visibility !== "hidden" && style.visibility !== "collapse"
      && (!style.opacity || Number(style.opacity) !== 0) && rect.width > 0 && rect.height > 0;
  }

  private observe(root: Document | ShadowRoot): void {
    if (!this.observers.has(root)) {
      const view = ownerWindow(root);
      const Observer = view
        ? (view as unknown as { MutationObserver: typeof MutationObserver }).MutationObserver
        : MutationObserver;
      const observer = new Observer((records) => {
        if (records.some(isProductMutation)) this.revision += 1;
      });
      observer.observe(root, { childList: true, subtree: true, attributes: true, characterData: true });
      this.observers.set(root, observer);
    }
    this.trackRoot(root);
  }

  private installTracking(): void {
    const changed = () => { this.revision += 1; };
    window.addEventListener("scroll", changed, true);
    window.addEventListener("popstate", changed);
    window.addEventListener("hashchange", changed);
    this.listeners.push(
      () => window.removeEventListener("scroll", changed, true),
      () => window.removeEventListener("popstate", changed),
      () => window.removeEventListener("hashchange", changed)
    );
  }

  private trackRoot(root: Document | ShadowRoot): void {
    if (this.rootListeners.has(root)) return;
    const changed = () => { this.revision += 1; };
    const hover = (event: Event) => {
      this.hovered = event.composedPath().find((value): value is HTMLElement => isHtmlElement(value) && !isSdkElement(value));
    };
    root.addEventListener("pointerover", hover, true);
    root.addEventListener("focusin", changed, true);
    root.addEventListener("input", changed, true);
    root.addEventListener("change", changed, true);
    root.addEventListener("scroll", changed, true);
    this.rootListeners.set(root, () => {
      root.removeEventListener("pointerover", hover, true);
      root.removeEventListener("focusin", changed, true);
      root.removeEventListener("input", changed, true);
      root.removeEventListener("change", changed, true);
      root.removeEventListener("scroll", changed, true);
    });
  }

  private pruneRoots(active: Set<Node>): void {
    for (const [root, observer] of this.observers) {
      if (active.has(root)) continue;
      observer.disconnect();
      this.observers.delete(root);
      this.rootListeners.get(root)?.();
      this.rootListeners.delete(root);
    }
  }

  private assertActive(): void {
    if (this.destroyed) throw new Error("Mia observation collector has been destroyed.");
  }
}

function collectRoots(): RootContext[] {
  const roots: RootContext[] = [];
  const visited = new Set<Node>();
  const visit = (root: Document | ShadowRoot, frameId: string, offsetX: number, offsetY: number) => {
    if (visited.has(root)) return;
    visited.add(root);
    roots.push({ root, frameId, offsetX, offsetY });
    for (const element of root.querySelectorAll<HTMLElement>("*")) {
      if (isSdkElement(element)) continue;
      if (element.shadowRoot) visit(element.shadowRoot, frameId, offsetX, offsetY);
      if (tagName(element) === "iframe") {
        const frame = element as HTMLIFrameElement;
        try {
          const child = frame.contentDocument;
          if (!child || !isSameOriginFrame(frame)) continue;
          const rect = frame.getBoundingClientRect();
          visit(child, `${frameId}.${fnv1a(frame.name || frame.id || String(roots.length))}`, offsetX + rect.left, offsetY + rect.top);
        } catch {
          // Cross-origin frames are intentionally opaque.
        }
      }
    }
  };
  visit(document, "top", 0, 0);
  return roots;
}

function contextForElement(element: HTMLElement, roots: RootContext[]): RootContext {
  return roots.find((context) => context.root === element.getRootNode()) ?? { root: document, frameId: "top", offsetX: 0, offsetY: 0 };
}

function deepActiveElement(document_: Document | ShadowRoot): HTMLElement | undefined {
  let active = document_.activeElement;
  while (isHtmlElement(active) && active.shadowRoot?.activeElement) active = active.shadowRoot.activeElement;
  if (isHtmlElement(active) && tagName(active) === "iframe") {
    const frame = active as HTMLIFrameElement;
    try { return frame.contentDocument ? deepActiveElement(frame.contentDocument) ?? frame : frame; } catch { return frame; }
  }
  return isHtmlElement(active) ? active : undefined;
}

function implicitRole(element: HTMLElement): string | undefined {
  const tag = element.tagName.toLowerCase();
  if (tag === "a" && element.hasAttribute("href")) return "link";
  if (tag === "button") return "button";
  if (tag === "textarea" || element.isContentEditable) return "textbox";
  if (tag === "select") return (element as HTMLSelectElement).multiple ? "listbox" : "combobox";
  if (tag === "option") return "option";
  if (tag === "summary") return "button";
  if (/^h[1-6]$/.test(tag)) return "heading";
  if (tag === "main" || tag === "nav" || tag === "form" || tag === "table" || tag === "dialog") return tag;
  if (tag === "input") {
    const type = (element as HTMLInputElement).type;
    if (["button", "submit", "reset", "image"].includes(type)) return "button";
    if (type === "checkbox") return "checkbox";
    if (type === "radio") return "radio";
    if (type === "range") return "slider";
    if (type === "number") return "spinbutton";
    if (type === "search") return "searchbox";
    return "textbox";
  }
  if (tag === "img") return "img";
  return undefined;
}

function accessibleName(element: HTMLElement): string {
  const labelled = element.getAttribute("aria-labelledby")?.split(/\s+/).map((id) => element.ownerDocument.getElementById(id)?.textContent ?? "").join(" ").trim();
  const label = labelText(element);
  const input = tagName(element) === "input" ? element as HTMLInputElement : undefined;
  const value = input && ["button", "submit", "reset"].includes(input.type) ? input.value : "";
  return normalize(element.getAttribute("aria-label") || labelled || label || element.getAttribute("alt") || value || element.textContent || "");
}

function describedText(element: HTMLElement): string {
  const direct = element.getAttribute("aria-description") || element.getAttribute("title");
  if (direct) return normalize(direct);
  return normalize(element.getAttribute("aria-describedby")?.split(/\s+/).map((id) => element.ownerDocument.getElementById(id)?.textContent ?? "").join(" ") || "");
}

function labelText(element: HTMLElement): string {
  if (["input", "textarea", "select"].includes(tagName(element))) {
    return normalize((element as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement).labels?.[0]?.textContent || "");
  }
  return "";
}

function readElementText(element: HTMLElement): string {
  if (["input", "textarea", "select"].includes(tagName(element))) return "";
  return normalize(element.textContent || "");
}

function readValue(element: HTMLElement): string {
  if (["input", "textarea", "select"].includes(tagName(element))) return normalize((element as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement).value);
  return element.isContentEditable ? normalize(element.textContent || "") : "";
}

function inputTypeForElement(element: HTMLElement): string | undefined {
  const tag = tagName(element);
  if (tag === "input" || tag === "button") return (element as HTMLInputElement | HTMLButtonElement).type.toLowerCase();
  return undefined;
}

function isFormAssociated(element: HTMLElement): boolean {
  const tag = tagName(element);
  if (!["button", "input", "select", "textarea"].includes(tag)) return false;
  return Boolean((element as HTMLButtonElement | HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement).form);
}

function isFormSubmitter(element: HTMLElement): boolean {
  const type = inputTypeForElement(element);
  return isFormAssociated(element) && (type === "submit" || type === "image");
}

function buildLocators(element: HTMLElement, role?: string, name?: string): TargetLocator[] {
  const locators: TargetLocator[] = [];
  if (role && name) locators.push({ strategy: "role", role, name });
  const label = labelText(element);
  if (label) locators.push({ strategy: "label", label });
  for (const attribute of ["data-mia-key", "data-testid"] as const) {
    const value = element.getAttribute(attribute);
    if (value) locators.push({ strategy: "css", selector: `[${attribute}="${escapeCssString(value)}"]` });
  }
  if (element.id) locators.push({ strategy: "css", selector: `#${cssEscape(element.id)}` });
  if (name && ["a", "button", "h1", "h2", "h3", "h4"].includes(element.tagName.toLowerCase())) {
    locators.push({ strategy: "text", text: name, tagName: element.tagName.toLowerCase() });
  }
  return locators.slice(0, 12);
}

function stableElementFingerprint(element: HTMLElement, role: string | undefined, name: string | undefined, frameId: string): string {
  const explicit = element.dataset.miaKey || element.getAttribute("data-testid") || element.id;
  if (explicit) return `${frameId}|explicit:${explicit}`;
  const ancestors: string[] = [];
  let current: HTMLElement | null = element.parentElement;
  while (current && ancestors.length < 4) {
    const landmark = current.dataset.miaKey || current.id || current.getAttribute("role") || current.tagName.toLowerCase();
    ancestors.unshift(landmark);
    current = current.parentElement;
  }
  return `${frameId}|${ancestors.join("/")}|${role ?? element.tagName.toLowerCase()}|${name ?? ""}`;
}

function isSensitive(element: HTMLElement, options: MiaOptions): boolean {
  if (element.matches("[data-mia-private],[data-private]") || isRedacted(element, options)) return true;
  const tag = tagName(element);
  if (tag !== "input" && tag !== "textarea") return false;
  const control = element as HTMLInputElement | HTMLTextAreaElement;
  const type = tag === "input" ? (control as HTMLInputElement).type.toLowerCase() : "";
  const autocomplete = control.getAttribute("autocomplete")?.toLowerCase() ?? "";
  const semantic = [
    type,
    autocomplete,
    control.getAttribute("name"),
    control.id,
    control.getAttribute("aria-label"),
    control.getAttribute("placeholder"),
    control.getAttribute("title"),
    accessibleName(element),
    describedText(element)
  ].filter(Boolean).join(" ").replace(/[_-]+/g, " ");
  return ["password", "hidden", "file"].includes(type)
    || autocomplete.split(/\s+/).some((token) => ["current-password", "new-password", "one-time-code", "webauthn"].includes(token) || token.startsWith("cc-") || token.startsWith("transaction-"))
    || /\b(password|passcode|passphrase|pin|otp|one time code|verification code|authentication code|security code|recovery code|token|secret|api key|access key|private key|seed phrase|credit card|debit card|card number|payment|cvv|cvc|bank account|routing number|ssn|social security|tax id|webauthn|passkey|captcha)\b/i.test(semantic);
}

function isRedacted(element: HTMLElement, options: MiaOptions): boolean {
  return (options.privacy?.redactedSelectors ?? []).some((selector) => {
    try { return Boolean(element.closest(selector)); } catch { return false; }
  });
}

function isSdkElement(element: Element): boolean {
  return Boolean(element.closest("[data-mia-sdk-root],[data-mia-assistant-panel],[data-mia-shadow-cursor],[data-mia-prompt-ui]"));
}

function isProductMutation(record: MutationRecord): boolean {
  if (record.type !== "childList") return !isSdkNode(record.target);
  if (isSdkNode(record.target)) return false;
  const changed = [...record.addedNodes, ...record.removedNodes];
  return changed.length === 0 || changed.some((node) => !isSdkNode(node));
}

function isSdkNode(node: Node): boolean {
  const element = node.nodeType === 1 ? node as Element : node.parentElement;
  return Boolean(element && isSdkElement(element));
}

function collectPageText(roots: RootContext[], options: MiaOptions): string | undefined {
  const chunks: string[] = [];
  let length = 0;
  for (const { root } of roots) {
    const document_ = documentForRoot(root);
    const textRoot = root.nodeType === Node.DOCUMENT_NODE ? document_.body : root;
    if (!textRoot) continue;
    const walker = document_.createTreeWalker(textRoot, NodeFilter.SHOW_TEXT);
    let node = walker.nextNode();
    while (node && length < MAX_PAGE_TEXT) {
      const parent = node.parentElement;
      if (parent && !isSdkElement(parent) && !isRedacted(parent, options) && !isSensitive(parent, options) && !["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE"].includes(parent.tagName)) {
        const text = redact(normalize(node.textContent || ""), options);
        if (text) {
          const value = text.slice(0, MAX_PAGE_TEXT - length);
          chunks.push(value);
          length += value.length + 1;
        }
      }
      node = walker.nextNode();
    }
    if (length >= MAX_PAGE_TEXT) break;
  }
  return chunks.join(" ").replace(/\s+/g, " ").trim() || undefined;
}

function selectedText(roots: RootContext[], options: MiaOptions): string | undefined {
  const documents = new Set(roots.map(({ root }) => documentForRoot(root)));
  for (const document_ of documents) {
    const selection = document_.defaultView?.getSelection();
    if (!selection || selection.isCollapsed || selection.rangeCount === 0) continue;
    const ancestor = selection.getRangeAt(0).commonAncestorContainer;
    const element = isHtmlElement(ancestor) ? ancestor : ancestor.parentElement;
    if (!element || isSdkElement(element) || isRedacted(element, options) || isSensitive(element, options)) continue;
    const value = redact(normalize(selection.toString()), options).slice(0, 2_000);
    if (value) return value;
  }
  return undefined;
}

export function redact(value: string, options: MiaOptions): string {
  let result = value;
  for (const pattern of [...DEFAULT_SECRET_PATTERNS, ...(options.privacy?.sensitivePatterns ?? [])]) {
    result = result.replace(new RegExp(pattern.source, pattern.flags), "[redacted]");
  }
  return result;
}

function checkedState(element: HTMLElement): boolean | undefined {
  if (tagName(element) === "input") {
    const input = element as HTMLInputElement;
    if (["checkbox", "radio"].includes(input.type)) return input.checked;
  }
  return ariaBoolean(element, "aria-checked");
}

function booleanProperty(element: HTMLElement, property: "disabled" | "selected" | "required" | "readOnly", aria: string): boolean | undefined {
  const ariaValue = ariaBoolean(element, aria);
  if (ariaValue !== undefined) return ariaValue;
  return property in element ? Boolean((element as unknown as Record<string, unknown>)[property]) : undefined;
}

function ariaBoolean(element: Element, attribute: string): boolean | undefined {
  const value = element.getAttribute(attribute);
  return value === "true" ? true : value === "false" ? false : undefined;
}

function readActionPolicy(element: HTMLElement): RiskLevel | "guide_only" | undefined {
  const value = element.dataset.miaPolicy;
  return ["read", "navigate", "reversible_write", "manual", "blocked", "guide_only"].includes(value ?? "")
    ? value as RiskLevel | "guide_only"
    : undefined;
}

function routeForElement(element: HTMLElement): string | undefined {
  if (tagName(element) === "a") {
    try {
      const url = new URL((element as HTMLAnchorElement).href, element.ownerDocument.baseURI);
      return url.origin === window.location.origin ? `${url.pathname}${url.search}${url.hash}` : undefined;
    } catch { return undefined; }
  }
  return undefined;
}

function tagName(element: Element): string {
  return element.tagName.toLowerCase();
}

function isHtmlElement(value: unknown): value is HTMLElement {
  if (!value || typeof value !== "object") return false;
  const candidate = value as { nodeType?: unknown; tagName?: unknown; ownerDocument?: unknown };
  return candidate.nodeType === 1 && typeof candidate.tagName === "string" && Boolean(candidate.ownerDocument);
}

function ownerWindow(root: Document | ShadowRoot): Window | null {
  return documentForRoot(root).defaultView;
}

function documentForRoot(root: Document | ShadowRoot): Document {
  if (root.nodeType === 9) return root as Document;
  if (!root.ownerDocument) throw new Error("Mia encountered a detached shadow root.");
  return root.ownerDocument;
}

function isSameOriginFrame(frame: HTMLIFrameElement): boolean {
  try {
    const location_ = frame.contentWindow?.location;
    return Boolean(location_ && (location_.origin === window.location.origin || location_.protocol === "about:"));
  } catch {
    return false;
  }
}

function priority(node: ObservationNode, focused: HTMLElement | undefined, hovered: HTMLElement | undefined, registry: Map<string, HTMLElement>): number {
  const element = registry.get(node.nodeId);
  let score = node.viewportVisible ? 100 : 0;
  if (element === focused) score += 1_000;
  if (element === hovered) score += 900;
  if (["button", "link", "textbox", "checkbox", "radio", "switch", "combobox", "option", "tab", "menuitem"].includes(node.role ?? "")) score += 400;
  if (node.elementKey) score += 200;
  if (node.name) score += 80;
  return score;
}

function intersectsViewport(bounds: ObservationNode["bounds"]): boolean {
  return bounds.x + bounds.width > 0 && bounds.y + bounds.height > 0 && bounds.x < window.innerWidth && bounds.y < window.innerHeight;
}

function normalize(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function escapeCssString(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function cssEscape(value: string): string {
  const escape = globalThis.CSS?.escape;
  return typeof escape === "function" ? escape(value) : value.replace(/[^a-zA-Z0-9_-]/g, (character) => `\\${character.codePointAt(0)?.toString(16)} `);
}

function randomId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

function fnv1a(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}
