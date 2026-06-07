import type { Page } from "playwright";
import type { Repositories } from "../../db/repositories.js";
import type { SemanticSearchAdapter } from "../../adapters/interfaces.js";
import { scanVisibleElements } from "./domScanner.js";
import { buildUiElementRecord } from "./selector.js";
import type { SemanticRecord, UIElementRecord } from "../../schemas/domain.js";

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
  constructor(
    private readonly repositories: Repositories,
    private readonly moss: SemanticSearchAdapter
  ) {}

  async captureCurrentPage(input: {
    appId: string;
    uiMapVersionId: string;
    baseUrl: string;
    page: Page;
    route?: string;
    stateName?: string;
    stateReason?: string;
    discoveredBy: UiElementDiscoveredBy;
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

    const rawElements = await scanVisibleElements(input.page);
    let savedElements = 0;
    let duplicateElements = 0;
    let weakSelectors = 0;
    const semanticRecords: SemanticRecord[] = [];

    for (const [index, raw] of rawElements.entries()) {
      const record = buildUiElementRecord({
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
      });

      if (record.selectorQuality === "weak") weakSelectors += 1;
      const saved = this.repositories.saveUiElement(record);
      if (!saved) {
        duplicateElements += 1;
        continue;
      }

      savedElements += 1;
      semanticRecords.push(toSemanticRecord(record));
    }

    await this.moss.upsertMany(semanticRecords);

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

function routeFromUrl(url: string, baseUrl: string): string {
  const current = new URL(url);
  const base = new URL(baseUrl);
  if (current.origin !== base.origin) return current.pathname + current.search;
  return current.pathname + current.search || "/";
}

function toSemanticRecord(record: UIElementRecord) {
  return {
    id: record.id,
    kind: "ui_element" as const,
    appId: record.appId,
    searchableText: [
      `Page: ${record.pageName}`,
      `Route: ${record.route}`,
      `State: ${record.stateName}`,
      `Element type: ${record.elementType}`,
      `Label: ${record.label ?? ""}`,
      `Description: ${record.description}`,
      `Tags: ${record.tags.join(", ")}`
    ].join("\n"),
    metadata: {
      kind: "ui_element",
      appId: record.appId,
      elementId: record.elementId,
      route: record.route,
      pageName: record.pageName,
      stateName: record.stateName,
      discoveredBy: record.discoveredBy,
      elementType: record.elementType,
      selectorQuality: record.selectorQuality
    }
  };
}
