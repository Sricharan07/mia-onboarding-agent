import assert from "node:assert/strict";
import test from "node:test";
import { loadV1Config, validateSetupTokenForState } from "../src/v1/config.js";
import { V1Database } from "../src/v1/db/database.js";
import { V1Repositories } from "../src/v1/db/repositories.js";

const databaseUrl = process.env.MIA_TEST_DATABASE_URL;

test("production setup requires a strong token only until the singleton product exists", () => {
  const base = {
    NODE_ENV: "production",
    CORS_ORIGIN: "https://mia.example.com,https://app.example.com",
    DATABASE_URL: "postgres://mia:password@postgres:5432/mia",
    MIA_SECRET_ENCRYPTION_KEY: "encryption-key-with-at-least-32-characters"
  };
  const configured = loadV1Config(base);
  assert.doesNotThrow(() => validateSetupTokenForState(configured, true));
  assert.throws(() => validateSetupTokenForState(configured, false), /SETUP_TOKEN/);
  assert.throws(() => loadV1Config({ ...base, SETUP_TOKEN: "too-short" }), /SETUP_TOKEN/);
  assert.doesNotThrow(() => validateSetupTokenForState(loadV1Config({
    ...base,
    SETUP_TOKEN: "setup-token-with-at-least-32-characters"
  }), false));
});

test("v1 PostgreSQL foundation migrates and enforces singleton setup plus session revisions", {
  skip: databaseUrl ? false : "Set MIA_TEST_DATABASE_URL to run PostgreSQL integration tests."
}, async () => {
  assert.ok(databaseUrl);
  const parsed = new URL(databaseUrl);
  assert.match(parsed.pathname, /test/i, "Refusing to reset a database whose name does not contain test.");

  const database = new V1Database({ DATABASE_URL: databaseUrl, DATABASE_POOL_MAX: 3 });
  try {
    await database.query("DROP SCHEMA public CASCADE");
    await database.query("CREATE SCHEMA public");
    await database.connect();

    const migrations = await database.query<{ id: number; name: string }>("SELECT id, name FROM schema_migrations ORDER BY id");
    assert.deepEqual(migrations.rows, [
      { id: 1, name: "mia_v1_initial" },
      { id: 2, name: "encrypted_product_settings" },
      { id: 3, name: "diagnostic_lookup_indexes" },
      { id: 4, name: "stable_goal_run_identity" },
      { id: 5, name: "separate_host_action_risk_review" },
      { id: 6, name: "constrain_mia_voice" }
    ]);
    assert.equal((await database.query<{ count: number }>(`
      SELECT COUNT(*)::int AS count FROM information_schema.tables WHERE table_schema = 'public'
    `)).rows[0]?.count, 21);

    const repositories = new V1Repositories(database);
    assert.equal(await repositories.product.isSetup(), false);
    await repositories.product.setup({
      product: {
        name: "Mia Test Product",
        origin: "http://localhost:3001",
        documentationOrigins: ["https://docs.example.com"],
        redactedSelectors: ["[data-private]"],
        transcriptMode: "full",
        transcriptRetentionDays: 30
      },
      admin: {
        id: "admin_test",
        email: "admin@example.com",
        name: "Admin",
        passwordHash: "test-hash"
      }
    });
    assert.equal(await repositories.product.isSetup(), true);
    await assert.rejects(
      () => database.query(`UPDATE product SET voice_config = '{"enabled":true,"voice":"Puck","language":"en-US"}'::jsonb`),
      /product_voice_config_valid/
    );
    await assert.rejects(() => repositories.product.setup({
      product: {
        name: "Duplicate",
        origin: "http://localhost:3001",
        documentationOrigins: [],
        redactedSelectors: [],
        transcriptMode: "full",
        transcriptRetentionDays: 30
      },
      admin: { id: "other", email: "other@example.com", name: "Other", passwordHash: "hash" }
    }), /already been completed/i);

    const session = await repositories.agent.createSession({
      id: "agent_session_test",
      resumeTokenHash: "resume-hash",
      userId: "user_test",
      route: "/dashboard"
    });
    const started = await repositories.agent.beginGoal({
      id: session.id,
      expectedRevision: 0,
      goal: "Explain the dashboard",
      goalRunId: "goal_run_test",
      route: "/dashboard"
    });
    assert.equal(started.revision, 1);
    await assert.rejects(() => repositories.agent.advanceSession({
      id: session.id,
      expectedRevision: 0,
      status: "completed"
    }), /changed while the request was running/i);

    const manifest = {
      name: "lookup_customer",
      description: "Look up a customer record",
      inputSchema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
      risk: "read" as const,
      manifestHash: "stable-manifest"
    };
    await repositories.agent.syncHostActions([manifest]);
    const reviewed = await repositories.agent.reviewHostAction(manifest.name, { status: "published", risk: "reversible_write" });
    assert.equal(reviewed.proposedRisk, "read");
    assert.equal(reviewed.effectiveRisk, "reversible_write");
    assert.ok(reviewed.reviewedAt);

    await repositories.agent.syncHostActions([manifest]);
    const afterSameManifest = (await repositories.agent.listHostActions())[0]!;
    assert.equal(afterSameManifest.status, "published");
    assert.equal(afterSameManifest.proposedRisk, "read");
    assert.equal(afterSameManifest.effectiveRisk, "reversible_write", "SDK sync must not weaken reviewed effective risk");
    assert.equal(afterSameManifest.reviewedAt, reviewed.reviewedAt);

    await repositories.agent.syncHostActions([{ ...manifest, risk: "manual", manifestHash: "changed-manifest" }]);
    const afterChangedManifest = (await repositories.agent.listHostActions())[0]!;
    assert.equal(afterChangedManifest.status, "needs_review");
    assert.equal(afterChangedManifest.proposedRisk, "manual");
    assert.equal(afterChangedManifest.effectiveRisk, "reversible_write");
    assert.equal(afterChangedManifest.reviewedAt, null);
    await assert.rejects(
      () => repositories.agent.reviewHostAction(manifest.name, { status: "published", risk: "read" }),
      /cannot be less restrictive/i
    );
  } finally {
    await database.close();
  }
});
