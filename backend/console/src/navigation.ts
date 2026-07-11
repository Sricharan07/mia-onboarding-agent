import {
  Activity,
  BookOpenText,
  Bot,
  Gauge,
  ListChecks,
  Settings,
  ShieldCheck,
  Sparkles,
  type LucideIcon
} from "lucide-react";
import type { RouteId } from "./types";

export type NavItem = { id: RouteId; label: string; description: string; icon: LucideIcon };

export const navItems: NavItem[] = [
  { id: "setup", label: "Setup", description: "Deployment readiness", icon: ListChecks },
  { id: "overview", label: "Overview", description: "Health and activity", icon: Gauge },
  { id: "knowledge", label: "Knowledge", description: "Docs and UI maps", icon: BookOpenText },
  { id: "skills", label: "Skills", description: "Reviewed behavior", icon: Sparkles },
  { id: "actions", label: "Actions & Safety", description: "Effective permissions", icon: ShieldCheck },
  { id: "test", label: "Test Mia", description: "Live validation", icon: Bot },
  { id: "runs", label: "Runs", description: "Agent diagnostics", icon: Activity },
  { id: "settings", label: "Settings", description: "Product and security", icon: Settings }
];

export const routePath: Record<RouteId, string> = {
  setup: "/setup",
  overview: "/overview",
  knowledge: "/knowledge",
  skills: "/skills",
  actions: "/actions",
  test: "/test-mia",
  runs: "/runs",
  settings: "/settings"
};

export function routeFromPath(pathname: string): RouteId {
  const match = (Object.entries(routePath) as Array<[RouteId, string]>).find(([, path]) => pathname === path || pathname.startsWith(`${path}/`));
  return match?.[0] ?? "overview";
}

export function routeMeta(route: RouteId): NavItem {
  return navItems.find((item) => item.id === route) ?? navItems[1]!;
}
