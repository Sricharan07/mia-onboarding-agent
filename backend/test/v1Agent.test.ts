import assert from "node:assert/strict";
import test from "node:test";
import type { ActionDirective, ActionReceipt, PlannerDecision } from "../src/v1/domain.js";
import type { V1Config } from "../src/v1/config.js";
import { V1AgentService } from "../src/v1/agent.js";
import { V1Database } from "../src/v1/db/database.js";
import { V1Repositories } from "../src/v1/db/repositories.js";

const databaseUrl = process.env.MIA_TEST_DATABASE_URL;

test("v1 agent persists an observe-act-verify run and enforces confirmations and receipts", {
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
    const repositories = new V1Repositories(database);
    await repositories.product.setup({
      product: {
        name: "Mia Test Product",
        origin: "http://localhost:3001",
        documentationOrigins: [],
        redactedSelectors: [],
        transcriptMode: "full",
        transcriptRetentionDays: 30
      },
      admin: { id: "admin_test", email: "admin@example.com", name: "Admin", passwordHash: "hash" }
    });

    const model = new FakeAgentModel();
    const agent = new V1AgentService(config(databaseUrl), repositories, model);
    const created = await agent.createSession("user_1", runtime());

    model.push(decision("actions", {
      message: "I will open the draft form.",
      actions: [
        planned("point", "live:create", "Point at Create draft"),
        planned("click", "live:create", "Open Create draft")
      ]
    }));
    const issued = await agent.submitTurn({
      sessionId: created.sessionId,
      userId: "user_1",
      revision: created.revision,
      utterance: "Create a draft lead",
      source: "text",
      runtime: runtime()
    });
    assert.equal(issued.status, "waiting_confirmation");
    assert.equal(issued.actions.length, 2);
    assert.equal(issued.actions[0]?.confirmation, undefined);
    assert.ok(issued.actions[1]?.confirmation);

    const receipts = issued.actions.map((action) => ({
      actionId: action.actionId,
      idempotencyKey: action.idempotencyKey,
      type: action.type,
      status: "completed" as const,
      message: `${action.type} completed`,
      targetRef: action.target?.ref,
      route: "/dashboard/crm",
      evidence: { verified: true }
    }));
    await assert.rejects(() => agent.continue({
      sessionId: created.sessionId,
      userId: "user_1",
      revision: issued.revision,
      receipts,
      runtime: runtime(2)
    }), /approved before it can be completed/i);

    const confirmation = issued.actions[1]!.confirmation!;
    assert.match(confirmation.prompt, /^Approve (?:this|these) reversible change/);
    assert.match(confirmation.prompt, /Create draft lead/);
    await assert.rejects(() => agent.resolveConfirmation({
      sessionId: created.sessionId,
      confirmationId: confirmation.id,
      userId: "user_1",
      revision: issued.revision,
      binding: "wrong-binding",
      approved: true,
      source: "ui",
      observation: observation()
    }), /invalid, expired, or already resolved/i);
    const approved = await agent.resolveConfirmation({
      sessionId: created.sessionId,
      confirmationId: confirmation.id,
      userId: "user_1",
      revision: issued.revision,
      binding: confirmation.binding,
      approved: true,
      source: "voice",
      observation: observation()
    });
    assert.equal(approved.status, "active");

    await assert.rejects(() => agent.continue({
      sessionId: created.sessionId,
      userId: "user_1",
      revision: approved.revision,
      receipts: [{ ...receipts[0]!, idempotencyKey: "wrong" }, receipts[1]!],
      runtime: runtime(2)
    }), /did not match the issued action batch/i);

    model.pushJudgment(false, "The current page has not yet proven the result.", ["Open form state"]);
    model.pushJudgment(true, "The second completion proposal is verified.");
    model.push(decision("complete", { message: "The draft form appears to be open." }));
    model.push(decision("complete", { message: "The draft form is open and verified." }));
    const completed = await agent.continue({
      sessionId: created.sessionId,
      userId: "user_1",
      revision: approved.revision,
      receipts,
      runtime: runtime(2)
    });
    assert.equal(completed.status, "completed");
    assert.equal(completed.type, "complete");
    assert.equal(model.judgeCalls, 2);
    await repositories.diagnostics.logAiRequest({
      id: "acceptance_judge",
      sessionId: created.sessionId,
      purpose: "agent_judge",
      model: "fake-agent-model",
      latencyMs: 1
    });

    const run = await repositories.diagnostics.getRun(created.sessionId);
    const steps = run.steps as Array<{ directive: { actions: Array<{ confirmation?: Record<string, unknown> }> } }>;
    assert.equal(steps.length, 2);
    assert.equal(steps[0]?.directive.actions[1]?.confirmation?.binding, undefined, "confirmation bindings must not be logged");
    await database.query("UPDATE confirmations SET action_id = 'unrelated_action' WHERE id = $1", [confirmation.id]);
    const mismatched = await repositories.diagnostics.acceptanceEvidence();
    assert.equal(mismatched.mutation.passed, false, "an unrelated approval must not satisfy mutation acceptance");
    await database.query("UPDATE confirmations SET action_id = $2 WHERE id = $1", [confirmation.id, issued.actions[1]!.actionId]);
    const acceptance = await repositories.diagnostics.acceptanceEvidence();
    assert.equal(acceptance.mutation.passed, true);
    assert.equal(acceptance.mutation.runId, created.sessionId);
    assert.equal(acceptance.voice.passed, false, "a text run must not satisfy voice parity");
  } finally {
    await database.close();
  }
});

