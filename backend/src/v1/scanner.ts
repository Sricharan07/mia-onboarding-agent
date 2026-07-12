import { chromium, type Browser, type Frame, type Page, type Route } from "playwright";
import { createHash } from "node:crypto";
import type { V1Config } from "./config.js";
import type { UiActionPolicy } from "./domain.js";
import type { UiMapVersionRecord, V1Repositories } from "./db/repositories.js";
import type { V1Gemini } from "./gemini.js";
import type { V1SecretService } from "./secrets.js";
import { resolvePublicHttpsUrl } from "./network.js";
import { AppError } from "../utils/errors.js";
import { createId } from "../utils/id.js";
import { isProhibitedOperation, isProtectedInputSemantic } from "./safety.js";

const MAX_SCAN_ROUTES = 50;
const SCAN_TIMEOUT_MS = 30_000;

type ScanModel = Pick<V1Gemini, "embed">;
type ScanConfig = {
  authMode?: "none" | "login_form";
  loginUrl?: string;
  username?: string;
  usernameSelector?: string;
  passwordSelector?: string;
  submitSelector?: string;
  successUrlPattern?: string;
  allowedResourceOrigins?: string[];
  waitAfterLoginMs?: number;
};
type ScannedElement = {
  elementKey: string;
  route: string;
  role?: string;
  name?: string;
  description?: string;
  locators: unknown[];
  fingerprint: string;
  actionPolicy: UiActionPolicy;
  metadata: Record<string, unknown>;
};
type BrowserElement = {
  role?: string;
  name?: string;
  description?: string;
  tagName: string;
  type?: string;
  formAssociated?: boolean;
  formSubmitter?: boolean;
  href?: string;
  explicitKey?: string;
  locators: unknown[];
};

export class V1UiScanner {
  private readonly jobs = new Map<string, Promise<void>>();
  private closing = false;

  constructor(
    private readonly config: V1Config,
    private readonly repositories: V1Repositories,
    private readonly secrets: V1SecretService,
    private readonly model: ScanModel
  ) {}

  async start(input: { routes?: string[]; discover?: boolean }): Promise<UiMapVersionRecord> {
    const product = await this.repositories.product.get();
    const routes = normalizeRoutes(input.routes?.length ? input.routes : ["/"], product.origin);
    const version = await this.repositories.knowledge.createMapVersion({
      id: createId("ui_map"),
      routes,
      metadata: { discover: input.discover !== false }
    });
    this.schedule(version.id);
    return version;
  }

