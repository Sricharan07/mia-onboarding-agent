import type { SemanticRecord, UIElementRecord, Workflow } from "../../schemas/domain.js";

export function uiElementToSemanticRecord(record: UIElementRecord): SemanticRecord {
  return {
    id: record.id,
    kind: "ui_element",
    appId: record.appId,
    searchableText: [
      `Page: ${record.pageName}`,
      `Route: ${record.route}`,
      `State: ${record.stateName}`,
      `Element type: ${record.elementType}`,
      `Label: ${record.label ?? ""}`,
      `Description: ${record.description}`,
      `Tags: ${record.tags.join(", ")}`
    ].join("\n"),
    metadata: {
      kind: "ui_element",
      appId: record.appId,
      elementId: record.elementId,
      route: record.route,
      pageName: record.pageName,
      stateName: record.stateName,
      discoveredBy: record.discoveredBy,
      elementType: record.elementType,
      selectorQuality: record.selectorQuality
    }
  };
}

export function workflowToSemanticRecord(workflow: Workflow): SemanticRecord {
  return {
    id: `workflow_${workflow.workflowId}`,
    kind: "workflow",
    appId: workflow.appId,
    searchableText: [
      `Workflow: ${workflow.name}`,
      `Description: ${workflow.description}`,
      `Trigger phrases: ${workflow.triggerPhrases.join(", ")}`,
      `Steps: ${workflow.steps.map((step) => step.label ?? step.type).join(", ")}`
    ].join("\n"),
    metadata: {
      kind: "workflow",
      appId: workflow.appId,
      workflowId: workflow.workflowId,
      name: workflow.name,
      status: workflow.status,
      triggerPhrases: workflow.triggerPhrases,
      routes: workflow.requiredContext.startingRoutes
    }
  };
}
