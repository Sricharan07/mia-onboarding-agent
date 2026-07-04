import assert from "node:assert/strict";
import test from "node:test";
import { GeminiModelGatewayAdapter } from "../src/adapters/geminiModelGateway.js";
import type { AppConfig } from "../src/config/env.js";
import { ConfigError } from "../src/utils/errors.js";

test("Gemini model gateway requires a Gemini API key", async () => {
  const logs: Array<{ provider: string; purpose: string; error?: string }> = [];
  const gateway = new GeminiModelGatewayAdapter({
    GEMINI_TEXT_MODEL: "gemini-2.5-flash",
    GEMINI_VISION_MODEL: "gemini-2.5-flash"
  } as AppConfig, (log) => logs.push(log));

  await assert.rejects(
    () => gateway.generateText({ prompt: "hello" }),
    (error) => error instanceof ConfigError && error.message.includes("GEMINI_API_KEY")
  );
  assert.equal(logs[0]?.provider, "gemini");
  assert.equal(logs[0]?.purpose, "gemini_generate_text");
  assert.match(logs[0]?.error ?? "", /GEMINI_API_KEY/);
});
