import assert from "node:assert/strict";
import { access, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { chromium, firefox, webkit } from "playwright";
import {
  assertNoAxeViolations,
  booleanEnvironment,
  consoleRoutes,
  required,
  slug
} from "./lib/acceptance.mjs";

const demoUrl = process.env.MIA_ACCEPTANCE_DEMO_URL ?? "http://127.0.0.1:3001/dashboard/crm";
const consoleUrl = (process.env.MIA_ACCEPTANCE_CONSOLE_URL ?? "http://127.0.0.1:4000").replace(/\/$/, "");
const email = required("MIA_ACCEPTANCE_CONSOLE_EMAIL");
const password = required("MIA_ACCEPTANCE_CONSOLE_PASSWORD");
const requireAgent = booleanEnvironment("MIA_ACCEPTANCE_AGENT", false);
const evidenceDirectory = resolve(process.env.MIA_ACCEPTANCE_EVIDENCE_DIR ?? "/tmp/mia-release-evidence");
const requestedBrowsers = new Set((process.env.MIA_ACCEPTANCE_BROWSERS ?? "chrome,edge,firefox,webkit")
  .split(",").map((value) => value.trim().toLowerCase()).filter(Boolean));

await mkdir(evidenceDirectory, { recursive: true });
const definitions = await browserDefinitions();
const unknown = [...requestedBrowsers].filter((name) => !definitions.some((definition) => definition.id === name));
assert.deepEqual(unknown, [], `Unknown acceptance browsers: ${unknown.join(", ")}`);
if (requireAgent) assert.equal(requestedBrowsers.has("chrome"), true, "Agent acceptance requires Google Chrome.");

const results = [];
const failures = [];
for (const definition of definitions.filter((candidate) => requestedBrowsers.has(candidate.id))) {
  let browser;
  try {
    browser = await definition.launch();
    const version = browser.version();
    const consoleResult = await testConsole(browser, definition.name);
    const runAgent = requireAgent && definition.id === "chrome";
    const demoResult = await testDemo(browser, definition.name, runAgent);
    results.push({ browser: definition.name, version, console: consoleResult, demo: demoResult });
    process.stdout.write(`${definition.name} ${version}: passed\n`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    failures.push({ browser: definition.name, error: message });
    process.stderr.write(`${definition.name}: ${message}\n`);
  } finally {
    await browser?.close().catch(() => undefined);
  }
}
process.stdout.write(`${JSON.stringify({ artifactBound: true, results, failures }, null, 2)}\n`);
if (failures.length > 0) process.exitCode = 1;

async function browserDefinitions() {
  const edgeExecutable = process.env.MIA_EDGE_EXECUTABLE?.trim();
  if (edgeExecutable) await access(edgeExecutable);
  return [
    { id: "chrome", name: "Google Chrome", launch: () => chromium.launch({ channel: "chrome", headless: true }) },
    {
      id: "edge",
      name: "Microsoft Edge",
      launch: () => chromium.launch(edgeExecutable ? { executablePath: edgeExecutable, headless: true } : { channel: "msedge", headless: true })
    },
    { id: "firefox", name: "Firefox", launch: () => firefox.launch({ headless: true }) },
    { id: "webkit", name: "Playwright WebKit", launch: () => webkit.launch({ headless: true }) }
  ];
}

async function testConsole(browser, browserName) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce", colorScheme: "light" });
  const page = await context.newPage();
  const errors = collectErrors(page);
  try {
    await signIn(page);
    for (const [heading, path] of consoleRoutes) {
      await openConsoleRoute(page, path);
      assert.equal((await page.locator("h1").textContent())?.trim(), heading, `${browserName} console heading ${path}`);
      assert.equal(await horizontalOverflow(page), 0, `${browserName} desktop console overflow ${path}`);
      await assertAccessible(page, `${browserName} console ${path} desktop`);
    }
    await page.screenshot({ path: evidencePath(browserName, "console-desktop"), fullPage: true });

    await page.setViewportSize({ width: 720, height: 450 });
    await openConsoleRoute(page, "/overview");
    assert.equal(await horizontalOverflow(page), 0, `${browserName} console 200-percent-equivalent reflow`);
    assert.equal(await visibleTextClipping(page), 0, `${browserName} console clips visible text at 200-percent-equivalent reflow`);

    await page.setViewportSize({ width: 390, height: 844 });
    for (const [heading, path] of consoleRoutes) {
      await openConsoleRoute(page, path);
      assert.equal((await page.locator("h1").textContent())?.trim(), heading, `${browserName} mobile console heading ${path}`);
      assert.equal(await horizontalOverflow(page), 0, `${browserName} mobile console overflow ${path}`);
      await assertAccessible(page, `${browserName} console ${path} mobile`);
    }
    await openConsoleRoute(page, "/overview");
    const sidebar = page.locator(".sidebar");
    assert.equal(await sidebar.evaluate((element) => element.inert), true, `${browserName} closed mobile navigation is inert`);
    assert.equal(await sidebar.getAttribute("aria-hidden"), "true", `${browserName} closed mobile navigation is hidden from assistive technology`);
    assert.equal(await sidebar.evaluate((element) => {
      element.querySelector("button")?.focus();
      return !element.contains(document.activeElement);
    }), true, `${browserName} hidden mobile navigation rejects focus`);

    const openButton = page.getByRole("button", { name: "Open navigation" });
    await openButton.focus();
    assert.equal(await hasVisibleFocus(openButton), true, `${browserName} navigation trigger has no visible keyboard focus`);
    await openButton.press("Enter");
    await page.waitForTimeout(250);
    const navigation = await sidebar.boundingBox();
    assert.ok(navigation && navigation.x >= -1 && navigation.x + navigation.width <= 391, `${browserName} mobile navigation bounds`);
    assert.equal(await page.getByRole("button", { name: "Dismiss navigation overlay" }).isVisible(), true);
    assert.equal(await sidebar.evaluate((element) => element.inert), false, `${browserName} open mobile navigation is interactive`);
    assert.equal(await page.locator(".main-shell").evaluate((element) => element.inert), true, `${browserName} navigation background is inert`);
    assert.equal(await page.evaluate(() => document.activeElement?.getAttribute("aria-label")), "Close navigation", `${browserName} navigation receives focus`);
    await page.keyboard.press("Shift+Tab");
    assert.equal(await page.evaluate(() => document.activeElement?.getAttribute("aria-label")), "Sign out", `${browserName} reverse tab wraps inside navigation`);
    await page.keyboard.press("Tab");
    assert.equal(await page.evaluate(() => document.activeElement?.getAttribute("aria-label")), "Close navigation", `${browserName} forward tab wraps inside navigation`);
    await page.keyboard.press("Escape");
    await page.waitForFunction(() => document.activeElement?.getAttribute("aria-label") === "Open navigation");
    assert.equal(await page.evaluate(() => document.activeElement?.getAttribute("aria-label")), "Open navigation", `${browserName} closing navigation restores focus`);

    await page.setViewportSize({ width: 320, height: 700 });
    await openConsoleRoute(page, "/overview");
    assert.equal(await horizontalOverflow(page), 0, `${browserName} 320px console overflow`);
    await page.screenshot({ path: evidencePath(browserName, "console-mobile-320"), fullPage: true });
    assert.deepEqual(errors, [], `${browserName} console errors`);
    return { routes: consoleRoutes.length, desktop: true, mobile: true, width320: true, zoomEquivalent200: true, wcag22aa: true, keyboard: true };
  } catch (error) {
    await page.screenshot({ path: evidencePath(browserName, "console-failure"), fullPage: true }).catch(() => undefined);
    throw error;
  } finally {
    await context.close();
  }
}

async function testDemo(browser, browserName, runAgent) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: "no-preference", colorScheme: "light" });
  const page = await context.newPage();
  const errors = collectErrors(page);
  await installEventCapture(page, "__miaAcceptanceEvents");
  try {
    await openDemo(page);
    assert.equal(await horizontalOverflow(page), 0, `${browserName} demo desktop overflow`);
    const launcher = page.locator("[data-mia-assistant-panel] [data-launcher]");
    await launcher.focus();
    assert.equal(await hasVisibleFocus(launcher), true, `${browserName} Mia launcher has no visible keyboard focus`);
    await launcher.press("Enter");
    await page.locator("[data-mia-assistant-panel] [data-panel]").waitFor({ state: "visible" });
    assertPanelBounds(await panelMetrics(page), `${browserName} desktop`, false);
    await assertAccessible(page, `${browserName} demo desktop with Mia open`);
    await page.screenshot({ path: evidencePath(browserName, "demo-desktop"), fullPage: true });

    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(250);
    assert.equal(await horizontalOverflow(page), 0, `${browserName} demo mobile overflow`);
    assertPanelBounds(await panelMetrics(page), `${browserName} mobile`, false);
    await assertAccessible(page, `${browserName} demo mobile with Mia open`);

    await page.setViewportSize({ width: 320, height: 700 });
    await page.waitForTimeout(250);
    assert.equal(await horizontalOverflow(page), 0, `${browserName} demo 320px overflow`);
    assertPanelBounds(await panelMetrics(page), `${browserName} 320px`, false);
    await page.screenshot({ path: evidencePath(browserName, "demo-mobile-320"), fullPage: true });

    let agent = "not required";
    if (runAgent) {
      await page.setViewportSize({ width: 1440, height: 900 });
      const composer = page.locator("[data-mia-assistant-panel] [data-composer]");
      await composer.fill("Point to the Stage filter with your visible cursor, then explain what the filter does.");
      await composer.press("Enter");
      await waitForEvent(page, "__miaAcceptanceEvents", (event) => event.type === "action_completed" && event.receiptType === "point" && event.receiptStatus === "completed");
      await waitForEvent(page, "__miaAcceptanceEvents", (event) => ["answer", "completed"].includes(event.type));
      const cursor = await cursorTargetMetrics(page, "Stage");
      assert.ok(cursor.target && cursor.cursor, `${browserName} cursor and Stage target exist`);
      assert.ok(cursor.distance <= 4, `${browserName} cursor hotspot is ${cursor.distance.toFixed(2)}px from the Stage target`);
      assert.equal(cursor.targetHit, true, `${browserName} Stage target is occluded`);
      assert.equal(cursor.panelHidden, true, `${browserName} panel did not collapse during guidance`);
      agent = "real point, receipt, cursor, and judged answer passed";
      await page.screenshot({ path: evidencePath(browserName, "demo-agent-point"), fullPage: true });
    }

    await page.emulateMedia({ reducedMotion: "reduce", colorScheme: "dark" });
    await page.reload({ waitUntil: "domcontentloaded" });
    await waitForEvent(page, "__miaAcceptanceEvents", (event) => event.type === "ready", 30_000);
    const reduced = await panelMetrics(page);
    assert.equal(reduced.reducedMotion, true, `${browserName} reduced-motion mode is not honored`);
    assert.equal(reduced.colorScheme, "dark", `${browserName} dark host preference is not exposed`);
    assert.deepEqual(await runtimeErrors(page, "__miaAcceptanceEvents"), [], `${browserName} SDK runtime errors`);
    assert.deepEqual(errors, [], `${browserName} demo errors`);
    return { ready: true, desktop: true, mobile: true, width320: true, panel: true, wcag22aa: true, reducedMotion: true, darkHost: true, agent };
  } catch (error) {
    await page.screenshot({ path: evidencePath(browserName, "demo-failure"), fullPage: true }).catch(() => undefined);
    throw error;
  } finally {
    await context.close();
  }
}

