import { mkdirSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import type { AppConfig } from "../config/env.js";
import { requireConfig } from "../config/env.js";
import { createId } from "../utils/id.js";
import type { TextToSpeechAdapter } from "./interfaces.js";
import { joinUrl, providerRequestPolicy, requestBytes, requestJson } from "./http.js";
import { AppError } from "../utils/errors.js";

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

  async synthesize(input: { text: string; voice?: string; signal?: AbortSignal }): Promise<{ audioPath?: string; audioUrl?: string; mimeType: string }> {
    requireConfig(this.config, ["QWEN_TTS_BASE_URL", "QWEN_API_KEY", "QWEN_VOICE_MODEL"], "Qwen Voice/TTS");
    const json = await requestJson<QwenTtsResponse>({
      url: joinUrl(this.config.QWEN_TTS_BASE_URL!, this.config.QWEN_TTS_ENDPOINT),
      ...providerRequestPolicy(this.config),
      signal: input.signal,
      headers: {
        authorization: `Bearer ${this.config.QWEN_API_KEY}`
      },
      body: {
        model: this.config.QWEN_VOICE_MODEL,
        input: {
          text: input.text,
          voice: input.voice ?? "Cherry",
          language_type: "Auto"
        }
      }
    });

    const audio = json.output?.audio;
    if (!audio?.data && !audio?.url) {
      throw new AppError("PROVIDER_ERROR", "Qwen TTS response did not include audio output.", 502);
    }

    const bytes = audio.data
      ? Buffer.from(audio.data, "base64")
      : await requestBytes({
          url: allowedAudioUrl(audio.url!, this.config),
          method: "GET",
          ...providerRequestPolicy(this.config),
          signal: input.signal
        });
    const filename = `${createId("tts")}.wav`;
    mkdirSync(this.config.LOCAL_TTS_DIR, { recursive: true });
    const audioPath = join(this.config.LOCAL_TTS_DIR, filename);
    writeFileSync(audioPath, bytes);
    return { audioPath, audioUrl: `/local-files/tts/${basename(audioPath)}`, mimeType: "audio/wav" };
  }
}

function allowedAudioUrl(rawUrl: string, config: AppConfig): string {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new AppError("PROVIDER_ERROR", "Qwen TTS returned an invalid audio URL.", 502);
  }
  if (url.protocol !== "https:") {
    throw new AppError("PROVIDER_ERROR", "Qwen TTS audio URL must use HTTPS.", 502);
  }

  const baseOrigin = new URL(config.QWEN_TTS_BASE_URL!).origin;
  const allowedOrigins = new Set([
    baseOrigin,
    ...(config.QWEN_TTS_AUDIO_ORIGINS ?? "").split(",").map((origin) => origin.trim()).filter(Boolean)
  ]);
  if (!allowedOrigins.has(url.origin)) {
    throw new AppError("PROVIDER_ERROR", "Qwen TTS returned audio from an unapproved origin.", 502);
  }
  return url.toString();
}
