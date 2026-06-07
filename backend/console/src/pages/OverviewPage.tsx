import { Database, FileVideo, Layers3, Plus, ShieldCheck, Workflow as WorkflowIcon } from "lucide-react";
import { useMemo } from "react";
import type { AppRecord, BackendHealth, ExecutionLog, SystemReadiness, UiElement, UiMapVersion, UiPage, WorkflowJob, WorkflowSummary } from "../api";
import { Badge, LogTable, MetricCard, Panel, ServiceRow, StatusBadge } from "../components/console";
import { formatDate } from "../utils/format";

export function OverviewPage({
  app,
  health,
  readiness,
  pages,
  elements,
  workflows,
  jobs,
  logs,
  latestUiMap,
  onReview,
  onOpenSettings
}: {
  app: AppRecord | null;
  health: BackendHealth | null;
  readiness: SystemReadiness | null;
  pages: UiPage[];
  elements: UiElement[];
  workflows: WorkflowSummary[];
  jobs: WorkflowJob[];
  logs: ExecutionLog[];
  latestUiMap: UiMapVersion | null;
  onReview: (workflowId: string) => void;
  onOpenSettings: () => void;
}) {
  const statusCounts = useMemo(
    () =>
      workflows.reduce<Record<string, number>>((counts, workflow) => {
        counts[workflow.status] = (counts[workflow.status] ?? 0) + 1;
        return counts;
      }, {}),
    [workflows]
  );

  if (!app) {
    return <EmptySetup onOpenSettings={onOpenSettings} />;
  }

  return (
    <div className="dashboard-page">
      <section className="dashboard-section">
        <div className="section-heading">
          <h2>Console Overview</h2>
          <p>Real backend state for UI maps, workflow jobs, workflow review, and runtime logs.</p>
        </div>
        <div className="metric-grid">
          <MetricCard
            label="App"
            value={app.name}
            detail={app.slug}
            icon={Database}
            badge={<Badge tone="green">configured</Badge>}
            footer={app.baseUrl}
          />
          <MetricCard
            label="UI map"
            value={latestUiMap?.version ?? "None"}
            detail={`${pages.length} pages scanned`}
            icon={Layers3}
            badge={<Badge tone={latestUiMap?.status === "completed" ? "green" : "yellow"}>{latestUiMap?.status ?? "not scanned"}</Badge>}
            footer={`${elements.length} selectors loaded`}
          />
          <MetricCard
            label="Workflows"
            value={workflows.length.toString()}
            detail={`${statusCounts.published ?? 0} published`}
            icon={WorkflowIcon}
            badge={<Badge tone={(statusCounts.needs_review ?? 0) > 0 ? "yellow" : "green"}>{statusCounts.needs_review ?? 0} to review</Badge>}
            footer={`${jobs.length} video processing jobs`}
          />
          <MetricCard
            label="Runtime health"
            value={health?.ok ? "Healthy" : "Offline"}
            detail={health?.service ?? "Backend unavailable"}
            icon={ShieldCheck}
            badge={<Badge tone={health?.ok ? "green" : "red"}>{health?.mode ?? "unknown"}</Badge>}
            footer={health?.time ?? "No health response"}
          />
        </div>
      </section>

      <section className="overview-grid">
        <Panel title="Workflows by status">
          <div className="workflow-status-list">
            {["draft", "needs_review", "approved", "published", "archived"].map((status) => (
              <div className="workflow-status-row" key={status}>
                <div className="workflow-status-meta">
                  <StatusBadge status={status} />
                  <span>{statusCounts[status] ?? 0} workflows</span>
                </div>
                <strong>{statusCounts[status] ?? 0}</strong>
              </div>
            ))}
          </div>
        </Panel>
        <Panel title="Recent workflow jobs">
          <div className="job-list">
            {jobs.length === 0 && <div className="empty-state">No workflow videos uploaded yet.</div>}
            {jobs.slice(0, 5).map((job) => (
              <button className="job-row" key={job.id} type="button" onClick={() => job.workflowId && onReview(job.workflowId)}>
                <span className="job-icon"><FileVideo size={16} /></span>
                <span className="job-main">
                  <strong>{job.filename}</strong>
                  <span><code>{job.id}</code> - {formatDate(job.createdAt)}</span>
                </span>
                <StatusBadge status={job.status} />
              </button>
            ))}
          </div>
        </Panel>
      </section>

      <section className="overview-grid overview-lower">
        <Panel title="Recent runtime logs">
          <LogTable logs={logs.slice(0, 5)} compact />
        </Panel>
        <Panel title="Backend-connected coverage">
          <div className="service-grid">
            <ServiceRow label="Apps" value="connected" />
            <ServiceRow label="UI map scan/pages/elements" value="connected" />
            <ServiceRow label="Workflow upload/jobs/review" value="connected" />
            <ServiceRow label="Usage/API keys" value="connected" />
          </div>
        </Panel>
        <Panel title="Provider readiness">
          <div className="service-grid">
            <ServiceRow label="Database" value={readinessLabel(readiness?.database.status)} />
            <ServiceRow label="Qwen" value={readinessLabel(readiness?.providers.qwen.status)} />
            <ServiceRow label="Moss" value={readinessLabel(readiness?.providers.moss.status)} />
            <ServiceRow label="LiveKit Voice Agent" value={readinessLabel(readiness?.providers.livekit.status)} />
          </div>
        </Panel>
      </section>
    </div>
  );
}

function readinessLabel(status?: string): string {
  if (status === "ok") return "connected";
  if (status === "unverified") return "configured";
  if (status === "missing_config") return "missing config";
  if (status === "error") return "error";
  return "unknown";
}

function EmptySetup({ onOpenSettings }: { onOpenSettings: () => void }) {
  return (
    <Panel title="Create an app to begin">
      <div className="empty-state">
        The backend is reachable, but no app records exist yet. Create an app record before scanning UI maps or uploading workflow videos.
      </div>
      <div className="panel-actions">
        <button className="button primary" type="button" onClick={onOpenSettings}>
          <Plus size={16} />
          Configure app
        </button>
      </div>
    </Panel>
  );
}
