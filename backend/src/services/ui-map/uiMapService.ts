import { chromium } from "playwright";
import type { Repositories } from "../../db/repositories.js";
import type { SemanticSearchAdapter } from "../../adapters/interfaces.js";
import { buildUiElementRecord, type RawElement } from "./selector.js";
import { ValidationAppError } from "../../utils/errors.js";

export class UiMapService {
  constructor(
    private readonly repositories: Repositories,
    private readonly moss: SemanticSearchAdapter
  ) {}

  async scanApp(input: { appId: string; routes: string[]; auth?: { mode: string } }): Promise<{ uiMapVersionId: string; status: string }> {
    const app = this.repositories.getApp(input.appId);
    if (input.routes.length === 0) throw new ValidationAppError("At least one route is required.");
    const version = this.repositories.createUiMapVersion(input.appId);

    void this.runScan({
      appId: input.appId,
      baseUrl: app.baseUrl,
      routes: input.routes,
      uiMapVersionId: version.id
    });

    return { uiMapVersionId: version.id, status: "scanning" };
  }

  private async runScan(input: { appId: string; baseUrl: string; routes: string[]; uiMapVersionId: string }): Promise<void> {
    const browser = await chromium.launch();
    const page = await browser.newPage();

    try {
      for (const route of input.routes) {
        const url = new URL(route, input.baseUrl).toString();
        try {
          await page.goto(url, { waitUntil: "networkidle" });
          const title = await page.title();
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

          const rawElements = await page.$$eval(
            "button,a,input,textarea,select,[role='button'],[role='tab'],[role='menuitem']",
            (nodes) => nodes.map((node) => {
              const element = node as HTMLElement;
              const rect = element.getBoundingClientRect();
              const input = element as HTMLInputElement;
              return {
                tagName: element.tagName,
                role: element.getAttribute("role") ?? undefined,
                label: element.getAttribute("aria-label") ?? element.innerText?.trim() ?? input.labels?.[0]?.textContent?.trim() ?? undefined,
                text: element.innerText?.trim() || element.textContent?.trim() || undefined,
                dataAiId: element.getAttribute("data-ai-id") ?? undefined,
                testId: element.getAttribute("data-testid") ?? undefined,
                id: element.id || undefined,
                name: input.name || undefined,
                placeholder: input.placeholder || undefined,
                ariaLabel: element.getAttribute("aria-label") ?? undefined,
                inputType: input.type || undefined,
                href: (element as HTMLAnchorElement).href || undefined,
                boundingBox: rect.width && rect.height ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height } : undefined
              };
            })
          ) as RawElement[];

          for (const [index, raw] of rawElements.entries()) {
            const record = buildUiElementRecord({
              appId: input.appId,
              uiMapVersionId: input.uiMapVersionId,
              pageId,
              pageName,
              route,
              raw,
              index
            });
            this.repositories.saveUiElement(record);
            await this.moss.index({
              id: record.id,
              kind: "ui_element",
              appId: record.appId,
              searchableText: [
                `Page: ${record.pageName}`,
                `Route: ${record.route}`,
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
                elementType: record.elementType,
                selectorQuality: record.selectorQuality
              }
            });
          }
        } catch (error) {
          this.repositories.createPage({
            appId: input.appId,
            uiMapVersionId: input.uiMapVersionId,
            name: route,
            route,
            url,
            status: "failed",
            error: error instanceof Error ? error.message : String(error)
          });
        }
      }
      this.repositories.updateUiMapVersion(input.uiMapVersionId, "completed");
    } catch (error) {
      this.repositories.updateUiMapVersion(input.uiMapVersionId, "failed", error instanceof Error ? error.message : String(error));
    } finally {
      await browser.close();
    }
  }
}
