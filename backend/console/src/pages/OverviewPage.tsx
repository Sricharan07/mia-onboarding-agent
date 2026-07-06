import { ArrowRight, CheckCircle2, Code2, Database, FileVideo, KeyRound, Layers3, Plus, Radar, ShieldCheck, Workflow as WorkflowIcon } from "lucide-react";
import { useMemo } from "react";
import type { ApiKeyRecord, AppRecord, BackendHealth, ExecutionLog, SystemReadiness, UiElement, UiMapVersion, UiPage, WorkflowJob, WorkflowSummary } from "../api";
import { Panel, ServiceRow, StatusBadge, StatusPill } from "../components/console";
import type { RouteId, StatusTone } from "../types";
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

  const activation = buildActivationSteps({ app, readiness, latestUiMap, pages, apiKeys, logs, workflows, onOpenRoute });
  const launchState = buildLaunchState(activation.steps);
  const nextAction = activation.steps.find((step) => !step.done);
  const blockers = activation.steps.filter((step) => !step.done);
  const completedCount = activation.steps.length - blockers.length;
  const runtimeEvents = logs.filter((log) => isRuntimeEvent(log.eventType)).slice(0, 4);
  const publishedWorkflows = statusCounts.published ?? 0;
  const needsReview = statusCounts.needs_review ?? 0;

  return (
    <div className="operator-page">
      <section className="launch-header">
        <div className="launch-title-block">
          <StatusPill tone={launchState.tone} label={launchState.label} />
          <h2>{launchState.title}</h2>
          <p>{launchState.detail}</p>
        </div>
        <div className="launch-progress-card">
          <span>Launch progress</span>
          <strong>{completedCount}/{activation.steps.length}</strong>
          <p>{blockers.length ? `${blockers.length} item(s) still block a confident launch.` : "All launch gates have evidence."}</p>
          <div className="launch-progress-track" aria-hidden="true">
            <div style={{ width: `${Math.round((completedCount / activation.steps.length) * 100)}%` }} />
          </div>
        </div>
      </section>

      <section className="launch-workbench">
        <div className="launch-primary">
          <section className={`fix-now-panel ${nextAction ? launchState.tone : "green"}`}>
            <div className="fix-now-copy">
              <span>{nextAction ? "Fix this next" : "Launch desk"}</span>
              <h3>{nextAction?.title ?? "Mia is ready for monitored use"}</h3>
              <p>{nextAction?.detail ?? "The remaining work is operational monitoring, not launch blocking setup."}</p>
            </div>
            <button className="button primary" type="button" onClick={nextAction?.action ?? (() => onOpenRoute("logs"))}>
              {nextAction?.actionLabel ?? "Open runtime logs"}
              <ArrowRight size={15} />
            </button>
          </section>

          <section className="launch-path">
            <div className="launch-section-header">
              <div>
                <h3>Launch path</h3>
                <p>Work top to bottom. Each row needs evidence before users should rely on Mia.</p>
              </div>
              <StatusPill tone={blockers.length ? "yellow" : "green"} label={blockers.length ? `${blockers.length} open` : "clear"} />
            </div>
            <div className="launch-path-list">
              {activation.steps.map((step) => (
                <LaunchPathRow key={step.id} step={step} active={step.id === nextAction?.id} />
              ))}
            </div>
          </section>

          <section className="launch-queues">
            <div className="queue-panel">
              <div className="launch-section-header compact">
                <h3>Workflow queue</h3>
                <StatusPill tone={app.uiScanConfig.runtimeMode === "qa_only" || publishedWorkflows > 0 ? "green" : "yellow"} label={app.uiScanConfig.runtimeMode === "qa_only" ? "Q&A only" : `${publishedWorkflows} published`} />
              </div>
              <div className="job-list">
                {jobs.length === 0 && workflows.length === 0 && <div className="empty-state">No recordings or workflows yet. Upload a walkthrough if this app should guide tasks, or mark the app Q&A-only in App setup.</div>}
                {jobs.slice(0, 3).map((job) => (
                  <button className="job-row" key={job.id} type="button" onClick={() => job.workflowId && onReview(job.workflowId)}>
                    <span className="job-icon"><FileVideo size={16} /></span>
                    <span className="job-main">
                      <strong>{job.filename}</strong>
                      <span>{formatDate(job.createdAt)}</span>
                    </span>
                    <StatusBadge status={job.status} />
                  </button>
                ))}
                {jobs.length === 0 && workflows.slice(0, 3).map((workflow) => (
                  <button className="job-row" key={workflow.workflowId} type="button" onClick={() => onReview(workflow.workflowId)}>
                    <span className="job-icon"><WorkflowIcon size={16} /></span>
                    <span className="job-main">
                      <strong>{workflow.name}</strong>
                      <span>{workflow.description}</span>
                    </span>
                    <StatusBadge status={workflow.status} />
                  </button>
                ))}
              </div>
            </div>
          </section>
        </div>

        <aside className="launch-rail" aria-label="Launch evidence">
          <section className="rail-panel">
            <div className="launch-section-header compact">
              <h3>App evidence</h3>
            </div>
            <EvidenceCell label="Customer app" value={app.name} detail={app.baseUrl} tone="green" />
            <EvidenceCell label="UI map" value={latestUiMap?.version ?? "No map"} detail={`${pages.length} pages, ${elements.length} elements`} tone={latestUiMap?.status === "completed" ? "green" : "yellow"} />
            <EvidenceCell label="Runtime" value={runtimeEvents.length ? "Seen" : "Not seen"} detail={runtimeEvents[0] ? `${runtimeEventLabel(runtimeEvents[0].eventType)} at ${formatDate(runtimeEvents[0].createdAt)}` : "No SDK session has reached logs"} tone={runtimeEvents.length ? "green" : "yellow"} />
          </section>

          <section className="rail-panel">
            <div className="launch-section-header compact">
              <h3>Provider readiness</h3>
            </div>
            <div className="service-grid">
              <ServiceRow label="Database" value={readinessLabel(readiness?.database.status)} />
              <ServiceRow label="Secret storage" value={readinessLabel(readiness?.secrets.status)} />
              <ServiceRow label="Gemini" value={readinessLabel(readiness?.providers.gemini.status)} />
              <ServiceRow label="Semantic search" value={readinessLabel(readiness?.providers.semanticSearch.status)} />
            </div>
          </section>

          <section className="rail-panel">
            <div className="launch-section-header compact">
              <h3>Runtime activity</h3>
            </div>
            <div className="runtime-evidence-list">
              {runtimeEvents.length === 0 && (
                <div className="empty-state">No SDK runtime events yet.</div>
              )}
              {runtimeEvents.map((log) => (
                <div className="runtime-evidence-row" key={log.id}>
                  <span>{runtimeEventLabel(log.eventType)}</span>
                  <strong>{formatDate(log.createdAt)}</strong>
                </div>
              ))}
            </div>
          </section>
        </aside>
      </section>
    </div>
  );
}

