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

    await this.semanticSearch.deleteByFilter({ appId });
    await this.semanticSearch.upsertMany(records);

    return {
      appId,
      uiElements: uiElements.length,
      workflows: workflows.length,
      indexedRecords: records.length
    };
  }
}
