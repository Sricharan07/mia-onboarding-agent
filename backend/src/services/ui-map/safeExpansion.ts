import type { Page } from "playwright";
import type { UiElementDiscoveredBy, UiMapPageCaptureService, CapturePageResult } from "./pageCaptureService.js";

type ExpansionCandidate = {
  selector: string;
  label: string;
};

export async function captureSafeExpansions(input: {
  page: Page;
  appId: string;
  uiMapVersionId: string;
  baseUrl: string;
  route: string;
  capture: UiMapPageCaptureService;
  discoveredBy?: UiElementDiscoveredBy;
}): Promise<CapturePageResult[]> {
  const candidates = await markSafeExpansionCandidates(input.page);
  const results: CapturePageResult[] = [];

  for (const candidate of candidates.slice(0, 10)) {
    try {
      const locator = input.page.locator(candidate.selector).first();
      if (await locator.count() === 0) continue;
      await locator.click({ timeout: 2000 });
      await input.page.waitForTimeout(250);
      results.push(await input.capture.captureCurrentPage({
        appId: input.appId,
        uiMapVersionId: input.uiMapVersionId,
        baseUrl: input.baseUrl,
        page: input.page,
        route: input.route,
        stateName: `${candidate.label} expanded`,
        stateReason: `Safe auto-expansion of ${candidate.label}.`,
        discoveredBy: input.discoveredBy ?? "auto_expansion"
      }));
      await input.page.keyboard.press("Escape").catch(() => undefined);
      await input.page.waitForTimeout(100);
    } catch {
      await input.page.keyboard.press("Escape").catch(() => undefined);
    }
  }

  return results;
}

async function markSafeExpansionCandidates(page: Page): Promise<ExpansionCandidate[]> {
  return page.evaluate(() => {
    const safeLabel = /^(more|more options|actions|options|menu|open menu|filter|filters|columns|view options)$/i;
    const dangerousLabel = /(save|submit|delete|remove|archive|send|invite|create|update|confirm|pay|purchase|checkout|disable|enable)/i;
    const nodes = Array.from(document.querySelectorAll("button,summary,[role='button'],[role='combobox']"));
    document.querySelectorAll("[data-mia-scan-expander]").forEach((node) => node.removeAttribute("data-mia-scan-expander"));

    function text(value: string | null | undefined): string | undefined {
      const normalized = value?.replace(/\s+/g, " ").trim();
      return normalized || undefined;
    }

    function visible(element: HTMLElement): boolean {
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
    }

    const candidates: ExpansionCandidate[] = [];
    for (const node of nodes) {
      if (!(node instanceof HTMLElement) || !visible(node)) continue;
      const label = text(node.getAttribute("aria-label")) ?? text(node.innerText) ?? text(node.textContent) ?? text(node.getAttribute("title"));
      if (!label || dangerousLabel.test(label)) continue;
      const hasSemanticExpansionSignal = Boolean(node.getAttribute("aria-haspopup"))
        || node.getAttribute("aria-expanded") === "false"
        || node.getAttribute("role") === "combobox";
      if (!hasSemanticExpansionSignal && !safeLabel.test(label)) continue;

      const index = candidates.length;
      node.setAttribute("data-mia-scan-expander", String(index));
      candidates.push({
        selector: `[data-mia-scan-expander='${index}']`,
        label
      });
    }

    return candidates;
  });
}