async function signIn(page) {
  await page.goto(`${consoleUrl}/overview`, { waitUntil: "networkidle" });
  if (await page.getByRole("heading", { name: "Sign in to Mia" }).isVisible().catch(() => false)) {
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill(password);
    await page.getByRole("button", { name: "Sign in" }).click();
  }
  await page.locator(".page-content").waitFor({ state: "visible" });
}

async function openConsoleRoute(page, path) {
  await page.goto(`${consoleUrl}${path}`, { waitUntil: "networkidle" });
  await page.locator(".page-content").waitFor({ state: "visible" });
}

async function openDemo(page) {
  await page.goto(demoUrl, { waitUntil: "domcontentloaded" });
  await waitForEvent(page, "__miaAcceptanceEvents", (event) => event.type === "ready", 30_000);
}

async function installEventCapture(page, key) {
  await page.addInitScript((storageKey) => {
    window[storageKey] = [];
    window.addEventListener("mia:runtime-event", (event) => {
      const detail = event.detail;
      window[storageKey].push({
        type: detail?.type,
        actionType: detail?.action?.type,
        actionRisk: detail?.action?.risk,
        targetLabel: detail?.action?.target?.label,
        receiptType: detail?.receipt?.type,
        receiptStatus: detail?.receipt?.status,
        message: detail?.message,
        error: detail?.error?.message
      });
    });
  }, key);
}

