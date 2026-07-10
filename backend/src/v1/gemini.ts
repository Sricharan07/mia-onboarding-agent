import { GoogleGenAI, Modality, ThinkingLevel } from "@google/genai";
import { z } from "zod";
import type { V1Config } from "./config.js";
import { plannerDecisionSchema, type PlannerDecision, type VisualContext } from "./domain.js";
import type { DiagnosticsRepository } from "./db/repositories.js";
import { AppError } from "../utils/errors.js";
import { createId } from "../utils/id.js";

const judgeSchema = z.object({
  satisfied: z.boolean(),
  summary: z.string().min(1).max(1_000),
  missingEvidence: z.array(z.string().min(1).max(500)).max(10).default([])
});

const skillAnalysisSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().min(1).max(1_000),
  goal: z.string().min(1).max(2_000),
  businessContext: z.string().max(4_000).default(""),
  steps: z.array(z.object({
    order: z.number().int().positive(),
    intent: z.string().min(1).max(1_000),
    expectedPage: z.string().max(500).optional(),
    expectedControl: z.string().max(500).optional(),
    successEvidence: z.string().max(1_000)
  })).min(1).max(100),
  constraints: z.array(z.string().min(1).max(1_000)).max(30).default([]),
  expectedOutcomes: z.array(z.string().min(1).max(1_000)).max(30).default([])
});
export type SkillAnalysis = z.infer<typeof skillAnalysisSchema>;

export type ModelUsage = {
  inputTokens?: number;
  outputTokens?: number;
};

export class V1Gemini {
  private client?: GoogleGenAI;
  private clientKey?: string;

  constructor(
    private readonly config: V1Config,
    private readonly diagnostics: DiagnosticsRepository,
    private readonly apiKeyProvider?: () => Promise<string | undefined>
  ) {}

  async decide(input: {
    sessionId: string;
    system: string;
    prompt: string;
    visualContext?: VisualContext[];
    signal?: AbortSignal;
  }): Promise<{ decision: PlannerDecision; latencyMs: number; usage: ModelUsage }> {
    const generated = await this.generateJson({
      sessionId: input.sessionId,
      purpose: "agent_plan",
      model: this.config.GEMINI_PLANNER_MODEL,
      system: input.system,
      prompt: input.prompt,
      schema: plannerDecisionSchema,
      visualContext: input.visualContext,
      signal: input.signal,
      thinkingLevel: "high"
    });
    return { decision: generated.data, latencyMs: generated.latencyMs, usage: generated.usage };
  }

  async judge(input: {
    sessionId: string;
    goal: string;
    evidence: string;
    signal?: AbortSignal;
  }): Promise<{ satisfied: boolean; summary: string; missingEvidence: string[] }> {
    const generated = await this.generateJson({
      sessionId: input.sessionId,
      purpose: "agent_judge",
      model: this.config.GEMINI_PLANNER_MODEL,
      system: "You are a strict completion judge. Decide only from supplied action receipts and current page evidence. Never assume an unobserved outcome. Return JSON.",
      prompt: `Goal:\n${input.goal}\n\nTrusted execution evidence:\n${input.evidence}`,
      schema: judgeSchema,
      signal: input.signal,
      thinkingLevel: "medium"
    });
    return generated.data;
  }

  async embed(texts: string[], signal?: AbortSignal): Promise<number[][]> {
    if (texts.length === 0) return [];
    const client = await this.getClient();
    const embeddings: number[][] = [];
    for (const text of texts) {
      const response = await client.models.embedContent({
        model: this.config.GEMINI_EMBEDDING_MODEL,
        contents: text,
        config: {
          outputDimensionality: this.config.GEMINI_EMBEDDING_DIMENSIONS,
          httpOptions: { timeout: this.config.PROVIDER_REQUEST_TIMEOUT_MS },
          abortSignal: signal
        }
      });
      const values = response.embeddings?.[0]?.values;
      if (!values || values.length !== this.config.GEMINI_EMBEDDING_DIMENSIONS) {
        throw new AppError("GEMINI_EMBEDDING_INVALID", "Gemini returned an invalid embedding.", 502);
      }
      embeddings.push(values);
    }
    return embeddings;
  }

  async analyzeRecording(input: {
    sessionId?: string;
    mimeType: string;
    data: string;
    productName: string;
    knownRoutes: string[];
    signal?: AbortSignal;
  }): Promise<SkillAnalysis> {
    const generated = await this.generateJson({
      sessionId: input.sessionId,
      purpose: "recording_to_skill",
      model: this.config.GEMINI_VISION_MODEL,
      system: `Convert a product walkthrough recording into an adaptive agent skill. Capture business intent and observable success evidence, not brittle click coordinates or fixed selectors. Never copy credentials, personal values, or payment data from the recording.`,
      prompt: `Product: ${input.productName}\nKnown routes: ${input.knownRoutes.join(", ") || "none"}\nReturn a reusable reviewed skill for what the recording demonstrates.`,
      schema: skillAnalysisSchema,
      media: { mimeType: input.mimeType, data: input.data },
      signal: input.signal,
      thinkingLevel: "high"
    });
    return generated.data;
  }

