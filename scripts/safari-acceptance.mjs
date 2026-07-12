import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { Builder, By, Key, until } from "selenium-webdriver";
import { assertNoAxeViolations, consoleRoutes, required, slug } from "./lib/acceptance.mjs";

const require = createRequire(import.meta.url);
const axeSource = await readFile(require.resolve("axe-core/axe.min.js"), "utf8");
const demoUrl = process.env.MIA_ACCEPTANCE_DEMO_URL ?? "http://127.0.0.1:3001/dashboard/crm";
const consoleUrl = (process.env.MIA_ACCEPTANCE_CONSOLE_URL ?? "http://127.0.0.1:4000").replace(/\/$/, "");
const email = required("MIA_ACCEPTANCE_CONSOLE_EMAIL");
const password = required("MIA_ACCEPTANCE_CONSOLE_PASSWORD");
const evidenceDirectory = resolve(process.env.MIA_ACCEPTANCE_EVIDENCE_DIR ?? "/tmp/mia-release-evidence");
await mkdir(evidenceDirectory, { recursive: true });

const driver = await new Builder().forBrowser("safari").build();
try {
  const capabilities = await driver.getCapabilities();
  const consoleResult = await testConsole();
  const demoResult = await testDemo();
  process.stdout.write(`${JSON.stringify({
    artifactBound: true,
    browser: "Safari",
    version: capabilities.getBrowserVersion(),
    platform: capabilities.getPlatform(),
    console: consoleResult,
    demo: demoResult
  }, null, 2)}\n`);
} catch (error) {
  await screenshot("safari-failure").catch(() => undefined);
  throw error;
} finally {
  await driver.quit();
}

async function testConsole() {
  await setViewport(1440, 900);
  await driver.get(`${consoleUrl}/overview`);
  await signInIfNeeded();
  for (const [heading, path] of consoleRoutes) {
    await openConsole(path);
    assert.equal((await driver.findElement(By.css("h1")).getText()).trim(), heading, `Safari console heading ${path}`);
    assert.equal(await horizontalOverflow(), 0, `Safari desktop console overflow ${path}`);
    await assertAccessible(`Safari console ${path} desktop`);
  }
  await screenshot("safari-console-desktop");

  await setViewport(720, 600);
  await openConsole("/overview");
  assert.equal(await horizontalOverflow(), 0, "Safari console 200-percent-equivalent reflow");

  await setViewport(390, 844);
  for (const [heading, path] of consoleRoutes) {
    await openConsole(path);
    assert.equal((await driver.findElement(By.css("h1")).getText()).trim(), heading, `Safari mobile console heading ${path}`);
    assert.equal(await horizontalOverflow(), 0, `Safari mobile console overflow ${path}`);
    await assertAccessible(`Safari console ${path} mobile`);
  }
  await openConsole("/overview");
  const initial = await driver.executeScript(`
    const sidebar = document.querySelector('.sidebar');
    return { inert: sidebar.inert, ariaHidden: sidebar.getAttribute('aria-hidden') };
  `);
  assert.deepEqual(initial, { inert: true, ariaHidden: "true" }, "Safari closed navigation is not isolated");
  const open = await driver.findElement(By.css("button[aria-label='Open navigation']"));
  await open.sendKeys(Key.ENTER);
  await driver.wait(async () => driver.executeScript("return document.querySelector('.sidebar')?.dataset.open === 'true'"), 5_000);
  assert.equal(await driver.executeScript("return document.activeElement?.getAttribute('aria-label')"), "Close navigation");
  await driver.actions().sendKeys(Key.ESCAPE).perform();
  await driver.wait(async () => await driver.executeScript("return document.activeElement?.getAttribute('aria-label')") === "Open navigation", 5_000);

  await setViewport(320, 700);
  await openConsole("/overview");
  assert.equal(await horizontalOverflow(), 0, "Safari 320px console overflow");
  await screenshot("safari-console-mobile-320");
  return { routes: consoleRoutes.length, desktop: true, mobile: true, width320: true, zoomEquivalent200: true, wcag22aa: true, keyboard: true };
}

