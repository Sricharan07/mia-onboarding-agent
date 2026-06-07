import { readFileSync } from "node:fs";
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

export class TrueFoundryModelGatewayAdapter implements ModelGatewayAdapter {
  constructor(private readonly config: AppConfig) {}

  async generateText(input: GenerateTextInput): Promise<{ text: string; raw: unknown }> {
    requireConfig(this.config, ["TRUEFOUNDRY_BASE_URL", "TRUEFOUNDRY_API_KEY"], "TrueFoundry");
    const raw = await requestJson<ChatCompletionResponse>({
      url: joinUrl(this.config.TRUEFOUNDRY_BASE_URL!, this.config.TRUEFOUNDRY_TEXT_ENDPOINT),
      headers: { authorization: `Bearer ${this.config.TRUEFOUNDRY_API_KEY}` },
      body: {
        model: input.model ?? this.config.RUNTIME_LLM_MODEL ?? this.config.QWEN_MODEL,
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
    requireConfig(this.config, ["TRUEFOUNDRY_BASE_URL", "TRUEFOUNDRY_API_KEY"], "TrueFoundry video gateway");
    const videoBase64 = readFileSync(input.videoPath).toString("base64");
    const raw = await requestJson<ChatCompletionResponse>({
      url: joinUrl(this.config.TRUEFOUNDRY_BASE_URL!, this.config.TRUEFOUNDRY_VIDEO_ENDPOINT),
      headers: { authorization: `Bearer ${this.config.TRUEFOUNDRY_API_KEY}` },
      body: {
        model: input.model ?? this.config.QWEN_VISION_MODEL ?? this.config.QWEN_MODEL,
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: input.prompt },
              {
                type: "input_video",
                input_video: {
                  data: videoBase64
                }
              }
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
    throw new AppError("PROVIDER_ERROR", "Provider response did not include text content.", 502, raw);
  }
  return text;
}

function parseProviderJson<T>(text: string): T {
  const trimmed = text.trim().replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/\s*```$/i, "");
  try {
    return JSON.parse(trimmed) as T;
  } catch (error) {
    throw new AppError("PROVIDER_JSON_ERROR", "Provider returned invalid JSON.", 502, { text, error: error instanceof Error ? error.message : String(error) });
  }
}
