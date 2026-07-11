import assert from "node:assert/strict";
import { access } from "node:fs/promises";
import { chromium, firefox, webkit } from "playwright";

const demoUrl = process.env.MIA_ACCEPTANCE_DEMO_URL ?? "http://127.0.0.1:3001/dashboard/crm";
const consoleUrl = (process.env.MIA_ACCEPTANCE_CONSOLE_URL ?? "http://127.0.0.1:4000").replace(/\/$/, "");
const email = required("MIA_ACCEPTANCE_CONSOLE_EMAIL");
const password = required("MIA_ACCEPTANCE_CONSOLE_PASSWORD");
const runAgent = process.env.MIA_ACCEPTANCE_AGENT === "true";
const edgeExecutable = process.env.MIA_EDGE_EXECUTABLE
  ?? "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge";

await access(edgeExecutable).catch(() => {
  throw new Error("Microsoft Edge is required. Set MIA_EDGE_EXECUTABLE to its browser executable.");
});

const browsers = [
  { name: "Chrome", launch: () => chromium.launch({ channel: "chrome", headless: true }) },
  { name: "Edge", launch: () => chromium.launch({ executablePath: edgeExecutable, headless: true }) },
  { name: "Firefox", launch: () => firefox.launch({ headless: true }) },
  { name: "WebKit", launch: () => webkit.launch({ headless: true }) }
];
const results = [];
const failures = [];

for (const definition of browsers) {
  let browser;
  try {
    browser = await definition.launch();
    const version = browser.version();
    const consoleResult = await testConsole(browser, definition.name);
    const demoResult = await testDemo(browser, definition.name);
    results.push({ browser: definition.name, version, console: consoleResult, demo: demoResult });
    process.stdout.write(`${definition.name} ${version}: passed\n`);
  } catch (error) {
    failures.push({ browser: definition.name, error: error instanceof Error ? error.message : String(error) });
    process.stderr.write(`${definition.name}: ${failures.at(-1).error}\n`);
  } finally {
    await browser?.close().catch(() => undefined);
  }
}

process.stdout.write(`${JSON.stringify({ results, failures }, null, 2)}\n`);
if (failures.length > 0) process.exitCode = 1;

async function testConsole(browser, browserName) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: "reduce" });
  const page = await context.newPage();
  const errors = collectErrors(page);
  try {
    await page.goto(`${consoleUrl}/overview`, { waitUntil: "networkidle" });
    if (await page.getByRole("heading", { name: "Sign in to Mia" }).isVisible().catch(() => false)) {
      await page.getByLabel("Email").fill(email);
      await page.getByLabel("Password").fill(password);
      await page.getByRole("button", { name: "Sign in" }).click();
    }
    await page.locator(".page-content").waitFor({ state: "visible" });

    const routes = [
      ["Setup", "/setup"],
      ["Overview", "/overview"],
      ["Knowledge", "/knowledge"],
      ["Skills", "/skills"],
      ["Actions & Safety", "/actions"],
      ["Test Mia", "/test-mia"],
      ["Runs", "/runs"],
      ["Settings", "/settings"]
    ];
    for (const [heading, path] of routes) {
      await page.goto(`${consoleUrl}${path}`, { waitUntil: "networkidle" });
      await page.locator(".page-content").waitFor({ state: "visible" });
      assert.equal((await page.locator("h1").textContent())?.trim(), heading, `${browserName} console heading ${path}`);
      assert.equal(await horizontalOverflow(page), 0, `${browserName} console overflow ${path}`);
    }

    await page.goto(`${consoleUrl}/overview`, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "Open navigation" }).click();
    await page.waitForTimeout(250);
    const navigation = await page.locator(".sidebar").boundingBox();
    assert.ok(navigation && navigation.x >= -1 && navigation.x + navigation.width <= 391, `${browserName} mobile navigation bounds`);
    assert.equal(await page.getByRole("button", { name: "Dismiss navigation overlay" }).isVisible(), true);
    assert.deepEqual(errors, [], `${browserName} console errors`);
    return { routes: routes.length, mobileOverflow: 0, navigation: true };
  } catch (error) {
    await page.screenshot({ path: `/tmp/mia-browser-acceptance-${slug(browserName)}-console.png`, fullPage: true }).catch(() => undefined);
    throw error;
  } finally {
    await context.close();
  }
}

