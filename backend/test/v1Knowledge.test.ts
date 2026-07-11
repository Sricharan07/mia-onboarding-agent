import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createServer } from "node:http";
import { once } from "node:events";
import type { V1Config } from "../src/v1/config.js";
import { V1Database } from "../src/v1/db/database.js";
import { V1Repositories } from "../src/v1/db/repositories.js";
import { V1KnowledgeService, chunkText, extractHtml } from "../src/v1/knowledge.js";
import { isPublicIp, resolvePublicHttpsUrl } from "../src/v1/network.js";
import { actionPolicyForElement } from "../src/v1/scanner.js";
import { V1UiScanner } from "../src/v1/scanner.js";
import { V1SecretService } from "../src/v1/secrets.js";

const databaseUrl = process.env.MIA_TEST_DATABASE_URL;

test("knowledge files are embedded, recordings become reviewed skills, and publication is indexed", {
  skip: databaseUrl ? false : "Set MIA_TEST_DATABASE_URL to run PostgreSQL integration tests."
}, async () => {
  assert.ok(databaseUrl);
  const parsed = new URL(databaseUrl);
  assert.match(parsed.pathname, /test/i);
  const database = new V1Database({ DATABASE_URL: databaseUrl, DATABASE_POOL_MAX: 3 });
  const directory = mkdtempSync(join(tmpdir(), "mia-v1-knowledge-"));
  try {
    await database.query("DROP SCHEMA public CASCADE");
    await database.query("CREATE SCHEMA public");
    await database.connect();
    const repositories = new V1Repositories(database);
    await repositories.product.setup({
      product: {
        name: "Knowledge Test",
        origin: "http://localhost:3001",
        documentationOrigins: [],
        redactedSelectors: [],
        transcriptMode: "full",
        transcriptRetentionDays: 30
      },
      admin: { id: "admin", email: "admin@example.com", name: "Admin", passwordHash: "hash" }
    });
    const model = new FakeKnowledgeModel();
    const service = new V1KnowledgeService(config(databaseUrl, directory), repositories, model);

    const documentPath = join(directory, "guide.md");
    writeFileSync(documentPath, "# Pipeline guide\n\nUse Quick Create to prepare a reversible lead draft. Review the owner and stage before saving the draft.");
    const source = await service.createDocumentFileSource({
      name: "CRM guide",
      filePath: documentPath,
      originalName: "guide.md",
      mimeType: "text/markdown",
      size: 120
    });
    await service.waitForJob(source.id);
    const indexed = await repositories.knowledge.getSource(source.id);
    assert.equal(indexed.status, "ready");
    assert.ok(Number(indexed.metadata.chunkCount) >= 1);
    const matches = await repositories.knowledge.search({ query: "Quick Create lead draft" });
    assert.equal(matches[0]?.sourceName, "CRM guide");

    const recording = await service.createRecording({
      name: "Create lead walkthrough",
      filePath: join(directory, "walkthrough.mp4"),
      originalName: "walkthrough.mp4",
      mimeType: "video/mp4",
      size: 2_000
    });
    await service.waitForJob(recording.id);
    const analyzed = await repositories.knowledge.getRecording(recording.id);
    assert.equal(analyzed.status, "needs_review");
    const skills = await repositories.knowledge.listSkills();
    assert.equal(skills.length, 1);
    assert.equal(skills[0]?.status, "needs_review");

    const published = await service.setSkillStatus(skills[0]!.id, "published");
    assert.equal(published.status, "published");
    assert.equal((await repositories.knowledge.getRecording(recording.id)).status, "ready");
    const skillMatches = await repositories.knowledge.search({ query: "prepare a lead draft" });
    assert.ok(skillMatches.some((match) => match.kind === "skill"));
    await service.close();
  } finally {
    await database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("document extraction, SSRF policy, and UI action policy preserve product semantics", async () => {
  const extracted = extractHtml(`
    <html><head><title>CRM Help</title></head><body>
      <nav>Ignore navigation</nav><main><h1>Create a lead</h1><p>Open Quick Create.</p><p>Open Quick Create.</p></main>
      <a href="/guide/details">Details</a><script>steal()</script>
    </body></html>
  `, "https://docs.example.com/guide");
  assert.equal(extracted.title, "CRM Help");
  assert.match(extracted.text, /Create a lead/);
  assert.equal(extracted.text.match(/Open Quick Create/g)?.length, 1);
  assert.deepEqual(extracted.links, ["https://docs.example.com/guide/details"]);
  assert.ok(chunkText("A useful sentence. ".repeat(200)).length > 1);

  assert.equal(isPublicIp("8.8.8.8"), true);
  assert.equal(isPublicIp("127.0.0.1"), false);
  assert.equal(isPublicIp("10.0.0.1"), false);
  assert.equal(isPublicIp("::1"), false);
  assert.equal(isPublicIp("2606:4700:4700::1111"), true);
  await assert.rejects(() => resolvePublicHttpsUrl("https://127.0.0.1/private"), /private or reserved/i);
  await assert.rejects(() => resolvePublicHttpsUrl("http://example.com"), /public HTTPS/i);

  assert.equal(actionPolicyForElement({ role: "button", name: "Create draft", tagName: "button" }), "reversible_write");
  assert.equal(actionPolicyForElement({ role: "button", name: "Delete account", tagName: "button" }), "blocked");
  assert.equal(actionPolicyForElement({ role: "button", name: "Submit the final application", tagName: "button" }), "blocked");
  assert.equal(actionPolicyForElement({ role: "textbox", name: "Password", tagName: "input", type: "password" }), "manual");
  assert.equal(actionPolicyForElement({ role: "link", name: "Pipeline", tagName: "a" }), "navigate");
});

test("Playwright scanner discovers routes, redacts private regions, and auto-indexes semantic controls", {
  skip: databaseUrl ? false : "Set MIA_TEST_DATABASE_URL to run PostgreSQL integration tests."
}, async () => {
  assert.ok(databaseUrl);
  const server = createServer((request, response) => {
    response.setHeader("content-type", "text/html");
    if (request.url === "/settings") {
      response.end("<main><h1>Settings</h1><label>Company<input name='company'></label></main>");
      return;
    }
    response.end(`
      <main>
        <h1>Pipeline</h1>
        <button data-mia-key="create-draft">Create draft</button>
        <button data-mia-key="create-draft-secondary">Create draft</button>
        <button>Delete account</button>
        <section data-private><button>Private customer action</button></section>
        <a href="/settings">Settings</a>
      </main>
    `);
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const origin = `http://127.0.0.1:${address.port}`;

  const directory = mkdtempSync(join(tmpdir(), "mia-v1-scanner-"));
  const database = new V1Database({ DATABASE_URL: databaseUrl, DATABASE_POOL_MAX: 3 });
  try {
    await database.query("DROP SCHEMA public CASCADE");
    await database.query("CREATE SCHEMA public");
    await database.connect();
    const repositories = new V1Repositories(database);
    await repositories.product.setup({
      product: {
        name: "Scanner Test", origin, documentationOrigins: [], redactedSelectors: ["[data-private]"],
        transcriptMode: "full", transcriptRetentionDays: 30
      },
      admin: { id: "admin", email: "admin@example.com", name: "Admin", passwordHash: "hash" }
    });
    const scanConfig = { ...config(databaseUrl, directory), UI_SCAN_ALLOW_PRIVATE_NETWORKS: true };
    const scanner = new V1UiScanner(
      scanConfig,
      repositories,
      new V1SecretService(scanConfig, repositories.secrets),
      new FakeKnowledgeModel()
    );
    const version = await scanner.start({ routes: ["/"], discover: true });
    await scanner.wait(version.id);
    const completed = await repositories.knowledge.getMapVersion(version.id);
    assert.equal(completed.status, "ready", completed.error ?? undefined);
    assert.deepEqual(new Set(completed.routes), new Set(["/", "/settings"]));
    const home = await repositories.knowledge.listMappedElements("/");
    assert.equal(home.find((element) => element.elementKey === "create-draft")?.actionPolicy, "reversible_write");
    assert.equal(home.find((element) => element.elementKey === "create-draft-secondary")?.actionPolicy, "reversible_write");
    assert.equal(home.find((element) => element.name === "Delete account")?.actionPolicy, "blocked");
    assert.equal(home.some((element) => element.name === "Private customer action"), false);
    const firstPage = await repositories.knowledge.listMappedElementsPage({ search: "Create draft", limit: 1, offset: 0 });
    const secondPage = await repositories.knowledge.listMappedElementsPage({ search: "Create draft", limit: 1, offset: 1 });
    assert.equal(firstPage.total, 2);
    assert.ok(firstPage.overallTotal > firstPage.total);
    assert.equal(firstPage.items.length, 1);
    assert.equal(secondPage.items.length, 1);
    assert.notEqual(firstPage.items[0]?.elementKey, secondPage.items[0]?.elementKey);
    assert.ok(firstPage.routes.includes("/"));
    const mapSource = (await repositories.knowledge.listSources()).find((source) => source.kind === "ui_map");
    assert.equal(mapSource?.status, "ready");
    await scanner.close();
  } finally {
    await database.close();
    server.close();
    await once(server, "close");
    rmSync(directory, { recursive: true, force: true });
  }
});

class FakeKnowledgeModel {
  async embed(texts: string[]): Promise<number[][]> {
    return texts.map((text) => {
      const vector = Array(768).fill(0);
      vector[0] = Math.min(text.length / 10_000, 1);
      return vector;
    });
  }

  async analyzeRecording() {
    return {
      name: "Prepare a lead draft",
      description: "Prepare a reversible CRM lead draft for review.",
      goal: "Create a lead draft without sending or publishing it.",
      businessContext: "A sales representative collects the initial lead details.",
      steps: [{ order: 1, intent: "Open Quick Create and prepare the lead fields", successEvidence: "The draft form contains the requested lead details" }],
      constraints: ["Do not send or publish"],
      expectedOutcomes: ["A reversible lead draft is ready for review"]
    };
  }
}

function config(url: string, directory: string): V1Config {
  return {
    NODE_ENV: "test", BACKEND_HOST: "127.0.0.1", BACKEND_PORT: 4000, TRUST_PROXY: false,
    CORS_ORIGIN: "*", DATABASE_URL: url, DATABASE_POOL_MAX: 3,
    LOCAL_UPLOAD_DIR: directory, CONSOLE_DIST_DIR: join(directory, "console"),
    MIA_SECRET_ENCRYPTION_KEY: "test-encryption-key-with-more-than-32-characters", SETUP_TOKEN: "setup-token",
    CONSOLE_SESSION_TTL_SECONDS: 3_600, RATE_LIMIT_WINDOW_MS: 60_000, RATE_LIMIT_MAX: 300,
    RUNTIME_RATE_LIMIT_MAX: 180, RUNTIME_TOKEN_TTL_SECONDS: 900, RUNTIME_TOKEN_MAX_USES: 2_000,
    TRANSCRIPT_RETENTION_DAYS: 30, DATA_RETENTION_SWEEP_INTERVAL_MS: 3_600_000,
    MAX_UPLOAD_BYTES: 50_000_000, PROVIDER_REQUEST_TIMEOUT_MS: 90_000, PROVIDER_RETRY_ATTEMPTS: 3,
    SHUTDOWN_GRACE_PERIOD_MS: 30_000, GEMINI_BASE_URL: "https://generativelanguage.googleapis.com",
    GEMINI_PLANNER_MODEL: "gemini-3.5-flash", GEMINI_VISION_MODEL: "gemini-3.5-flash",
    GEMINI_EMBEDDING_MODEL: "gemini-embedding-2", GEMINI_EMBEDDING_DIMENSIONS: 768,
    GEMINI_LIVE_MODEL: "gemini-3.1-flash-live-preview", GEMINI_TOKEN_TTL_SECONDS: 1_800,
    GEMINI_NEW_SESSION_TTL_SECONDS: 60, UI_SCAN_HEADLESS: true, UI_SCAN_ALLOW_PRIVATE_NETWORKS: false
  };
}
