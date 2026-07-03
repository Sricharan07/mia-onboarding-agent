import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { LanceDbSemanticSearchAdapter, toWhereClause } from "../src/adapters/lanceDbSemanticSearch.js";
import type { AppConfig } from "../src/config/env.js";
import { AppError } from "../src/utils/errors.js";

test("LanceDB semantic search filters only indexed fields and escapes values", () => {
  assert.equal(
    toWhereClause({ appId: "app_1", route: "/people's/accounts" }),
    "appId = 'app_1' AND route = '/people''s/accounts'"
  );

  assert.throws(
    () => toWhereClause({ metadataJson: "x" }),
    (error) => error instanceof AppError && error.code === "SEMANTIC_FILTER_UNSUPPORTED"
  );
});

test("LanceDB semantic search indexes and searches records with OpenAI embeddings", async () => {
  const originalFetch = globalThis.fetch;
  const dir = mkdtempSync(join(tmpdir(), "mia-lancedb-"));

  globalThis.fetch = (async (_url, init) => {
    const body = JSON.parse(String(init?.body ?? "{}")) as { input: string[] };
    return new Response(JSON.stringify({
      data: body.input.map((text, index) => ({
        index,
        embedding: text.toLowerCase().includes("billing") ? [1, 0] : [0, 1]
      }))
    }), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;

  try {
    const adapter = new LanceDbSemanticSearchAdapter({
      OPENAI_API_KEY: "test",
      OPENAI_BASE_URL: "https://api.openai.com/v1",
      OPENAI_EMBEDDING_MODEL: "text-embedding-3-small",
      OPENAI_EMBEDDING_DIMENSIONS: 2,
      SEMANTIC_INDEX_DIR: dir
    } as AppConfig);

    await adapter.upsertMany([
      { id: "billing", kind: "workflow", appId: "app_1", searchableText: "Billing workflow", metadata: { workflowId: "billing", status: "published" } },
      { id: "support", kind: "workflow", appId: "app_1", searchableText: "Support workflow", metadata: { workflowId: "support", status: "published" } }
    ]);

    const matches = await adapter.search({
      query: "billing",
      filters: { appId: "app_1", kind: "workflow", status: "published" },
      limit: 1
    });

    assert.equal(matches[0]?.id, "billing");
    assert.equal(matches[0]?.metadata?.workflowId, "billing");
    assert.ok(matches[0]!.score > 0.9);
  } finally {
    globalThis.fetch = originalFetch;
    rmSync(dir, { recursive: true, force: true });
  }
});
