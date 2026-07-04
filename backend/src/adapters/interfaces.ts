import type { ExtractedActionTimeline, SemanticRecord } from "../schemas/domain.js";

export type AiLogContext = {
  appId?: string;
  purpose?: string;
};

export type AiRequestLogInput = {
  provider: string;
  purpose: string;
  inputSummary: string;
  outputSummary?: string;
  latencyMs?: number;
  error?: string;
};

export type GenerateTextInput = {
  model?: string;
  system?: string;
  prompt: string;
  logContext?: AiLogContext;
};

export type GenerateJsonInput = GenerateTextInput & {
  schemaName: string;
};

export type AnalyzeVideoInput = {
  videoPath: string;
  prompt: string;
  model?: string;
  logContext?: AiLogContext;
};

export interface ModelGatewayAdapter {
  generateText(input: GenerateTextInput): Promise<{ text: string; raw: unknown }>;
  generateJson<T>(input: GenerateJsonInput): Promise<{ data: T; raw: unknown }>;
  analyzeImagesOrVideo<T>(input: AnalyzeVideoInput): Promise<{ data: T; raw: unknown }>;
}

export interface VideoUnderstandingAdapter {
  extractActionTimeline(input: {
    videoPath: string;
    appContext: {
      appName: string;
      knownRoutes: string[];
      uiMapSummary?: string;
    };
  }): Promise<{ timeline: ExtractedActionTimeline; raw: unknown }>;
}

export type SemanticSearchInput = {
  query: string;
  filters?: Record<string, string>;
  limit?: number;
};

export type SemanticSearchResult = {
  id: string;
  score: number;
  metadata?: Record<string, unknown>;
};

export interface SemanticSearchAdapter {
  index(record: SemanticRecord): Promise<void>;
  upsertMany(records: SemanticRecord[]): Promise<void>;
  search(input: SemanticSearchInput): Promise<SemanticSearchResult[]>;
  deleteByFilter(filter: Record<string, string>): Promise<void>;
  deleteByIds(ids: string[]): Promise<void>;
  listIdsByFilter(filter: Record<string, string>): Promise<string[]>;
}

export interface FileStorageAdapter {
  saveBuffer(input: { buffer: Buffer; filename: string; directory: string }): Promise<{ path: string; sizeBytes: number }>;
}
