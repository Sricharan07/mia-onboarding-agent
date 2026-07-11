import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";

const backendUrl = required("MIA_VOICE_BACKEND_URL").replace(/\/+$/, "");
const origin = new URL(required("MIA_VOICE_ORIGIN")).origin;
const integrationKey = required("MIA_VOICE_INTEGRATION_KEY");
const expectedSpeech = "Mia voice acceptance passed.";
const userPrompt = "Run the Mia voice acceptance check.";

const runtime = await json(`${backendUrl}/api/v1/runtime/tokens`, {
  method: "POST",
  headers: { "content-type": "application/json", "x-mia-key": integrationKey },
  body: JSON.stringify({
    userId: `voice-acceptance-${randomBytes(8).toString("hex")}`,
    origin,
    capabilities: ["voice:live"]
  })
});
assert.equal(typeof runtime.token, "string", "Runtime token response did not contain a token.");

const live = await json(`${backendUrl}/api/v1/runtime/voice/token`, {
  method: "POST",
  headers: {
    authorization: `Bearer ${runtime.token}`,
    origin,
    "content-type": "application/json"
  },
  body: JSON.stringify({ voice: "Aoede" })
});
assert.equal(live.voice, "Aoede", "The backend did not lock the requested Aoede voice.");
assert.equal(live.language, "en-US", "The backend did not lock English voice output.");

const socket = new WebSocket(`${live.websocketUrl}?access_token=${encodeURIComponent(live.token)}`);
const messages = messageBuffer(socket);
try {
  await waitForOpen(socket);
  socket.send(JSON.stringify({
    setup: {
      model: String(live.model).startsWith("models/") ? live.model : `models/${live.model}`,
      generationConfig: {
        responseModalities: ["AUDIO"],
        speechConfig: {
          voiceConfig: { prebuiltVoiceConfig: { voiceName: "Aoede" } },
          languageCode: "en-US"
        },
        thinkingConfig: { thinkingLevel: "MINIMAL" }
      },
      inputAudioTranscription: {},
      outputAudioTranscription: {},
      sessionResumption: {},
      contextWindowCompression: { slidingWindow: {} }
    }
  }));
  await messages.waitFor((message) => Boolean(message.setupComplete ?? message.setup_complete), 20_000, "Gemini Live setup did not complete.");

  socket.send(JSON.stringify({
    clientContent: { turns: [{ role: "user", parts: [{ text: userPrompt }] }], turnComplete: true }
  }));
  const toolMessage = await messages.waitFor((message) => functionCalls(message).some((call) => call.name === "submit_mia_turn"), 30_000, "Voice transport did not call Mia's authoritative turn tool.");
  const call = functionCalls(toolMessage).find((candidate) => candidate.name === "submit_mia_turn");
  assert.ok(call, "submit_mia_turn call was missing.");
  assert.equal(normalize(String(call.args?.utterance ?? "")), normalize(userPrompt), "Voice transport altered the user request.");

  socket.send(JSON.stringify({
    toolResponse: {
      functionResponses: [{
        id: call.id,
        name: call.name,
        response: { state: "answer", spokenMessage: expectedSpeech }
      }]
    }
  }));

  let transcript = "";
  let audioBytes = 0;
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const message = await messages.next(deadline - Date.now(), "Gemini Live did not finish trusted speech output.");
    const content = object(message.serverContent) ?? object(message.server_content);
    const output = object(content?.outputTranscription) ?? object(content?.output_transcription);
    if (typeof output?.text === "string") transcript = mergeTranscript(transcript, output.text);
    const turn = object(content?.modelTurn) ?? object(content?.model_turn);
    for (const rawPart of array(turn?.parts)) {
      const part = object(rawPart);
      const inline = object(part?.inlineData) ?? object(part?.inline_data);
      if (typeof inline?.data === "string") audioBytes += Buffer.from(inline.data, "base64").byteLength;
    }
    if ((content?.turnComplete ?? content?.turn_complete) && transcript && audioBytes > 0) break;
  }
  assert.ok(audioBytes > 0, "Gemini Live returned no audio bytes.");
  assert.equal(normalize(transcript), normalize(expectedSpeech), "Gemini Live did not speak the exact trusted Mia result.");
  process.stdout.write(`${JSON.stringify({ voice: live.voice, language: live.language, tool: call.name, transcript, audioBytes }, null, 2)}\n`);
} finally {
  messages.close();
  if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) socket.close();
}

