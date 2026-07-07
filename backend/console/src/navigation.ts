import {
  BarChart3,
  Home,
  KeyRound,
  Layers3,
  MessageSquareText,
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
    title: "Build",
    items: [
      { id: "ui-map", label: "UI map", icon: Layers3 },
      { id: "workflows", label: "Workflows", icon: WorkflowIcon }
    ]
  },
  {
    title: "Operate",
    items: [
      { id: "test-mia", label: "Test Mia", icon: MessageSquareText },
      { id: "logs", label: "Runtime logs", icon: TerminalSquare },
      { id: "usage", label: "Usage", icon: BarChart3 },
      { id: "api-keys", label: "API keys", icon: KeyRound }
    ]
  }
];

export function routeTitle(route: RouteId) {
  const titles: Record<RouteId, string> = {
    overview: "Overview",
    settings: "Settings",
    "ui-map": "UI map",
    "ui-map-detail": "UI map page detail",
    upload: "Upload recording",
    "workflow-review": "Workflow review",
    workflows: "Workflows",
    "test-mia": "Test Mia",
    logs: "Runtime logs",
    usage: "Usage",
    "api-keys": "API keys"
  };
  return titles[route];
}

/** Nav item to highlight for detail routes that are not in the sidebar. */
export function navRouteFor(route: RouteId): RouteId {
  if (route === "ui-map-detail") return "ui-map";
  if (route === "upload" || route === "workflow-review") return "workflows";
  return route;
}
