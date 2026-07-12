import assert from "node:assert/strict";
import test from "node:test";
import type { BackendClient } from "../src/client/backendClient.js";
import { GeminiLiveClient } from "../src/voice/geminiLiveClient.js";

type TestVoice = {
  socket: { readyState: number; send: (message: string) => void };
  handlers: { voice: string };
  sessionHandle?: string;
  sendSetup: (model: string, voice: string, language: string) => void;
};

type VoiceTransportHarness = {
  socket: { readyState: number; send: (message: string) => void };
  handlers: {
    voice: "Aoede";
    microphoneInitiallyEnabled: boolean;
    onTurn: (utterance: string) => Promise<{ spokenMessage: string; state: "answer" }>;
    onConfirmation: (approved: boolean) => Promise<{ spokenMessage: string; state: "completed" }>;
    onEvent: (event: { type: string; error?: Error }) => void;
  };
  handleContent: (content: Record<string, unknown>) => void;
  handleCalls: (calls: Array<{ id: string; name: string; args: Record<string, unknown> }>) => Promise<void>;
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
    voice.sessionHandle = "provider-session-handle";
    voice.sendSetup("gemini-live", "Aoede", "en-US");
    const setup = messages[0]?.setup as {
      generationConfig?: {
        speechConfig?: {
          voiceConfig?: { prebuiltVoiceConfig?: { voiceName?: string } };
          languageCode?: string;
        };
      };
      tools?: Array<{ functionDeclarations?: Array<{ name?: string }> }>;
      systemInstruction?: { parts?: Array<{ text?: string }> };
      sessionResumption?: { handle?: string };
    };
    assert.equal(setup.generationConfig?.speechConfig?.voiceConfig?.prebuiltVoiceConfig?.voiceName, "Aoede");
    assert.equal(setup.generationConfig?.speechConfig?.languageCode, "en-US");
    assert.deepEqual(setup.tools?.[0]?.functionDeclarations?.map((tool) => tool.name), [
      "submit_mia_turn",
      "respond_to_mia_confirmation"
    ]);
    assert.match(setup.systemInstruction?.parts?.[0]?.text ?? "", /never answer a user request yourself/i);
    assert.match(setup.systemInstruction?.parts?.[0]?.text ?? "", /never claim you cannot see, point, click, or act/i);
    assert.equal(setup.sessionResumption?.handle, "provider-session-handle");
  } finally {
    if (previousWebSocket) Object.defineProperty(globalThis, "WebSocket", previousWebSocket);
    else delete (globalThis as Record<string, unknown>).WebSocket;
  }
});

test("Gemini Live always submits the authoritative audio transcription instead of a paraphrased tool argument", async () => {
  const previousWebSocket = Object.getOwnPropertyDescriptor(globalThis, "WebSocket");
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "WebSocket", {
    configurable: true,
    value: class TestWebSocket { static readonly OPEN = 1; static readonly CLOSED = 3; static readonly CLOSING = 2; }
  });
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { setTimeout, clearTimeout }
  });
  try {
    const messages: Array<Record<string, unknown>> = [];
    const submitted: string[] = [];
    const errors: Error[] = [];
    const voice = new GeminiLiveClient({} as BackendClient) as unknown as VoiceTransportHarness;
    voice.socket = { readyState: 1, send: (message) => messages.push(JSON.parse(message) as Record<string, unknown>) };
    voice.handlers = {
      voice: "Aoede",
      microphoneInitiallyEnabled: true,
      onTurn: async (utterance) => {
        submitted.push(utterance);
        return { spokenMessage: "Acceptance complete.", state: "answer" };
      },
      onConfirmation: async () => ({ spokenMessage: "Confirmed.", state: "completed" }),
      onEvent: (event: { type: string; error?: Error }) => {
        if (event.type === "error" && event.error) errors.push(event.error);
      }
    };

    const tool = voice.handleCalls([{
      id: "tool-1",
      name: "submit_mia_turn",
      args: { utterance: "run the acceptance check" }
    }]);
    // Real Gemini Live sessions can send the tool call well before the final
    // transcription frame. This delay guards against regressing to the former
    // 1.5-second race.
    await new Promise((resolve) => setTimeout(resolve, 1_800));
    voice.handleContent({
      inputTranscription: { text: "run the mia voice acceptance check" },
      turnComplete: false
    });
    await tool;
    await new Promise((resolve) => setTimeout(resolve, 450));

    assert.deepEqual(submitted, ["run the mia voice acceptance check"]);
    assert.deepEqual(errors, []);
    const response = messages.find((message) => "toolResponse" in message) as { toolResponse?: { functionResponses?: Array<{ response?: { spokenMessage?: string } }> } } | undefined;
    assert.equal(response?.toolResponse?.functionResponses?.[0]?.response?.spokenMessage, "Acceptance complete.");
    assert.equal(messages.some((message) => "clientContent" in message), false, "A real tool response must not race the fallback speaker.");
  } finally {
    if (previousWebSocket) Object.defineProperty(globalThis, "WebSocket", previousWebSocket);
    else delete (globalThis as Record<string, unknown>).WebSocket;
    if (previousWindow) Object.defineProperty(globalThis, "window", previousWindow);
    else delete (globalThis as Record<string, unknown>).window;
  }
});

