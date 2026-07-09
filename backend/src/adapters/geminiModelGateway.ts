import { GoogleGenAI, type ContentListUnion, type GenerateContentResponse } from "@google/genai";
import { readFileSync } from "node:fs";
import { extname } from "node:path";
import type { AppConfig } from "../config/env.js";
import { requireConfig } from "../config/env.js";
import { AppError } from "../utils/errors.js";
import type { AiLogContext, AiRequestLogInput, AnalyzeVideoInput, GenerateJsonInput, GenerateTextInput, ModelGatewayAdapter } from "./interfaces.js";

export class GeminiModelGatewayAdapter implements ModelGatewayAdapter {
  private client?: GoogleGenAI;

  constructor(
    private readonly config: AppConfig,
    private readonly logAiRequest?: (input: AiRequestLogInput) => void
  ) {}

  async generateText(input: GenerateTextInput): Promise<{ text: string; raw: unknown }> {
    const model = input.model ?? this.config.GEMINI_TEXT_MODEL;
    const started = Date.now();
    try {
      const response = await this.generateContent({
        model,
        contents: input.system ? `${input.system}\n\n${input.prompt}` : input.prompt,
        signal: input.signal
      });
      const text = extractText(response);
      this.writeLog(input.logContext, "gemini_generate_text", model, started, `textChars=${text.length}`);
      return { text, raw: response };
    } catch (error) {
      this.writeLog(input.logContext, "gemini_generate_text", model, started, undefined, error);
      throw error;
    }
  }

  async generateJson<T>(input: GenerateJsonInput): Promise<{ data: T; raw: unknown }> {
    const model = input.model ?? this.config.GEMINI_TEXT_MODEL;
    const started = Date.now();
    try {
      const response = await this.generateContent({
        model,
        contents: input.system ? `${input.system}\n\n${input.prompt}` : input.prompt,
        config: { responseMimeType: "application/json" },
        signal: input.signal
      });
      const text = extractText(response);
      const data = parseProviderJson<T>(text);
      this.writeLog(input.logContext, "gemini_generate_json", model, started, `textChars=${text.length}; schema=${input.schemaName}`);
      return { data, raw: response };
    } catch (error) {
      this.writeLog(input.logContext, "gemini_generate_json", model, started, `schema=${input.schemaName}`, error);
      throw error;
    }
  }

  async analyzeImagesOrVideo<T>(input: AnalyzeVideoInput): Promise<{ data: T; raw: unknown }> {
    const model = input.model ?? this.config.GEMINI_VISION_MODEL ?? this.config.GEMINI_TEXT_MODEL;
    const started = Date.now();
    try {
      const videoBase64 = readFileSync(input.videoPath).toString("base64");
      const response = await this.generateContent({
        model,
        contents: [
          {
            inlineData: {
              mimeType: mimeTypeForVideo(input.videoPath),
              data: videoBase64
            }
          },
          { text: input.prompt }
        ],
        config: { responseMimeType: "application/json" },
        signal: input.signal
      });
      const text = extractText(response);
      const data = parseProviderJson<T>(text);
      this.writeLog(input.logContext, "gemini_video_analysis", model, started, `textChars=${text.length}`);
      return { data, raw: response };
    } catch (error) {
      this.writeLog(input.logContext, "gemini_video_analysis", model, started, undefined, error);
      throw error;
    }
  }

  private async generateContent(input: {
    model?: string;
    contents: ContentListUnion;
    config?: { responseMimeType?: string };
    signal?: AbortSignal;
  }): Promise<GenerateContentResponse> {
    requireConfig(this.config, ["GEMINI_API_KEY"], "Gemini model gateway");
    const model = input.model;
    if (!model) {
      throw new AppError("CONFIG_ERROR", "Gemini model gateway is not configured. Missing: GEMINI_TEXT_MODEL.", 500);
    }

    this.client ??= new GoogleGenAI({
      apiKey: this.config.GEMINI_API_KEY,
      httpOptions: {
        baseUrl: this.config.GEMINI_BASE_URL,
        timeout: this.config.PROVIDER_REQUEST_TIMEOUT_MS ?? 60_000,
        retryOptions: { attempts: this.config.PROVIDER_RETRY_ATTEMPTS ?? 3 }
      }
    });
    return this.client.models.generateContent({
      model,
      contents: input.contents,
      config: { ...input.config, abortSignal: input.signal }
    });
  }

  private writeLog(context: AiLogContext | undefined, fallbackPurpose: string, model: string | undefined, started: number, outputSummary?: string, error?: unknown): void {
    try {
      this.logAiRequest?.({
        appId: context?.appId,
        provider: "gemini",
        purpose: context?.purpose ?? fallbackPurpose,
        inputSummary: `appId=${context?.appId ?? "unknown"}; model=${model ?? "unknown"}`,
        outputSummary,
        latencyMs: Date.now() - started,
        error: error ? errorMessage(error) : undefined
      });
    } catch {
      // Metrics logging must not break the provider request path.
    }
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function extractText(response: GenerateContentResponse): string {
  const text = response.text;
  if (!text) {
    throw new AppError("PROVIDER_ERROR", "Gemini response did not include text content.", 502);
  }
  return text;
}

function parseProviderJson<T>(text: string): T {
  const trimmed = text.trim().replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/\s*```$/i, "");
  try {
    return JSON.parse(trimmed) as T;
  } catch {
    throw new AppError("PROVIDER_JSON_ERROR", "Gemini returned invalid JSON.", 502);
  }
}

function mimeTypeForVideo(path: string): string {
  const extension = extname(path).toLowerCase();
  if (extension === ".webm") return "video/webm";
  if (extension === ".mov") return "video/quicktime";
  if (extension === ".m4v") return "video/x-m4v";
  return "video/mp4";
}
