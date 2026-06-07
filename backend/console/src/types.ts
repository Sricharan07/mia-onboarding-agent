export type RouteId =
  | "overview"
  | "settings"
  | "ui-map"
  | "ui-map-detail"
  | "upload"
  | "workflow-jobs"
  | "workflow-review"
  | "workflows"
  | "logs"
  | "usage"
  | "api-keys";

export type LoadState = "idle" | "loading" | "ready" | "error";
export type StatusTone = "green" | "yellow" | "red" | "gray";
