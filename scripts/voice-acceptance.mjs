import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { adminHeaders, loginAdmin, requestJson, required } from "./lib/acceptance.mjs";

const backendUrl = (process.env.MIA_VOICE_BACKEND_URL ?? process.env.MIA_ACCEPTANCE_BACKEND_URL ?? "").replace(/\/+$/, "");
if (!backendUrl) throw new Error("MIA_VOICE_BACKEND_URL or MIA_ACCEPTANCE_BACKEND_URL is required.");
const demoUrl = process.env.MIA_ACCEPTANCE_DEMO_URL ?? "http://127.0.0.1:3001/dashboard/crm";
const origin = new URL(process.env.MIA_VOICE_ORIGIN ?? demoUrl).origin;
const integrationKey = required("MIA_VOICE_INTEGRATION_KEY");
const adminEmail = required("MIA_ACCEPTANCE_CONSOLE_EMAIL");
const adminPassword = required("MIA_ACCEPTANCE_CONSOLE_PASSWORD");
const prompt = "Point to the Stage filter with your visible cursor, then explain what it does.";
const evidenceDirectory = resolve(process.env.MIA_ACCEPTANCE_EVIDENCE_DIR ?? "/tmp/mia-release-evidence");
const audioPath = resolve(tmpdir(), `mia-voice-input-${randomBytes(8).toString("hex")}.wav`);
const approvalAudioPath = resolve(tmpdir(), `mia-voice-approval-${randomBytes(8).toString("hex")}.wav`);
const fixturePath = fileURLToPath(new URL("./fixtures/voice-stage-filter.wav", import.meta.url));
const approvalFixturePath = fileURLToPath(new URL("./fixtures/voice-approve-draft.wav", import.meta.url));
await mkdir(evidenceDirectory, { recursive: true });

const runtime = await requestJson(`${backendUrl}/api/v1/runtime/tokens`, {
  method: "POST",
  headers: { "content-type": "application/json", "x-mia-key": integrationKey },
  body: JSON.stringify({
    userId: `voice-acceptance-${randomBytes(8).toString("hex")}`,
    origin,
    capabilities: ["voice:live"]
  })
});
assert.match(runtime.token ?? "", /^mia_rt_/, "Runtime token response did not contain a Mia token.");
const live = await requestJson(`${backendUrl}/api/v1/runtime/voice/token`, {
  method: "POST",
  headers: { authorization: `Bearer ${runtime.token}`, origin, "content-type": "application/json" },
  body: JSON.stringify({ voice: "Aoede" })
});
assert.equal(live.voice, "Aoede", "The backend did not lock the configured Aoede voice.");
assert.equal(live.language, "en-US", "The backend did not lock English voice output.");

const fixture = readPcmWave(await readFile(fixturePath));
assert.equal(fixture.sampleRate, 48_000, "The voice fixture must remain 48 kHz for Chromium fake capture.");
await writeFile(audioPath, wavWithSilence(fixture.audio, fixture.sampleRate, 2, 90), { mode: 0o600 });
const approvalFixture = readPcmWave(await readFile(approvalFixturePath));
assert.equal(approvalFixture.sampleRate, 48_000, "The approval fixture must remain 48 kHz for Chromium fake capture.");
await writeFile(approvalAudioPath, wavWithSilence(approvalFixture.audio, approvalFixture.sampleRate, 16, 90), { mode: 0o600 });