test("v1 agent keeps a goal across questions and blocks protected operations before confirmation", {
  skip: databaseUrl ? false : "Set MIA_TEST_DATABASE_URL to run PostgreSQL integration tests."
}, async () => {
  assert.ok(databaseUrl);
  const database = new V1Database({ DATABASE_URL: databaseUrl, DATABASE_POOL_MAX: 3 });
  try {
    await database.query("DROP SCHEMA public CASCADE");
    await database.query("CREATE SCHEMA public");
    await database.connect();
    const repositories = new V1Repositories(database);
    await repositories.product.setup({
      product: {
        name: "Mia Test Product",
        origin: "http://localhost:3001",
        documentationOrigins: [],
        redactedSelectors: [],
        transcriptMode: "full",
        transcriptRetentionDays: 30
      },
      admin: { id: "admin_test", email: "admin@example.com", name: "Admin", passwordHash: "hash" }
    });
    const model = new FakeAgentModel();
    const agent = new V1AgentService(config(databaseUrl), repositories, model);
    const created = await agent.createSession("user_2", runtime());

    model.push(decision("ask_user", { message: "What is the lead name?", field: "lead_name" }));
    const question = await agent.submitTurn({
      sessionId: created.sessionId,
      userId: "user_2",
      revision: created.revision,
      utterance: "Create a draft lead",
      source: "text",
      runtime: runtime()
    });
    assert.equal(question.status, "waiting_user");

    model.pushJudgment(false, "The lead draft has not been created.", ["A completed draft-creation receipt"]);
    model.push(decision("answer", { message: "I have the name Avery." }));
    model.push(decision("unable", { message: "I have the name, but I cannot verify that the draft was created." }));
    const answered = await agent.submitTurn({
      sessionId: created.sessionId,
      userId: "user_2",
      revision: question.revision,
      utterance: "Avery",
      source: "voice",
      runtime: runtime(2)
    });
    assert.equal(answered.status, "failed");
    assert.equal(answered.type, "unable");
    assert.equal(model.judgeCalls, 1, "answer decisions must pass the same independent completion judgment as complete decisions");
    assert.equal((await repositories.agent.getSession(created.sessionId)).goal, "Create a draft lead");

    let revision = answered.revision;
    model.push(decision("ask_user", { message: "Enter your one-time verification code.", field: "verification_code" }));
    const protectedQuestion = await agent.submitTurn({
      sessionId: created.sessionId,
      userId: "user_2",
      revision,
      utterance: "Help me sign in",
      source: "text",
      runtime: runtime(3)
    });
    assert.equal(protectedQuestion.type, "unable");
    assert.equal(protectedQuestion.status, "failed");
    assert.equal(protectedQuestion.input, undefined);
    assert.match(protectedQuestion.message, /will not ask for or handle secrets/i);
    revision = protectedQuestion.revision;

    const prohibited = [
      ["Delete this account", "Delete the account"],
      ["Send this proposal", "Send the proposal"],
      ["Publish this draft", "Publish the draft"],
      ["Approve this request", "Approve the request"],
      ["Pay this invoice", "Pay the invoice"],
      ["Email the customer", "Email the customer"],
      ["Submit the final application", "Submit the final application"],
      ["Erase this account", "Erase the account"],
      ["Destroy this workspace", "Destroy the workspace"],
      ["Charge this card", "Charge the card"],
      ["Dispatch this email", "Dispatch the email"],
      ["Finalize this order", "Finalize the order"]
    ] as const;
    for (const [utterance, actionMessage] of prohibited) {
      model.push(decision("actions", {
        message: actionMessage,
        actions: [planned("click", "live:create", actionMessage)]
      }));
      const blocked = await agent.submitTurn({
        sessionId: created.sessionId,
        userId: "user_2",
        revision,
        utterance,
        source: "text",
        runtime: runtime(3)
      });
      assert.equal(blocked.type, "unable", utterance);
      assert.equal(blocked.status, "failed", utterance);
      revision = blocked.revision;
    }

    model.push(decision("actions", {
      message: "Continue to the next step",
      actions: [planned("click", "live:continue", "Continue")]
    }));
    const neutralSubmit = await agent.submitTurn({
      sessionId: created.sessionId,
      userId: "user_2",
      revision,
      utterance: "Continue",
      source: "text",
      runtime: runtime(4)
    });
    assert.equal(neutralSubmit.type, "unable");
    assert.equal(neutralSubmit.status, "failed");
    revision = neutralSubmit.revision;

    model.push(decision("actions", {
      message: "Use the focused form",
      actions: [{
        actionId: "from_model",
        type: "press_key",
        key: "Enter",
        message: "Continue with Enter",
        expectedOutcome: "The next step opens"
      }]
    }));
    const enterSubmit = await agent.submitTurn({
      sessionId: created.sessionId,
      userId: "user_2",
      revision,
      utterance: "Continue with the keyboard",
      source: "text",
      runtime: runtime(5)
    });
    assert.equal(enterSubmit.type, "unable");
    assert.equal(enterSubmit.status, "failed");
    revision = enterSubmit.revision;

    model.push(decision("actions", {
      message: "Open the external account",
      actions: [planned("click", "live:external", "Open the external account")]
    }));
    const externalLink = await agent.submitTurn({
      sessionId: created.sessionId,
      userId: "user_2",
      revision,
      utterance: "Open the external account",
      source: "text",
      runtime: runtime(5)
    });
    assert.equal(externalLink.type, "unable");
    assert.equal(externalLink.status, "failed");
    revision = externalLink.revision;

    const confirmationCount = await database.query<{ count: number }>("SELECT COUNT(*)::int AS count FROM confirmations");
    assert.equal(confirmationCount.rows[0]?.count, 0);

    model.push(decision("actions", {
      message: "I will point to the email field.",
      actions: [planned("point", "live:email", "Point to the email field")]
    }));
    const guided = await agent.submitTurn({
      sessionId: created.sessionId,
      userId: "user_2",
      revision,
      utterance: "Where is the email field?",
      source: "text",
      runtime: runtime(4)
    });
    assert.equal(guided.type, "actions");
    assert.equal(guided.actions[0]?.risk, "read");
    revision = guided.revision;

    model.push(decision("actions", {
      message: "I will save the reversible draft.",
      actions: [planned("click", "live:save", "Save the draft")]
    }));
    const write = await agent.submitTurn({
      sessionId: created.sessionId,
      userId: "user_2",
      revision,
      utterance: "Save this draft",
      source: "text",
      runtime: runtime(5)
    });
    assert.equal(write.status, "waiting_confirmation");
    assert.equal(write.actions[0]?.risk, "reversible_write");

    const manualSession = await agent.createSession("manual-user", runtime());
    model.push(decision("actions", { message: "Use the protected control", actions: [planned("click", "live:manual", "Use protected control")] }));
    const manualAction = await agent.submitTurn({
      sessionId: manualSession.sessionId, userId: "manual-user", revision: manualSession.revision,
      utterance: "Use the protected control", source: "text", runtime: runtime(6)
    });
    assert.equal(manualAction.type, "actions");
    assert.equal(manualAction.status, "active");
    assert.equal(manualAction.actions[0]?.risk, "manual");
    assert.equal(manualAction.actions[0]?.confirmation, undefined);

    const guideSession = await agent.createSession("guide-user", runtime());
    model.push(decision("actions", { message: "Activate the guide-only control", actions: [planned("click", "live:guide", "Activate guide-only control")] }));
    const guideOnly = await agent.submitTurn({
      sessionId: guideSession.sessionId, userId: "guide-user", revision: guideSession.revision,
      utterance: "Activate the guide-only control", source: "text", runtime: runtime(7)
    });
    assert.equal(guideOnly.type, "unable");
    assert.equal(guideOnly.status, "failed");

    const popupSession = await agent.createSession("popup-user", runtime());
    model.push(decision("actions", { message: "Open the Stage menu", actions: [planned("click", "live:popup", "Open the Stage menu")] }));
    const popup = await agent.submitTurn({
      sessionId: popupSession.sessionId, userId: "popup-user", revision: popupSession.revision,
      utterance: "Open the Stage filter", source: "text", runtime: runtime(8)
    });
    assert.equal(popup.type, "actions");
    assert.equal(popup.status, "active");
    assert.equal(popup.actions[0]?.risk, "read");
    assert.equal(popup.actions[0]?.confirmation, undefined);

    const guardedBatchSession = await agent.createSession("guarded-batch-user", runtime());
    model.push(decision("actions", {
      message: "Fill two fields",
      actions: [
        {
          actionId: "first-fill", type: "fill", targetRef: "live:email", value: "first@example.com",
          message: "Enter the first value", expectedOutcome: "The first value is present"
        },
        {
          actionId: "second-fill", type: "fill", targetRef: "live:email", value: "second@example.com",
          message: "Enter the second value", expectedOutcome: "The second value is present"
        }
      ]
    }));
    const guardedBatch = await agent.submitTurn({
      sessionId: guardedBatchSession.sessionId,
      userId: "guarded-batch-user",
      revision: guardedBatchSession.revision,
      utterance: "Fill both fields",
      source: "text",
      runtime: runtime(8)
    });
    assert.equal(guardedBatch.actions.length, 1, "a mutation must end the batch so Mia re-observes before another mutation");
    assert.ok(guardedBatch.actions[0]?.confirmation);

    const hostRuntime = {
      ...runtime(8),
      actions: [{
        name: "update_opportunity",
        description: "Update reversible opportunity fields",
        inputSchema: {
          type: "object",
          additionalProperties: false,
          properties: {
            id: { type: "string" },
            patch: { type: "object", properties: { stage: { type: "string" } }, required: ["stage"] }
          },
          required: ["id", "patch"]
        },
        risk: "reversible_write" as const,
        effect: "draft_update" as const
      }]
    };
    const hostSession = await agent.createSession("host-user", hostRuntime);
    await repositories.agent.reviewHostAction("update_opportunity", { status: "published", risk: "reversible_write" });
    model.push(decision("actions", {
      message: "Update the opportunity",
      actions: [{
        actionId: "host-model",
        type: "host_action",
        hostAction: "update_opportunity",
        arguments: { id: "DRAFT-AVERY", patch: { stage: "Discovery" } },
        message: "Update the opportunity stage",
        expectedOutcome: "The opportunity stage is Discovery"
      }]
    }));
    const hostIssued = await agent.submitTurn({
      sessionId: hostSession.sessionId, userId: "host-user", revision: hostSession.revision,
      utterance: "Change the Avery draft to Discovery", source: "text", runtime: hostRuntime
    });
    const hostConfirmation = hostIssued.actions[0]?.confirmation;
    assert.ok(hostConfirmation);
    assert.match(hostConfirmation.prompt, /DRAFT-AVERY/);
    assert.match(hostConfirmation.prompt, /stage.*Discovery/i);

    const safeKeySession = await agent.createSession("safe-key-user", runtime());
    model.push(decision("actions", {
      message: "Activate the reversible button",
      actions: [{
        actionId: "safe-key-model",
        type: "press_key",
        targetRef: "live:plain",
        key: "Enter",
        message: "Activate Pin draft",
        expectedOutcome: "The draft is pinned"
      }]
    }));
    const safeKey = await agent.submitTurn({
      sessionId: safeKeySession.sessionId,
      userId: "safe-key-user",
      revision: safeKeySession.revision,
      utterance: "Pin the draft with the keyboard",
      source: "text",
      runtime: runtime(8)
    });
    assert.equal(safeKey.status, "waiting_confirmation");
    assert.equal(safeKey.actions[0]?.risk, "reversible_write");

    const submitKeySession = await agent.createSession("submit-key-user", runtime());
    model.push(decision("actions", {
      message: "Activate the form submitter",
      actions: [{
        actionId: "submit-key-model",
        type: "press_key",
        targetRef: "live:continue",
        key: "Space",
        message: "Continue with Space",
        expectedOutcome: "The form advances"
      }]
    }));
    const submitKey = await agent.submitTurn({
      sessionId: submitKeySession.sessionId,
      userId: "submit-key-user",
      revision: submitKeySession.revision,
      utterance: "Continue with Space",
      source: "text",
      runtime: runtime(8)
    });
    assert.equal(submitKey.type, "unable");
    assert.equal(submitKey.status, "failed");

    await agent.createSession("dangerous-host-user", {
      ...runtime(8),
      actions: [{
        name: "destroy_workspace",
        description: "Destroy the current workspace",
        inputSchema: { type: "object" },
        risk: "reversible_write",
        effect: "reversible_change"
      }]
    });
    const dangerousHost = (await repositories.agent.listHostActions()).find((action) => action.name === "destroy_workspace");
    assert.equal(dangerousHost?.status, "blocked");
    assert.equal(dangerousHost?.proposedRisk, "blocked");
    assert.equal(dangerousHost?.effect, "protected");

    await agent.createSession("secret-host-user", {
      ...runtime(8),
      actions: [{
        name: "update_credentials",
        description: "Update a product setting",
        inputSchema: {
          type: "object",
          properties: { apiKey: { type: "string" } },
          required: ["apiKey"]
        },
        risk: "reversible_write",
        effect: "reversible_change"
      }]
    });
    const secretHost = (await repositories.agent.listHostActions()).find((action) => action.name === "update_credentials");
    assert.equal(secretHost?.status, "blocked");
    assert.equal(secretHost?.effect, "protected");

    await assert.rejects(() => agent.createSession("invalid-schema-user", {
      ...runtime(8),
      actions: [{
        name: "invalid_schema_action",
        description: "Invalid schema",
        inputSchema: { type: "definitely-not-a-json-schema-type" },
        risk: "read",
        effect: "read"
      }]
    }), /invalid JSON input schema/i);
  } finally {
    await database.close();
  }
});

