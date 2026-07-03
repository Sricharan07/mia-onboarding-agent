import assert from "node:assert/strict";
import test from "node:test";
import { buildGeminiLiveWebSocketUrl, LIVE_API_WEBSOCKET_PATH } from "../src/services/gemini/geminiLiveTokenService.js";

test("Gemini Live token service uses constrained ephemeral-token WebSocket endpoint", () => {
  assert.equal(
    buildGeminiLiveWebSocketUrl("https://generativelanguage.googleapis.com/"),
    `wss://generativelanguage.googleapis.com${LIVE_API_WEBSOCKET_PATH}`
  );
  assert.match(LIVE_API_WEBSOCKET_PATH, /v1alpha\.GenerativeService\.BidiGenerateContentConstrained$/);
});