async function waitForEvent(page, key, predicate, timeout = 90_000) {
  const handle = await page.waitForFunction(({ storageKey, predicateSource }) => {
    const test = Function(`return (${predicateSource})`)();
    const events = window[storageKey] ?? [];
    const match = events.find((event) => test(event));
    if (match) return { outcome: "match", event: match };
    const failure = events.find((event) => event.type === "error");
    return failure ? { outcome: "error", event: failure } : undefined;
  }, { storageKey: key, predicateSource: predicate.toString() }, { timeout });
  const result = await handle.jsonValue();
  if (result.outcome === "error") throw new Error(`SDK runtime error: ${result.event.error ?? "unknown error"}`);
  return result.event;
}

function runtimeErrors(page, key) {
  return page.evaluate((storageKey) => window[storageKey]?.filter((event) => event.type === "error") ?? [], key);
}

async function assertAccessible(page, label) {
  const result = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22a", "wcag22aa"])
    .analyze();
  assertNoAxeViolations(result, label);
}

function collectErrors(page) {
  const errors = [];
  page.on("pageerror", (error) => errors.push(`page: ${error.message}`));
  page.on("console", (message) => { if (message.type() === "error") errors.push(`console: ${message.text()}`); });
  return errors;
}

function horizontalOverflow(page) {
  return page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - document.documentElement.clientWidth);
}

