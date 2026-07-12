import assert from "node:assert/strict";
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { randomBytes } from "node:crypto";
import { chromium } from "playwright";
import {
  adminHeaders,
  booleanEnvironment,
  loginAdmin,
  requestJson,
  required,
  waitForJson
} from "./lib/acceptance.mjs";

const command = process.argv[2];
const backendUrl = (process.env.MIA_ACCEPTANCE_BACKEND_URL ?? "http://127.0.0.1:4000").replace(/\/+$/, "");
const productOrigin = new URL(process.env.MIA_ACCEPTANCE_PRODUCT_ORIGIN ?? "http://127.0.0.1:3001").origin;
const demoUrl = process.env.MIA_ACCEPTANCE_DEMO_URL ?? `${productOrigin}/dashboard/crm`;
const stateFile = resolve(required("MIA_ACCEPTANCE_STATE_FILE"));

if (command === "setup") await setup();
else if (command === "prepare-product") await prepareProduct();
else if (command === "assert-ready") await assertReady();
else throw new Error("Use setup, prepare-product, or assert-ready.");

async function setup() {
  const setupToken = required("SETUP_TOKEN");
  const requireFresh = booleanEnvironment("MIA_ACCEPTANCE_REQUIRE_FRESH", true);
  const ready = await waitForJson(`${backendUrl}/api/v1/ready`, (value) => value?.database === true);
  if (requireFresh) assert.equal(ready.setupRequired, true, "Release acceptance must start from an empty v1 database.");
  if (booleanEnvironment("MIA_ACCEPTANCE_REQUIRE_GEMINI", false)) {
    assert.equal(ready.geminiConfigured, true, "The artifact-bound backend is not configured with Gemini.");
  }

  const suffix = randomBytes(6).toString("hex");
  const email = `release-${suffix}@example.invalid`;
  const password = `Mia-${randomBytes(24).toString("base64url")}`;
  const setupResult = await requestJson(`${backendUrl}/api/v1/setup`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      setupToken,
      productName: "Mia Release Product",
      origin: productOrigin,
      adminEmail: email,
      adminName: "Release Administrator",
      password
    })
  });
  assert.match(setupResult.token ?? "", /^mia_admin_/, "First-run setup did not return an administrator session.");
  assert.equal(setupResult.product?.origin, productOrigin);

  await requestJson(`${backendUrl}/api/v1/product`, {
    method: "PATCH",
    headers: adminHeaders(setupResult.token),
    body: JSON.stringify({
      redactedSelectors: ["[data-private]", "[data-mia-private]"],
      transcriptMode: "full",
      transcriptRetentionDays: 30,
      voiceConfig: { enabled: true, voice: "Aoede", language: "en-US" }
    })
  });
  const integration = await requestJson(`${backendUrl}/api/v1/integration-keys`, {
    method: "POST",
    headers: adminHeaders(setupResult.token),
    body: JSON.stringify({ name: "Artifact-bound release acceptance" })
  });
  assert.match(integration.key ?? "", /^mia_key_/, "Setup did not return an integration key.");

  const state = {
    backendUrl,
    productOrigin,
    demoUrl,
    email,
    password,
    adminToken: setupResult.token,
    integrationKey: integration.key
  };
  await mkdir(dirname(stateFile), { recursive: true });
  await writeFile(stateFile, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
  await exportEnvironment(state);
  process.stdout.write(`Initialized a fresh artifact-bound Mia deployment for ${productOrigin}.\n`);
}

