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
import { syncLatestUiElementSemanticIndex } from "../semantic/syncUiElementSemanticIndex.js";
import { assertSafeTargetUrl, resolveSameOriginRouteUrl } from "../security/targetUrlPolicy.js";
import { installUiScanRequestGuard } from "./requestGuard.js";

const SCAN_LEASE_MS = 30 * 60 * 1000;

type StoredUiMapScanConfig = {
  baseUrl: string;
  routes: string[];
  auth?: UiScanAuthConfig;
  ignoredSelectors: string[];
  redactedSelectors: string[];
  routeDiscovery: { enabled: boolean; maxRoutes: number };
};

export type UiMapPreflightCheck = {
  id: string;
  label: string;
  status: "passed" | "warning" | "failed";
  message: string;
  fix?: string;
};

export type UiMapPreflightReport = {
  appId: string;
  ok: boolean;
  checks: UiMapPreflightCheck[];
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
    this.capture = new UiMapPageCaptureService(repositories);
  }

  async scanApp(input: { appId: string; routes?: string[]; auth?: { mode: UiScanAuthMode } }): Promise<{ uiMapVersionId: string; status: string }> {
    const app = this.repositories.getActiveApp(input.appId);
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

  async preflightApp(input: { appId: string; routes?: string[]; auth?: { mode: UiScanAuthMode } }): Promise<UiMapPreflightReport> {
    const app = this.repositories.getActiveApp(input.appId);
    const appScanConfig = this.repositories.getAppUiScanConfig(input.appId);
    const routes = normalizeRoutes(input.routes?.length ? input.routes : appScanConfig.routes);
    const mode = input.auth?.mode ?? appScanConfig.authMode;
    const checks: UiMapPreflightCheck[] = [];

    addCheck(checks, "base-url", "Base URL", "passed", `Using ${app.baseUrl}.`);
    await checkReachable(app.baseUrl, this.config, checks, "base-url-reachable", "Base URL reachable");

    if (routes.length === 0) {
      addCheck(checks, "routes", "Routes", "failed", "At least one route is required.", "Add one or more routes to the scan profile.");
    } else {
      addCheck(checks, "routes", "Routes", "passed", `${routes.length} route(s) selected.`);
      for (const route of routes.slice(0, 5)) {
        await checkReachableRoute(route, app.baseUrl, this.config, checks, `route:${route}`, `Route ${route}`);
      }
      if (routes.length > 5) {
        addCheck(checks, "routes-sampled", "Route sample", "warning", "Only the first five routes were reachability-checked.", "Run the scan after fixing any listed route failures.");
      }
    }

    if (mode === "manual") {
      addCheck(checks, "auth-mode", "Auth mode", "warning", "Manual auth requires interactive scan.", "Use Start interactive scan instead of backend scan.");
    } else if (mode === "login_form") {
      await this.checkLoginForm(app.baseUrl, appScanConfig, checks);
    } else {
      addCheck(checks, "auth-mode", "Auth mode", "passed", "No authentication will be attempted.");
    }

    addSelectorListCheck(checks, "ignored-selectors", "Ignored selectors", appScanConfig.ignoredSelectors);
    addSelectorListCheck(checks, "redacted-selectors", "Redacted selectors", appScanConfig.redactedSelectors);

    if (appScanConfig.routeDiscovery.enabled) {
      addCheck(checks, "route-discovery", "Route discovery", "warning", `Same-origin route discovery can add up to ${appScanConfig.routeDiscovery.maxRoutes} routes.`, "Start with explicit routes for production scans.");
    } else {
      addCheck(checks, "route-discovery", "Route discovery", "passed", "Route discovery is disabled.");
    }

    return {
      appId: input.appId,
      ok: !checks.some((check) => check.status === "failed") && mode !== "manual",
      checks
    };
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
      await installUiScanRequestGuard(context, this.config);
      const page = await context.newPage();
      await assertSafeTargetUrl(config.baseUrl, this.config);
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
        let url = "";
        let capturedDefaultState = false;
        try {
          url = resolveSameOriginRouteUrl(route, config.baseUrl);
          await assertSafeTargetUrl(url, this.config);
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
              url: url || route,
              status: "failed",
              error: message
            });
          }
        }
      }
      const errorSummary = routeErrors.length ? routeErrors.join("\n") : undefined;
      const status = successfulRoutes > 0 ? "completed" : "failed";
      this.repositories.updateUiMapVersion(uiMapVersionId, status, errorSummary);
      if (status === "completed") {
        await syncLatestUiElementSemanticIndex(this.repositories, this.semanticSearch, appId);
      }
    } catch (error) {
      this.repositories.updateUiMapVersion(uiMapVersionId, "failed", error instanceof Error ? error.message : String(error));
    } finally {
      clearInterval(heartbeat);
      await browser?.close();
    }
  }

  private async checkLoginForm(baseUrl: string, auth: StoredUiMapScanConfig["auth"], checks: UiMapPreflightCheck[]): Promise<void> {
    const missing = Object.entries({
      loginUrl: auth?.loginUrl,
      username: auth?.username,
      password: auth?.password,
      usernameSelector: auth?.usernameSelector,
      passwordSelector: auth?.passwordSelector,
      submitSelector: auth?.submitSelector
    }).filter(([, value]) => !value).map(([key]) => key);

    if (missing.length) {
      addCheck(checks, "login-form-config", "Login form config", "failed", `Missing ${missing.join(", ")}.`, "Complete the login-form fields in Scan profile.");
      return;
    }

    addCheck(checks, "login-form-config", "Login form config", "passed", "Required login-form fields are configured.");

    let browser: Browser | undefined;
    try {
      browser = await chromium.launch({ headless: true });
      const context = await browser.newContext();
      await installUiScanRequestGuard(context, this.config);
      const page = await context.newPage();
      const loginUrl = new URL(auth!.loginUrl!, baseUrl).toString();
      await assertSafeTargetUrl(loginUrl, this.config);
      await gotoAndSettle(page, loginUrl);
      for (const [id, label, selector] of [
        ["username-selector", "Username selector", auth!.usernameSelector],
        ["password-selector", "Password selector", auth!.passwordSelector],
        ["submit-selector", "Submit selector", auth!.submitSelector]
      ] as const) {
        const count = await page.locator(selector!).count();
        if (count === 1) {
          addCheck(checks, id, label, "passed", `${selector} matched one element.`);
        } else {
          addCheck(checks, id, label, "failed", `${selector} matched ${count} elements.`, "Use a selector that matches exactly one element on the login page.");
        }
      }
    } catch (error) {
      addCheck(checks, "login-form-page", "Login page", "failed", error instanceof Error ? error.message : String(error), "Confirm login URL and selectors.");
    } finally {
      await browser?.close();
    }
  }
}