const browser = await launchVoiceBrowser(audioPath);
let approvalBrowser;
try {
  const text = await runText(browser);
  const voice = await runVoice(browser);
  const adminToken = await loginAdmin(backendUrl, adminEmail, adminPassword);
  const textRun = await runDetail(adminToken, text.sessionId);
  const voiceRun = await runDetail(adminToken, voice.sessionId);
  verifyRun(textRun, "text");
  verifyRun(voiceRun, "voice");
  await writeFile(
    resolve(evidenceDirectory, "voice-wire.json"),
    `${JSON.stringify({ textSessionId: text.sessionId, voiceSessionId: voice.sessionId, wire: voice.wire }, null, 2)}\n`,
    { mode: 0o600 }
  );

  const voiceErrors = voice.events.filter((event) => event.type === "error");
  assert.deepEqual(voiceErrors, [], `The SDK emitted a voice error: ${JSON.stringify({ voiceErrors, wire: voice.wire })}`);

  const textPlan = planSignature(text.events, "Text");
  const voicePlan = planSignature(voice.events, "Voice");
  assert.deepEqual(voicePlan, textPlan, "Voice and text did not produce the same guarded action plan.");
  const textReceipts = receiptSignature(text.events, "Text");
  const voiceReceipts = receiptSignature(voice.events, "Voice");
  assert.deepEqual(voiceReceipts, textReceipts, "Voice and text did not produce the same verified receipts.");
  assert.equal(text.cursor.distance <= 4, true, `Text cursor missed the Stage target by ${text.cursor.distance.toFixed(2)}px.`);
  assert.equal(voice.cursor.distance <= 4, true, `Voice cursor missed the Stage target by ${voice.cursor.distance.toFixed(2)}px.`);
  assert.equal(text.cursor.targetHit && voice.cursor.targetHit, true, "The Stage target was occluded during text or voice guidance.");

  const voiceUserEvent = voice.events.find((event) => event.type === "transcript" && event.role === "user");
  const voiceAssistantEvent = [...voice.events].reverse().find((event) => event.type === "transcript" && event.role === "assistant");
  const voiceUserTurn = voiceRun.turns.find((turn) => turn.role === "user" && turn.source === "voice");
  const voiceAssistantTurn = [...voiceRun.turns].reverse().find((turn) => turn.role === "assistant");
  assert.ok(voiceUserEvent && voiceUserTurn, "The real voice request was not persisted from authoritative transcription.");
  assert.equal(normalize(voiceUserEvent.text), normalize(voiceUserTurn.content), "The SDK changed the authoritative voice transcription before planning.");
  for (const keyword of ["point", "stage", "filter", "explain"]) {
    assert.match(normalize(voiceUserTurn.content), new RegExp(`\\b${keyword}\\b`), `Voice transcription lost the ${keyword} intent.`);
  }
  assert.ok(voiceAssistantEvent && voiceAssistantTurn, "Gemini Live did not return Mia's trusted final answer as speech.");
  assert.equal(normalize(voiceAssistantEvent.text), normalize(voiceAssistantTurn.content), "Gemini Live spoke text that differed from the authoritative backend result.");
  assert.match(normalize(voiceAssistantTurn.content), /\bstage\b|\bfilter\b/, "The voice result was not grounded in the requested Stage filter.");

  approvalBrowser = await launchVoiceBrowser(approvalAudioPath);
  const approval = await runVoiceApproval(approvalBrowser);
  const approvalRun = await runDetail(adminToken, approval.sessionId);
  verifyVoiceApprovalRun(approvalRun, approval.account);
  const approvalErrors = approval.events.filter((event) => event.type === "error");
  assert.deepEqual(approvalErrors, [], `Voice approval emitted an SDK error: ${JSON.stringify({ approvalErrors, wire: approval.wire })}`);
  await writeFile(
    resolve(evidenceDirectory, "voice-approval-wire.json"),
    `${JSON.stringify({ sessionId: approval.sessionId, wire: approval.wire }, null, 2)}\n`,
    { mode: 0o600 }
  );

  process.stdout.write(`${JSON.stringify({
    artifactBound: true,
    voice: live.voice,
    language: live.language,
    microphoneFixture: "scripts/fixtures/voice-stage-filter.wav",
    authoritativeInputTranscript: voiceUserTurn.content,
    trustedOutputTranscript: voiceAssistantEvent.text,
    textSessionId: text.sessionId,
    voiceSessionId: voice.sessionId,
    plan: textPlan,
    receipts: textReceipts,
    textCursorDistancePx: text.cursor.distance,
    voiceCursorDistancePx: voice.cursor.distance,
    textFinalStatus: textRun.session.status,
    voiceFinalStatus: voiceRun.session.status,
    voiceApprovalSessionId: approval.sessionId,
    voiceApprovalAccount: approval.account,
    voiceApprovalSource: "voice",
    voiceApprovalStatus: approvalRun.session.status
  }, null, 2)}\n`);
} finally {
  await approvalBrowser?.close();
  await browser.close();
  await rm(audioPath, { force: true });
  await rm(approvalAudioPath, { force: true });
}

