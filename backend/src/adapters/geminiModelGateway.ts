import { GoogleGenAI, type ContentListUnion, type GenerateContentResponse } from "@google/genai";
import { readFileSync } from "node:fs";
import { extname } from "node:path";
import type { AppConfig } from "../config/env.js";
import { requireConfig } from "../config/env.js";
import { AppError } from "../utils/errors.js";
import type { AnalyzeVideoInput, GenerateJsonInput, GenerateTextInput, ModelGatewayAdapter } from "./interfaces.js";

export class GeminiModelGatewayAdapter implements ModelGatewayAdapter {
  private client?: GoogleGenAI;

  constructor(private readonly config: AppConfig) {}

  async generateText(input: GenerateTextInput): Promise<{ text: string; raw: unknown }> {
    const response = await this.generateContent({
      model: input.model ?? this.config.RUNTIME_LLM_MODEL ?? this.config.GEMINI_TEXT_MODEL,
      contents: input.system ? `${input.system}\n\n${input.prompt}` : input.prompt
    });
    return { text: extractText(response), raw: response };
  }

  async generateJson<T>(input: GenerateJsonInput): Promise<{ data: T; raw: unknown }> {
    const response = await this.generateContent({
      model: input.model ?? this.config.RUNTIME_LLM_MODEL ?? this.config.GEMINI_TEXT_MODEL,
      contents: input.system ? `${input.system}\n\n${input.prompt}` : input.prompt,
      config: { responseMimeType: "application/json" }
    });
    const text = extractText(response);
    return { data: parseProviderJson<T>(text), raw: response };
  }

  async analyzeImagesOrVideo<T>(input: AnalyzeVideoInput): Promise<{ data: T; raw: unknown }> {
    const videoBase64 = readFileSync(input.videoPath).toString("base64");
    const response = await this.generateContent({
      model: input.model ?? this.config.GEMINI_VISION_MODEL ?? this.config.GEMINI_TEXT_MODEL,
      contents: [
        {
          inlineData: {
            mimeType: mimeTypeForVideo(input.videoPath),
            data: videoBase64
          }
        },
        { text: input.prompt }
      ],
      config: { responseMimeType: "application/json" }
    });
    const text = extractText(response);
    return { data: parseProviderJson<T>(text), raw: response };
  }

  private async generateContent(input: {
    model?: string;
    contents: ContentListUnion;
    config?: { responseMimeType?: string };
  }): Promise<GenerateContentResponse> {
    requireConfig(this.config, ["GEMINI_API_KEY"], "Gemini model gateway");
    const model = input.model;
    if (!model) {
      throw new AppError("CONFIG_ERROR", "Gemini model gateway is not configured. Missing: RUNTIME_LLM_MODEL or GEMINI_TEXT_MODEL.", 500);
    }

    this.client ??= new GoogleGenAI({ apiKey: this.config.GEMINI_API_KEY });
    return this.client.models.generateContent({
      model,
      contents: input.contents,
      config: input.config
    });
  }
}

function extractText(response: GenerateContentResponse): string {
  const text = response.text;
  if (!text) {
    throw new AppError("PROVIDER_ERROR", "Gemini response did not include text content.", 502, response);
  }
  return text;
}

function parseProviderJson<T>(text: string): T {
  const trimmed = text.trim().replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/\s*```$/i, "");
  try {
    return JSON.parse(trimmed) as T;
  } catch (error) {
    throw new AppError("PROVIDER_JSON_ERROR", "Gemini returned invalid JSON.", 502, { text, error: error instanceof Error ? error.message : String(error) });
  }
}

function mimeTypeForVideo(path: string): string {
  const extension = extname(path).toLowerCase();
  if (extension === ".webm") return "video/webm";
  if (extension === ".mov") return "video/quicktime";
  if (extension === ".m4v") return "video/x-m4v";
  return "video/mp4";
}