type ActivationStep = ReturnType<typeof buildActivationSteps>["steps"][number];

function LaunchPathRow({ step, active }: { step: ActivationStep; active: boolean }) {
  const Icon = step.done ? CheckCircle2 : step.icon;
  return (
    <div className={`launch-path-row ${step.done ? "is-done" : ""} ${active ? "is-active" : ""}`}>
      <span className="launch-path-icon"><Icon size={15} /></span>
      <span className="launch-path-copy">
        <strong>{step.title}</strong>
        <span>{step.detail}</span>
      </span>
      <button className="button secondary small" type="button" onClick={step.action}>
        {step.actionLabel}
      </button>
    </div>
  );
}

function EvidenceCell({ label, value, detail, tone }: { label: string; value: string; detail: string; tone: StatusTone }) {
  return (
    <div className="evidence-cell">
      <span>{label}</span>
      <strong>{value}</strong>
      <p>{detail}</p>
      <StatusPill tone={tone} label={tone === "green" ? "ready" : tone === "red" ? "blocked" : "check"} />
    </div>
  );
}

function buildLaunchState(steps: ActivationStep[]): { tone: StatusTone; label: string; title: string; detail: string } {
  const open = steps.filter((step) => !step.done);
  if (open.length === 0) {
    return {
      tone: "green",
      label: "Ready for users",
      title: "Mia is ready to put in front of customers.",
      detail: "The backend is verified, the app is mapped, the SDK has reported in, and runtime behavior has evidence."
    };
  }
  const hasProviderBlocker = open.some((step) => step.id === "providers" || step.id === "sdk-key" || step.id === "runtime");
  if (hasProviderBlocker) {
    return {
      tone: "red",
      label: "Not user ready",
      title: "Do not ship Mia to users yet.",
      detail: "Provider readiness is not fully verified. Validate Gemini, semantic search, database, and secret storage before trusting user-facing behavior."
    };
  }
  return {
    tone: "yellow",
    label: "Admin testing",
    title: "Mia is close, but still needs operator review.",
    detail: "The backend path is connected. Prove pointing/action behavior and workflow mode before calling the product ready."
  };
}

