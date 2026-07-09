import type { RuntimeElementContext, SDKConfig, SDKRuntimeContext, TargetLocator } from "../types/index.js";

let hoveredElement: Element | null = null;

export function installRuntimeContextTracking(): () => void {
  const trackHoveredElement = (event: PointerEvent) => {
    hoveredElement = event.target instanceof Element ? event.target : null;
  };
  document.addEventListener("pointerover", trackHoveredElement, { capture: true });
  return () => {
    document.removeEventListener("pointerover", trackHoveredElement, { capture: true });
    hoveredElement = null;
  };
}

export function collectRuntimeContext(config: SDKConfig, sessionId: string): SDKRuntimeContext {
  const currentUrl = config.privacy?.includeUrlQuery
    ? window.location.href
    : `${window.location.origin}${window.location.pathname}`;
  return {
    appId: config.appId,
    sessionId,
    currentUrl,
    currentRoute: window.location.pathname,
    pageTitle: config.privacy?.includePageTitle ? document.title : undefined,
    focusedElement: inspectElement(document.activeElement, config),
    hoveredElement: inspectElement(hoveredElement, config),
    visibleElements: collectVisibleElements(config),
    userMetadata: config.privacy?.includeUserMetadata ? config.user?.metadata : undefined
  };
}

function collectVisibleElements(config: SDKConfig): RuntimeElementContext[] {
  const nodes = Array.from(document.querySelectorAll([
    "button",
    "a",
    "input",
    "textarea",
    "select",
    "[contenteditable='true']",
    "[data-ai-id]",
    "[data-testid]",
    "[role='button']",
    "[role='checkbox']",
    "[role='combobox']",
    "[role='link']",
    "[role='menuitem']",
    "[role='menuitemcheckbox']",
    "[role='menuitemradio']",
    "[role='option']",
    "[role='switch']",
    "[role='tab']",
    "[tabindex]:not([tabindex='-1'])"
  ].join(",")));
  const inspected = nodes
    .filter((node) => {
      if (node instanceof HTMLElement && isSdkOwnedElement(node)) return false;
      if (node instanceof HTMLElement && isRedactedElement(node, config)) return false;
      const rect = (node as HTMLElement).getBoundingClientRect();
      return rect.width > 0 && rect.height > 0 && rect.bottom >= 0 && rect.right >= 0 && rect.top <= window.innerHeight && rect.left <= window.innerWidth;
    })
    .map((node) => inspectElement(node, config))
    .filter(Boolean) as RuntimeElementContext[];
  const focused = inspectElement(document.activeElement, config);
  const hovered = inspectElement(hoveredElement, config);
  return inspected
    .sort((left, right) => elementPriority(right, focused, hovered) - elementPriority(left, focused, hovered))
    .filter(uniqueElementContext)
    .slice(0, 40);
}