function launchVoiceBrowser(capturePath) {
  return chromium.launch({
    channel: process.env.MIA_VOICE_BROWSER ?? "chrome",
    headless: true,
    args: [
      "--autoplay-policy=no-user-gesture-required",
      "--use-fake-device-for-media-stream",
      "--use-fake-ui-for-media-stream",
      `--use-file-for-fake-audio-capture=${capturePath}`
    ]
  });
}

async function runText(browser) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: "no-preference" });
  const page = await context.newPage();
  await captureEvents(page);
  try {
    await openMia(page);
    const composer = page.locator("[data-mia-assistant-panel] [data-composer]");
    await composer.fill(prompt);
    await composer.press("Enter");
    await waitForEvent(page, (event) => event.type === "action_completed" && event.receiptType === "point" && event.receiptStatus === "completed");
    await waitForEvent(page, (event) => ["answer", "completed"].includes(event.type));
    const result = { sessionId: await sessionId(page), events: await events(page), cursor: await cursorMetrics(page) };
    await page.screenshot({ path: resolve(evidenceDirectory, "voice-parity-text.png"), fullPage: true });
    return result;
  } finally {
    await context.close();
  }
}

async function runVoice(browser) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: "no-preference", permissions: ["microphone"] });
  await context.grantPermissions(["microphone"], { origin });
  const page = await context.newPage();
  const wire = captureVoiceWire(page);
  await captureEvents(page);
  try {
    await openMia(page);
    await page.locator("[data-mia-assistant-panel] [data-voice]").click();
    await waitForEvent(page, (event) => event.type === "voice_started", 30_000);
    await waitForEvent(page, (event) => event.type === "transcript" && event.role === "user", 60_000);
    await waitForEvent(page, (event) => event.type === "action_completed" && event.receiptType === "point" && event.receiptStatus === "completed", 120_000);
    await waitForEvent(page, (event) => ["answer", "completed"].includes(event.type), 120_000);
    await waitForEvent(page, (event) => event.type === "transcript" && event.role === "assistant", 120_000);
    const result = { sessionId: await sessionId(page), events: await events(page), cursor: await cursorMetrics(page), wire };
    await page.screenshot({ path: resolve(evidenceDirectory, "voice-parity-voice.png"), fullPage: true });
    await page.locator("[data-mia-assistant-panel] [data-voice]").click().catch(() => undefined);
    return result;
  } finally {
    await context.close();
  }
}

