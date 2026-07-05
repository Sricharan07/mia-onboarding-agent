import type { Page } from "playwright";
import type { Repositories } from "../../db/repositories.js";
import { scanVisibleElements } from "./domScanner.js";
import { buildUiElementRecord } from "./selector.js";
import type { UIElementRecord } from "../../schemas/domain.js";

export type UiElementDiscoveredBy = UIElementRecord["discoveredBy"];

export type CapturePageResult = {
  pageId: string;
  route: string;
  url: string;
  stateName: string;
  scannedElements: number;
  savedElements: number;
  duplicateElements: number;
  weakSelectors: number;
};

export class UiMapPageCaptureService {
  constructor(private readonly repositories: Repositories) {}

  async captureCurrentPage(input: {
    appId: string;
    uiMapVersionId: string;
    baseUrl: string;
    page: Page;
    route?: string;
    stateName?: string;
    stateReason?: string;
    discoveredBy: UiElementDiscoveredBy;
    ignoredSelectors?: string[];
    redactedSelectors?: string[];
  }): Promise<CapturePageResult> {
    const url = input.page.url();
    const route = input.route ?? routeFromUrl(url, input.baseUrl);
    const title = await input.page.title();
    const pageName = title || route.split("/").filter(Boolean).at(-1) || "Home";
    const pageId = this.repositories.createPage({
      appId: input.appId,
      uiMapVersionId: input.uiMapVersionId,
      name: pageName,
      route,
      url,
      title,
      status: "mapped"
    });

    const rawElements = await scanVisibleElements(input.page, {
      ignoredSelectors: input.ignoredSelectors,
      redactedSelectors: input.redactedSelectors
    });
    let savedElements = 0;
    let duplicateElements = 0;
    let weakSelectors = 0;

    for (const [index, raw] of rawElements.entries()) {
      const record = await validateElementSelectors(input.page, buildUiElementRecord({
        appId: input.appId,
        uiMapVersionId: input.uiMapVersionId,
        pageId,
        pageName,
        route,
        raw,
        index,
        stateName: input.stateName ?? "default",
        stateReason: input.stateReason,
        discoveredBy: input.discoveredBy
      }));

      if (record.selectorQuality === "weak") weakSelectors += 1;
      const saved = this.repositories.saveUiElement(record);
      if (!saved) {
        duplicateElements += 1;
        continue;
      }

      savedElements += 1;
    }

    return {
      pageId,
      route,
      url,
      stateName: input.stateName ?? "default",
      scannedElements: rawElements.length,
      savedElements,
      duplicateElements,
      weakSelectors
    };
  }
}

async function validateElementSelectors(page: Page, record: UIElementRecord): Promise<UIElementRecord> {
  const primaryCount = await selectorCount(page, record.selector);
  const fallbackCounts = await Promise.all(record.fallbackSelectors.slice(0, 4).map((selector) => selectorCount(page, selector)));
  const warnings = [...record.selectorWarnings];
  let quality = record.selectorQuality;

  if (primaryCount === 0) {
    warnings.push("Primary selector did not match during scan validation.");
    quality = "weak";
  } else if (primaryCount > 1) {
    warnings.push(`Primary selector matched ${primaryCount} elements during scan validation.`);
    quality = quality === "strong" ? "medium" : quality;
  }

  if (primaryCount === 0 && fallbackCounts.every((count) => count === 0)) {
    warnings.push("No fallback selector matched during scan validation.");
  }

  return {
    ...record,
    selectorQuality: quality,
    selectorWarnings: [...new Set(warnings)]
  };
}

async function selectorCount(page: Page, selector: string): Promise<number> {
  try {
    return await page.locator(selector).count();
  } catch {
    return 0;
  }
}

function routeFromUrl(url: string, baseUrl: string): string {
  const current = new URL(url);
  const base = new URL(baseUrl);
  if (current.origin !== base.origin) return current.pathname + current.search;
  return current.pathname + current.search || "/";
}
