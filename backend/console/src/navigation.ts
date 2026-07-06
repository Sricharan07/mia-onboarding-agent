import {
  BarChart3,
  FileVideo,
  Home,
  KeyRound,
  Layers3,
  ListChecks,
  Loader2,
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
      { id: "overview", label: "Launch desk", icon: Home },
      { id: "settings", label: "App setup", icon: Settings }
    ]
  },
  {
    title: "UI Mapping",
    items: [
      { id: "ui-map", label: "Map UI", icon: Layers3 },
      { id: "upload", label: "Upload recording", icon: FileVideo }
    ]
  },
  {
    title: "Workflows",
    items: [
      { id: "workflow-jobs", label: "Processing queue", icon: Loader2 },
      { id: "workflow-review", label: "Review workflow", icon: ListChecks },
      { id: "workflows", label: "Published flows", icon: WorkflowIcon }
    ]
  },
  {
    title: "Runtime",
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
    overview: "Launch desk",
    settings: "App setup",
    "ui-map": "UI mapping",
    "ui-map-detail": "UI map page detail",
    upload: "Upload recording",
    "workflow-jobs": "Processing queue",
    "workflow-review": "Workflow review",
    workflows: "Published flows",
    "test-mia": "Test Mia",
    logs: "Runtime logs",
    usage: "Usage",
    "api-keys": "API keys"
  };
  return titles[route];
}
