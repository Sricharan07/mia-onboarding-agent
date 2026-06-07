import { MossClient, type DocumentInfo, type QueryResultDocumentInfo } from "@moss-dev/moss";
import type { AppConfig } from "../config/env.js";
import { requireConfig } from "../config/env.js";
import type { SemanticRecord } from "../schemas/domain.js";
import type { SemanticSearchAdapter, SemanticSearchInput, SemanticSearchResult } from "./interfaces.js";
import { AppError } from "../utils/errors.js";

export class MossSemanticSearchAdapter implements SemanticSearchAdapter {
  private client?: MossClient;

  constructor(private readonly config: AppConfig) {}

  async index(record: SemanticRecord): Promise<void> {
    await this.upsertMany([record]);
  }

  async upsertMany(records: SemanticRecord[]): Promise<void> {
    if (records.length === 0) return;
    const client = this.getClient();
    const indexName = this.getIndexName();
    const docs = records.map(toMossDocument);

    try {
      if (await this.indexExists(client, indexName)) {
        await client.addDocs(indexName, docs, { upsert: true });
        return;
      }

      await client.createIndex(indexName, docs);
    } catch (error) {
      throw toMossError("MOSS_INDEX_FAILED", "Moss failed to index semantic records.", error);
    }
  }

  async search(input: SemanticSearchInput): Promise<SemanticSearchResult[]> {
    const client = this.getClient();
    const indexName = this.getIndexName();

    try {
      await client.loadIndex(indexName);
      const response = await client.query(indexName, input.query, {
        topK: input.limit,
        filter: toMossFilter(input.filters)
      });
      return response.docs.map(fromMossDocument);
    } catch (error) {
      throw toMossError("MOSS_SEARCH_FAILED", "Moss failed to search semantic records.", error);
    }
  }

  async deleteByFilter(filter: Record<string, string>): Promise<void> {
    const client = this.getClient();
    const indexName = this.getIndexName();

    try {
      const docs = await client.getDocs(indexName);
      const docIds = docs.filter((doc) => matchesFilter(doc.metadata, filter)).map((doc) => doc.id);
      if (docIds.length > 0) {
        await client.deleteDocs(indexName, docIds);
      }
    } catch (error) {
      throw toMossError("MOSS_DELETE_FAILED", "Moss failed to delete semantic records.", error);
    }
  }

  private getClient(): MossClient {
    requireConfig(this.config, ["MOSS_PROJECT_ID", "MOSS_PROJECT_KEY"], "Moss");
    this.client ??= new MossClient(this.config.MOSS_PROJECT_ID!, this.config.MOSS_PROJECT_KEY!);
    return this.client;
  }

  private getIndexName(): string {
    requireConfig(this.config, ["MOSS_INDEX_NAME"], "Moss");
    return this.config.MOSS_INDEX_NAME!;
  }

  private async indexExists(client: MossClient, indexName: string): Promise<boolean> {
    try {
      await client.getIndex(indexName);
      return true;
    } catch {
      return false;
    }
  }
}

function toMossDocument(record: SemanticRecord): DocumentInfo {
  return {
    id: record.id,
    text: record.searchableText,
    metadata: stringifyMetadata({
      ...record.metadata,
      kind: record.kind,
      appId: record.appId
    })
  };
}

function fromMossDocument(doc: QueryResultDocumentInfo): SemanticSearchResult {
  return {
    id: doc.id,
    score: doc.score,
    metadata: doc.metadata ?? {}
  };
}

function stringifyMetadata(metadata: Record<string, unknown>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(metadata).map(([key, value]) => [key, typeof value === "string" ? value : JSON.stringify(value)])
  );
}

function toMossFilter(filters?: Record<string, string>) {
  const entries = Object.entries(filters ?? {});
  if (entries.length === 0) return undefined;

  const conditions = entries.map(([field, value]) => ({
    field,
    condition: { $eq: value }
  }));

  return conditions.length === 1 ? conditions[0] : { $and: conditions };
}

function matchesFilter(metadata: Record<string, string> | undefined, filter: Record<string, string>): boolean {
  return Object.entries(filter).every(([key, value]) => metadata?.[key] === value);
}

function toMossError(code: string, message: string, error: unknown): AppError {
  if (error instanceof AppError) return error;
  return new AppError(code, message, 502, { error: error instanceof Error ? error.message : String(error) });
}