function buildActivationSteps({
  app,
  readiness,
  latestUiMap,
  pages,
  apiKeys,
  logs,
  workflows,
  onOpenRoute
}: {
  app: AppRecord;
  readiness: SystemReadiness | null;
  latestUiMap: UiMapVersion | null;
  pages: UiPage[];
  apiKeys: ApiKeyRecord[];
  logs: ExecutionLog[];
  workflows: WorkflowSummary[];
  onOpenRoute: (route: RouteId) => void;
}) {
  const providersReady = readiness?.database.status === "ok"
    && readiness?.secrets.status === "ok"
    && readiness?.providers.gemini.status === "ok"
    && readiness?.providers.semanticSearch.status === "ok";
  const scanProfileReady = app.uiScanConfig.routes.length > 0
    && (app.uiScanConfig.authMode !== "login_form" || app.uiScanConfig.passwordConfigured);
  const mapReady = latestUiMap?.status === "completed" && pages.length > 0;
  const sdkKeyReady = apiKeys.some((key) => !key.revokedAt
    && key.appId === app.id
    && key.scopes.includes("runtime:write")
    && key.scopes.includes("logs:write"));
  const runtimeSeen = logs.some((log) => log.eventType === "session_started" || log.eventType.startsWith("workflow_") || log.eventType.startsWith("sdk_"));
  const miaResolved = logs.some((log) => log.eventType === "runtime_resolution" || log.eventType === "voice_resolution");
  const miaPointedOrActed = logs.some((log) => {
    if (log.eventType === "element_action_completed") return true;
    if (log.eventType !== "runtime_resolution" && log.eventType !== "voice_resolution") return false;
    const payload = log.payload as { target?: unknown };
    return Boolean(payload.target);
  });
  const workflowReady = app.uiScanConfig.runtimeMode === "qa_only" || workflows.some((workflow) => workflow.status === "published");
  const steps = [
    {
      id: "providers",
      title: "Backend providers",
      detail: providersReady ? "Required providers are configured and verified." : "Verify Gemini, semantic search, database, and secret storage before calling the app ready.",
      done: Boolean(providersReady),
      icon: ShieldCheck,
      actionLabel: providersReady ? "View backend" : "Open backend",
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
      actionLabel: scanProfileReady ? "Review scan" : "Edit scan",
      action: () => onOpenRoute("settings")
    },
    {
      id: "ui-map",
      title: "UI map",
      detail: mapReady ? `${pages.length} page(s) mapped.` : "Run a preflight and scan to map the app UI.",
      done: mapReady,
      icon: Layers3,
      actionLabel: mapReady ? "Review map" : "Open UI map",
      action: () => onOpenRoute("ui-map")
    },
    {
      id: "sdk-key",
      title: "SDK key",
      detail: sdkKeyReady ? "A runtime/logging key exists for this app." : "Create an app-bound key with runtime and log scopes.",
      done: sdkKeyReady,
      icon: KeyRound,
      actionLabel: sdkKeyReady ? "View keys" : "Create key",
      action: () => onOpenRoute("api-keys")
    },
    {
      id: "runtime",
      title: "SDK installed",
      detail: runtimeSeen ? "Runtime events have reached the backend." : "Install the SDK and verify that session events appear.",
      done: runtimeSeen,
      icon: Code2,
      actionLabel: runtimeSeen ? "Inspect logs" : "View logs",
      action: () => onOpenRoute("logs")
    },
    {
      id: "mia-test",
      title: "Mia answered and pointed",
      detail: miaResolved && miaPointedOrActed ? "Mia resolved a prompt with a target." : "Run a Test Mia prompt and confirm she can answer or point at a real element.",
      done: miaResolved && miaPointedOrActed,
      icon: CheckCircle2,
      actionLabel: miaResolved && miaPointedOrActed ? "Retest Mia" : "Test Mia",
      action: () => onOpenRoute("test-mia")
    },
    {
      id: "workflow-mode",
      title: "Runtime mode",
      detail: app.uiScanConfig.runtimeMode === "qa_only"
        ? "This app is intentionally Q&A and pointing only."
        : workflowReady
          ? "At least one reviewed workflow is published."
          : "Publish a reviewed workflow before claiming guided workflow readiness.",
      done: workflowReady,
      icon: WorkflowIcon,
      actionLabel: workflowReady ? "Review mode" : "Set mode",
      action: () => onOpenRoute(workflowReady ? "workflow-review" : "settings")
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

function isRuntimeEvent(eventType: string): boolean {
  return eventType === "session_started"
    || eventType === "runtime_resolution"
    || eventType === "voice_resolution"
    || eventType === "element_action_completed"
    || eventType.startsWith("voice_")
    || eventType.startsWith("workflow_");
}

function runtimeEventLabel(eventType: string): string {
  if (eventType === "session_started") return "SDK session started";
  if (eventType === "runtime_resolution") return "Text prompt resolved";
  if (eventType === "voice_resolution") return "Voice prompt resolved";
  if (eventType === "element_action_completed") return "Element action completed";
  if (eventType.startsWith("voice_")) return eventType.replace("voice_", "Voice ").replaceAll("_", " ");
  if (eventType.startsWith("workflow_")) return eventType.replace("workflow_", "Workflow ").replaceAll("_", " ");
  return eventType.replaceAll("_", " ");
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