async function prepareProduct() {
  const state = await readState();
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    await page.addInitScript(() => {
      window.__miaReleaseEvents = [];
      window.addEventListener("mia:runtime-event", (event) => window.__miaReleaseEvents.push(event.detail));
    });
    await page.goto(state.demoUrl, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => window.__miaReleaseEvents?.some((event) => event?.type === "ready"), null, { timeout: 30_000 });
    await context.close();
  } finally {
    await browser.close();
  }

  const token = await currentAdminToken(state);
  const expectedActions = new Map([
    ["create_draft_opportunity", "draft_create"],
    ["update_opportunity", "draft_update"]
  ]);
  const detected = await requestJson(`${backendUrl}/api/v1/actions`, { headers: adminHeaders(token, false) });
  assert.deepEqual(
    detected.items.map((action) => action.name).sort(),
    [...expectedActions.keys()].sort(),
    "The demo registered an unexpected host-action surface."
  );
  for (const action of detected.items) {
    assert.equal(action.effect, expectedActions.get(action.name), `${action.name} has the wrong typed effect.`);
    assert.equal(action.proposedRisk, "reversible_write", `${action.name} has the wrong proposed risk.`);
    await requestJson(`${backendUrl}/api/v1/actions/${encodeURIComponent(action.name)}`, {
      method: "PATCH",
      headers: adminHeaders(token),
      body: JSON.stringify({ status: "published", risk: "reversible_write" })
    });
  }

  const form = new FormData();
  form.set("name", "Release CRM guide");
  form.set("file", new Blob([
    "The Stage filter narrows recent opportunities by sales stage. Draft opportunities are reversible and are never sent or published."
  ], { type: "text/plain" }), "release-crm-guide.txt");
  const source = await requestJson(`${backendUrl}/api/v1/knowledge/files`, {
    method: "POST",
    headers: adminHeaders(token, false),
    body: form
  });
  await waitForJson(
    `${backendUrl}/api/v1/knowledge`,
    (value) => value?.items?.some((item) => item.id === source.id && item.status === "ready"),
    90_000,
    { headers: adminHeaders(token, false) }
  );

  const scan = await requestJson(`${backendUrl}/api/v1/scans`, {
    method: "POST",
    headers: adminHeaders(token),
    body: JSON.stringify({ routes: ["/dashboard/crm", "/dashboard/finance"], discover: false })
  });
  await waitForJson(
    `${backendUrl}/api/v1/scans/${encodeURIComponent(scan.id)}`,
    (value) => value?.status === "ready",
    120_000,
    { headers: adminHeaders(token, false) }
  );
  process.stdout.write("Indexed release knowledge, scanned the current demo, and published the reviewed draft actions.\n");
}

async function assertReady() {
  const state = await readState();
  const token = await currentAdminToken(state);
  const checklist = await requestJson(`${backendUrl}/api/v1/setup/checklist`, { headers: adminHeaders(token, false) });
  const incomplete = checklist.checks.filter((check) => !check.complete);
  assert.deepEqual(incomplete, [], "The clean deployment did not pass every first-run readiness check.");

  for (const [scenario, evidence] of Object.entries(checklist.acceptance)) {
    assert.equal(evidence.passed, true, `${scenario} acceptance evidence is missing.`);
    assert.ok(evidence.runId, `${scenario} acceptance did not identify its run.`);
    const run = await requestJson(`${backendUrl}/api/v1/runs/${encodeURIComponent(evidence.runId)}`, { headers: adminHeaders(token, false) });
    assert.equal(run.session.status, "completed", `${scenario} evidence references an incomplete run.`);
    assert.ok(run.steps.length > 0, `${scenario} evidence has no planner steps.`);
    assert.ok(run.aiRequests.some((request) => request.purpose === "agent_judge" && !request.error), `${scenario} evidence has no successful final judgment.`);
  }
  process.stdout.write("All first-run and Test Mia acceptance evidence is bound to completed, judged runs.\n");
}

async function currentAdminToken(state) {
  try {
    await requestJson(`${backendUrl}/api/v1/product`, { headers: adminHeaders(state.adminToken, false) });
    return state.adminToken;
  } catch {
    return loginAdmin(backendUrl, state.email, state.password);
  }
}

async function readState() {
  const value = JSON.parse(await readFile(stateFile, "utf8"));
  for (const field of ["backendUrl", "productOrigin", "demoUrl", "email", "password", "adminToken", "integrationKey"]) {
    assert.equal(typeof value[field], "string", `Acceptance state is missing ${field}.`);
  }
  return value;
}

async function exportEnvironment(state) {
  const githubEnvironment = process.env.GITHUB_ENV;
  if (!githubEnvironment) return;
  process.stdout.write(`::add-mask::${state.password}\n::add-mask::${state.adminToken}\n::add-mask::${state.integrationKey}\n`);
  await appendFile(githubEnvironment, [
    `MIA_ACCEPTANCE_CONSOLE_EMAIL=${state.email}`,
    `MIA_ACCEPTANCE_CONSOLE_PASSWORD=${state.password}`,
    `MIA_INTEGRATION_KEY=${state.integrationKey}`,
    `MIA_VOICE_INTEGRATION_KEY=${state.integrationKey}`
  ].join("\n") + "\n");
}