  async process(id: string): Promise<void> {
    const version = await this.repositories.knowledge.getMapVersion(id);
    const product = await this.repositories.product.get();
    const scanConfig = product.scanConfig as ScanConfig;
    const reviewedPolicies = new Map((await this.repositories.knowledge.listReviewedElementPolicies())
      .map((element) => [element.elementKey, element] as const));
    const pinnedOrigins = await validateScanOrigins(product.origin, scanConfig.allowedResourceOrigins ?? [], this.config.UI_SCAN_ALLOW_PRIVATE_NETWORKS);
    await this.repositories.knowledge.updateMapVersion(id, { status: "scanning", error: null });
    let browser: Browser | undefined;
    try {
      const resolverRules = hostResolverRules(pinnedOrigins);
      browser = await chromium.launch({
        headless: this.config.UI_SCAN_HEADLESS,
        args: resolverRules ? [`--host-resolver-rules=${resolverRules}`] : []
      });
      const context = await browser.newContext({
        acceptDownloads: false,
        ignoreHTTPSErrors: false,
        serviceWorkers: "block",
        viewport: { width: 1440, height: 1000 }
      });
      const page = await context.newPage();
      const allowedOrigins = new Set([product.origin, ...(scanConfig.allowedResourceOrigins ?? []).map(normalizeOrigin)]);
      await page.route("**/*", (route) => guardBrowserRequest(route, allowedOrigins));
      await authenticate(page, product.origin, scanConfig, await this.secrets.getScanPassword());

      const discover = version.metadata.discover !== false;
      const queue = [...version.routes];
      const visited = new Set<string>();
      const elements: ScannedElement[] = [];
      while (queue.length > 0 && visited.size < MAX_SCAN_ROUTES) {
        const requestedRoute = queue.shift()!;
        if (visited.has(requestedRoute)) continue;
        const target = new URL(requestedRoute, product.origin);
        await page.goto(target.toString(), { waitUntil: "domcontentloaded", timeout: SCAN_TIMEOUT_MS });
        await page.waitForTimeout(250);
        const actual = new URL(page.url());
        if (actual.origin !== product.origin) throw new AppError("SCAN_LEFT_PRODUCT", "The UI scan navigated outside the configured product origin.", 400);
        const route = normalizeRoute(`${actual.pathname}${actual.search}`);
        visited.add(route);
        const frames = page.frames().filter((frame) => {
          try { return new URL(frame.url()).origin === product.origin; } catch { return false; }
        });
        for (const [frameIndex, frame] of frames.entries()) {
          const scanned = await scanFrame(frame, product.redactedSelectors);
          elements.push(...scanned.map((element, index) => normalizeElement(element, route, frameIndex, index)));
        }
        if (discover) {
          const links = await page.locator("a[href]").evaluateAll((anchors) => anchors.map((anchor) => (anchor as HTMLAnchorElement).href));
          for (const raw of links) {
            const candidate = new URL(raw);
            const candidateRoute = normalizeRoute(`${candidate.pathname}${candidate.search}`);
            if (candidate.origin === product.origin && isScannableRoute(candidateRoute) && !visited.has(candidateRoute) && !queue.includes(candidateRoute)) queue.push(candidateRoute);
            if (queue.length + visited.size >= MAX_SCAN_ROUTES) break;
          }
        }
      }
      const deduped = dedupeElements(elements).map((element) => {
        const reviewed = reviewedPolicies.get(element.elementKey);
        return reviewed
          ? { ...element, actionPolicy: reviewed.actionPolicy, metadata: { ...element.metadata, ...reviewed.metadata, policySource: "admin" } }
          : element;
      });
      await this.repositories.knowledge.replaceMapElements(id, deduped.map((element) => ({ id: createId("ui_element"), ...element })));
      await this.indexMap(id, deduped);
      await this.repositories.knowledge.updateMapVersion(id, {
        status: "ready",
        routes: [...visited],
        metadata: { ...version.metadata, routeCount: visited.size, elementCount: deduped.length, indexedAt: new Date().toISOString() },
        error: null
      });
    } catch (error) {
      await this.repositories.knowledge.updateMapVersion(id, { status: "failed", error: safeScanError(error) });
      throw error;
    } finally {
      await browser?.close().catch(() => undefined);
    }
  }

  async resumePending(): Promise<void> {
    for (const version of await this.repositories.knowledge.listMapVersions()) {
      if (["pending", "scanning"].includes(version.status)) this.schedule(version.id);
    }
  }

  async wait(id: string): Promise<void> {
    await this.jobs.get(id);
  }

  async close(): Promise<void> {
    this.closing = true;
    await Promise.allSettled(this.jobs.values());
  }

  private schedule(id: string): void {
    if (this.closing || this.jobs.has(id)) return;
    const job = this.process(id).catch(() => undefined).finally(() => this.jobs.delete(id));
    this.jobs.set(id, job);
  }

