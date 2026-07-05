import type { SemanticSearchAdapter } from "../../adapters/interfaces.js";
import type { Repositories } from "../../db/repositories.js";
import { uiElementToSemanticRecord } from "./semanticRecords.js";

export async function syncLatestUiElementSemanticIndex(
  repositories: Repositories,
  semanticSearch: SemanticSearchAdapter,
  appId: string
): Promise<number> {
  const records = repositories.listUiElementsForApp(appId).map(uiElementToSemanticRecord);
  const existingIds = await semanticSearch.listIdsByFilter({ appId, kind: "ui_element" });
  const nextIds = new Set(records.map((record) => record.id));
  await semanticSearch.upsertMany(records);
  await semanticSearch.deleteByIds(existingIds.filter((id) => !nextIds.has(id)));
  return records.length;
}
