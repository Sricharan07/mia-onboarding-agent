import type { WorkflowStep } from "../api";

export function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

export function summarizePayload(payload: unknown): string {
  const text = JSON.stringify(payload);
  if (!text) return "";
  return text.length > 90 ? `${text.slice(0, 90)}...` : text;
}

export function describeStep(step: WorkflowStep): string {
  if (step.type === "navigate") return `Navigate to ${step.route}`;
  if (step.type === "ask_user") return `${step.prompt} -> ${step.field}`;
  if (step.type === "confirm") return step.message;
  if (step.type === "complete") return step.message;
  if (step.type === "wait_for_element") return `Wait ${step.timeoutMs}ms for ${step.target.elementId}`;
  if (step.type === "fill" || step.type === "select") return `${step.type} ${step.target.elementId} from ${step.valueFrom}`;
  return `${step.type} ${step.target.elementId}`;
}