  async createLiveToken(): Promise<{ token: string; model: string; expiresAt: string; websocketUrl: string }> {
    const client = await this.getClient();
    const expiresAt = new Date(Date.now() + this.config.GEMINI_TOKEN_TTL_SECONDS * 1_000).toISOString();
    const newSessionExpiresAt = new Date(Date.now() + this.config.GEMINI_NEW_SESSION_TTL_SECONDS * 1_000).toISOString();
    const token = await client.authTokens.create({
      config: {
        uses: 1,
        expireTime: expiresAt,
        newSessionExpireTime: newSessionExpiresAt,
        httpOptions: { apiVersion: "v1alpha" },
        liveConnectConstraints: {
          model: this.config.GEMINI_LIVE_MODEL,
          config: { responseModalities: [Modality.AUDIO] }
        }
      }
    });
    if (!token.name) throw new AppError("GEMINI_LIVE_TOKEN_INVALID", "Gemini did not return an ephemeral token.", 502);
    return {
      token: token.name,
      model: this.config.GEMINI_LIVE_MODEL,
      expiresAt,
      websocketUrl: `${this.config.GEMINI_BASE_URL.replace(/^http/, "ws").replace(/\/+$/, "")}/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContentConstrained`
    };
  }

  private async generateJson<T>(input: {
    sessionId?: string;
    purpose: string;
    model: string;
    system: string;
    prompt: string;
    schema: z.ZodType<T>;
    visualContext?: VisualContext[];
    media?: { mimeType: string; data: string };
    signal?: AbortSignal;
    thinkingLevel: "minimal" | "low" | "medium" | "high";
  }): Promise<{ data: T; latencyMs: number; usage: ModelUsage }> {
    const started = Date.now();
    let error: unknown;
    try {
      const parts: Array<Record<string, unknown>> = [{ text: input.prompt }];
      for (const visual of input.visualContext ?? []) {
        if (visual.data && visual.mimeType) parts.push({ inlineData: { mimeType: visual.mimeType, data: visual.data } });
        if (visual.description) parts.push({ text: `<visual_context name="${visual.name}">${visual.description}</visual_context>` });
      }
      if (input.media) parts.push({ inlineData: input.media });
      const response = await (await this.getClient()).models.generateContent({
        model: input.model,
        contents: [{ role: "user", parts }],
        config: {
          systemInstruction: input.system,
          responseMimeType: "application/json",
          responseJsonSchema: z.toJSONSchema(input.schema),
          temperature: 0.1,
          thinkingConfig: { thinkingLevel: thinkingLevel(input.thinkingLevel) },
          httpOptions: { timeout: this.config.PROVIDER_REQUEST_TIMEOUT_MS, retryOptions: { attempts: this.config.PROVIDER_RETRY_ATTEMPTS } },
          abortSignal: input.signal
        }
      });
      if (!response.text) throw new AppError("GEMINI_EMPTY_RESPONSE", "Gemini returned no response text.", 502);
      let parsed: unknown;
      try {
        parsed = JSON.parse(stripCodeFence(response.text));
      } catch {
        throw new AppError("GEMINI_JSON_INVALID", "Gemini returned invalid JSON.", 502);
      }
      const data = input.schema.parse(parsed);
      const usage = readUsage(response.usageMetadata);
      await this.logRequest({
        sessionId: input.sessionId,
        purpose: input.purpose,
        model: input.model,
        latencyMs: Date.now() - started,
        ...usage
      });
      return { data, latencyMs: Date.now() - started, usage };
    } catch (caught) {
      error = caught;
      await this.logRequest({
        sessionId: input.sessionId,
        purpose: input.purpose,
        model: input.model,
        latencyMs: Date.now() - started,
        error: caught instanceof Error ? caught.message : String(caught)
      });
      throw caught;
    } finally {
      void error;
    }
  }

  private async getClient(): Promise<GoogleGenAI> {
    const apiKey = this.config.GEMINI_API_KEY ?? await this.apiKeyProvider?.();
    if (!apiKey) throw new AppError("GEMINI_NOT_CONFIGURED", "Gemini is not configured.", 503);
    if (!this.client || this.clientKey !== apiKey) {
      this.client = new GoogleGenAI({ apiKey, httpOptions: { baseUrl: this.config.GEMINI_BASE_URL } });
      this.clientKey = apiKey;
    }
    return this.client;
  }

  private async logRequest(input: {
    sessionId?: string;
    purpose: string;
    model: string;
    latencyMs?: number;
    inputTokens?: number;
    outputTokens?: number;
    error?: string;
  }): Promise<void> {
    try {
      await this.diagnostics.logAiRequest({ id: createId("ai_request"), ...input });
    } catch {
      // Diagnostics must never replace the provider result.
    }
  }
}

function stripCodeFence(text: string): string {
  return text.trim().replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/\s*```$/i, "");
}

function readUsage(value: unknown): ModelUsage {
  if (!value || typeof value !== "object") return {};
  const usage = value as Record<string, unknown>;
  return {
    inputTokens: typeof usage.promptTokenCount === "number" ? usage.promptTokenCount : undefined,
    outputTokens: typeof usage.candidatesTokenCount === "number" ? usage.candidatesTokenCount : undefined
  };
}

function thinkingLevel(value: "minimal" | "low" | "medium" | "high"): ThinkingLevel {
  if (value === "high") return ThinkingLevel.HIGH;
  if (value === "medium") return ThinkingLevel.MEDIUM;
  if (value === "low") return ThinkingLevel.LOW;
  return ThinkingLevel.MINIMAL;
}
