import { readFileSync } from "node:fs";
import { extname } from "node:path";
import type { AppConfig } from "../config/env.js";
import { requireConfig } from "../config/env.js";
import type { AnalyzeVideoInput, GenerateJsonInput, GenerateTextInput, ModelGatewayAdapter } from "./interfaces.js";
import { joinUrl, requestJson } from "./http.js";
import { AppError } from "../utils/errors.js";

type ChatCompletionResponse = {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
};

export class QwenModelGatewayAdapter implements ModelGatewayAdapter {
  constructor(private readonly config: AppConfig) {}

  async generateText(input: GenerateTextInput): Promise<{ text: string; raw: unknown }> {
    requireConfig(this.config, ["QWEN_BASE_URL", "QWEN_API_KEY"], "Qwen model gateway");
    const model = input.model ?? this.config.RUNTIME_LLM_MODEL ?? this.config.QWEN_MODEL;
    if (!model) {
      throw new AppError("CONFIG_ERROR", "Qwen model gateway is not configured. Missing: RUNTIME_LLM_MODEL or QWEN_MODEL.", 500);
    }

    const raw = await requestJson<ChatCompletionResponse>({
      url: joinUrl(this.config.QWEN_BASE_URL!, this.config.QWEN_TEXT_ENDPOINT),
      headers: { authorization: `Bearer ${this.config.QWEN_API_KEY}` },
      body: {
        model,
        messages: [
          ...(input.system ? [{ role: "system", content: input.system }] : []),
          { role: "user", content: input.prompt }
        ]
      }
    });

    return { text: extractText(raw), raw };
  }

  async generateJson<T>(input: GenerateJsonInput): Promise<{ data: T; raw: unknown }> {
    const result = await this.generateText({
      model: input.model,
      system: input.system,
      prompt: `${input.prompt}\n\nReturn only valid JSON for ${input.schemaName}.`
    });
    return { data: parseProviderJson<T>(result.text), raw: result.raw };
  }

  async analyzeImagesOrVideo<T>(input: AnalyzeVideoInput): Promise<{ data: T; raw: unknown }> {
    requireConfig(this.config, ["QWEN_BASE_URL", "QWEN_API_KEY"], "Qwen video gateway");
    const model = input.model ?? this.config.QWEN_VISION_MODEL ?? this.config.QWEN_MODEL;
    if (!model) {
      throw new AppError("CONFIG_ERROR", "Qwen video gateway is not configured. Missing: QWEN_VISION_MODEL or QWEN_MODEL.", 500);
    }

    const videoBase64 = readFileSync(input.videoPath).toString("base64");
    const raw = await requestJson<ChatCompletionResponse>({
      url: joinUrl(this.config.QWEN_BASE_URL!, this.config.QWEN_VIDEO_ENDPOINT),
      headers: { authorization: `Bearer ${this.config.QWEN_API_KEY}` },
      body: {
        model,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "video_url",
                video_url: {
                  url: `data:${mimeTypeForVideo(input.videoPath)};base64,${videoBase64}`
                },
                fps: 2
              },
              { type: "text", text: input.prompt }
            ]
          }
        ]
      }
    });

    return { data: parseProviderJson<T>(extractText(raw)), raw };
  }
}

function extractText(raw: ChatCompletionResponse): string {
  const text = raw.choices?.[0]?.message?.content;
  if (!text) {
    throw new AppError("PROVIDER_ERROR", "Qwen response did not include text content.", 502, raw);
  }
  return text;
}

function parseProviderJson<T>(text: string): T {
  const trimmed = text.trim().replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/\s*```$/i, "");
  try {
    return JSON.parse(trimmed) as T;
  } catch (error) {
    throw new AppError("PROVIDER_JSON_ERROR", "Qwen returned invalid JSON.", 502, { text, error: error instanceof Error ? error.message : String(error) });
  }
}

function mimeTypeForVideo(path: string): string {
  const extension = extname(path).toLowerCase();
  if (extension === ".webm") return "video/webm";
  if (extension === ".mov") return "video/quicktime";
  if (extension === ".m4v") return "video/x-m4v";
  return "video/mp4";
}