  private async indexMap(id: string, elements: ScannedElement[]): Promise<void> {
    const sourceId = `knowledge_ui_map_${id}`;
    await this.repositories.knowledge.upsertSource({
      id: sourceId, kind: "ui_map", name: `UI map ${id}`, status: "processing", metadata: { mapVersionId: id }
    });
    const chunksByHash = new Map<string, {
      content: string;
      contentHash: string;
      metadata: { mapVersionId: string; elementKey: string; elementKeys: string[]; route: string };
    }>();
    for (const element of elements) {
      const content = [
        `Route: ${element.route}`,
        `Control: ${element.name ?? element.elementKey}`,
        `Role: ${element.role ?? element.metadata.tagName ?? "element"}`,
        element.description ? `Description: ${element.description}` : "",
        `Policy: ${element.actionPolicy}`
      ].filter(Boolean).join("\n");
      const contentHash = hash(content);
      const existing = chunksByHash.get(contentHash);
      if (existing) {
        existing.metadata.elementKeys.push(element.elementKey);
      } else {
        chunksByHash.set(contentHash, {
          content,
          contentHash,
          metadata: { mapVersionId: id, elementKey: element.elementKey, elementKeys: [element.elementKey], route: element.route }
        });
      }
    }
    const chunks = [...chunksByHash.values()];
    const embeddings = await this.model.embed(chunks.map((chunk) => chunk.content), undefined, "RETRIEVAL_DOCUMENT");
    await this.repositories.knowledge.replaceChunks(sourceId, chunks.map((chunk, index) => ({
      id: createId("chunk"), kind: "ui_map", content: chunk.content,
      contentHash: chunk.contentHash, metadata: chunk.metadata, embedding: embeddings[index]
    })));
    await this.repositories.knowledge.upsertSource({
      id: sourceId, kind: "ui_map", name: `UI map ${id}`, status: "ready",
      metadata: { mapVersionId: id, elementCount: elements.length, chunkCount: chunks.length }
    });
  }
}

export function actionPolicyForElement(element: Pick<BrowserElement, "role" | "name" | "description" | "tagName" | "type" | "formSubmitter">): UiActionPolicy {
  const semantic = [element.role, element.name, element.description, element.tagName].filter(Boolean).join(" ");
  if (isProhibitedOperation(semantic)) return "blocked";
  if (element.formSubmitter) return "blocked";
  if (["password", "file"].includes(element.type ?? "") || isProtectedInputSemantic(semantic)) return "manual";
  if (element.role === "link" || element.tagName === "a") return "navigate";
  if (["button", "textbox", "checkbox", "radio", "switch", "combobox", "listbox", "option", "slider", "spinbutton"].includes(element.role ?? "")
    || ["button", "input", "textarea", "select"].includes(element.tagName)) return "reversible_write";
  return "guide_only";
}