async function runVoiceApproval(browser) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: "no-preference", permissions: ["microphone"] });
  await context.grantPermissions(["microphone"], { origin });
  const page = await context.newPage();
  const wire = captureVoiceWire(page);
  await captureEvents(page);
  const account = `Voice Approval ${alphabeticId()} Labs`;
  try {
    await openMia(page);
    const composer = page.locator("[data-mia-assistant-panel] [data-composer]");
    await composer.fill(`Create a draft opportunity for ${account} worth $12,345.`);
    await composer.press("Enter");
    const confirmation = await waitForEvent(page, (event) => event.type === "confirmation_required", 120_000);
    assert.match(confirmation.confirmationPrompt ?? "", /approve this reversible change/i);
    assert.match(confirmation.confirmationPrompt ?? "", new RegExp(account, "i"));

    await page.locator("[data-mia-assistant-panel] [data-voice]").click();
    await waitForEvent(page, (event) => event.type === "voice_started", 30_000);
    const spokenPrompt = await waitForEvent(page, (event) => event.type === "transcript" && event.role === "assistant", 60_000);
    assert.equal(normalize(spokenPrompt.text), normalize(confirmation.confirmationPrompt), "Mia did not speak the exact bound confirmation prompt.");
    const approvalTranscript = await waitForEvent(
      page,
      (event) => event.type === "transcript" && event.role === "user" && /\byes\b/i.test(event.text ?? ""),
      60_000
    );
    assert.match(normalize(approvalTranscript.text), /\byes\b/, "Gemini Live did not transcribe the spoken approval.");
    await waitForEvent(page, (event) => event.type === "action_completed" && event.receiptType === "host_action" && event.receiptStatus === "completed", 120_000);
    await waitForEvent(page, (event) => ["answer", "completed"].includes(event.type), 120_000);
    const finalSpeech = await waitForEvent(
      page,
      (event) => event.type === "transcript" && event.role === "assistant" && !/approve this reversible change/i.test(event.text ?? ""),
      120_000
    );
    assert.match(normalize(finalSpeech.text), /\bdraft\b|\bopportunity\b/, "The trusted voice completion did not describe the created draft.");

    const record = await page.evaluate(async (name) => {
      const response = await fetch("/api/v1/crm/state", { cache: "no-store" });
      if (!response.ok) throw new Error(`CRM state returned ${response.status}.`);
      const payload = await response.json();
      return payload.state?.opportunities?.find((opportunity) => opportunity.account === name);
    }, account);
    assert.ok(record, "The approved host action did not create the requested CRM record.");
    assert.equal(record.amount, 12_345, "The approved host action changed the requested amount.");
    assert.equal(record.isDraft, true, "Voice approval performed a final submit instead of creating a draft.");

    const result = { sessionId: await sessionId(page), account, events: await events(page), wire };
    await page.screenshot({ path: resolve(evidenceDirectory, "voice-approval.png"), fullPage: true });
    await page.locator("[data-mia-assistant-panel] [data-voice]").click().catch(() => undefined);
    return result;
  } finally {
    await context.close();
  }
}

function captureVoiceWire(page) {
  const frames = [];
  page.on("websocket", (socket) => {
    socket.on("framereceived", ({ payload }) => record("received", payload));
    socket.on("framesent", ({ payload }) => record("sent", payload));
  });
  return frames;

  function record(direction, payload) {
    const text = Buffer.isBuffer(payload) ? payload.toString("utf8") : String(payload);
    let message;
    try { message = JSON.parse(text); } catch { return; }
    if (message.realtimeInput) return;
    const content = message.serverContent ?? message.server_content;
    const tool = message.toolCall ?? message.tool_call;
    const responses = message.toolResponse?.functionResponses ?? [];
    const clientParts = message.clientContent?.turns?.flatMap((turn) => turn.parts ?? []) ?? [];
    const frame = {
      direction,
      setup: Boolean(message.setup),
      setupComplete: Boolean(message.setupComplete ?? message.setup_complete),
      input: content?.inputTranscription?.text ?? content?.input_transcription?.text,
      output: content?.outputTranscription?.text ?? content?.output_transcription?.text,
      turnComplete: Boolean(content?.turnComplete ?? content?.turn_complete),
      calls: (tool?.functionCalls ?? tool?.function_calls ?? []).map((call) => ({ id: call.id, name: call.name })),
      responses: responses.map((response) => ({
        id: response.id,
        name: response.name,
        state: response.response?.state,
        error: response.response?.error
      })),
      clientText: clientParts.map((part) => part.text).filter(Boolean)
    };
    if (frame.setup || frame.setupComplete || frame.input || frame.output || frame.turnComplete
      || frame.calls.length || frame.responses.length || frame.clientText.length) frames.push(frame);
  }
}

async function openMia(page) {
  await page.goto(demoUrl, { waitUntil: "domcontentloaded" });
  await waitForEvent(page, (event) => event.type === "ready", 30_000);
  const launcher = page.locator("[data-mia-assistant-panel] [data-launcher]");
  await launcher.focus();
  await launcher.press("Enter");
}

