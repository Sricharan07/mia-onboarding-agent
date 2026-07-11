import { ChevronRight, CircleCheck, CircleDashed, ExternalLink } from "lucide-react";
import type { ReactNode } from "react";
import { Button, StatusBadge } from "./ui";
import type { RouteId, SetupCheck } from "../types";
import { formatDateTime } from "../utils/format";

export function Checklist({ checks, onNavigate }: { checks: SetupCheck[]; onNavigate?: (route: RouteId) => void }) {
  return (
    <ol className="checklist">
      {checks.map((check) => {
        const route = routeForCheck(check.id);
        return (
          <li key={check.id} data-complete={check.complete}>
            {check.complete ? <CircleCheck aria-hidden="true" /> : <CircleDashed aria-hidden="true" />}
            <span>{check.label}</span>
            {!check.complete && route && onNavigate ? <Button variant="quiet" size="sm" onClick={() => onNavigate(route)}>Open <ChevronRight /></Button> : null}
          </li>
        );
      })}
    </ol>
  );
}

export function RunTable({ runs, selectedId, onSelect }: {
  runs: Array<{ id: string; goal: string; status: string; userId: string; currentRoute: string | null; stepCount: number; updatedAt: string }>;
  selectedId?: string;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="table-scroll">
      <table className="data-table">
        <thead><tr><th>Run</th><th>Status</th><th>Route</th><th>Steps</th><th>Updated</th></tr></thead>
        <tbody>
          {runs.map((run) => (
            <tr key={run.id} data-selected={selectedId === run.id} onClick={() => onSelect(run.id)}>
              <td><button className="table-primary" type="button" onClick={() => onSelect(run.id)}><strong>{run.goal || "New session"}</strong><span>{run.userId}</span></button></td>
              <td><StatusBadge value={run.status} /></td>
              <td><code>{run.currentRoute ?? "-"}</code></td>
              <td>{run.stepCount}</td>
              <td>{formatDateTime(run.updatedAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function ProductLink({ origin, path = "", children }: { origin: string; path?: string; children?: ReactNode }) {
  const href = `${origin.replace(/\/$/, "")}${path.startsWith("/") ? path : path ? `/${path}` : ""}`;
  return <a className="button button-secondary button-md" href={href} target="_blank" rel="noreferrer">{children ?? "Open product"}<ExternalLink /></a>;
}

function routeForCheck(id: string): RouteId | undefined {
  if (id === "gemini" || id === "runtime_key") return "settings";
  if (id === "knowledge" || id === "ui_map") return "knowledge";
  if (id === "sdk" || id === "validation") return "test";
  if (id === "actions") return "actions";
  return undefined;
}