async function scanFrame(frame: Frame, redactedSelectors: string[]): Promise<BrowserElement[]> {
  return frame.evaluate((selectors) => {
    const result: BrowserElement[] = [];
    const interactive = "a[href],button,input,textarea,select,option,[role],[tabindex]:not([tabindex='-1']),[data-mia-key],h1,h2,h3";
    const roots: Array<Document | ShadowRoot> = [document];
    const seenRoots = new Set<Node>();
    while (roots.length > 0) {
      const root = roots.shift()!;
      if (seenRoots.has(root)) continue;
      seenRoots.add(root);
      for (const host of root.querySelectorAll("*")) if ((host as HTMLElement).shadowRoot) roots.push((host as HTMLElement).shadowRoot!);
      for (const node of root.querySelectorAll(interactive)) {
        const element = node as HTMLElement;
        if (element.closest("[data-mia-sdk-root],[data-mia-ignore]") || isRedacted(element, selectors) || !visible(element)) continue;
        const tagName = element.tagName.toLowerCase();
        const role = element.getAttribute("role") || implicitRole(element);
        const name = accessibleName(element);
        if (!role && !name) continue;
        const description = element.getAttribute("aria-description") || element.getAttribute("title") || undefined;
        const locators: unknown[] = [];
        if (role && name) locators.push({ strategy: "role", role, name });
        const label = labelText(element);
        if (label) locators.push({ strategy: "label", label });
        const testId = element.getAttribute("data-testid");
        if (testId) locators.push({ strategy: "css", selector: `[data-testid=${JSON.stringify(testId)}]` });
        if (element.id) locators.push({ strategy: "css", selector: `#${CSS.escape(element.id)}` });
        if (name && ["a", "button", "h1", "h2", "h3"].includes(tagName)) locators.push({ strategy: "text", text: name, tagName });
        result.push({
          role: role || undefined,
          name: name || undefined,
          description,
          tagName,
          type: element instanceof HTMLInputElement || element instanceof HTMLButtonElement ? element.type : undefined,
          formAssociated: element instanceof HTMLInputElement || element instanceof HTMLButtonElement
            || element instanceof HTMLSelectElement || element instanceof HTMLTextAreaElement
            ? Boolean(element.form)
            : false,
          formSubmitter: element instanceof HTMLInputElement || element instanceof HTMLButtonElement
            ? Boolean(element.form) && ["submit", "image"].includes(element.type.toLowerCase())
            : false,
          href: element instanceof HTMLAnchorElement ? element.href : undefined,
          explicitKey: element.dataset.miaKey,
          locators: locators.slice(0, 8)
        });
      }
    }
    return result;

    function visible(element: HTMLElement): boolean {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity) !== 0 && rect.width > 0 && rect.height > 0;
    }
    function isRedacted(element: HTMLElement, configured: string[]): boolean {
      return configured.some((selector) => {
        try { return Boolean(element.closest(selector)); } catch { return false; }
      });
    }
    function implicitRole(element: HTMLElement): string | undefined {
      const tag = element.tagName.toLowerCase();
      if (tag === "a" && element.hasAttribute("href")) return "link";
      if (tag === "button") return "button";
      if (tag === "textarea") return "textbox";
      if (tag === "select") return "combobox";
      if (/^h[1-6]$/.test(tag)) return "heading";
      if (element instanceof HTMLInputElement) {
        if (["button", "submit", "reset"].includes(element.type)) return "button";
        if (element.type === "checkbox") return "checkbox";
        if (element.type === "radio") return "radio";
        if (element.type === "range") return "slider";
        return "textbox";
      }
      return undefined;
    }
    function accessibleName(element: HTMLElement): string {
      const labelledBy = element.getAttribute("aria-labelledby")?.split(/\s+/).map((id) => document.getElementById(id)?.textContent ?? "").join(" ").trim();
      return (element.getAttribute("aria-label") || labelledBy || labelText(element) || element.getAttribute("alt") || element.textContent || "").replace(/\s+/g, " ").trim().slice(0, 500);
    }
    function labelText(element: HTMLElement): string | undefined {
      if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement) {
        const direct = element.labels?.[0]?.textContent?.replace(/\s+/g, " ").trim();
        if (direct) return direct;
      }
      return undefined;
    }
  }, redactedSelectors);
}

async function authenticate(page: Page, productOrigin: string, config: ScanConfig, password?: string): Promise<void> {
  if (!config.authMode || config.authMode === "none") return;
  if (!config.loginUrl || !config.username || !config.usernameSelector || !config.passwordSelector || !config.submitSelector || !password) {
    throw new AppError("SCAN_AUTH_INCOMPLETE", "Login-form scan authentication is incomplete.", 409);
  }
  const login = new URL(config.loginUrl, productOrigin);
  if (login.origin !== productOrigin) throw new AppError("SCAN_AUTH_ORIGIN_INVALID", "Scan login URL must use the product origin.", 400);
  await page.goto(login.toString(), { waitUntil: "domcontentloaded", timeout: SCAN_TIMEOUT_MS });
  await page.locator(config.usernameSelector).fill(config.username);
  await page.locator(config.passwordSelector).fill(password);
  await Promise.all([
    page.waitForLoadState("domcontentloaded", { timeout: SCAN_TIMEOUT_MS }).catch(() => undefined),
    page.locator(config.submitSelector).click()
  ]);
  await page.waitForTimeout(Math.min(Math.max(config.waitAfterLoginMs ?? 500, 0), 5_000));
  if (config.successUrlPattern && !new RegExp(config.successUrlPattern).test(page.url())) {
    throw new AppError("SCAN_AUTH_FAILED", "UI scan login did not reach the configured success URL.", 400);
  }
}