async function captureEvents(page) {
  await page.addInitScript(() => {
    window.__miaVoiceAcceptance = [];
    window.addEventListener("mia:runtime-event", (event) => {
      const detail = event.detail;
      window.__miaVoiceAcceptance.push({
        type: detail?.type,
        sessionId: detail?.sessionId,
        role: detail?.role,
        text: detail?.text,
        message: detail?.message,
        error: detail?.error?.message,
        actionType: detail?.action?.type,
        actionRisk: detail?.action?.risk,
        actionHost: detail?.action?.hostAction,
        targetRef: detail?.action?.target?.ref,
        targetLabel: detail?.action?.target?.label,
        confirmationPrompt: detail?.confirmation?.prompt,
        receiptType: detail?.receipt?.type,
        receiptStatus: detail?.receipt?.status,
        receiptTargetRef: detail?.receipt?.targetRef
      });
    });
  });
}

async function waitForEvent(page, predicate, timeout = 90_000) {
  const handle = await page.waitForFunction((source) => {
    const test = Function(`return (${source})`)();
    return window.__miaVoiceAcceptance?.find((event) => test(event));
  }, predicate.toString(), { timeout });
  return handle.jsonValue();
}

function events(page) {
  return page.evaluate(() => window.__miaVoiceAcceptance ?? []);
}

async function sessionId(page) {
  const ready = (await events(page)).find((event) => event.type === "ready");
  assert.ok(ready?.sessionId, "SDK readiness did not identify its backend session.");
  return ready.sessionId;
}

function cursorMetrics(page) {
  return page.evaluate(() => {
    const target = [...document.querySelectorAll("button")].find((element) => element.textContent?.trim() === "Stage");
    const cursor = document.querySelector("[data-mia-shadow-cursor]")?.shadowRoot?.querySelector(".mia-cursor");
    const targetRect = target?.getBoundingClientRect();
    const cursorRect = cursor?.getBoundingClientRect();
    const center = targetRect ? { x: targetRect.left + targetRect.width / 2, y: targetRect.top + targetRect.height / 2 } : null;
    const hit = center ? document.elementFromPoint(center.x, center.y) : null;
    return {
      distance: center && cursorRect ? Math.hypot(center.x - cursorRect.left, center.y - cursorRect.top) : Number.POSITIVE_INFINITY,
      targetHit: Boolean(target && hit && (hit === target || target.contains(hit)))
    };
  });
}

async function runDetail(token, id) {
  return requestJson(`${backendUrl}/api/v1/runs/${encodeURIComponent(id)}`, { headers: adminHeaders(token, false) });
}

function verifyRun(run, source) {
  assert.equal(run.session.status, "completed", `${source} run did not complete.`);
  assert.ok(run.steps.length > 0, `${source} run has no planner steps.`);
  assert.ok(run.aiRequests.some((request) => request.purpose === "agent_judge" && !request.error), `${source} run has no successful final judgment.`);
  assert.ok(run.turns.some((turn) => turn.role === "user" && turn.source === source), `${source} run did not persist its source.`);
  assert.ok(run.receipts.some((receipt) => receipt.type === "point" && receipt.status === "completed"), `${source} run has no completed point receipt.`);
}

function verifyVoiceApprovalRun(run, account) {
  assert.equal(run.session.status, "completed", "The voice-approved mutation did not complete.");
  assert.ok(run.aiRequests.some((request) => request.purpose === "agent_judge" && !request.error), "The voice-approved mutation has no successful final judgment.");
  const confirmation = run.confirmations.find((entry) => entry.status === "approved" && entry.source === "voice");
  assert.ok(confirmation, "The mutation was not approved through the bound voice confirmation path.");
  assert.match(confirmation.prompt ?? "", new RegExp(account, "i"), "The voice confirmation was not bound to the requested record.");
  const receipt = run.receipts.find((entry) => entry.type === "host_action" && entry.status === "completed");
  assert.ok(receipt, "The voice-approved mutation has no completed host-action receipt.");
  assert.equal(receipt.actionId, confirmation.actionId, "The voice approval was not bound to the action that executed.");
}

