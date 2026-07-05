import { CheckCircle2, Code2, Database, FileVideo, KeyRound, Layers3, Plus, Radar, ShieldCheck, Workflow as WorkflowIcon } from "lucide-react";
import { useMemo } from "react";
import type { ApiKeyRecord, AppRecord, BackendHealth, ExecutionLog, SystemReadiness, UiElement, UiMapVersion, UiPage, WorkflowJob, WorkflowSummary } from "../api";
import { Badge, LogTable, MetricCard, Panel, ServiceRow, StatusBadge } from "../components/console";
import type { RouteId } from "../types";
import { formatDate } from "../utils/format";

export function OverviewPage({
  app,
  health,
  readiness,
  apiKeys,
  pages,
  elements,
  workflows,
  jobs,
  logs,
  latestUiMap,
  onReview,
  onOpenRoute
}: {
  app: AppRecord | null;
  health: BackendHealth | null;
  readiness: SystemReadiness | null;
  apiKeys: ApiKeyRecord[];
  pages: UiPage[];
  elements: UiElement[];
  workflows: WorkflowSummary[];
  jobs: WorkflowJob[];
  logs: ExecutionLog[];
  latestUiMap: UiMapVersion | null;
  onReview: (workflowId: string) => void;
  onOpenRoute: (route: RouteId) => void;
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
    return <EmptySetup onOpenSettings={() => onOpenRoute("settings")} />;
  }

  const activation = buildActivationSteps({ app, readiness, latestUiMap, pages, apiKeys, logs, onOpenRoute });

  return (
    <div className="dashboard-page">
      <Panel title="Activation checklist" action={<StatusBadge status={activation.complete ? "completed" : "needs_review"} />}>
        <div className="activation-list">
          {activation.steps.map((step) => (
            <div className={`activation-row ${step.done ? "is-done" : ""}`} key={step.id}>
              <span className="activation-icon">{step.done ? <CheckCircle2 size={16} /> : <step.icon size={16} />}</span>
              <span className="activation-copy">
                <strong>{step.title}</strong>
                <span>{step.detail}</span>
              </span>
              <button className="button secondary small" type="button" onClick={step.action}>
                {step.actionLabel}
              </button>
            </div>
          ))}
        </div>
      </Panel>

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
            <ServiceRow label="Secret storage" value={readinessLabel(readiness?.secrets.status)} />
            <ServiceRow label="Gemini" value={readinessLabel(readiness?.providers.gemini.status)} />
            <ServiceRow label="Semantic search" value={readinessLabel(readiness?.providers.semanticSearch.status)} />
          </div>
        </Panel>
      </section>
    </div>
  );
}

function buildActivationSteps({
  app,
  readiness,
  latestUiMap,
  pages,
  apiKeys,
  logs,
  onOpenRoute
}: {
  app: AppRecord;
  readiness: SystemReadiness | null;
  latestUiMap: UiMapVersion | null;
  pages: UiPage[];
  apiKeys: ApiKeyRecord[];
  logs: ExecutionLog[];
  onOpenRoute: (route: RouteId) => void;
}) {
  const providersReady = readiness?.database.status === "ok"
    && readiness?.secrets.status === "ok"
    && readiness?.providers.gemini.status !== "missing_config"
    && readiness?.providers.semanticSearch.status !== "missing_config";
  const scanProfileReady = app.uiScanConfig.routes.length > 0
    && (app.uiScanConfig.authMode !== "login_form" || app.uiScanConfig.passwordConfigured);
  const mapReady = latestUiMap?.status === "completed" && pages.length > 0;
  const sdkKeyReady = apiKeys.some((key) => !key.revokedAt
    && key.appId === app.id
    && key.scopes.includes("runtime:write")
    && key.scopes.includes("logs:write"));
  const runtimeSeen = logs.some((log) => log.eventType === "session_started" || log.eventType.startsWith("workflow_") || log.eventType.startsWith("sdk_"));
  const steps = [
    {
      id: "providers",
      title: "Backend providers",
      detail: providersReady ? "Required providers are configured." : "Configure Gemini, OpenAI embeddings, LanceDB storage, and secret storage.",
      done: Boolean(providersReady),
      icon: ShieldCheck,
      actionLabel: "Open backend",
      action: () => onOpenRoute("settings")
    },
    {
      id: "app",
      title: "Customer app",
      detail: `${app.name} points to ${app.baseUrl}.`,
      done: true,
      icon: Database,
      actionLabel: "Edit app",
      action: () => onOpenRoute("settings")
    },
    {
      id: "scan-profile",
      title: "Scan profile",
      detail: scanProfileReady ? "Routes and auth mode are ready for scanning." : "Add routes and complete auth credentials/selectors.",
      done: scanProfileReady,
      icon: Radar,
      actionLabel: "Edit scan",
      action: () => onOpenRoute("settings")
    },
    {
      id: "ui-map",
      title: "UI map",
      detail: mapReady ? `${pages.length} page(s) mapped.` : "Run a preflight and scan to map the app UI.",
      done: mapReady,
      icon: Layers3,
      actionLabel: "Open UI map",
      action: () => onOpenRoute("ui-map")
    },
    {
      id: "sdk-key",
      title: "SDK key",
      detail: sdkKeyReady ? "A runtime/logging key exists for this app." : "Create an app-bound key with runtime and log scopes.",
      done: sdkKeyReady,
      icon: KeyRound,
      actionLabel: "Create key",
      action: () => onOpenRoute("api-keys")
    },
    {
      id: "runtime",
      title: "Runtime verification",
      detail: runtimeSeen ? "Runtime events have reached the backend." : "Install the SDK and verify that runtime events appear.",
      done: runtimeSeen,
      icon: Code2,
      actionLabel: "View logs",
      action: () => onOpenRoute("logs")
    }
  ];
  return {
    complete: steps.every((step) => step.done),
    steps
  };
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
