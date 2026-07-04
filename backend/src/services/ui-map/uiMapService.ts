import { chromium } from "playwright";
import type { Browser } from "playwright";
import { randomUUID } from "node:crypto";
import type { Repositories } from "../../db/repositories.js";
import type { SemanticSearchAdapter } from "../../adapters/interfaces.js";
import { ValidationAppError } from "../../utils/errors.js";
import type { AppConfig } from "../../config/env.js";
import { applyUiScanAuth, type UiScanAuthMode } from "./auth.js";
import { gotoAndSettle } from "./navigation.js";
import { UiMapPageCaptureService } from "./pageCaptureService.js";
import { captureSafeExpansions } from "./safeExpansion.js";

const SCAN_LEASE_MS = 30 * 60 * 1000;

export class UiMapService {
  private readonly capture: UiMapPageCaptureService;
  private readonly activeScans = new Set<string>();
  private readonly workerId = `ui_scan_${process.pid}_${randomUUID()}`;

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
    const version = this.repositories.createUiMapVersion(input.appId, "runtime_browser_scan", {
      baseUrl: app.baseUrl,
      routes: input.routes,
      authMode: input.auth?.mode
    });

    this.startScan(version.id);

    return { uiMapVersionId: version.id, status: "scanning" };
  }

  resumeUnfinishedScans(onError?: (error: unknown) => void): void {
    for (const scan of this.repositories.listUnfinishedUiMapScans()) {
      this.startScan(scan.id, onError);
    }
  }

  private startScan(uiMapVersionId: string, onError?: (error: unknown) => void): void {
    if (this.activeScans.has(uiMapVersionId)) return;
    if (!this.repositories.claimUiMapVersion(uiMapVersionId, this.workerId, leaseUntil(SCAN_LEASE_MS))) return;
    this.activeScans.add(uiMapVersionId);
    void this.runScan(uiMapVersionId)
      .catch((error) => onError?.(error))
      .finally(() => {
        this.activeScans.delete(uiMapVersionId);
      });
  }

  private async runScan(uiMapVersionId: string): Promise<void> {
    const version = this.repositories.getUiMapVersion(uiMapVersionId);
    const config = parseScanConfig(version.scan_config_json);
    const appId = String(version.app_id);
    const heartbeat = setInterval(() => {
      this.repositories.refreshUiMapVersionLease(uiMapVersionId, this.workerId, leaseUntil(SCAN_LEASE_MS));
    }, Math.floor(SCAN_LEASE_MS / 3));
    let browser: Browser | undefined;

    try {
      browser = await chromium.launch({ headless: this.config.UI_SCAN_HEADLESS });
      const context = await browser.newContext();
      const page = await context.newPage();
      await applyUiScanAuth({
        page,
        baseUrl: config.baseUrl,
        config: this.config,
        mode: config.authMode
      });

      let successfulRoutes = 0;
      const routeErrors: string[] = [];
      for (const route of config.routes) {
        const url = new URL(route, config.baseUrl).toString();
        let capturedDefaultState = false;
        try {
          await gotoAndSettle(page, url);
          await this.capture.captureCurrentPage({
            appId,
            uiMapVersionId,
            baseUrl: config.baseUrl,
            page,
            route,
            stateName: "default",
            discoveredBy: "route_scan"
          });
          capturedDefaultState = true;
          successfulRoutes += 1;
          await captureSafeExpansions({
            page,
            appId,
            uiMapVersionId,
            baseUrl: config.baseUrl,
            route,
            capture: this.capture
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          routeErrors.push(`${route}: ${message}`);
          if (!capturedDefaultState) {
            this.repositories.createPage({
              appId,
              uiMapVersionId,
              name: route,
              route,
              url,
              status: "failed",
              error: message
            });
          }
        }
      }
      const errorSummary = routeErrors.length ? routeErrors.join("\n") : undefined;
      this.repositories.updateUiMapVersion(uiMapVersionId, successfulRoutes > 0 ? "completed" : "failed", errorSummary);
    } catch (error) {
      this.repositories.updateUiMapVersion(uiMapVersionId, "failed", error instanceof Error ? error.message : String(error));
    } finally {
      clearInterval(heartbeat);
      await browser?.close();
    }
  }
}

function parseScanConfig(value: unknown): { baseUrl: string; routes: string[]; authMode?: UiScanAuthMode } {
  const parsed = JSON.parse(String(value ?? "{}")) as { baseUrl?: unknown; routes?: unknown; authMode?: unknown };
  if (typeof parsed.baseUrl !== "string" || !Array.isArray(parsed.routes) || !parsed.routes.every((route) => typeof route === "string")) {
    throw new ValidationAppError("Stored UI scan config is invalid.");
  }
  const authMode = parsed.authMode === "login_form" || parsed.authMode === "none" ? parsed.authMode : undefined;
  return { baseUrl: parsed.baseUrl, routes: parsed.routes, authMode };
}

function leaseUntil(ms: number): string {
  return new Date(Date.now() + ms).toISOString();
}
