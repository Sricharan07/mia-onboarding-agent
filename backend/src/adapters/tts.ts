import { mkdirSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import type { AppConfig } from "../config/env.js";
import { requireConfig } from "../config/env.js";
import { createId } from "../utils/id.js";
import type { TextToSpeechAdapter } from "./interfaces.js";
import { joinUrl } from "./http.js";

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
        voice: input.voice ?? "default",
        input: input.text
      })
    });

    if (!response.ok) {
      throw new Error(`Qwen TTS request failed: ${response.status} ${response.statusText}`);
    }

    const bytes = Buffer.from(await response.arrayBuffer());
    const filename = `${createId("tts")}.mp3`;
    mkdirSync(this.config.LOCAL_TTS_DIR, { recursive: true });
    const audioPath = join(this.config.LOCAL_TTS_DIR, filename);
    writeFileSync(audioPath, bytes);
    return { audioPath, audioUrl: `/local-files/tts/${basename(audioPath)}`, mimeType: response.headers.get("content-type") ?? "audio/mpeg" };
  }
}
