import type { RuntimeElementContext, SDKConfig, SDKRuntimeContext } from "../types/index.js";

export function collectRuntimeContext(config: SDKConfig, sessionId: string): SDKRuntimeContext {
  return {
    appId: config.appId,
    sessionId,
    currentUrl: window.location.href,
    currentRoute: window.location.pathname,
    pageTitle: document.title,
    focusedElement: inspectElement(document.activeElement),
    visibleElements: collectVisibleElements(),
    userMetadata: config.user?.metadata
  };
}

function collectVisibleElements(): RuntimeElementContext[] {
  const nodes = Array.from(document.querySelectorAll("button,a,input,textarea,select,[role='button'],[role='tab'],[role='menuitem']"));
  return nodes
    .filter((node) => {
      const rect = (node as HTMLElement).getBoundingClientRect();
      return rect.width > 0 && rect.height > 0 && rect.bottom >= 0 && rect.right >= 0 && rect.top <= window.innerHeight && rect.left <= window.innerWidth;
    })
    .slice(0, 50)
    .map(inspectElement)
    .filter(Boolean) as RuntimeElementContext[];
}

function inspectElement(node: Element | null): RuntimeElementContext | undefined {
  if (!node || !(node instanceof HTMLElement)) return undefined;
  const rect = node.getBoundingClientRect();
  return {
    tagName: node.tagName,
    role: node.getAttribute("role") ?? undefined,
    label: node.getAttribute("aria-label") ?? node.innerText?.trim() ?? undefined,
    text: node.innerText?.trim() || node.textContent?.trim() || undefined,
    selector: node.getAttribute("data-ai-id") ? `[data-ai-id='${node.getAttribute("data-ai-id")}']` : undefined,
    elementId: node.getAttribute("data-ai-id") ?? undefined,
    boundingBox: { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
  };
}
