import { ArrowRight, CircleAlert, CircleCheck, Clock3 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { BackendApi } from "../api";
import { RunTable } from "../components/console";
import { Alert, Button, Loading, Metric, Section, StatusBadge } from "../components/ui";
import type { RouteId, RunSummary, SetupChecklist } from "../types";
import { errorMessage, formatNumber, formatRelative } from "../utils/format";

export function OverviewPage({ api, refreshNonce, onNavigate }: { api: BackendApi; refreshNonce: number; onNavigate: (route: RouteId) => void }) {
  const [checklist, setChecklist] = useState<SetupChecklist | null>(null);
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    try {
      const [nextChecklist, nextRuns] = await Promise.all([api.checklist(), api.runs()]);
      setChecklist(nextChecklist); setRuns(nextRuns.items); setError("");
    } catch (cause) { setError(errorMessage(cause)); }
  }, [api]);
  useEffect(() => { void load(); }, [load, refreshNonce]);
  const completionRate = checklist?.usage.sessions ? Math.round((checklist.usage.completed / checklist.usage.sessions) * 100) : 0;
  const pending = useMemo(() => checklist?.checks.filter((check) => !check.complete) ?? [], [checklist]);
  if (!checklist && !error) return <Loading label="Loading product health" />;
  return (
    <div className="page-stack">
      {error ? <Alert tone="danger">{error}</Alert> : null}
      {checklist ? (
        <>
          <div className="metrics-grid four">
            <Metric label="Agent runs" value={formatNumber(checklist.usage.sessions)} detail={`${formatNumber(checklist.usage.actions)} verified action receipts`} />
            <Metric label="Completion rate" value={`${completionRate}%`} detail={`${checklist.usage.completed} completed`} tone={completionRate >= 80 ? "good" : checklist.usage.sessions ? "warn" : "neutral"} />
            <Metric label="SDK activity" value={checklist.sdk.detected ? "Live" : "Waiting"} detail={checklist.sdk.detected ? formatRelative(checklist.sdk.lastSeenAt) : "No runtime event received"} tone={checklist.sdk.detected ? "good" : "warn"} />
            <Metric label="Safety review" value={checklist.actions.pending ? `${checklist.actions.pending} pending` : "Current"} detail={`${checklist.actions.published} published, ${checklist.actions.blocked} blocked`} tone={checklist.actions.pending ? "warn" : "good"} />
          </div>

          <div className="overview-grid">
            <Section title="Production status" description={checklist.product.origin}>
              <div className="health-list">
                <Health label="PostgreSQL" status="ready" detail="Connected and migrated" />
                <Health label="Gemini" status={checklist.gemini.configured ? "ready" : "missing"} detail={checklist.gemini.configured ? `Credential from ${checklist.gemini.source ?? "secure storage"}` : "Credential required"} />
                <Health label="Knowledge" status={checklist.knowledge.ready ? "ready" : "pending"} detail={`${checklist.knowledge.ready} ready source${checklist.knowledge.ready === 1 ? "" : "s"}`} />
                <Health label="UI map" status={checklist.scan?.status ?? "not_started"} detail={checklist.scan ? formatRelative(checklist.scan.completedAt ?? checklist.scan.createdAt) : "No production scan"} />
              </div>
            </Section>
            <Section title="Needs attention" description={pending.length ? "Finish these before release." : "No setup blockers."}>
              {pending.length ? <div className="attention-list">{pending.slice(0, 5).map((check) => <button key={check.id} type="button" onClick={() => onNavigate(routeForCheck(check.id))}><CircleAlert /><span>{check.label}</span><ArrowRight /></button>)}</div> : <div className="all-clear"><CircleCheck /><div><strong>Deployment checks passed</strong><p>Continue monitoring live runs and safety reviews.</p></div></div>}
            </Section>
          </div>

          <Section title="Recent runs" description="Latest user goals across text and voice." action={<Button variant="secondary" size="sm" onClick={() => onNavigate("runs")}>All runs <ArrowRight /></Button>}>
            {runs.length ? <RunTable runs={runs.slice(0, 8)} onSelect={() => onNavigate("runs")} /> : <div className="empty-inline"><Clock3 /><span>No agent runs yet.</span><Button variant="quiet" onClick={() => onNavigate("test")}>Open validation</Button></div>}
          </Section>
        </>
      ) : null}
    </div>
  );
}

function Health({ label, status, detail }: { label: string; status: string; detail: string }) {
  return <div><span>{label}</span><div><StatusBadge value={status} /><small>{detail}</small></div></div>;
}

function routeForCheck(id: string): RouteId {
  if (id === "gemini" || id === "runtime_key") return "settings";
  if (id === "knowledge" || id === "ui_map") return "knowledge";
  if (id === "actions") return "actions";
  return "test";
}
