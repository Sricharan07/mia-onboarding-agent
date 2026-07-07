export type RouteId =
  | "overview"
  | "settings"
  | "ui-map"
  | "ui-map-detail"
  | "upload"
  | "workflow-review"
  | "workflows"
  | "test-mia"
  | "logs"
  | "usage"
  | "api-keys";

export type LoadState = "idle" | "loading" | "ready" | "error";
export type StatusTone = "green" | "yellow" | "red" | "gray";