function planSignature(captured, source) {
  const actions = captured.filter((event) => event.type === "action_requested")
    .map((event) => ({ type: event.actionType, risk: event.actionRisk, target: semanticTarget(event.targetLabel, event.targetRef) }));
  assert.ok(actions.length > 0, `${source} did not request a guidance action.`);
  assert.equal(actions.every((action) => action.risk === "read"), true, `${source} applied a non-read policy to a guidance request.`);
  return uniqueSignatures(actions);
}

function receiptSignature(captured, source) {
  const receipts = captured.filter((event) => event.type === "action_completed")
    .map((event) => ({
      type: event.receiptType,
      status: event.receiptStatus,
      target: event.receiptType === "point" ? "stage_filter" : semanticTarget(undefined, event.receiptTargetRef)
    }));
  assert.ok(receipts.length > 0, `${source} did not return a verified receipt.`);
  assert.equal(receipts.every((receipt) => receipt.status === "completed"), true, `${source} required a failed or unverified recovery action.`);
  return uniqueSignatures(receipts);
}

function uniqueSignatures(values) {
  const seen = new Set();
  return values.filter((value) => {
    const signature = JSON.stringify(value);
    if (seen.has(signature)) return false;
    seen.add(signature);
    return true;
  });
}

function semanticTarget(label, reference) {
  if (/stage/i.test(label ?? "") || /stage_filter/i.test(reference ?? "")) return "stage_filter";
  return label ?? reference ?? null;
}

function readPcmWave(input) {
  assert.equal(input.subarray(0, 4).toString("ascii"), "RIFF", "The voice fixture is not a RIFF file.");
  assert.equal(input.subarray(8, 12).toString("ascii"), "WAVE", "The voice fixture is not a WAVE file.");
  let format;
  let audio;
  for (let offset = 12; offset + 8 <= input.length;) {
    const id = input.subarray(offset, offset + 4).toString("ascii");
    const size = input.readUInt32LE(offset + 4);
    const start = offset + 8;
    assert.ok(start + size <= input.length, `The ${id} WAVE chunk is truncated.`);
    if (id === "fmt ") {
      assert.ok(size >= 16, "The voice fixture has an invalid format chunk.");
      format = {
        encoding: input.readUInt16LE(start),
        channels: input.readUInt16LE(start + 2),
        sampleRate: input.readUInt32LE(start + 4),
        bitsPerSample: input.readUInt16LE(start + 14)
      };
    } else if (id === "data") {
      audio = Buffer.from(input.subarray(start, start + size));
    }
    offset = start + size + (size % 2);
  }
  assert.ok(format && audio, "The voice fixture is missing its format or audio chunk.");
  assert.deepEqual(
    { encoding: format.encoding, channels: format.channels, bitsPerSample: format.bitsPerSample },
    { encoding: 1, channels: 1, bitsPerSample: 16 },
    "The voice fixture must be mono 16-bit PCM."
  );
  assert.equal(audio.length % 2, 0, "The voice fixture PCM is not 16-bit aligned.");
  return { audio, sampleRate: format.sampleRate };
}

function wavWithSilence(pcm, sampleRate, leadingSeconds, trailingSeconds) {
  const leading = Buffer.alloc(Math.floor(sampleRate * leadingSeconds) * 2);
  const trailing = Buffer.alloc(Math.floor(sampleRate * trailingSeconds) * 2);
  const data = Buffer.concat([leading, pcm, trailing]);
  const header = Buffer.alloc(44);
  header.write("RIFF", 0, "ascii");
  header.writeUInt32LE(36 + data.length, 4);
  header.write("WAVE", 8, "ascii");
  header.write("fmt ", 12, "ascii");
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36, "ascii");
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

function normalize(value) {
  return String(value ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function alphabeticId() {
  return [...randomBytes(6)].map((value) => String.fromCharCode(65 + value % 26)).join("");
}
