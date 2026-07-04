import { chromium } from "playwright";
import type { Browser } from "playwright";
import { randomUUID } from "node:crypto";
import type { Repositories } from "../../db/repositories.js";
import type { SemanticSearchAdapter } from "../../adapters/interfaces.js";
import { ValidationAppError } from "../../utils/errors.js";
import type { AppConfig } from "../../config/env.js";
import { applyUiScanAuth, type UiScanAuthConfig, type UiScanAuthMode } from "./auth.js";
import { gotoAndSettle } from "./navigation.js";
import { UiMapPageCaptureService } from "./pageCaptureService.js";
import { captureSafeExpansions } from "./safeExpansion.js";

const SCAN_LEASE_MS = 30 * 60 * 1000;

type StoredUiMapScanConfig = {
  baseUrl: string;
  routes: string[];
  auth?: UiScanAuthConfig;
  ignoredSelectors: string[];
  redactedSelectors: string[];
  routeDiscovery: { enabled: boolean; maxRoutes: number };
};

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

  async scanApp(input: { appId: string; routes?: string[]; auth?: { mode: UiScanAuthMode } }): Promise<{ uiMapVersionId: string; status: string }> {
    const app = this.repositories.getApp(input.appId);
    const appScanConfig = this.repositories.getAppUiScanConfig(input.appId);
    const routes = normalizeRoutes(input.routes?.length ? input.routes : appScanConfig.routes);
    if (routes.length === 0) throw new ValidationAppError("At least one route is required.");
    const auth = {
      ...appScanConfig,
      mode: input.auth?.mode ?? appScanConfig.authMode
    };
    if (auth.mode === "manual") {
      throw new ValidationAppError("Manual UI scan auth is only supported by interactive scans.");
    }
    const version = this.repositories.createUiMapVersion(input.appId, "runtime_browser_scan", {
      baseUrl: app.baseUrl,
      routes,
      auth,
      ignoredSelectors: appScanConfig.ignoredSelectors,
      redactedSelectors: appScanConfig.redactedSelectors,
      routeDiscovery: appScanConfig.routeDiscovery
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
        auth: config.auth
      });

      let successfulRoutes = 0;
      const routeErrors: string[] = [];
      const pendingRoutes = [...config.routes];
      const visitedRoutes = new Set<string>();
      for (let index = 0; index < pendingRoutes.length; index += 1) {
        const route = pendingRoutes[index]!;
        if (visitedRoutes.has(route)) continue;
        visitedRoutes.add(route);
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
            discoveredBy: "route_scan",
            ignoredSelectors: config.ignoredSelectors,
            redactedSelectors: config.redactedSelectors
          });
          capturedDefaultState = true;
          successfulRoutes += 1;
          await captureSafeExpansions({
            page,
            appId,
            uiMapVersionId,
            baseUrl: config.baseUrl,
            route,
            capture: this.capture,
            ignoredSelectors: config.ignoredSelectors,
            redactedSelectors: config.redactedSelectors
          });
          if (config.routeDiscovery.enabled && visitedRoutes.size < config.routeDiscovery.maxRoutes) {
            for (const discoveredRoute of await discoverSameOriginRoutes(page, config.baseUrl)) {
              if (visitedRoutes.has(discoveredRoute) || pendingRoutes.includes(discoveredRoute)) continue;
              pendingRoutes.push(discoveredRoute);
              if (pendingRoutes.length >= config.routeDiscovery.maxRoutes) break;
            }
          }
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

function parseScanConfig(value: unknown): StoredUiMapScanConfig {
  const parsed = JSON.parse(String(value ?? "{}")) as {
    baseUrl?: unknown;
    routes?: unknown;
    authMode?: unknown;
    auth?: Record<string, unknown>;
    ignoredSelectors?: unknown;
    redactedSelectors?: unknown;
    routeDiscovery?: { enabled?: unknown; maxRoutes?: unknown };
  };
  if (typeof parsed.baseUrl !== "string" || !Array.isArray(parsed.routes) || !parsed.routes.every((route) => typeof route === "string")) {
    throw new ValidationAppError("Stored UI scan config is invalid.");
  }
  const authMode = normalizeAuthMode(parsed.auth?.mode ?? parsed.auth?.authMode ?? parsed.authMode);
  return {
    baseUrl: parsed.baseUrl,
    routes: normalizeRoutes(parsed.routes),
    auth: { ...parsed.auth, mode: authMode } as UiScanAuthConfig,
    ignoredSelectors: normalizeStringArray(parsed.ignoredSelectors),
    redactedSelectors: normalizeStringArray(parsed.redactedSelectors),
    routeDiscovery: {
      enabled: Boolean(parsed.routeDiscovery?.enabled),
      maxRoutes: Number.isInteger(parsed.routeDiscovery?.maxRoutes) ? Math.min(Number(parsed.routeDiscovery?.maxRoutes), 200) : 25
    }
  };
}

function leaseUntil(ms: number): string {
  return new Date(Date.now() + ms).toISOString();
}

async function discoverSameOriginRoutes(page: import("playwright").Page, baseUrl: string): Promise<string[]> {
  const base = new URL(baseUrl);
  const hrefs = await page.evaluate(() => Array.from(document.querySelectorAll("a[href]"))
    .map((anchor) => anchor instanceof HTMLAnchorElement ? anchor.href : "")
    .filter(Boolean));
  const dangerousRoute = /(logout|signout|sign-out|delete|remove|destroy|deactivate|cancel|checkout|purchase|billing\/cancel)/i;
  const assetRoute = /\.(pdf|png|jpe?g|gif|webp|svg|zip|csv|xlsx?|docx?|mp4|mov)$/i;
  const routes: string[] = [];
  for (const href of hrefs) {
    try {
      const url = new URL(href);
      if (url.origin !== base.origin) continue;
      const route = `${url.pathname}${url.search}`;
      if (!route.startsWith("/") || dangerousRoute.test(route) || assetRoute.test(route)) continue;
      routes.push(route || "/");
    } catch {
      continue;
    }
  }
  return [...new Set(routes)];
}

function normalizeRoutes(routes: unknown): string[] {
  if (!Array.isArray(routes)) return [];
  return [...new Set(routes.map((route) => typeof route === "string" ? route.trim() : "").filter(Boolean).map((route) => route.startsWith("/") ? route : `/${route}`))];
}

function normalizeStringArray(value: unknown): string[] {
  return Array.isArray(value) ? [...new Set(value.map((item) => typeof item === "string" ? item.trim() : "").filter(Boolean))] : [];
}

function normalizeAuthMode(value: unknown): UiScanAuthMode | undefined {
  return value === "none" || value === "login_form" || value === "manual" ? value : undefined;
}