test("v1 agent resumes confirmations and navigation without persisting mutation values in browser storage", {
  skip: databaseUrl ? false : "Set MIA_TEST_DATABASE_URL to run PostgreSQL integration tests."
}, async () => {
  assert.ok(databaseUrl);
  const database = new V1Database({ DATABASE_URL: databaseUrl, DATABASE_POOL_MAX: 3 });
  try {
    await database.query("DROP SCHEMA public CASCADE");
    await database.query("CREATE SCHEMA public");
    await database.connect();
    const repositories = new V1Repositories(database);
    await repositories.product.setup({
      product: { name: "Resume Test", origin: "http://localhost:3001", documentationOrigins: [], redactedSelectors: [], transcriptMode: "full", transcriptRetentionDays: 30 },
      admin: { id: "admin", email: "admin@example.com", name: "Admin", passwordHash: "hash" }
    });
    const model = new FakeAgentModel();
    const agent = new V1AgentService(config(databaseUrl), repositories, model);
    const created = await agent.createSession("resume-user", runtime());
    model.push(decision("actions", { message: "Open the draft form", actions: [planned("click", "live:create", "Open Create draft")] }));
    const issued = await agent.submitTurn({
      sessionId: created.sessionId, userId: "resume-user", revision: created.revision,
      utterance: "Open the draft form", source: "text", runtime: runtime()
    });
    const firstBinding = issued.actions[0]?.confirmation?.binding;
    assert.ok(firstBinding);
    const reconfirm = await agent.resumeSession("resume-user", {
      ...runtime(2), sessionId: created.sessionId, resumeToken: created.resumeToken
    });
    assert.equal(reconfirm.pending?.recovery, "confirm");
    const refreshed = reconfirm.pending?.actions[0]?.confirmation;
    assert.ok(refreshed);
    assert.notEqual(refreshed.binding, firstBinding);
    const approved = await agent.resolveConfirmation({
      sessionId: created.sessionId, confirmationId: refreshed.id, userId: "resume-user",
      revision: reconfirm.revision, binding: refreshed.binding, approved: true, source: "ui", observation: observation(2)
    });
    const redirectedRuntime = runtime(3);
    redirectedRuntime.observation.route = "/login";
    redirectedRuntime.observation.url = "http://localhost:3001/login";
    const redirected = await agent.resumeSession("resume-user", {
      ...redirectedRuntime, sessionId: created.sessionId, resumeToken: created.resumeToken
    });
    assert.equal(redirected.pending?.recovery, "verify_navigation", "the browser must verify the exact destination rather than trusting a privacy-reduced observation");
    assert.equal(redirected.pending?.expectedRoute, "/dashboard/crm/new");
    const navigatedRuntime = runtime(3);
    navigatedRuntime.observation.route = "/dashboard/crm/new";
    navigatedRuntime.observation.url = "http://localhost:3001/dashboard/crm/new";
    const navigated = await agent.resumeSession("resume-user", {
      ...navigatedRuntime, sessionId: created.sessionId, resumeToken: created.resumeToken
    });
    assert.equal(navigated.revision, approved.revision);
    assert.equal(navigated.pending?.recovery, "verify_navigation");
    assert.equal(navigated.pending?.expectedRoute, "/dashboard/crm/new");

    const fillSession = await agent.createSession("fill-user", runtime());
    model.push(decision("actions", {
      message: "Enter the name",
      actions: [{
        actionId: "model", type: "fill", targetRef: "live:create", value: "Avery",
        message: "Enter Avery", expectedOutcome: "The field contains Avery"
      }]
    }));
    const fillIssued = await agent.submitTurn({
      sessionId: fillSession.sessionId, userId: "fill-user", revision: fillSession.revision,
      utterance: "Enter Avery", source: "text", runtime: runtime()
    });
    assert.equal(fillIssued.status, "waiting_confirmation");
    const fillResumed = await agent.resumeSession("fill-user", {
      ...runtime(2), sessionId: fillSession.sessionId, resumeToken: fillSession.resumeToken
    });
    assert.equal(fillResumed.status, "active");
    assert.equal(fillResumed.pending?.recovery, "replan");
    assert.equal(fillResumed.pending?.actions[0]?.value, undefined);
    const expiredReloadConfirmation = await database.query<{ status: string }>(
      "SELECT status FROM confirmations WHERE id = $1",
      [fillIssued.actions[0]?.confirmation?.id]
    );
    assert.equal(expiredReloadConfirmation.rows[0]?.status, "expired");

    model.push(decision("actions", {
      message: "Enter the name after re-observing",
      actions: [{
        actionId: "new-model-id", type: "fill", targetRef: "live:create", value: "Avery",
        message: "Enter Avery", expectedOutcome: "The field contains Avery"
      }]
    }));
    const replanned = await agent.continue({
      sessionId: fillSession.sessionId,
      userId: "fill-user",
      revision: fillResumed.revision,
      receipts: fillIssued.actions.map((action) => ({
        actionId: action.actionId,
        idempotencyKey: action.idempotencyKey,
        type: action.type,
        status: "cancelled" as const,
        message: "Cancelled after reload for a fresh observation.",
        targetRef: action.target?.ref,
        route: "/dashboard/crm",
        evidence: { recoveredAfterReload: true }
      })),
      runtime: runtime(3)
    });
    assert.equal(replanned.actions[0]?.idempotencyKey, fillIssued.actions[0]?.idempotencyKey);
    assert.notEqual(replanned.actions[0]?.actionId, fillIssued.actions[0]?.actionId);
    const retryConfirmation = replanned.actions[0]?.confirmation;
    assert.ok(retryConfirmation);
    const retryApproved = await agent.resolveConfirmation({
      sessionId: fillSession.sessionId,
      confirmationId: retryConfirmation.id,
      userId: "fill-user",
      revision: replanned.revision,
      binding: retryConfirmation.binding,
      approved: true,
      source: "ui",
      observation: observation(3)
    });
    model.push(decision("actions", {
      message: "Check the same completed name entry",
      actions: [{
        actionId: "third-model-id", type: "fill", targetRef: "live:create", value: "Avery",
        message: "Enter Avery", expectedOutcome: "The field contains Avery"
      }]
    }));
    const replayed = await agent.continue({
      sessionId: fillSession.sessionId,
      userId: "fill-user",
      revision: retryApproved.revision,
      receipts: replanned.actions.map((action) => ({
        actionId: action.actionId,
        idempotencyKey: action.idempotencyKey,
        type: action.type,
        status: "completed" as const,
        message: "The exact value was entered and verified.",
        targetRef: action.target?.ref,
        route: "/dashboard/crm",
        evidence: { valueChanged: true, exactValueMatch: true }
      })),
      runtime: runtime(4)
    });
    assert.equal(replayed.status, "active");
    assert.equal(replayed.actions[0]?.replay?.status, "completed");
    assert.equal(replayed.actions[0]?.confirmation, undefined, "a completed idempotent action must not request approval again");
    const storedAttempts = await database.query<{ status: string }>(
      "SELECT status FROM action_receipts WHERE session_id = $1 ORDER BY created_at",
      [fillSession.sessionId]
    );
    assert.deepEqual(storedAttempts.rows.map((row) => row.status), ["cancelled", "completed"]);

    const cancelSession = await agent.createSession("cancel-user", runtime());
    model.push(decision("actions", { message: "Save the draft", actions: [planned("click", "live:save", "Save the draft")] }));
    const cancelIssued = await agent.submitTurn({
      sessionId: cancelSession.sessionId,
      userId: "cancel-user",
      revision: cancelSession.revision,
      utterance: "Save the draft",
      source: "text",
      runtime: runtime(4)
    });
    await agent.cancel(cancelSession.sessionId, "cancel-user", cancelIssued.revision);
    const cancelledConfirmation = await database.query<{ status: string }>(
      "SELECT status FROM confirmations WHERE id = $1",
      [cancelIssued.actions[0]?.confirmation?.id]
    );
    assert.equal(cancelledConfirmation.rows[0]?.status, "expired");

    const queryRouteSession = await agent.createSession("query-route-user", runtime());
    const queryRuntime = runtime(5);
    queryRuntime.observation.nodes[0]!.route = "/dashboard/crm?view=mine";
    model.push(decision("actions", {
      message: "Open my CRM view",
      actions: [{
        actionId: "query-route-model",
        type: "navigate",
        route: "/dashboard/crm?view=mine",
        message: "Open my CRM view",
        expectedOutcome: "The exact CRM view opens"
      }]
    }));
    const queryIssued = await agent.submitTurn({
      sessionId: queryRouteSession.sessionId,
      userId: "query-route-user",
      revision: queryRouteSession.revision,
      utterance: "Open my CRM view",
      source: "text",
      runtime: queryRuntime
    });
    const queryResumed = await agent.resumeSession("query-route-user", {
      ...runtime(6),
      sessionId: queryRouteSession.sessionId,
      resumeToken: queryRouteSession.resumeToken
    });
    assert.equal(queryIssued.actions[0]?.route, "/dashboard/crm?view=mine");
    assert.equal(queryResumed.pending?.recovery, "verify_navigation");
    assert.equal(queryResumed.pending?.expectedRoute, "/dashboard/crm?view=mine");

    const routeSession = await agent.createSession("route-user", runtime());
    model.push(decision("actions", {
      message: "Open an unapproved query variant",
      actions: [{
        actionId: "route-model-id",
        type: "navigate",
        route: "/dashboard/crm/new?admin=true",
        message: "Open the new lead page",
        expectedOutcome: "The approved page opens"
      }]
    }));
    await assert.rejects(() => agent.submitTurn({
      sessionId: routeSession.sessionId,
      userId: "route-user",
      revision: routeSession.revision,
      utterance: "Open the new lead page",
      source: "text",
      runtime: runtime(5)
    }), /outside the supplied product routes/i);
  } finally {
    await database.close();
  }
});