function visibleTextClipping(page) {
  return page.evaluate(() => [...document.querySelectorAll("button,a,label,h1,h2,h3,p")].filter((element) => {
    const style = getComputedStyle(element);
    const visible = style.display !== "none" && style.visibility !== "hidden" && element.getClientRects().length > 0;
    return visible && (element.scrollWidth > element.clientWidth + 1 || element.scrollHeight > element.clientHeight + 1)
      && style.overflow !== "auto" && style.overflow !== "scroll";
  }).length);
}

function hasVisibleFocus(locator) {
  return locator.evaluate((element) => {
    const style = getComputedStyle(element);
    const root = element.getRootNode();
    const active = root instanceof ShadowRoot ? root.activeElement : document.activeElement;
    const outline = style.outlineStyle !== "none" && Number.parseFloat(style.outlineWidth) > 0;
    const shadow = style.boxShadow !== "none";
    const border = style.borderColor !== "rgba(0, 0, 0, 0)" && Number.parseFloat(style.borderWidth) > 0;
    return active === element && element.matches(":focus-visible") && (outline || shadow || border);
  });
}

function panelMetrics(page) {
  return page.evaluate(() => {
    const root = document.querySelector("[data-mia-assistant-panel]")?.shadowRoot;
    const panel = root?.querySelector("[data-panel]");
    const launcher = root?.querySelector("[data-launcher]");
    const rect = panel?.getBoundingClientRect();
    return {
      panel: rect ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height, right: rect.right, bottom: rect.bottom } : null,
      launcherVisibility: launcher ? getComputedStyle(launcher).visibility : "missing",
      input: Boolean(root?.querySelector("[data-composer]")),
      microphone: Boolean(root?.querySelector("[data-voice]")),
      stop: Boolean(root?.querySelector("[data-stop]")),
      reducedMotion: document.querySelector("[data-mia-shadow-cursor]")?.shadowRoot?.querySelector(".mia-root")?.hasAttribute("data-reduced-motion") ?? false,
      colorScheme: matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light",
      viewport: { width: innerWidth, height: innerHeight }
    };
  });
}

function assertPanelBounds(metrics, label, reducedMotion) {
  assert.ok(metrics.panel, `${label} panel does not exist`);
  assert.ok(metrics.panel.x >= 0 && metrics.panel.y >= 0, `${label} panel starts outside the viewport`);
  assert.ok(metrics.panel.right <= metrics.viewport.width + 1 && metrics.panel.bottom <= metrics.viewport.height + 1, `${label} panel ends outside the viewport`);
  assert.equal(metrics.launcherVisibility, "hidden", `${label} launcher remains visible while the panel is open`);
  assert.equal(metrics.input && metrics.microphone && metrics.stop, true, `${label} is missing an expected assistant control`);
  assert.equal(metrics.reducedMotion, reducedMotion, `${label} reduced-motion state is wrong`);
}

function cursorTargetMetrics(page, label) {
  return page.evaluate((targetLabel) => {
    const target = [...document.querySelectorAll("button")].find((element) => element.textContent?.trim() === targetLabel);
    const cursor = document.querySelector("[data-mia-shadow-cursor]")?.shadowRoot?.querySelector(".mia-cursor");
    const panel = document.querySelector("[data-mia-assistant-panel]")?.shadowRoot?.querySelector("[data-panel]");
    const targetRect = target?.getBoundingClientRect();
    const cursorRect = cursor?.getBoundingClientRect();
    const center = targetRect ? { x: targetRect.left + targetRect.width / 2, y: targetRect.top + targetRect.height / 2 } : null;
    const hit = center ? document.elementFromPoint(center.x, center.y) : null;
    return {
      target: targetRect ? { x: targetRect.x, y: targetRect.y, width: targetRect.width, height: targetRect.height } : null,
      cursor: cursorRect ? { x: cursorRect.x, y: cursorRect.y, width: cursorRect.width, height: cursorRect.height } : null,
      distance: center && cursorRect ? Math.hypot(center.x - cursorRect.left, center.y - cursorRect.top) : Number.POSITIVE_INFINITY,
      targetHit: Boolean(target && hit && (hit === target || target.contains(hit))),
      panelHidden: panel?.hasAttribute("hidden") ?? false
    };
  }, label);
}

function evidencePath(browserName, name) {
  return resolve(evidenceDirectory, `${slug(browserName)}-${name}.png`);
}