function inspectElement(node: Element | null, config: SDKConfig): RuntimeElementContext | undefined {
  if (!node || !(node instanceof HTMLElement)) return undefined;
  if (isSdkOwnedElement(node)) return undefined;
  if (isRedactedElement(node, config)) return undefined;
  const rect = node.getBoundingClientRect();
  const redactText = config.privacy?.redactText !== false || isSensitiveInput(node);
  const locators = locatorsForElement(node, redactText);
  const selector = locators.find((locator): locator is Extract<TargetLocator, { strategy: "css" }> => locator.strategy === "css")?.selector;
  return {
    tagName: node.tagName,
    role: node.getAttribute("role") ?? undefined,
    label: redactText ? undefined : readableLabel(node),
    text: redactText ? undefined : readableText(node),
    selector,
    locators,
    elementId: node.getAttribute("data-ai-id") ?? node.getAttribute("data-testid") ?? (node.id || undefined),
    boundingBox: { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
  };
}

function readableLabel(node: HTMLElement): string | undefined {
  const ariaLabel = node.getAttribute("aria-label")?.trim();
  if (ariaLabel) return ariaLabel;

  const labelledBy = node.getAttribute("aria-labelledby");
  if (labelledBy) {
    const label = labelledBy
      .split(/\s+/)
      .map((id) => document.getElementById(id)?.innerText?.trim() || document.getElementById(id)?.textContent?.trim())
      .filter(Boolean)
      .join(" ")
      .trim();
    if (label) return label;
  }

  if (node.id) {
    const explicitLabel = document.querySelector(`label[for="${cssEscape(node.id)}"]`)?.textContent?.trim();
    if (explicitLabel) return explicitLabel;
  }

  if (node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement) {
    return firstNonEmpty(node.placeholder, node.name, node.id);
  }

  if (node instanceof HTMLSelectElement) {
    return firstNonEmpty(node.name, node.id);
  }

  return readableText(node);
}

function readableText(node: HTMLElement): string | undefined {
  return firstNonEmpty(node.innerText, node.textContent);
}

function locatorsForElement(node: HTMLElement, redactText: boolean): TargetLocator[] {
  const locators: TargetLocator[] = [];
  const dataAiId = node.getAttribute("data-ai-id");
  if (dataAiId) locators.push({ strategy: "css", selector: `[data-ai-id='${cssString(dataAiId)}']` });
  const testId = node.getAttribute("data-testid");
  if (testId) locators.push({ strategy: "css", selector: `[data-testid='${cssString(testId)}']` });
  if (node.id) locators.push({ strategy: "css", selector: `[id='${cssString(node.id)}']` });
  const name = node.getAttribute("name");
  if (name) locators.push({ strategy: "css", selector: `${node.tagName.toLowerCase()}[name='${cssString(name)}']` });

  const role = explicitOrImplicitRole(node);
  const label = redactText ? undefined : readableLabel(node);
  if (role) locators.push({ strategy: "role", role, name: label });
  if (label && (node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement || node instanceof HTMLSelectElement)) {
    locators.push({ strategy: "label", label });
  }
  const text = redactText ? undefined : readableText(node);
  if (text && isTextTarget(node, role)) locators.push({ strategy: "text", text, tagName: node.tagName.toLowerCase() });
  return uniqueLocators(locators);
}

function firstNonEmpty(...values: Array<string | null | undefined>): string | undefined {
  for (const value of values) {
    const trimmed = value?.trim();
    if (trimmed) return trimmed;
  }
  return undefined;
}

function cssEscape(value: string): string {
  return typeof CSS !== "undefined" && typeof CSS.escape === "function"
    ? CSS.escape(value)
    : value.replace(/["'\\]/g, "\\$&");
}

function cssString(value: string): string {
  return Array.from(value).map((character) => {
    const code = character.codePointAt(0) ?? 0;
    if (character === "\\" || character === "'") return `\\${character}`;
    if (code === 0) return "\\fffd ";
    if (code < 0x20 || code === 0x7f) return `\\${code.toString(16)} `;
    return character;
  }).join("");
}

function explicitOrImplicitRole(node: HTMLElement): string | undefined {
  const explicit = node.getAttribute("role")?.trim();
  if (explicit) return explicit;
  if (node instanceof HTMLButtonElement || node.tagName === "SUMMARY") return "button";
  if (node instanceof HTMLAnchorElement && node.hasAttribute("href")) return "link";
  if (node instanceof HTMLTextAreaElement) return "textbox";
  if (node instanceof HTMLSelectElement) return "combobox";
  if (node instanceof HTMLInputElement) {
    if (node.type === "checkbox") return "checkbox";
    if (node.type === "radio") return "radio";
    if (node.type !== "hidden") return "textbox";
  }
  return undefined;
}

function isTextTarget(node: HTMLElement, role?: string): boolean {
  return node instanceof HTMLButtonElement
    || node instanceof HTMLAnchorElement
    || node.tagName === "SUMMARY"
    || ["button", "link", "tab", "menuitem", "option"].includes(role ?? "");
}

function elementPriority(element: RuntimeElementContext, focused?: RuntimeElementContext, hovered?: RuntimeElementContext): number {
  let score = 0;
  if (sameElementContext(element, hovered)) score += 100;
  if (sameElementContext(element, focused)) score += 80;
  if (element.locators?.some((locator) => locator.strategy === "css")) score += 20;
  if (element.label || element.text) score += 10;
  const box = element.boundingBox;
  if (box) {
    const centerDistance = Math.abs(box.x + box.width / 2 - window.innerWidth / 2)
      + Math.abs(box.y + box.height / 2 - window.innerHeight / 2);
    score += Math.max(0, 8 - centerDistance / 250);
  }
  return score;
}

function sameElementContext(left?: RuntimeElementContext, right?: RuntimeElementContext): boolean {
  if (!left || !right) return false;
  if (left.selector && right.selector) return left.selector === right.selector;
  return left.elementId === right.elementId && left.tagName === right.tagName;
}

function uniqueElementContext(value: RuntimeElementContext, index: number, values: RuntimeElementContext[]): boolean {
  return values.findIndex((candidate) => sameElementContext(candidate, value)) === index;
}

function uniqueLocators(locators: TargetLocator[]): TargetLocator[] {
  const seen = new Set<string>();
  return locators.filter((locator) => {
    const key = JSON.stringify(locator);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function isRedactedElement(node: HTMLElement, config: SDKConfig): boolean {
  return (config.privacy?.redactedSelectors ?? []).some((selector) => {
    try {
      return node.matches(selector) || Boolean(node.closest(selector));
    } catch {
      return false;
    }
  });
}

function isSensitiveInput(node: HTMLElement): boolean {
  if (!(node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement)) return false;
  const type = node instanceof HTMLInputElement ? node.type : "textarea";
  if (["password", "hidden", "email", "tel", "url"].includes(type)) return true;
  return /\b(token|secret|password|passcode|api[-_ ]?key|credit|card|ssn|social|email|phone)\b/i.test([
    node.name,
    node.id,
    node.getAttribute("autocomplete"),
    node.getAttribute("aria-label"),
    node.placeholder
  ].filter(Boolean).join(" "));
}

function isSdkOwnedElement(node: HTMLElement): boolean {
  return Boolean(node.closest([
    "[data-mia-prompt-ui='true']",
    "[data-mia-shadow-cursor='true']",
    "[data-mia-ignore]",
    ".mia-root",
    ".mia-cursor",
    ".mia-bubble",
    ".mia-nav-bubble"
  ].join(",")));
}