function guardBrowserRequest(route: Route, allowedOrigins: Set<string>): Promise<void> {
  const raw = route.request().url();
  if (/^(?:data|blob|about):/.test(raw)) return route.continue();
  let origin: string;
  try { origin = new URL(raw).origin; } catch { return route.abort("blockedbyclient"); }
  return allowedOrigins.has(origin) ? route.continue() : route.abort("blockedbyclient");
}

export type PinnedScanOrigin = { hostname: string; address: string; family: 4 | 6 };

async function validateScanOrigins(productOrigin: string, resourceOrigins: string[], allowPrivate: boolean): Promise<PinnedScanOrigin[]> {
  const origins = [productOrigin, ...resourceOrigins.map(normalizeOrigin)];
  if (allowPrivate) return [];
  const resolved = await Promise.all(origins.map((origin) => resolvePublicHttpsUrl(origin)));
  return resolved.map(({ url, address, family }) => ({ hostname: url.hostname, address, family }));
}

export function hostResolverRules(origins: PinnedScanOrigin[]): string {
  const addresses = new Map<string, string>();
  for (const origin of origins) {
    if (!addresses.has(origin.hostname)) {
      addresses.set(origin.hostname, origin.family === 6 ? `[${origin.address}]` : origin.address);
    }
  }
  return [...addresses].map(([hostname, address]) => `MAP ${hostname} ${address}`).join(", ");
}

function normalizeElement(element: BrowserElement, route: string, frameIndex: number, index: number): ScannedElement {
  const semantic = `${route}|${frameIndex}|${element.role ?? element.tagName}|${element.name ?? ""}|${index}`;
  const elementKey = element.explicitKey?.slice(0, 300) || `mapped_${hash(semantic).slice(0, 20)}`;
  return {
    elementKey,
    route,
    role: element.role,
    name: element.name,
    description: element.description,
    locators: element.locators,
    fingerprint: hash(JSON.stringify({ route, role: element.role, name: element.name, tag: element.tagName, type: element.type })),
    actionPolicy: actionPolicyForElement(element),
    metadata: {
      tagName: element.tagName,
      type: element.type,
      href: element.href,
      formAssociated: element.formAssociated,
      formSubmitter: element.formSubmitter,
      frameIndex,
      policySource: "inferred"
    }
  };
}

function dedupeElements(elements: ScannedElement[]): ScannedElement[] {
  const byKey = new Map<string, ScannedElement>();
  for (const element of elements) {
    let key = element.elementKey;
    let suffix = 1;
    while (byKey.has(key) && byKey.get(key)?.fingerprint !== element.fingerprint) key = `${element.elementKey}_${suffix++}`;
    byKey.set(key, { ...element, elementKey: key });
  }
  return [...byKey.values()];
}

function normalizeRoutes(routes: string[], origin: string): string[] {
  const normalized = routes.map((route) => {
    const url = new URL(route, origin);
    if (url.origin !== origin) throw new AppError("SCAN_ROUTE_INVALID", "Scan routes must stay on the configured product origin.", 400);
    return normalizeRoute(`${url.pathname}${url.search}`);
  });
  return [...new Set(normalized)].slice(0, MAX_SCAN_ROUTES);
}

function normalizeRoute(value: string): string {
  const url = new URL(value, "https://route.invalid");
  url.hash = "";
  url.searchParams.sort();
  return `${url.pathname}${url.search}`;
}

function normalizeOrigin(value: string): string {
  const url = new URL(value);
  if (url.origin !== value.replace(/\/$/, "")) throw new AppError("SCAN_RESOURCE_ORIGIN_INVALID", "Allowed scan resources must be origins.", 400);
  return url.origin;
}

function isScannableRoute(route: string): boolean {
  return !/(?:^|\/)(?:logout|signout)(?:\/|$)/i.test(route) && !/\.(?:pdf|zip|png|jpe?g|gif|svg|mp[34]|webm)(?:$|\?)/i.test(route);
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function safeScanError(error: unknown): string {
  return (error instanceof AppError && error.statusCode < 500
    ? error.message
    : "UI scan failed. Review the protected server logs and retry.").slice(0, 2_000);
}
