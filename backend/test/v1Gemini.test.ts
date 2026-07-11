import assert from "node:assert/strict";
import test from "node:test";
import { buildEmbeddingRequest, buildLiveTokenConfig } from "../src/v1/gemini.js";

test("Gemini Embedding 2 uses documented retrieval prefixes without taskType", () => {
  const query = buildEmbeddingRequest({
    model: "gemini-embedding-2",
    texts: ["qualified pipeline"],
    taskType: "RETRIEVAL_QUERY",
    dimensions: 768,
    timeoutMs: 1_000
  });
  const document = buildEmbeddingRequest({
    model: "models/gemini-embedding-2",
    texts: ["Pipeline is the total value of open opportunities."],
    taskType: "RETRIEVAL_DOCUMENT",
    dimensions: 768,
    timeoutMs: 1_000
  });

  assert.equal("taskType" in (query.config ?? {}), false);
  assert.equal("taskType" in (document.config ?? {}), false);
  assert.match(firstText(query), /^task: search result \| query: qualified pipeline$/);
  assert.match(firstText(document), /^title: none \| text: Pipeline is the total value/);
});

test("legacy embedding models retain provider taskType", () => {
  const request = buildEmbeddingRequest({
    model: "gemini-embedding-001",
    texts: ["query"],
    taskType: "RETRIEVAL_QUERY",
    dimensions: 768,
    timeoutMs: 1_000
  });
  assert.equal(request.config?.taskType, "RETRIEVAL_QUERY");
  assert.equal(firstText(request), "query");
});

test("ephemeral Live tokens lock the authoritative voice and agent tools", () => {
  const config = buildLiveTokenConfig({
    model: "gemini-3.1-flash-live-preview",
    voice: "Aoede",
    language: "en-US",
    expiresAt: "2026-07-11T12:30:00.000Z",
    newSessionExpiresAt: "2026-07-11T12:01:00.000Z"
  });
  const live = config.liveConnectConstraints?.config;
  const tools = Array.isArray(live?.tools) ? live.tools : [];

  assert.deepEqual(config.lockAdditionalFields, []);
  assert.equal(config.liveConnectConstraints?.model, "gemini-3.1-flash-live-preview");
  assert.equal(live?.speechConfig?.voiceConfig?.prebuiltVoiceConfig?.voiceName, "Aoede");
  assert.equal(live?.speechConfig?.languageCode, "en-US");
  assert.ok(live?.inputAudioTranscription);
  assert.ok(live?.outputAudioTranscription);
  assert.deepEqual(tools[0]?.functionDeclarations?.map((tool) => tool.name), [
    "submit_mia_turn",
    "respond_to_mia_confirmation"
  ]);
  assert.match(JSON.stringify(live?.systemInstruction), /never claim you cannot see, point, click, or act/i);
  assert.equal("sessionResumption" in (live ?? {}), false);
});

function firstText(request: ReturnType<typeof buildEmbeddingRequest>): string {
  const contents = Array.isArray(request.contents) ? request.contents : [request.contents];
  const content = contents[0];
  if (typeof content === "string" || !content || !("parts" in content)) return "";
  const part = content.parts?.[0];
  return part && "text" in part && typeof part.text === "string" ? part.text : "";
}
