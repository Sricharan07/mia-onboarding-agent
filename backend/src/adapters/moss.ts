import type { AppConfig } from "../config/env.js";
import { requireConfig } from "../config/env.js";
import type { SemanticRecord } from "../schemas/domain.js";
import type { SemanticSearchAdapter, SemanticSearchInput, SemanticSearchResult } from "./interfaces.js";
import { joinUrl, requestJson } from "./http.js";

type MossSearchResponse = {
  items?: SemanticSearchResult[];
  results?: SemanticSearchResult[];
};

export class MossSemanticSearchAdapter implements SemanticSearchAdapter {
  constructor(private readonly config: AppConfig) {}

  async index(record: SemanticRecord): Promise<void> {
    await this.upsertMany([record]);
  }

  async upsertMany(records: SemanticRecord[]): Promise<void> {
    requireConfig(this.config, ["MOSS_BASE_URL", "MOSS_API_KEY"], "Moss");
    await requestJson({
      url: joinUrl(this.config.MOSS_BASE_URL!, this.config.MOSS_INDEX_ENDPOINT),
      headers: { authorization: `Bearer ${this.config.MOSS_API_KEY}` },
      body: { records }
    });
  }

  async search(input: SemanticSearchInput): Promise<SemanticSearchResult[]> {
    requireConfig(this.config, ["MOSS_BASE_URL", "MOSS_API_KEY"], "Moss");
    const response = await requestJson<MossSearchResponse>({
      url: joinUrl(this.config.MOSS_BASE_URL!, this.config.MOSS_SEARCH_ENDPOINT),
      headers: { authorization: `Bearer ${this.config.MOSS_API_KEY}` },
      body: input
    });
    return response.items ?? response.results ?? [];
  }

  async deleteByFilter(filter: Record<string, string>): Promise<void> {
    requireConfig(this.config, ["MOSS_BASE_URL", "MOSS_API_KEY"], "Moss");
    await requestJson({
      url: joinUrl(this.config.MOSS_BASE_URL!, this.config.MOSS_DELETE_ENDPOINT),
      headers: { authorization: `Bearer ${this.config.MOSS_API_KEY}` },
      body: { filter }
    });
  }
}
