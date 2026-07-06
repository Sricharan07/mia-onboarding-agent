import type { RuntimeElementContext, SDKConfig, SDKRuntimeContext } from "../types/index.js";

export function collectRuntimeContext(config: SDKConfig, sessionId: string): SDKRuntimeContext {
  return {
    appId: config.appId,
    sessionId,
    currentUrl: window.location.href,
    currentRoute: window.location.pathname,
    pageTitle: document.title,
    focusedElement: inspectElement(document.activeElement, config),
    visibleElements: collectVisibleElements(config),
    userMetadata: config.user?.metadata
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
  return nodes
    .filter((node) => {
      if (node instanceof HTMLElement && isSdkOwnedElement(node)) return false;
      if (node instanceof HTMLElement && isRedactedElement(node, config)) return false;
      const rect = (node as HTMLElement).getBoundingClientRect();
      return rect.width > 0 && rect.height > 0 && rect.bottom >= 0 && rect.right >= 0 && rect.top <= window.innerHeight && rect.left <= window.innerWidth;
    })
    .slice(0, 50)
    .map((node) => inspectElement(node, config))
    .filter(Boolean) as RuntimeElementContext[];
}

function inspectElement(node: Element | null, config: SDKConfig): RuntimeElementContext | undefined {
  if (!node || !(node instanceof HTMLElement)) return undefined;
  if (isSdkOwnedElement(node)) return undefined;
  if (isRedactedElement(node, config)) return undefined;
  const rect = node.getBoundingClientRect();
  const redactText = config.privacy?.redactText !== false || isSensitiveInput(node);
  const selector = selectorForElement(node);
  return {
    tagName: node.tagName,
    role: node.getAttribute("role") ?? undefined,
    label: redactText ? undefined : readableLabel(node),
    text: redactText ? undefined : readableText(node),
    selector,
    elementId: node.getAttribute("data-ai-id") ?? (node.id || undefined),
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

function selectorForElement(node: HTMLElement): string | undefined {
  const dataAiId = node.getAttribute("data-ai-id");
  if (dataAiId) return `[data-ai-id='${cssEscape(dataAiId)}']`;
  const testId = node.getAttribute("data-testid");
  if (testId) return `[data-testid='${cssEscape(testId)}']`;
  if (node.id) return `#${cssEscape(node.id)}`;
  return undefined;
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
    ".mia-root",
    ".mia-cursor",
    ".mia-bubble",
    ".mia-nav-bubble"
  ].join(",")));
}
