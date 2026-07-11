import { createPartFromUri, FileState, GoogleGenAI, Modality, ThinkingLevel, Type } from "@google/genai";
import type { CreateAuthTokenConfig, EmbedContentParameters, LiveConnectConfig, Part } from "@google/genai";
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

type EmbeddingTask = "RETRIEVAL_DOCUMENT" | "RETRIEVAL_QUERY";

const VOICE_RESULT_PREFIX = "[MIA_AGENT_RESULT]";

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
    const decision = generated.data.type === "actions"
      ? generated.data
      : { ...generated.data, actions: [] };
    return { decision, latencyMs: generated.latencyMs, usage: generated.usage };
  }

  async judge(input: {
    sessionId: string;
    goal: string;
    evidence: string;
    proposedResult: string;
    signal?: AbortSignal;
  }): Promise<{ satisfied: boolean; summary: string; missingEvidence: string[] }> {
    const generated = await this.generateJson({
      sessionId: input.sessionId,
      purpose: "agent_judge",
      model: this.config.GEMINI_PLANNER_MODEL,
      system: "You are a strict completion judge. Decide whether the proposed user-facing result, supplied action receipts, and current page evidence satisfy the goal. Never assume an unobserved action outcome or accept an ungrounded factual claim. Return JSON.",
      prompt: `Goal:\n${input.goal}\n\nProposed user-facing result:\n${input.proposedResult}\n\nTrusted execution evidence:\n${input.evidence}`,
      schema: judgeSchema,
      signal: input.signal,
      thinkingLevel: "medium"
    });
    return generated.data;
  }

  async embed(texts: string[], signal?: AbortSignal, taskType: EmbeddingTask = "RETRIEVAL_DOCUMENT"): Promise<number[][]> {
    if (texts.length === 0) return [];
    const client = await this.getClient();
    const embeddings: number[][] = [];
    for (let offset = 0; offset < texts.length; offset += 100) {
      const batch = texts.slice(offset, offset + 100);
      const response = await client.models.embedContent(buildEmbeddingRequest({
        model: this.config.GEMINI_EMBEDDING_MODEL,
        texts: batch,
        taskType,
        dimensions: this.config.GEMINI_EMBEDDING_DIMENSIONS,
        timeoutMs: this.config.PROVIDER_REQUEST_TIMEOUT_MS,
        signal
      }));
      if (response.embeddings?.length !== batch.length) throw new AppError("GEMINI_EMBEDDING_INVALID", "Gemini returned an incomplete embedding batch.", 502);
      for (const embedding of response.embeddings) {
        const values = embedding.values;
        if (!values || values.length !== this.config.GEMINI_EMBEDDING_DIMENSIONS) {
          throw new AppError("GEMINI_EMBEDDING_INVALID", "Gemini returned an invalid embedding.", 502);
        }
        embeddings.push(values);
      }
    }
    return embeddings;
  }

  async analyzeRecording(input: {
    sessionId?: string;
    mimeType: string;
    filePath: string;
    productName: string;
    knownRoutes: string[];
    signal?: AbortSignal;
  }): Promise<SkillAnalysis> {
    const client = await this.getClient();
    const uploaded = await client.files.upload({
      file: input.filePath,
      config: { mimeType: input.mimeType, displayName: "Mia product walkthrough", abortSignal: input.signal }
    });
    if (!uploaded.name) throw new AppError("GEMINI_FILE_INVALID", "Gemini did not return an uploaded file name.", 502);
    try {
      let file = uploaded;
      const deadline = Date.now() + 5 * 60_000;
      while (file.state === FileState.PROCESSING && Date.now() < deadline) {
        await abortableDelay(2_000, input.signal);
        file = await client.files.get({ name: uploaded.name });
      }
      if (file.state !== FileState.ACTIVE || !file.uri || !file.mimeType) {
        throw new AppError("GEMINI_FILE_PROCESSING_FAILED", "Gemini could not process the walkthrough recording.", 502);
      }
      const generated = await this.generateJson({
        sessionId: input.sessionId,
        purpose: "recording_to_skill",
        model: this.config.GEMINI_VISION_MODEL,
        system: `Convert a product walkthrough recording into an adaptive agent skill. Capture business intent and observable success evidence, not brittle click coordinates or fixed selectors. Never copy credentials, personal values, or payment data from the recording.`,
        prompt: `Product: ${input.productName}\nKnown routes: ${input.knownRoutes.join(", ") || "none"}\nReturn a reusable reviewed skill for what the recording demonstrates.`,
        schema: skillAnalysisSchema,
        parts: [createPartFromUri(file.uri, file.mimeType)],
        signal: input.signal,
        thinkingLevel: "high"
      });
      return generated.data;
    } finally {
      await client.files.delete({ name: uploaded.name }).catch(() => undefined);
    }
  }

  async createLiveToken(voice: string, language: string): Promise<{
    token: string;
    model: string;
    voice: string;
    language: string;
    expiresAt: string;
    websocketUrl: string;
  }> {
    const client = await this.getClient();
    const expiresAt = new Date(Date.now() + this.config.GEMINI_TOKEN_TTL_SECONDS * 1_000).toISOString();
    const newSessionExpiresAt = new Date(Date.now() + this.config.GEMINI_NEW_SESSION_TTL_SECONDS * 1_000).toISOString();
    const token = await client.authTokens.create({
      config: buildLiveTokenConfig({
        model: this.config.GEMINI_LIVE_MODEL,
        voice,
        language,
        expiresAt,
        newSessionExpiresAt
      })
    });
    if (!token.name) throw new AppError("GEMINI_LIVE_TOKEN_INVALID", "Gemini did not return an ephemeral token.", 502);
    return {
      token: token.name,
      model: this.config.GEMINI_LIVE_MODEL,
      voice,
      language,
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
    parts?: Part[];
    signal?: AbortSignal;
    thinkingLevel: "minimal" | "low" | "medium" | "high";
  }): Promise<{ data: T; latencyMs: number; usage: ModelUsage }> {
    const started = Date.now();
    const parts: Part[] = [{ text: input.prompt }, ...(input.parts ?? [])];
    for (const visual of input.visualContext ?? []) {
      if (visual.data && visual.mimeType) parts.push({ inlineData: { mimeType: visual.mimeType, data: visual.data } });
      if (visual.description) parts.push({ text: `<visual_context name="${visual.name}">${visual.description}</visual_context>` });
    }
    if (input.media) parts.push({ inlineData: input.media });
    const client = await this.getClient();
    const structuredAttempts = Math.min(3, Math.max(1, this.config.PROVIDER_RETRY_ATTEMPTS));
    let correction = "";
    for (let attempt = 1; attempt <= structuredAttempts; attempt += 1) {
      const attemptStarted = Date.now();
      try {
        const response = await client.models.generateContent({
          model: input.model,
          contents: [{
            role: "user",
            parts: correction ? [...parts, { text: correction }] : parts
          }],
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
        const validated = parseStructuredResponse(response.text, input.schema);
        if (!validated.success) {
          await this.logRequest({
            sessionId: input.sessionId,
            purpose: input.purpose,
            model: input.model,
            latencyMs: Date.now() - attemptStarted,
            error: validated.error
          });
          if (attempt === structuredAttempts) {
            throw new AppError("GEMINI_RESPONSE_INVALID", "Gemini returned a structured response that failed validation.", 502);
          }
          correction = `Your previous response failed schema validation: ${validated.error.slice(0, 1_500)}\nReturn a corrected JSON object only. Preserve the original user goal and evidence.`;
          continue;
        }
        const usage = readUsage(response.usageMetadata);
        await this.logRequest({
          sessionId: input.sessionId,
          purpose: input.purpose,
          model: input.model,
          latencyMs: Date.now() - attemptStarted,
          ...usage
        });
        return { data: validated.data, latencyMs: Date.now() - started, usage };
      } catch (caught) {
        if (caught instanceof AppError && caught.code === "GEMINI_RESPONSE_INVALID") throw caught;
        await this.logRequest({
          sessionId: input.sessionId,
          purpose: input.purpose,
          model: input.model,
          latencyMs: Date.now() - attemptStarted,
          error: caught instanceof Error ? caught.message : String(caught)
        });
        throw caught;
      }
    }
    throw new AppError("GEMINI_RESPONSE_INVALID", "Gemini returned a structured response that failed validation.", 502);
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

export function buildEmbeddingRequest(input: {
  model: string;
  texts: string[];
  taskType: EmbeddingTask;
  dimensions: number;
  timeoutMs: number;
  signal?: AbortSignal;
}): EmbedContentParameters {
  const embedding2 = /(?:^|\/)gemini-embedding-2(?:$|[-:])/i.test(input.model);
  return {
    model: input.model,
    contents: input.texts.map((text) => ({
      role: "user",
      parts: [{ text: embedding2 ? embedding2Input(text, input.taskType) : text }]
    })),
    config: {
      ...(embedding2 ? {} : { taskType: input.taskType }),
      outputDimensionality: input.dimensions,
      httpOptions: { timeout: input.timeoutMs },
      abortSignal: input.signal
    }
  };
}

export function buildVoiceLiveConfig(voice: string, language: string): LiveConnectConfig {
  return {
    responseModalities: [Modality.AUDIO],
    speechConfig: {
      voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } },
      languageCode: language
    },
    thinkingConfig: { thinkingLevel: ThinkingLevel.MINIMAL },
    systemInstruction: { role: "system", parts: [{ text: voiceSystemInstruction(voice) }] },
    inputAudioTranscription: {},
    outputAudioTranscription: {},
    contextWindowCompression: { slidingWindow: {} },
    tools: [{
      functionDeclarations: [
        {
          name: "submit_mia_turn",
          description: "Submit every complete user request or answer to Mia's authoritative product agent. Never answer independently.",
          parameters: {
            type: Type.OBJECT,
            properties: { utterance: { type: Type.STRING } },
            required: ["utterance"]
          }
        },
        {
          name: "respond_to_mia_confirmation",
          description: "Use only when Mia has asked for confirmation and the user clearly approves or declines.",
          parameters: {
            type: Type.OBJECT,
            properties: { approved: { type: Type.BOOLEAN } },
            required: ["approved"]
          }
        }
      ]
    }]
  };
}

export function buildLiveTokenConfig(input: {
  model: string;
  voice: string;
  language: string;
  expiresAt: string;
  newSessionExpiresAt: string;
}): CreateAuthTokenConfig {
  return {
    uses: 1,
    expireTime: input.expiresAt,
    newSessionExpireTime: input.newSessionExpiresAt,
    httpOptions: { apiVersion: "v1alpha" },
    liveConnectConstraints: {
      model: input.model,
      config: buildVoiceLiveConfig(input.voice, input.language)
    },
    // Lock every supplied protocol field while allowing the client to add
    // the session-resumption handle issued after the initial connection.
    lockAdditionalFields: []
  };
}

function embedding2Input(text: string, taskType: EmbeddingTask): string {
  return taskType === "RETRIEVAL_QUERY"
    ? `task: search result | query: ${text}`
    : `title: none | text: ${text}`;
}

function voiceSystemInstruction(voice: string): string {
  return [
    `You are the voice transport for Mia, an embedded product agent using the configured ${voice} voice.`,
    "You do not reason about the product and you never answer a user request yourself.",
    "For every complete user request or answer, immediately call submit_mia_turn with the user's exact words and do not speak first.",
    "When the tool returns spokenMessage, speak that exact text and nothing else.",
    "When the tool state is confirmation, ask only the returned spokenMessage. After the user clearly approves or declines, call respond_to_mia_confirmation.",
    "Never claim you cannot see, point, click, or act. The authoritative Mia agent and SDK perform those operations.",
    `Messages beginning ${VOICE_RESULT_PREFIX} contain an authoritative Mia response. Speak only its spokenMessage value.`,
    "Keep the microphone interaction in English."
  ].join(" ");
}

function abortableDelay(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
    }, { once: true });
  });
}

function stripCodeFence(text: string): string {
  return text.trim().replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/\s*```$/i, "");
}

function parseStructuredResponse<T>(text: string, schema: z.ZodType<T>): { success: true; data: T } | { success: false; error: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripCodeFence(text));
  } catch {
    return { success: false, error: "Response was not valid JSON." };
  }
  const validated = schema.safeParse(parsed);
  if (validated.success) return { success: true, data: validated.data };
  return { success: false, error: validated.error.issues.map((issue) => `${issue.path.join(".") || "response"}: ${issue.message}`).join("; ") };
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
