import {
  BarChart3,
  FileVideo,
  Home,
  KeyRound,
  Layers3,
  ListChecks,
  Loader2,
  Settings,
  TerminalSquare,
  Workflow as WorkflowIcon,
  type LucideIcon
} from "lucide-react";
import type { RouteId } from "./types";

export const navGroups: Array<{
  title: string;
  items: Array<{ id: RouteId; label: string; icon: LucideIcon }>;
}> = [
  {
    title: "Console",
    items: [
      { id: "overview", label: "Overview", icon: Home },
      { id: "settings", label: "Settings", icon: Settings }
    ]
  },
  {
    title: "UI Mapping",
    items: [
      { id: "ui-map", label: "UI map", icon: Layers3 },
      { id: "upload", label: "Upload workflow", icon: FileVideo }
    ]
  },
  {
    title: "Workflows",
    items: [
      { id: "workflow-jobs", label: "Workflow jobs", icon: Loader2 },
      { id: "workflow-review", label: "Review workflow", icon: ListChecks },
      { id: "workflows", label: "Workflows", icon: WorkflowIcon }
    ]
  },
  {
    title: "Runtime",
    items: [
      { id: "logs", label: "Logs", icon: TerminalSquare },
      { id: "usage", label: "Usage", icon: BarChart3 },
      { id: "api-keys", label: "API keys", icon: KeyRound }
    ]
  }
];

export function routeTitle(route: RouteId) {
  const titles: Record<RouteId, string> = {
    overview: "Overview",
    settings: "Settings",
    "ui-map": "UI mapping",
    "ui-map-detail": "UI map page detail",
    upload: "Upload workflow",
    "workflow-jobs": "Workflow jobs",
    "workflow-review": "Workflow review",
    workflows: "Workflows",
    logs: "Logs",
    usage: "Usage",
    "api-keys": "API keys"
  };
  return titles[route];
}
