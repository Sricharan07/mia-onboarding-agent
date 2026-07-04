import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import type { AppConfig } from "../../config/env.js";
import type { Repositories } from "../../db/repositories.js";
import type { SemanticSearchAdapter } from "../../adapters/interfaces.js";
import { AppError, NotFoundError, ValidationAppError } from "../../utils/errors.js";
import { createId } from "../../utils/id.js";
import { applyUiScanAuth, type UiScanAuthMode } from "./auth.js";
import { gotoAndSettle } from "./navigation.js";
import { UiMapPageCaptureService, type CapturePageResult } from "./pageCaptureService.js";

type InteractiveSession = {
  sessionId: string;
  appId: string;
  baseUrl: string;
  uiMapVersionId: string;
  browser: Browser;
  context: BrowserContext;
  page: Page;
  createdAt: string;
  currentRoute: string;
};

export type InteractiveSessionSummary = {
  sessionId: string;
  appId: string;
  uiMapVersionId: string;
  currentRoute: string;
  createdAt: string;
};

export class InteractiveUiMapScanService {
  private readonly sessions = new Map<string, InteractiveSession>();
  private readonly capture: UiMapPageCaptureService;

  constructor(
    private readonly config: AppConfig,
    private readonly repositories: Repositories,
    semanticSearch: SemanticSearchAdapter
  ) {
    this.capture = new UiMapPageCaptureService(repositories, semanticSearch);
  }

  async start(input: {
    appId: string;
    routes: string[];
    auth?: { mode: UiScanAuthMode };
  }): Promise<InteractiveSessionSummary & { initialCapture: CapturePageResult }> {
    if (input.routes.length === 0) throw new ValidationAppError("At least one route is required.");
    const app = this.repositories.getApp(input.appId);
    const version = this.repositories.createUiMapVersion(input.appId, "interactive_browser_scan");
    const browser = await chromium.launch({ headless: this.config.UI_SCAN_HEADLESS });
    const context = await browser.newContext();
    const page = await context.newPage();
    const sessionId = createId("ui_scan_session");
    const firstRoute = input.routes[0]!;

    try {
      await applyUiScanAuth({
        page,
        baseUrl: app.baseUrl,
        config: this.config,
        mode: input.auth?.mode
      });
      await gotoAndSettle(page, new URL(firstRoute, app.baseUrl).toString());
      const initialCapture = await this.capture.captureCurrentPage({
        appId: input.appId,
        uiMapVersionId: version.id,
        baseUrl: app.baseUrl,
        page,
        route: firstRoute,
        stateName: "default",
        discoveredBy: "route_scan"
      });
      this.sessions.set(sessionId, {
        sessionId,
        appId: input.appId,
        baseUrl: app.baseUrl,
        uiMapVersionId: version.id,
        browser,
        context,
        page,
        createdAt: new Date().toISOString(),
        currentRoute: firstRoute
      });

      return {
        sessionId,
        appId: input.appId,
        uiMapVersionId: version.id,
        currentRoute: firstRoute,
        createdAt: new Date().toISOString(),
        initialCapture
      };
    } catch (error) {
      this.repositories.updateUiMapVersion(version.id, "failed", safeErrorMessage(error));
      await closeQuietly(context, browser);
      throw error;
    }
  }

  list(): InteractiveSessionSummary[] {
    return [...this.sessions.values()].map(toSummary);
  }

  get(sessionId: string): InteractiveSessionSummary {
    return toSummary(this.getSession(sessionId));
  }

  async goto(sessionId: string, input: { route: string; captureDefault?: boolean }): Promise<InteractiveSessionSummary & { capture?: CapturePageResult }> {
    const session = this.getSession(sessionId);
    await gotoAndSettle(session.page, new URL(input.route, session.baseUrl).toString());
    session.currentRoute = input.route;

    const capture = input.captureDefault === false
      ? undefined
      : await this.capture.captureCurrentPage({
        appId: session.appId,
        uiMapVersionId: session.uiMapVersionId,
        baseUrl: session.baseUrl,
        page: session.page,
        route: input.route,
        stateName: "default",
        discoveredBy: "route_scan"
      });

    return { ...toSummary(session), capture };
  }

  async captureState(sessionId: string, input: { stateName: string; stateReason?: string }): Promise<InteractiveSessionSummary & { capture: CapturePageResult }> {
    const session = this.getSession(sessionId);
    const capture = await this.capture.captureCurrentPage({
      appId: session.appId,
      uiMapVersionId: session.uiMapVersionId,
      baseUrl: session.baseUrl,
      page: session.page,
      route: session.currentRoute,
      stateName: input.stateName,
      stateReason: input.stateReason,
      discoveredBy: "manual_capture"
    });
    return { ...toSummary(session), capture };
  }

  async finish(sessionId: string): Promise<{ uiMapVersionId: string; status: string }> {
    const session = this.getSession(sessionId);
    this.repositories.updateUiMapVersion(session.uiMapVersionId, "completed");
    await this.closeSession(session);
    return { uiMapVersionId: session.uiMapVersionId, status: "completed" };
  }

  async cancel(sessionId: string, reason?: string): Promise<{ uiMapVersionId: string; status: string }> {
    const session = this.getSession(sessionId);
    this.repositories.updateUiMapVersion(session.uiMapVersionId, "failed", reason ?? "Interactive scan cancelled.");
    await this.closeSession(session);
    return { uiMapVersionId: session.uiMapVersionId, status: "failed" };
  }

  async closeAll(): Promise<void> {
    await Promise.all([...this.sessions.values()].map(async (session) => {
      try {
        this.repositories.updateUiMapVersion(session.uiMapVersionId, "failed", "Backend closed before interactive scan finished.");
      } finally {
        await this.closeSession(session);
      }
    }));
  }

  private getSession(sessionId: string): InteractiveSession {
    const session = this.sessions.get(sessionId);
    if (!session) throw new NotFoundError(`Interactive UI map session not found: ${sessionId}`);
    if (!session.browser.isConnected()) {
      this.sessions.delete(sessionId);
      throw new AppError("UI_SCAN_BROWSER_CLOSED", "Interactive scan browser was closed.", 410);
    }
    return session;
  }

  private async closeSession(session: InteractiveSession): Promise<void> {
    this.sessions.delete(session.sessionId);
    await closeQuietly(session.context, session.browser);
  }
}

function toSummary(session: InteractiveSession): InteractiveSessionSummary {
  return {
    sessionId: session.sessionId,
    appId: session.appId,
    uiMapVersionId: session.uiMapVersionId,
    currentRoute: session.currentRoute,
    createdAt: session.createdAt
  };
}

async function closeQuietly(context: BrowserContext, browser: Browser): Promise<void> {
  await context.close().catch(() => undefined);
  await browser.close().catch(() => undefined);
}

function safeErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
