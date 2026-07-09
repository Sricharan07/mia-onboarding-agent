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

export function errorMessage(cause: unknown, fallback: string): string {
  const raw = cause instanceof Error ? cause.message : "";
  if (!raw) return fallback;
  const lower = raw.toLowerCase();
  if (lower.includes("failed to fetch") || lower.includes("networkerror") || lower.includes("load failed") || lower.includes("fetch failed")) {
    return "Can't reach the backend. Check that it is running and that the backend URL in Settings is correct.";
  }
  if (lower.includes("401") || lower.includes("unauthorized") || lower.includes("invalid session") || lower.includes("session expired")) {
    return "Your session is no longer valid. Sign out and sign in again.";
  }
  if (lower.includes("403") || lower.includes("forbidden")) {
    return "You don't have permission to do that with this account or key.";
  }
  if (lower.includes("internal server") || /\b50[0-9]\b/.test(lower)) {
    return `The backend hit an internal error, check its logs. Details: ${raw}`;
  }
  return raw;
}

const statusLabels: Record<string, string> = {
  needs_review: "Needs review",
  requires_confirmation: "Asks user first",
  manual_only: "Manual only",
  auto: "Runs automatically",
  qa_only: "Q&A only",
  no_match: "No match"
};

export function humanizeStatus(status: string): string {
  return statusLabels[status] ?? capitalize(status.replaceAll("_", " "));
}

export function humanizeEventType(eventType: string): string {
  if (eventType === "session_started") return "SDK session started";
  if (eventType === "runtime_resolution") return "Text prompt resolved";
  if (eventType === "voice_resolution") return "Voice prompt resolved";
  if (eventType === "element_action_completed") return "Element action completed";
  return capitalize(eventType.replaceAll("_", " "));
}

function capitalize(value: string): string {
  return value ? value[0]!.toUpperCase() + value.slice(1) : value;
}

export function describeStep(step: WorkflowStep): string {
  if (step.type === "review_required") return step.message;
  if (step.type === "navigate") return `Navigate to ${step.route}`;
  if (step.type === "ask_user") return `${step.prompt} -> ${step.field}`;
  if (step.type === "confirm") return step.message;
  if (step.type === "complete") return step.message;
  if (step.type === "wait_for_element") return `Wait ${step.timeoutMs}ms for ${step.target.elementId}`;
  if (step.type === "fill" || step.type === "select") return `${step.type} ${step.target.elementId} from ${step.valueFrom}`;
  return `${step.type} ${step.target.elementId}`;
}
