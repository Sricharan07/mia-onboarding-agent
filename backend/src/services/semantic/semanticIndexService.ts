import type { SemanticSearchAdapter } from "../../adapters/interfaces.js";
import type { Repositories } from "../../db/repositories.js";
import { uiElementToSemanticRecord, workflowToSemanticRecord } from "./semanticRecords.js";

export class SemanticIndexService {
  constructor(
    private readonly repositories: Repositories,
    private readonly semanticSearch: SemanticSearchAdapter
  ) {}

  async rebuildApp(appId: string): Promise<{ appId: string; uiElements: number; workflows: number; indexedRecords: number }> {
    const uiElements = this.repositories.listUiElementsForApp(appId);
    const workflows = this.repositories.listFullWorkflows(appId, "published");
    const records = [
      ...uiElements.map(uiElementToSemanticRecord),
      ...workflows.map(workflowToSemanticRecord)
    ];

    const existingIds = await this.semanticSearch.listIdsByFilter({ appId });
    const nextIds = new Set(records.map((record) => record.id));
    await this.semanticSearch.upsertMany(records);
    await this.semanticSearch.deleteByIds(existingIds.filter((id) => !nextIds.has(id)));

    return {
      appId,
      uiElements: uiElements.length,
      workflows: workflows.length,
      indexedRecords: records.length
    };
  }
}
