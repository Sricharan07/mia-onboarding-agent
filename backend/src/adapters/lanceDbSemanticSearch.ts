import * as lancedb from "@lancedb/lancedb";
import type { Connection, Table } from "@lancedb/lancedb";
import { mkdirSync } from "node:fs";
import type { AppConfig } from "../config/env.js";
import { requireConfig } from "../config/env.js";
import type { SemanticRecord } from "../schemas/domain.js";
import { AppError } from "../utils/errors.js";
import { joinUrl, requestJson } from "./http.js";
import type { SemanticSearchAdapter, SemanticSearchInput, SemanticSearchResult } from "./interfaces.js";

const TABLE_NAME = "semantic_records";
const EMBEDDING_BATCH_SIZE = 100;
const FILTER_COLUMNS = new Set([
  "id",
  "kind",
  "appId",
  "route",
  "status",
  "workflowId",
  "elementId",
  "selectorQuality",
  "stateName",
  "discoveredBy",
  "elementType",
  "pageName",
  "name"
]);

type OpenAIEmbeddingsResponse = {
  data?: Array<{
    index: number;
    embedding?: number[];
  }>;
};

type LanceSemanticRow = {
  id: string;
  vector: number[];
  searchableText: string;
  kind: string;
  appId: string;
  route: string;
  status: string;
  workflowId: string;
  elementId: string;
  selectorQuality: string;
  stateName: string;
  discoveredBy: string;
  elementType: string;
  pageName: string;
  name: string;
  metadataJson: string;
};

export class LanceDbSemanticSearchAdapter implements SemanticSearchAdapter {
  private connection?: Promise<Connection>;
  private table?: Promise<Table | undefined>;

  constructor(private readonly config: AppConfig) {}

  async index(record: SemanticRecord): Promise<void> {
    await this.upsertMany([record]);
  }

  async upsertMany(records: SemanticRecord[]): Promise<void> {
    if (records.length === 0) return;
    const embeddings = await this.embedTexts(records.map((record) => searchableText(record)));
    const rows = records.map((record, index) => toLanceRow(record, embeddings[index]));

    let table = await this.getTableIfExists();
    if (!table) {
      const connection = await this.getConnection();
      this.table = connection.createTable(TABLE_NAME, rows, { mode: "create", existOk: true });
      table = await this.table;
      return;
    }

    await table
      .mergeInsert("id")
      .whenMatchedUpdateAll()
      .whenNotMatchedInsertAll()
      .execute(rows);
  }

  async search(input: SemanticSearchInput): Promise<SemanticSearchResult[]> {
    const query = input.query.trim();
    if (!query) return [];

    const table = await this.getTableIfExists();
    if (!table) return [];

    const [vector] = await this.embedTexts([query]);
    const where = toWhereClause(input.filters);
    const limit = Math.max(input.limit ?? 10, 1);
    let search = table
      .vectorSearch(vector)
      .distanceType("cosine")
      .select(["id", "metadataJson", "_distance"])
      .limit(limit);

    if (where) search = search.where(where);

    const rows = await search.toArray() as Array<{ id?: unknown; metadataJson?: unknown; _distance?: unknown }>;
    return rows.map((row) => ({
      id: String(row.id),
      score: distanceToScore(row._distance),
      metadata: parseMetadata(row.metadataJson)
    }));
  }

  async deleteByFilter(filter: Record<string, string>): Promise<void> {
    const where = toWhereClause(filter);
    if (!where) return;

    const table = await this.getTableIfExists();
    if (!table) return;
    await table.delete(where);
  }

  private async getConnection(): Promise<Connection> {
    if (!this.connection) {
      mkdirSync(this.config.SEMANTIC_INDEX_DIR, { recursive: true });
      this.connection = lancedb.connect(this.config.SEMANTIC_INDEX_DIR);
    }
    return this.connection;
  }

  private async getTableIfExists(): Promise<Table | undefined> {
    if (this.table) return this.table;
    const connection = await this.getConnection();
    const tables = await connection.tableNames();
    if (!tables.includes(TABLE_NAME)) return undefined;
    this.table = connection.openTable(TABLE_NAME);
    return this.table;
  }

  private async embedTexts(texts: string[]): Promise<number[][]> {
    requireConfig(this.config, ["OPENAI_API_KEY", "OPENAI_BASE_URL", "OPENAI_EMBEDDING_MODEL"], "OpenAI embeddings");
    const embeddings: number[][] = [];

    for (let start = 0; start < texts.length; start += EMBEDDING_BATCH_SIZE) {
      const input = texts.slice(start, start + EMBEDDING_BATCH_SIZE);
      const response = await requestJson<OpenAIEmbeddingsResponse>({
        url: joinUrl(this.config.OPENAI_BASE_URL, "/embeddings"),
        headers: { authorization: `Bearer ${this.config.OPENAI_API_KEY}` },
        body: {
          model: this.config.OPENAI_EMBEDDING_MODEL,
          input,
          dimensions: this.config.OPENAI_EMBEDDING_DIMENSIONS
        }
      });

      embeddings.push(...parseEmbeddingsResponse(response, input.length));
    }

    return embeddings;
  }
}

function searchableText(record: SemanticRecord): string {
  return record.searchableText.trim() || record.id;
}

function toLanceRow(record: SemanticRecord, vector: number[]): LanceSemanticRow {
  const metadata = stringifyMetadata({
    ...record.metadata,
    kind: record.kind,
    appId: record.appId
  });

  return {
    id: record.id,
    vector,
    searchableText: searchableText(record),
    kind: record.kind,
    appId: record.appId,
    route: metadata.route ?? "",
    status: metadata.status ?? "",
    workflowId: metadata.workflowId ?? "",
    elementId: metadata.elementId ?? "",
    selectorQuality: metadata.selectorQuality ?? "",
    stateName: metadata.stateName ?? "",
    discoveredBy: metadata.discoveredBy ?? "",
    elementType: metadata.elementType ?? "",
    pageName: metadata.pageName ?? "",
    name: metadata.name ?? "",
    metadataJson: JSON.stringify(metadata)
  };
}

function stringifyMetadata(metadata: Record<string, unknown>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(metadata).map(([key, value]) => [key, typeof value === "string" ? value : JSON.stringify(value)])
  );
}

function parseEmbeddingsResponse(response: OpenAIEmbeddingsResponse, expectedCount: number): number[][] {
  const sorted = [...(response.data ?? [])].sort((a, b) => a.index - b.index);
  if (sorted.length !== expectedCount || sorted.some((item) => !Array.isArray(item.embedding))) {
    throw new AppError("OPENAI_EMBEDDINGS_INVALID", "OpenAI embeddings response did not include every embedding.", 502, response);
  }
  return sorted.map((item) => item.embedding!);
}

export function toWhereClause(filters?: Record<string, string>): string | undefined {
  const entries = Object.entries(filters ?? {});
  if (entries.length === 0) return undefined;

  return entries.map(([column, value]) => {
    if (!FILTER_COLUMNS.has(column)) {
      throw new AppError("SEMANTIC_FILTER_UNSUPPORTED", `Semantic search filter is not indexed: ${column}`, 400);
    }
    return `${column} = ${sqlString(value)}`;
  }).join(" AND ");
}

function sqlString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function distanceToScore(distance: unknown): number {
  const numeric = typeof distance === "number" ? distance : Number(distance);
  if (!Number.isFinite(numeric)) return 0;
  return Math.max(0, Math.min(1, 1 - numeric / 2));
}

function parseMetadata(value: unknown): Record<string, unknown> {
  if (typeof value !== "string") return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}
