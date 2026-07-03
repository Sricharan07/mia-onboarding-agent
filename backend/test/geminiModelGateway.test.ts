import assert from "node:assert/strict";
import test from "node:test";
import { GeminiModelGatewayAdapter } from "../src/adapters/geminiModelGateway.js";
import type { AppConfig } from "../src/config/env.js";
import { ConfigError } from "../src/utils/errors.js";

test("Gemini model gateway requires a Gemini API key", async () => {
  const gateway = new GeminiModelGatewayAdapter({
    GEMINI_TEXT_MODEL: "gemini-2.5-flash",
    GEMINI_VISION_MODEL: "gemini-2.5-flash"
  } as AppConfig);

  await assert.rejects(
    () => gateway.generateText({ prompt: "hello" }),
    (error) => error instanceof ConfigError && error.message.includes("GEMINI_API_KEY")
  );
});