test("v1 agent stops after three failures, repeated loops, and the 24-step ceiling", {
  skip: databaseUrl ? false : "Set MIA_TEST_DATABASE_URL to run PostgreSQL integration tests."
}, async () => {
  assert.ok(databaseUrl);
  const database = new V1Database({ DATABASE_URL: databaseUrl, DATABASE_POOL_MAX: 3 });
  try {
    await database.query("DROP SCHEMA public CASCADE");
    await database.query("CREATE SCHEMA public");
    await database.connect();
    const repositories = new V1Repositories(database);
    await repositories.product.setup({
      product: { name: "Limit Test", origin: "http://localhost:3001", documentationOrigins: [], redactedSelectors: [], transcriptMode: "full", transcriptRetentionDays: 30 },
      admin: { id: "admin", email: "admin@example.com", name: "Admin", passwordHash: "hash" }
    });
    const model = new FakeAgentModel();
    const agent = new V1AgentService(config(databaseUrl), repositories, model);

    const failedSession = await agent.createSession("failure-user", runtime());
    model.push(decision("actions", { message: "Point to the control", actions: [planned("point", "live:create", "Point to the control")] }));
    let failed = await agent.submitTurn({
      sessionId: failedSession.sessionId, userId: "failure-user", revision: failedSession.revision,
      utterance: "Point to the control", source: "text", runtime: runtime()
    });
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      if (attempt < 3) model.push(decision("actions", { message: "Try the control again", actions: [planned("point", "live:create", "Try the control again")] }));
      failed = await agent.continue({
        sessionId: failedSession.sessionId,
        userId: "failure-user",
        revision: failed.revision,
        receipts: receiptsFor(failed.actions, "failed", { targetVisible: false }),
        runtime: runtime(attempt + 1)
      });
    }
    assert.equal(failed.type, "unable");
    assert.equal(failed.status, "failed");
    assert.match(failed.message, /three unsuccessful attempts/i);

    const loopSession = await agent.createSession("loop-user", runtime());
    model.push(decision("actions", { message: "Point to the control", actions: [planned("point", "live:create", "Point to the control")] }));
    let looped = await agent.submitTurn({
      sessionId: loopSession.sessionId, userId: "loop-user", revision: loopSession.revision,
      utterance: "Keep pointing to the same control", source: "text", runtime: runtime()
    });
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      if (attempt < 3) model.push(decision("actions", { message: "Repeat the same point", actions: [planned("point", "live:create", "Repeat the same point")] }));
      looped = await agent.continue({
        sessionId: loopSession.sessionId,
        userId: "loop-user",
        revision: looped.revision,
        receipts: receiptsFor(looped.actions, "completed", { targetVisible: true }),
        runtime: runtime(1)
      });
    }
    assert.equal(looped.type, "unable");
    assert.equal(looped.status, "failed");
    assert.match(looped.message, /same action was repeating/i);

    const ceilingSession = await agent.createSession("ceiling-user", runtime());
    model.push(decision("actions", { message: "Point to the control", actions: [planned("point", "live:create", "Point to the control")] }));
    const ceilingIssued = await agent.submitTurn({
      sessionId: ceilingSession.sessionId, userId: "ceiling-user", revision: ceilingSession.revision,
      utterance: "Run a long task", source: "text", runtime: runtime()
    });
    await database.query("UPDATE agent_sessions SET step_count = 24 WHERE id = $1", [ceilingSession.sessionId]);
    const ceiling = await agent.continue({
      sessionId: ceilingSession.sessionId,
      userId: "ceiling-user",
      revision: ceilingIssued.revision,
      receipts: receiptsFor(ceilingIssued.actions, "completed", { targetVisible: true }),
      runtime: runtime(2)
    });
    assert.equal(ceiling.type, "unable");
    assert.equal(ceiling.status, "failed");
    assert.match(ceiling.message, /24-step safety limit/i);
  } finally {
    await database.close();
  }
});

