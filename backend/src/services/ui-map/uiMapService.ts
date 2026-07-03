import { chromium } from "playwright";
import type { Repositories } from "../../db/repositories.js";
import type { SemanticSearchAdapter } from "../../adapters/interfaces.js";
import { ValidationAppError } from "../../utils/errors.js";
import type { AppConfig } from "../../config/env.js";
import { applyUiScanAuth, type UiScanAuthMode } from "./auth.js";
import { gotoAndSettle } from "./navigation.js";
import { UiMapPageCaptureService } from "./pageCaptureService.js";
import { captureSafeExpansions } from "./safeExpansion.js";

export class UiMapService {
  private readonly capture: UiMapPageCaptureService;

  constructor(
    private readonly config: AppConfig,
    private readonly repositories: Repositories,
    private readonly semanticSearch: SemanticSearchAdapter
  ) {
    this.capture = new UiMapPageCaptureService(repositories, semanticSearch);
  }

  async scanApp(input: { appId: string; routes: string[]; auth?: { mode: UiScanAuthMode } }): Promise<{ uiMapVersionId: string; status: string }> {
    const app = this.repositories.getApp(input.appId);
    if (input.routes.length === 0) throw new ValidationAppError("At least one route is required.");
    const version = this.repositories.createUiMapVersion(input.appId);

    void this.runScan({
      appId: input.appId,
      baseUrl: app.baseUrl,
      routes: input.routes,
      uiMapVersionId: version.id,
      authMode: input.auth?.mode
    });

    return { uiMapVersionId: version.id, status: "scanning" };
  }

  private async runScan(input: { appId: string; baseUrl: string; routes: string[]; uiMapVersionId: string; authMode?: UiScanAuthMode }): Promise<void> {
    const browser = await chromium.launch({ headless: this.config.UI_SCAN_HEADLESS });
    const context = await browser.newContext();
    const page = await context.newPage();

    try {
      await applyUiScanAuth({
        page,
        baseUrl: input.baseUrl,
        config: this.config,
        mode: input.authMode
      });

      for (const route of input.routes) {
        const url = new URL(route, input.baseUrl).toString();
        try {
          await gotoAndSettle(page, url);
          await this.capture.captureCurrentPage({
            appId: input.appId,
            uiMapVersionId: input.uiMapVersionId,
            baseUrl: input.baseUrl,
            page,
            route,
            stateName: "default",
            discoveredBy: "route_scan"
          });
          await captureSafeExpansions({
            page,
            appId: input.appId,
            uiMapVersionId: input.uiMapVersionId,
            baseUrl: input.baseUrl,
            route,
            capture: this.capture
          });
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
