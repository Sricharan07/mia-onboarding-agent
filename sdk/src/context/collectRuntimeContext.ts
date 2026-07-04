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
  const nodes = Array.from(document.querySelectorAll("button,a,input,textarea,select,[role='button'],[role='tab'],[role='menuitem']"));
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
  const redactText = Boolean(config.privacy?.redactText) || isSensitiveInput(node);
  return {
    tagName: node.tagName,
    role: node.getAttribute("role") ?? undefined,
    label: redactText ? undefined : node.getAttribute("aria-label") ?? node.innerText?.trim() ?? undefined,
    text: redactText ? undefined : node.innerText?.trim() || node.textContent?.trim() || undefined,
    selector: node.getAttribute("data-ai-id") ? `[data-ai-id='${node.getAttribute("data-ai-id")}']` : undefined,
    elementId: node.getAttribute("data-ai-id") ?? undefined,
    boundingBox: { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
  };
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
  return ["password", "hidden"].includes(node.type);
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