class FakeAgentModel {
  readonly decisions: PlannerDecision[] = [];
  readonly judgments: Array<{ satisfied: boolean; summary: string; missingEvidence: string[] }> = [];
  judgeCalls = 0;

  push(value: PlannerDecision): void {
    this.decisions.push(value);
  }

  pushJudgment(satisfied: boolean, summary: string, missingEvidence: string[] = []): void {
    this.judgments.push({ satisfied, summary, missingEvidence });
  }

  async decide(): Promise<{ decision: PlannerDecision; latencyMs: number; usage: Record<string, never> }> {
    const next = this.decisions.shift();
    assert.ok(next, "Fake model ran out of decisions.");
    return { decision: next, latencyMs: 1, usage: {} };
  }

  async judge(): Promise<{ satisfied: boolean; summary: string; missingEvidence: string[] }> {
    this.judgeCalls += 1;
    return this.judgments.shift() ?? { satisfied: true, summary: "Verified", missingEvidence: [] };
  }

  async embed(texts: string[]): Promise<number[][]> {
    return texts.map(() => Array(768).fill(0));
  }
}

function config(url: string): V1Config {
  return {
    NODE_ENV: "test",
    BACKEND_HOST: "127.0.0.1",
    BACKEND_PORT: 4000,
    TRUST_PROXY: false,
    CORS_ORIGIN: "*",
    DATABASE_URL: url,
    DATABASE_POOL_MAX: 3,
    LOCAL_UPLOAD_DIR: "/tmp/mia-v1-test",
    CONSOLE_DIST_DIR: "/tmp/mia-v1-console",
    SETUP_TOKEN: "test-setup-token",
    CONSOLE_SESSION_TTL_SECONDS: 3600,
    RATE_LIMIT_WINDOW_MS: 60_000,
    RATE_LIMIT_MAX: 300,
    RUNTIME_RATE_LIMIT_MAX: 180,
    RUNTIME_TOKEN_TTL_SECONDS: 900,
    RUNTIME_TOKEN_MAX_USES: 2_000,
    TRANSCRIPT_RETENTION_DAYS: 30,
    DATA_RETENTION_SWEEP_INTERVAL_MS: 3_600_000,
    MAX_UPLOAD_BYTES: 50_000_000,
    PROVIDER_REQUEST_TIMEOUT_MS: 90_000,
    PROVIDER_RETRY_ATTEMPTS: 3,
    SHUTDOWN_GRACE_PERIOD_MS: 30_000,
    GEMINI_BASE_URL: "https://generativelanguage.googleapis.com",
    GEMINI_PLANNER_MODEL: "gemini-3.5-flash",
    GEMINI_VISION_MODEL: "gemini-3.5-flash",
    GEMINI_EMBEDDING_MODEL: "gemini-embedding-2",
    GEMINI_EMBEDDING_DIMENSIONS: 768,
    GEMINI_LIVE_MODEL: "gemini-3.1-flash-live-preview",
    GEMINI_TOKEN_TTL_SECONDS: 1_800,
    GEMINI_NEW_SESSION_TTL_SECONDS: 60,
    UI_SCAN_HEADLESS: true,
    UI_SCAN_ALLOW_PRIVATE_NETWORKS: false
  };
}

