import { mkdirSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import type { AppConfig } from "../config/env.js";
import { requireConfig } from "../config/env.js";
import { createId } from "../utils/id.js";
import type { TextToSpeechAdapter } from "./interfaces.js";
import { joinUrl } from "./http.js";

type QwenTtsResponse = {
  output?: {
    audio?: {
      data?: string;
      url?: string;
    };
  };
  code?: string;
  message?: string;
};

export class QwenTextToSpeechAdapter implements TextToSpeechAdapter {
  constructor(private readonly config: AppConfig) {}

  async synthesize(input: { text: string; voice?: string }): Promise<{ audioPath?: string; audioUrl?: string; mimeType: string }> {
    requireConfig(this.config, ["QWEN_TTS_BASE_URL", "QWEN_API_KEY", "QWEN_VOICE_MODEL"], "Qwen Voice/TTS");
    const response = await fetch(joinUrl(this.config.QWEN_TTS_BASE_URL!, this.config.QWEN_TTS_ENDPOINT), {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.config.QWEN_API_KEY}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        model: this.config.QWEN_VOICE_MODEL,
        input: {
          text: input.text,
          voice: input.voice ?? "Cherry",
          language_type: "Auto"
        }
      })
    });

    const json = await response.json() as QwenTtsResponse;
    if (!response.ok) {
      throw new Error(`Qwen TTS request failed: ${response.status} ${response.statusText} ${json.message ?? ""}`.trim());
    }

    const audio = json.output?.audio;
    if (!audio?.data && !audio?.url) {
      throw new Error(`Qwen TTS response did not include audio output.${json.message ? ` ${json.message}` : ""}`);
    }

    const bytes = audio.data ? Buffer.from(audio.data, "base64") : await fetchAudio(audio.url!);
    const filename = `${createId("tts")}.wav`;
    mkdirSync(this.config.LOCAL_TTS_DIR, { recursive: true });
    const audioPath = join(this.config.LOCAL_TTS_DIR, filename);
    writeFileSync(audioPath, bytes);
    return { audioPath, audioUrl: `/local-files/tts/${basename(audioPath)}`, mimeType: "audio/wav" };
  }
}

async function fetchAudio(url: string): Promise<Buffer> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Qwen TTS audio download failed: ${response.status} ${response.statusText}`);
  }
  return Buffer.from(await response.arrayBuffer());
}