function messageBuffer(socket) {
  const values = [];
  const waiters = [];
  let failure;
  const onMessage = (event) => {
    void parseMessage(event.data).then((message) => {
      if (!message) return;
      const providerError = object(message.error);
      if (providerError) {
        fail(new Error(String(providerError.message ?? "Gemini Live returned an error.")));
        return;
      }
      const waiter = waiters.shift();
      if (waiter) waiter.resolve(message);
      else values.push(message);
    });
  };
  const onError = () => fail(new Error("Gemini Live WebSocket failed."));
  const onClose = (event) => fail(new Error(`Gemini Live closed before acceptance completed (${event.code}: ${event.reason || "no reason"}).`));
  socket.addEventListener("message", onMessage);
  socket.addEventListener("error", onError);
  socket.addEventListener("close", onClose);

  function fail(error) {
    failure = error;
    for (const waiter of waiters.splice(0)) waiter.reject(error);
  }

  async function next(timeoutMs, message) {
    if (failure) throw failure;
    if (values.length) return values.shift();
    return deadline(new Promise((resolve, reject) => waiters.push({ resolve, reject })), timeoutMs, message);
  }

  return {
    next,
    async waitFor(predicate, timeoutMs, message) {
      const end = Date.now() + timeoutMs;
      while (Date.now() < end) {
        const value = await next(end - Date.now(), message);
        if (predicate(value)) return value;
      }
      throw new Error(message);
    },
    close() {
      socket.removeEventListener("message", onMessage);
      socket.removeEventListener("error", onError);
      socket.removeEventListener("close", onClose);
    }
  };
}

function functionCalls(message) {
  const tool = object(message.toolCall) ?? object(message.tool_call);
  return array(tool?.functionCalls ?? tool?.function_calls).map(object).filter(Boolean);
}

async function parseMessage(data) {
  const text = typeof data === "string" ? data
    : data instanceof Blob ? await data.text()
      : data instanceof ArrayBuffer ? new TextDecoder().decode(data)
        : ArrayBuffer.isView(data) ? new TextDecoder().decode(data) : "";
  if (!text) return undefined;
  try { return object(JSON.parse(text)); } catch { return undefined; }
}

function waitForOpen(socket) {
  if (socket.readyState === WebSocket.OPEN) return Promise.resolve();
  return deadline(new Promise((resolve, reject) => {
    const done = (handler) => (event) => {
      socket.removeEventListener("open", open);
      socket.removeEventListener("error", error);
      socket.removeEventListener("close", close);
      handler(event);
    };
    const open = done(resolve);
    const error = done(() => reject(new Error("Gemini Live WebSocket failed to open.")));
    const close = done((event) => reject(new Error(`Gemini Live closed during setup (${event.code}).`)));
    socket.addEventListener("open", open);
    socket.addEventListener("error", error);
    socket.addEventListener("close", close);
  }), 20_000, "Gemini Live WebSocket timed out.");
}

async function json(url, init) {
  const response = await fetch(url, init);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`${response.status} ${payload?.error?.message ?? response.statusText}`);
  return payload;
}

function deadline(promise, timeoutMs, message) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(message)), Math.max(1, timeoutMs)); })
  ]).finally(() => clearTimeout(timer));
}

function mergeTranscript(current, next) {
  const left = current.trim();
  const right = next.trim();
  if (!left) return right;
  if (!right || left.endsWith(right)) return left;
  if (right.startsWith(left)) return right;
  return `${left} ${right}`;
}

function normalize(value) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function object(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : undefined;
}

function array(value) {
  return Array.isArray(value) ? value : [];
}

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}