function observation(revision = 1) {
  return {
    id: `observation_${revision}`,
    revision,
    url: "http://localhost:3001/dashboard/crm",
    route: "/dashboard/crm",
    title: "CRM",
    viewport: { width: 1280, height: 800, scrollX: 0, scrollY: 0 },
    pageText: "Create draft lead Delete account",
    nodes: [
      {
        nodeId: "create",
        tagName: "button",
        role: "button",
        name: "Create draft lead",
        route: "/dashboard/crm/new",
        locators: [{ strategy: "role" as const, role: "button", name: "Create draft lead" }],
        bounds: { x: 20, y: 20, width: 160, height: 40 },
        viewportVisible: true,
        sensitive: false
      },
      {
        nodeId: "delete",
        tagName: "button",
        role: "button",
        name: "Delete account",
        locators: [{ strategy: "role" as const, role: "button", name: "Delete account" }],
        bounds: { x: 200, y: 20, width: 140, height: 40 },
        viewportVisible: true,
        sensitive: false
      },
      {
        nodeId: "email",
        tagName: "input",
        role: "textbox",
        name: "Email address",
        inputType: "email",
        locators: [{ strategy: "role" as const, role: "textbox", name: "Email address" }],
        bounds: { x: 20, y: 80, width: 220, height: 40 },
        viewportVisible: true,
        sensitive: false
      },
      {
        nodeId: "save",
        tagName: "button",
        role: "button",
        name: "Save draft",
        actionPolicy: "reversible_write" as const,
        locators: [{ strategy: "role" as const, role: "button", name: "Save draft" }],
        bounds: { x: 260, y: 80, width: 140, height: 40 },
        viewportVisible: true,
        sensitive: false
      },
      {
        nodeId: "manual",
        tagName: "button",
        role: "button",
        name: "Protected control",
        actionPolicy: "manual" as const,
        locators: [{ strategy: "role" as const, role: "button", name: "Protected control" }],
        bounds: { x: 560, y: 80, width: 140, height: 40 },
        viewportVisible: true,
        sensitive: false
      },
      {
        nodeId: "guide",
        tagName: "button",
        role: "button",
        name: "Guide-only control",
        actionPolicy: "guide_only" as const,
        locators: [{ strategy: "role" as const, role: "button", name: "Guide-only control" }],
        bounds: { x: 720, y: 80, width: 140, height: 40 },
        viewportVisible: true,
        sensitive: false
      },
      {
        nodeId: "continue",
        tagName: "button",
        role: "button",
        name: "Continue",
        inputType: "submit",
        formAssociated: true,
        formSubmitter: true,
        locators: [{ strategy: "role" as const, role: "button", name: "Continue" }],
        bounds: { x: 420, y: 80, width: 120, height: 40 },
        viewportVisible: true,
        sensitive: false
      },
      {
        nodeId: "external",
        tagName: "a",
        role: "link",
        name: "External account",
        locators: [{ strategy: "role" as const, role: "link", name: "External account" }],
        bounds: { x: 880, y: 80, width: 140, height: 40 },
        viewportVisible: true,
        sensitive: false
      },
      {
        nodeId: "plain",
        tagName: "button",
        role: "button",
        name: "Pin draft",
        formAssociated: false,
        formSubmitter: false,
        locators: [{ strategy: "role" as const, role: "button", name: "Pin draft" }],
        bounds: { x: 1040, y: 80, width: 120, height: 40 },
        viewportVisible: true,
        sensitive: false
      },
      {
        nodeId: "popup",
        tagName: "button",
        role: "button",
        name: "Stage",
        hasPopup: "menu",
        formAssociated: false,
        formSubmitter: false,
        locators: [{ strategy: "role" as const, role: "button", name: "Stage" }],
        bounds: { x: 1180, y: 80, width: 100, height: 40 },
        viewportVisible: true,
        sensitive: false
      }
    ]
  };
}

function runtime(revision = 1) {
  return { observation: observation(revision), actions: [], context: [] };
}

function planned(type: "point" | "click", targetRef: string, message: string) {
  return { actionId: "from_model", type, targetRef, message, expectedOutcome: "The control responds as expected." };
}

function receiptsFor(actions: ActionDirective[], status: ActionReceipt["status"], evidence: Record<string, unknown>): ActionReceipt[] {
  return actions.map((action) => ({
    actionId: action.actionId,
    idempotencyKey: action.idempotencyKey,
    type: action.type,
    status,
    message: status === "completed" ? "The action completed." : "The action failed verification.",
    targetRef: action.target?.ref,
    route: "/dashboard/crm",
    evidence
  }));
}

function decision(
  type: PlannerDecision["type"],
  values: Partial<PlannerDecision> & Pick<PlannerDecision, "message">
): PlannerDecision {
  return {
    assessment: "The next step is clear.",
    progress: "Working on it",
    type,
    message: values.message,
    actions: values.actions ?? [],
    field: values.field,
    inputType: values.inputType,
    choices: values.choices,
    successEvidence: []
  };
}