async function testDemo(browser, browserName) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" });
  const page = await context.newPage();
  const errors = collectErrors(page);
  await page.addInitScript(() => {
    window.__miaAcceptanceEvents = [];
    window.addEventListener("mia:runtime-event", (event) => {
      const detail = event.detail;
      window.__miaAcceptanceEvents.push({
        type: detail?.type,
        actionType: detail?.action?.type,
        receiptType: detail?.receipt?.type,
        receiptStatus: detail?.receipt?.status,
        message: detail?.message
      });
    });
  });
  try {
    await page.goto(demoUrl, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => window.__miaAcceptanceEvents?.some((event) => event.type === "ready"), null, { timeout: 30_000 });
    assert.equal(await horizontalOverflow(page), 0, `${browserName} demo desktop overflow`);
    const launcher = page.locator("[data-mia-assistant-panel] [data-launcher]");
    await launcher.focus();
    await launcher.press("Enter");
    await page.locator("[data-mia-assistant-panel] [data-panel]").waitFor({ state: "visible" });
    assertPanelBounds(await panelMetrics(page), `${browserName} desktop`);

    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(250);
    assert.equal(await horizontalOverflow(page), 0, `${browserName} demo mobile overflow`);
    assertPanelBounds(await panelMetrics(page), `${browserName} mobile`);

    let agent = "not requested";
    if (runAgent) {
      await page.setViewportSize({ width: 1440, height: 900 });
      const composer = page.locator("[data-mia-assistant-panel] [data-composer]");
      await composer.fill("Point to the Stage filter with your visible cursor, then explain what the filter does.");
      await composer.press("Enter");
      await page.waitForFunction(() => window.__miaAcceptanceEvents?.some((event) => event.type === "action_completed" && event.receiptType === "point" && event.receiptStatus === "completed"), null, { timeout: 90_000 });
      await page.waitForFunction(() => window.__miaAcceptanceEvents?.some((event) => ["answer", "completed"].includes(event.type)), null, { timeout: 90_000 });
      agent = "point and answer passed";
    }

    const runtimeErrors = await page.evaluate(() => window.__miaAcceptanceEvents?.filter((event) => event.type === "error") ?? []);
    assert.deepEqual(runtimeErrors, [], `${browserName} SDK runtime errors`);
    assert.deepEqual(errors, [], `${browserName} demo errors`);
    return { ready: true, desktopOverflow: 0, mobileOverflow: 0, panel: true, agent };
  } catch (error) {
    await page.screenshot({ path: `/tmp/mia-browser-acceptance-${slug(browserName)}-demo.png`, fullPage: true }).catch(() => undefined);
    throw error;
  } finally {
    await context.close();
  }
}

function collectErrors(page) {
  const errors = [];
  page.on("pageerror", (error) => errors.push(`page: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(`console: ${message.text()}`);
  });
  return errors;
}

async function horizontalOverflow(page) {
  return page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - document.documentElement.clientWidth);
}

async function panelMetrics(page) {
  return page.evaluate(() => {
    const host = document.querySelector("[data-mia-assistant-panel]");
    const root = host?.shadowRoot;
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
      viewport: { width: innerWidth, height: innerHeight }
    };
  });
}

function assertPanelBounds(metrics, label) {
  assert.ok(metrics.panel, `${label} panel exists`);
  assert.ok(metrics.panel.x >= 0 && metrics.panel.y >= 0, `${label} panel starts inside viewport`);
  assert.ok(metrics.panel.right <= metrics.viewport.width + 1 && metrics.panel.bottom <= metrics.viewport.height + 1, `${label} panel ends inside viewport`);
  assert.equal(metrics.launcherVisibility, "hidden", `${label} launcher hidden while panel is open`);
  assert.equal(metrics.input && metrics.microphone && metrics.stop, true, `${label} expected controls`);
  assert.equal(metrics.reducedMotion, true, `${label} reduced-motion state`);
}

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function slug(value) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-");
}
