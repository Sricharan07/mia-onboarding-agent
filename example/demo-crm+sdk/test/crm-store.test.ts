import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";

const storeUrl = new URL("../src/server/crm-store.ts", import.meta.url);
const execFileAsync = promisify(execFile);

test("CRM persistence is atomic, durable, idempotent, and recovers after failures", async () => {
  await withStore(async (store, dataDir) => {
    const input = { account: "Durable Labs", contactName: "Avery", amount: 12_345 };
    const createKey = `create-${randomUUID()}`;
    const first = await store.createDraftOpportunity(input, createKey);
    const replay = await store.createDraftOpportunity(input, createKey);
    assert.equal(replay.draftId, first.draftId);

    let state = await store.getCrmSnapshot();
    assert.equal(state.opportunities.filter((item) => item.id === first.draftId).length, 1);
    assert.equal(state.activities.filter((item) => item.opportunityId === first.draftId).length, 1);
    await assert.rejects(
      store.createDraftOpportunity({ ...input, amount: 99_999 }, createKey),
      (error: unknown) => error instanceof store.IdempotencyConflictError,
    );

    const updateKey = `update-${randomUUID()}`;
    await store.updateOpportunity(first.draftId, { stage: "Discovery" }, updateKey);
    await store.updateOpportunity(first.draftId, { stage: "Discovery" }, updateKey);
    state = await store.getCrmSnapshot();
    assert.equal(state.opportunities.find((item) => item.id === first.draftId)?.stage, "Discovery");
    assert.equal(state.activities.filter((item) => item.opportunityId === first.draftId).length, 2);
    await assert.rejects(
      store.updateOpportunity(first.draftId, { stage: "Negotiation" }, updateKey),
      (error: unknown) => error instanceof store.IdempotencyConflictError,
    );

    const persisted = JSON.parse(await readFile(path.join(dataDir, "crm-state.json"), "utf8"));
    assert.equal(persisted._miaIdempotency.length, 2);

    const replayScript = [
      `const loaded = await import(${JSON.stringify(storeUrl.href)});`,
      "const store = loaded.default ?? loaded;",
      `await store.createDraftOpportunity(${JSON.stringify(input)}, ${JSON.stringify(createKey)});`,
      `await store.updateOpportunity(${JSON.stringify(first.draftId)}, { stage: "Discovery" }, ${JSON.stringify(updateKey)});`,
    ].join("\n");
    await execFileAsync(process.execPath, ["--import", "tsx", "--input-type=module", "--eval", replayScript], {
      cwd: process.cwd(),
      env: { ...process.env, MIA_DEMO_DATA_DIR: dataDir },
    });
    state = await store.getCrmSnapshot();
    assert.equal(state.activities.filter((item) => item.opportunityId === first.draftId).length, 2);

    await assert.rejects(store.updateOpportunity("missing", { stage: "Discovery" }), /Opportunity not found/);
    const existing = state.opportunities[0];
    assert.ok(existing);
    const updated = await store.updateOpportunity(existing.id, { nextStep: "Queue recovered." });
    assert.equal(updated.opportunities.find((item) => item.id === existing.id)?.nextStep, "Queue recovered.");

    const statePath = path.join(dataDir, "crm-state.json");
    await writeFile(statePath, "not-json", "utf8");
    await assert.rejects(store.getCrmSnapshot());
    assert.equal(await readFile(statePath, "utf8"), "not-json");
  });
});

async function withStore(
  run: (store: Awaited<ReturnType<typeof loadStore>>, dataDir: string) => Promise<void>,
): Promise<void> {
  const dataDir = await mkdtemp(path.join(tmpdir(), "mia-demo-crm-"));
  process.env.MIA_DEMO_DATA_DIR = dataDir;
  try {
    await run(await loadStore(), dataDir);
  } finally {
    delete process.env.MIA_DEMO_DATA_DIR;
    await rm(dataDir, { recursive: true, force: true });
  }
}

async function loadStore(): Promise<typeof import("../src/server/crm-store")> {
  return import(storeUrl.href);
}
