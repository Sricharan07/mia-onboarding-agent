import { readFileSync } from "node:fs";
import type { AppConfig } from "../config/env.js";
import { requireConfig } from "../config/env.js";
import type { SpeechToTextAdapter } from "./interfaces.js";
import { joinUrl } from "./http.js";
import { AppError } from "../utils/errors.js";

type SttResponse = {
  text?: string;
  confidence?: number;
};

export class HttpSpeechToTextAdapter implements SpeechToTextAdapter {
  constructor(private readonly config: AppConfig) {}

  async transcribe(input: { audioPath?: string; audioBuffer?: Buffer; mimeType?: string }): Promise<{ text: string; confidence?: number }> {
    requireConfig(this.config, ["STT_BASE_URL", "STT_API_KEY", "STT_MODEL"], "STT");
    const form = new FormData();
    form.set("model", this.config.STT_MODEL!);

    if (input.audioBuffer) {
      form.set("file", new Blob([new Uint8Array(input.audioBuffer)], { type: input.mimeType ?? "audio/webm" }), "audio.webm");
    } else if (input.audioPath) {
      const bytes = readFileSync(input.audioPath);
      form.set("file", new Blob([new Uint8Array(bytes)], { type: input.mimeType ?? "audio/webm" }), "audio.webm");
    } else {
      throw new AppError("VALIDATION_ERROR", "STT requires audioPath or audioBuffer.");
    }

    const response = await fetch(joinUrl(this.config.STT_BASE_URL!, this.config.STT_ENDPOINT), {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.config.STT_API_KEY}`
      },
      body: form
    });

    const json = await response.json() as SttResponse;
    if (!response.ok || !json.text) {
      throw new AppError("PROVIDER_ERROR", "STT provider failed to transcribe audio.", 502, json);
    }

    return { text: json.text, confidence: json.confidence };
  }
}
