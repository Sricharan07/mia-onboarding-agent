import assert from "node:assert/strict";
import test from "node:test";
import type { BackendClient } from "../src/client/backendClient.js";
import { GeminiLiveClient } from "../src/voice/geminiLiveClient.js";

type TestVoice = {
  socket: { readyState: number; send: (message: string) => void };
  handlers: { voice: string };
  sendSetup: (model: string) => void;
};

test("Gemini Live is constrained to the Aoede voice and authoritative agent tools", () => {
  const previousWebSocket = Object.getOwnPropertyDescriptor(globalThis, "WebSocket");
  Object.defineProperty(globalThis, "WebSocket", {
    configurable: true,
    value: class TestWebSocket { static readonly OPEN = 1; static readonly CLOSED = 3; static readonly CLOSING = 2; }
  });
  try {
    const messages: Array<Record<string, unknown>> = [];
    const voice = new GeminiLiveClient({} as BackendClient) as unknown as TestVoice;
    voice.socket = { readyState: 1, send: (message) => messages.push(JSON.parse(message) as Record<string, unknown>) };
    voice.handlers = { voice: "Aoede" };
    voice.sendSetup("gemini-live");
    const setup = messages[0]?.setup as {
      generationConfig?: { speechConfig?: { voiceConfig?: { prebuiltVoiceConfig?: { voiceName?: string } } } };
      tools?: Array<{ functionDeclarations?: Array<{ name?: string }> }>;
      systemInstruction?: { parts?: Array<{ text?: string }> };
    };
    assert.equal(setup.generationConfig?.speechConfig?.voiceConfig?.prebuiltVoiceConfig?.voiceName, "Aoede");
    assert.deepEqual(setup.tools?.[0]?.functionDeclarations?.map((tool) => tool.name), [
      "submit_mia_turn",
      "respond_to_mia_confirmation"
    ]);
    assert.match(setup.systemInstruction?.parts?.[0]?.text ?? "", /never answer a user request yourself/i);
    assert.match(setup.systemInstruction?.parts?.[0]?.text ?? "", /never claim you cannot see, point, click, or act/i);
  } finally {
    if (previousWebSocket) Object.defineProperty(globalThis, "WebSocket", previousWebSocket);
    else delete (globalThis as Record<string, unknown>).WebSocket;
  }
});