async function testDemo() {
  await setViewport(1440, 900);
  await driver.get(demoUrl);
  await driver.wait(async () => driver.executeScript("return Boolean(document.querySelector('[data-mia-assistant-panel]')?.shadowRoot)"), 30_000);
  assert.equal(await horizontalOverflow(), 0, "Safari demo desktop overflow");
  const launcher = await driver.executeScript("return document.querySelector('[data-mia-assistant-panel]').shadowRoot.querySelector('[data-launcher]')");
  await launcher.sendKeys(Key.ENTER);
  await driver.wait(async () => driver.executeScript(`
    const panel = document.querySelector('[data-mia-assistant-panel]')?.shadowRoot?.querySelector('[data-panel]');
    return Boolean(panel && !panel.hidden);
  `), 5_000);
  assertPanel(await panelMetrics(), "Safari desktop");
  await assertAccessible("Safari demo desktop with Mia open");
  await screenshot("safari-demo-desktop");

  await setViewport(390, 844);
  assert.equal(await horizontalOverflow(), 0, "Safari demo mobile overflow");
  assertPanel(await panelMetrics(), "Safari mobile");
  await assertAccessible("Safari demo mobile with Mia open");

  await setViewport(320, 700);
  assert.equal(await horizontalOverflow(), 0, "Safari demo 320px overflow");
  assertPanel(await panelMetrics(), "Safari 320px");
  await screenshot("safari-demo-mobile-320");
  return { ready: true, desktop: true, mobile: true, width320: true, panel: true, wcag22aa: true };
}

async function signInIfNeeded() {
  const signIn = await driver.findElements(By.xpath("//h1[normalize-space()='Sign in to Mia']"));
  if (signIn.length) {
    await driver.findElement(By.css("input[type='email']")).sendKeys(email);
    await driver.findElement(By.css("input[type='password']")).sendKeys(password);
    await driver.findElement(By.css("button[type='submit']")).click();
  }
  await driver.wait(until.elementLocated(By.css(".page-content")), 20_000);
}

async function openConsole(path) {
  await driver.get(`${consoleUrl}${path}`);
  await driver.wait(until.elementLocated(By.css(".page-content")), 20_000);
  await driver.wait(async () => driver.executeScript("return document.readyState === 'complete'"), 20_000);
}

async function assertAccessible(label) {
  await driver.executeScript(axeSource);
  const result = await driver.executeAsyncScript(`
    const done = arguments[arguments.length - 1];
    axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a','wcag2aa','wcag21a','wcag21aa','wcag22a','wcag22aa'] } })
      .then(done, (error) => done({ __error: error.message }));
  `);
  if (result?.__error) throw new Error(`${label}: ${result.__error}`);
  assertNoAxeViolations(result, label);
}

function horizontalOverflow() {
  return driver.executeScript("return Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - document.documentElement.clientWidth");
}

function panelMetrics() {
  return driver.executeScript(`
    const root = document.querySelector('[data-mia-assistant-panel]')?.shadowRoot;
    const panel = root?.querySelector('[data-panel]');
    const rect = panel?.getBoundingClientRect();
    return {
      panel: rect ? { x: rect.x, y: rect.y, right: rect.right, bottom: rect.bottom } : null,
      controls: Boolean(root?.querySelector('[data-composer]') && root?.querySelector('[data-voice]') && root?.querySelector('[data-stop]')),
      viewport: { width: innerWidth, height: innerHeight }
    };
  `);
}

function assertPanel(metrics, label) {
  assert.ok(metrics.panel, `${label} panel is missing`);
  assert.ok(metrics.panel.x >= 0 && metrics.panel.y >= 0, `${label} panel starts outside the viewport`);
  assert.ok(metrics.panel.right <= metrics.viewport.width + 1 && metrics.panel.bottom <= metrics.viewport.height + 1, `${label} panel ends outside the viewport`);
  assert.equal(metrics.controls, true, `${label} is missing assistant controls`);
}

async function setViewport(width, height) {
  await driver.manage().window().setRect({ width, height, x: 0, y: 0 });
}

async function screenshot(name) {
  const data = await driver.takeScreenshot();
  await writeFile(resolve(evidenceDirectory, `${slug(name)}.png`), Buffer.from(data, "base64"));
}
