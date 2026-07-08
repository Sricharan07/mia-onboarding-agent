import { readFileSync } from "node:fs";
import type { AppConfig } from "../config/env.js";
import { requireConfig } from "../config/env.js";
import type { SpeechToTextAdapter } from "./interfaces.js";
import { joinUrl } from "./http.js";
import { AppError } from "../utils/errors.js";

type SpeechRecognitionResponse = {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
};

export class HttpSpeechToTextAdapter implements SpeechToTextAdapter {
  constructor(private readonly config: AppConfig) {}

  async transcribe(input: { audioPath?: string; audioBuffer?: Buffer; mimeType?: string }): Promise<{ text: string; confidence?: number }> {
    requireConfig(this.config, ["STT_BASE_URL", "STT_API_KEY", "STT_MODEL"], "STT");
    const audio = readAudioInput(input);

    const response = await fetch(joinUrl(this.config.STT_BASE_URL!, this.config.STT_ENDPOINT), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${this.config.STT_API_KEY}`
      },
      body: JSON.stringify({
        model: this.config.STT_MODEL,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "input_audio",
                input_audio: {
                  data: `data:${audio.mimeType};base64,${audio.bytes.toString("base64")}`
                }
              }
            ]
          }
        ],
        stream: false,
        asr_options: {
          enable_itn: false
        }
      })
    });

    const json = await response.json() as SpeechRecognitionResponse;
    const text = json.choices?.[0]?.message?.content;
    if (!response.ok || !text) {
      throw new AppError("PROVIDER_ERROR", "STT provider failed to transcribe audio.", 502, json);
    }

    return { text };
  }
}

function readAudioInput(input: { audioPath?: string; audioBuffer?: Buffer; mimeType?: string }): { bytes: Buffer; mimeType: string } {
  if (input.audioBuffer) {
    return { bytes: input.audioBuffer, mimeType: input.mimeType ?? "audio/webm" };
  }

  if (input.audioPath) {
    return { bytes: readFileSync(input.audioPath), mimeType: input.mimeType ?? "audio/webm" };
  }

  throw new AppError("VALIDATION_ERROR", "STT requires audioPath or audioBuffer.");
}