test("push-to-talk gates the microphone and unexpected voice termination releases capture", async () => {
  const previousWebSocket = Object.getOwnPropertyDescriptor(globalThis, "WebSocket");
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "WebSocket", {
    configurable: true,
    value: class TestWebSocket { static readonly OPEN = 1; static readonly CLOSED = 3; static readonly CLOSING = 2; }
  });
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { setTimeout, clearTimeout }
  });
  try {
    const messages: Array<Record<string, unknown>> = [];
    const events: Array<{ type: string; reconnectable?: boolean }> = [];
    let stopped = 0;
    const track = { enabled: true, stop: () => { stopped += 1; } };
    const voice = new GeminiLiveClient({} as BackendClient) as unknown as {
      socket: { readyState: number; send: (message: string) => void; close: () => void };
      handlers: { onEvent: (event: { type: string; reconnectable?: boolean }) => void } | undefined;
      micStream: { getAudioTracks: () => Array<typeof track>; getTracks: () => Array<typeof track> };
      microphoneEnabled: boolean;
      connected: boolean;
      setMicrophoneEnabled: (enabled: boolean) => void;
      endUnexpectedly: (error: Error, reconnectable: boolean) => Promise<void>;
    };
    voice.socket = { readyState: 1, send: (message) => messages.push(JSON.parse(message) as Record<string, unknown>), close: () => undefined };
    voice.handlers = { onEvent: (event) => events.push(event) };
    voice.micStream = { getAudioTracks: () => [track], getTracks: () => [track] };
    voice.microphoneEnabled = true;
    voice.connected = true;

    voice.setMicrophoneEnabled(false);
    assert.equal(track.enabled, false);
    assert.equal(messages.some((message) => Boolean((message.realtimeInput as { audioStreamEnd?: boolean } | undefined)?.audioStreamEnd)), true);
    voice.setMicrophoneEnabled(true);
    assert.equal(track.enabled, true);

    await voice.endUnexpectedly(new Error("Voice transport failed."), true);
    assert.equal(stopped, 1, "an ended voice session must release its microphone track");
    assert.deepEqual(events.map((event) => event.type), ["input_level", "ready", "listening", "error", "ended"]);
    assert.equal(events.at(-1)?.reconnectable, true);
    assert.equal(voice.handlers, undefined);
  } finally {
    if (previousWebSocket) Object.defineProperty(globalThis, "WebSocket", previousWebSocket);
    else delete (globalThis as Record<string, unknown>).WebSocket;
    if (previousWindow) Object.defineProperty(globalThis, "window", previousWindow);
    else delete (globalThis as Record<string, unknown>).window;
  }
});