function addCheck(checks: UiMapPreflightCheck[], id: string, label: string, status: UiMapPreflightCheck["status"], message: string, fix?: string): void {
  checks.push({ id, label, status, message, fix });
}

async function checkReachable(url: string, config: AppConfig, checks: UiMapPreflightCheck[], id: string, label: string): Promise<void> {
  try {
    await assertSafeTargetUrl(url, config);
    const response = await fetch(url, { method: "GET", signal: AbortSignal.timeout(8000), redirect: "manual" });
    const status = response.status;
    if (status >= 200 && status < 500) {
      addCheck(checks, id, label, "passed", `${url} responded with HTTP ${status}.`);
      return;
    }
    addCheck(checks, id, label, "failed", `${url} responded with HTTP ${status}.`, "Fix the target app route or base URL.");
  } catch (error) {
    addCheck(checks, id, label, "failed", error instanceof Error ? error.message : String(error), "Confirm the target app is running and reachable from the backend.");
  }
}

async function checkReachableRoute(route: string, baseUrl: string, config: AppConfig, checks: UiMapPreflightCheck[], id: string, label: string): Promise<void> {
  try {
    await checkReachable(resolveSameOriginRouteUrl(route, baseUrl), config, checks, id, label);
  } catch (error) {
    addCheck(checks, id, label, "failed", error instanceof Error ? error.message : String(error), "Use a relative route on the configured app origin.");
  }
}

function addSelectorListCheck(checks: UiMapPreflightCheck[], id: string, label: string, selectors: string[]): void {
  for (const selector of selectors) {
    if (!looksLikeCssSelector(selector)) {
      addCheck(checks, `${id}:${selector}`, label, "failed", `${selector} is not valid CSS selector syntax.`, "Fix or remove the selector.");
      return;
    }
  }
  addCheck(checks, id, label, "passed", selectors.length ? `${selectors.length} selector(s) configured.` : "No selectors configured.");
}

function looksLikeCssSelector(selector: string): boolean {
  const trimmed = selector.trim();
  if (!trimmed || /[\r\n]/.test(trimmed) || /^[>+~]/.test(trimmed)) return false;
  return balanced(trimmed, "[", "]") && balanced(trimmed, "(", ")") && balanced(trimmed, "\"", "\"") && balanced(trimmed, "'", "'");
}

function balanced(value: string, open: string, close: string): boolean {
  if (open === close) return value.split(open).length % 2 === 1;
  let depth = 0;
  for (const char of value) {
    if (char === open) depth += 1;
    if (char === close) depth -= 1;
    if (depth < 0) return false;
  }
  return depth === 0;
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
