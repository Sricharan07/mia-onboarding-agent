import { Bell, Command, EllipsisVertical, LogOut, PanelLeft, RefreshCw } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  BackendApi,
  type AppRecord,
  type BackendHealth,
  type ExecutionLog,
  type SystemReadiness,
  type UiElement,
  type UiMapVersion,
  type UiPage,
  type Workflow,
  type WorkflowJob,
  type WorkflowSummary
} from "./api";
import { InlineAlert, StatusPill } from "./components/console";
import { navGroups, routeTitle } from "./navigation";
import { LoginPage } from "./pages/LoginPage";
import { LogsPage } from "./pages/LogsPage";
import { OverviewPage } from "./pages/OverviewPage";
import { SettingsPage } from "./pages/SettingsPage";
import { UiMapDetailPage, UiMapPage } from "./pages/UiMapPages";
import { ApiKeysPage } from "./pages/ApiKeysPage";
import { UsagePage } from "./pages/UsagePage";
import { UploadWorkflowPage, WorkflowJobsPage, WorkflowReviewPage, WorkflowsPage } from "./pages/WorkflowPages";
import type { LoadState, RouteId } from "./types";

const defaultBackendUrl = window.localStorage.getItem("mia-console-backend-url") ?? "http://localhost:4000";

function App() {
  const [authenticated, setAuthenticated] = useState(() => window.localStorage.getItem("mia-console-auth") === "true");
  const [activeRoute, setActiveRoute] = useState<RouteId>("overview");
  const [backendUrl, setBackendUrl] = useState(defaultBackendUrl);
  const [health, setHealth] = useState<BackendHealth | null>(null);
  const [readiness, setReadiness] = useState<SystemReadiness | null>(null);
  const [loadState, setLoadState] = useState<LoadState>("idle");
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const [apps, setApps] = useState<AppRecord[]>([]);
  const [selectedAppId, setSelectedAppId] = useState("");
  const [uiMapVersions, setUiMapVersions] = useState<UiMapVersion[]>([]);
  const [pages, setPages] = useState<UiPage[]>([]);
  const [elementsByPage, setElementsByPage] = useState<Record<string, UiElement[]>>({});
  const [selectedPageId, setSelectedPageId] = useState("");
  const [jobs, setJobs] = useState<WorkflowJob[]>([]);
  const [workflowSummaries, setWorkflowSummaries] = useState<WorkflowSummary[]>([]);
  const [selectedWorkflowId, setSelectedWorkflowId] = useState("");
  const [selectedWorkflow, setSelectedWorkflow] = useState<Workflow | null>(null);
  const [logs, setLogs] = useState<ExecutionLog[]>([]);

  const api = useMemo(() => new BackendApi(backendUrl), [backendUrl]);
  const selectedApp = apps.find((app) => app.id === selectedAppId) ?? null;
  const latestUiMap = uiMapVersions[0] ?? null;
  const selectedPage = pages.find((page) => page.id === selectedPageId) ?? pages[0] ?? null;
  const elements = Object.values(elementsByPage).flat();

  const showToast = (message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(""), 2600);
  };

  const reportError = (cause: unknown, fallback = "Request failed") => {
    const message = cause instanceof Error ? cause.message : fallback;
    setError(message);
    showToast(message);
  };

  const refresh = async (preferredAppId = selectedAppId) => {
    setLoadState("loading");
    setError("");
    try {
      const [nextHealth, nextReadiness, appResponse] = await Promise.all([api.health(), api.readiness(), api.listApps()]);
      setHealth(nextHealth);
      setReadiness(nextReadiness);
      setApps(appResponse.items);
      const nextAppId = preferredAppId || appResponse.items[0]?.id || "";
      setSelectedAppId(nextAppId);

      if (!nextAppId) {
        setUiMapVersions([]);
        setPages([]);
        setElementsByPage({});
        setJobs([]);
        setWorkflowSummaries([]);
        setSelectedWorkflow(null);
        setLogs([]);
        setLoadState("ready");
        return;
      }

      const [versionsResponse, jobsResponse, workflowResponse, logsResponse] = await Promise.all([
        api.listUiMapVersions(nextAppId),
        api.listWorkflowJobs(nextAppId),
        api.listWorkflows(nextAppId),
        api.listLogs({ appId: nextAppId })
      ]);

      setUiMapVersions(versionsResponse.items);
      setJobs(jobsResponse.items);
      setWorkflowSummaries(workflowResponse.items);
      setLogs(logsResponse.items);

      const latestVersion = versionsResponse.items[0];
      if (latestVersion) {
        const pageResponse = await api.listPages(latestVersion.id);
        setPages(pageResponse.items);
        setSelectedPageId((current) => current || pageResponse.items[0]?.id || "");
        const elementEntries = await Promise.all(
          pageResponse.items.map(async (page) => [page.id, (await api.listElements(page.id)).items] as const)
        );
        setElementsByPage(Object.fromEntries(elementEntries));
      } else {
        setPages([]);
        setElementsByPage({});
        setSelectedPageId("");
      }

      const nextWorkflowId = selectedWorkflowId || workflowResponse.items[0]?.workflowId || "";
      setSelectedWorkflowId(nextWorkflowId);
      if (nextWorkflowId) {
        setSelectedWorkflow(await api.getWorkflow(nextWorkflowId));
      } else {
        setSelectedWorkflow(null);
      }
      setLoadState("ready");
    } catch (cause) {
      setHealth(null);
      setReadiness(null);
      setLoadState("error");
      reportError(cause, "Unable to load backend console data.");
    }
  };

  useEffect(() => {
    if (authenticated) {
      void refresh();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authenticated, api]);

  const selectApp = async (appId: string) => {
    setSelectedAppId(appId);
    setSelectedWorkflowId("");
    await refresh(appId);
  };

  const selectWorkflow = async (workflowId: string) => {
    setSelectedWorkflowId(workflowId);
    try {
      setSelectedWorkflow(await api.getWorkflow(workflowId));
    } catch (cause) {
      reportError(cause, "Unable to load workflow.");
    }
  };

  const login = () => {
    window.localStorage.setItem("mia-console-auth", "true");
    setAuthenticated(true);
  };

  const logout = () => {
    window.localStorage.removeItem("mia-console-auth");
    setAuthenticated(false);
  };

  if (!authenticated) {
    return <LoginPage onLogin={login} />;
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <button className="brand-row" type="button" onClick={() => setActiveRoute("overview")}>
          <span className="brand-tile">
            <Command size={17} />
          </span>
          <div>
            <div className="brand-name">Mia Console</div>
            <div className="brand-subtitle">Backend connected</div>
          </div>
        </button>

        <nav className="sidebar-nav" aria-label="Console navigation">
          {navGroups.map((group) => (
            <div className="nav-group" key={group.title}>
              <div className="nav-title">{group.title}</div>
              {group.items.map((item) => (
                <button
                  className={`nav-item ${activeRoute === item.id ? "is-active" : ""}`}
                  key={item.id}
                  type="button"
                  onClick={() => setActiveRoute(item.id)}
                >
                  <item.icon size={16} />
                  <span>{item.label}</span>
                </button>
              ))}
            </div>
          ))}
        </nav>

        <div className="sidebar-footer">
          <div className="support-card">
            <div>Live backend mode</div>
            <p>Data shown here comes from `backend/src/routes`. Unsupported console ideas are marked as gaps.</p>
          </div>
          <button className="user-card" type="button" onClick={() => setActiveRoute("settings")}>
            <span className="avatar">LC</span>
            <span className="user-copy">
              <span>Local console</span>
              <span>{selectedApp?.slug ?? "no app selected"}</span>
            </span>
            <EllipsisVertical size={14} />
          </button>
        </div>
      </aside>

      <main className="main-shell">
        <header className="topbar">
          <div className="topbar-title">
            <button className="sidebar-trigger" type="button" aria-label="Sidebar">
              <PanelLeft size={16} />
            </button>
            <div className="breadcrumb">Console / {routeTitle(activeRoute)}</div>
            <h1>{routeTitle(activeRoute)}</h1>
          </div>
          <div className="topbar-actions">
            {selectedApp && (
              <select value={selectedApp.id} onChange={(event) => void selectApp(event.target.value)}>
                {apps.map((app) => (
                  <option value={app.id} key={app.id}>{app.name}</option>
                ))}
              </select>
            )}
            <StatusPill tone={health?.ok ? "green" : "red"} label={health?.ok ? "Backend healthy" : "Backend offline"} />
            <button className="button secondary" type="button" onClick={() => void refresh()}>
              <RefreshCw size={15} />
              Refresh
            </button>
            <button className="icon-button" type="button" aria-label="Notifications">
              <Bell size={15} />
            </button>
            <button className="button secondary" type="button" onClick={logout}>
              <LogOut size={15} />
              Sign out
            </button>
          </div>
        </header>

        {error && <InlineAlert tone="red" title="Backend error" message={error} />}
        {loadState === "loading" && <InlineAlert tone="gray" title="Loading" message="Fetching the latest backend data." />}

        {activeRoute === "overview" && (
          <OverviewPage
            app={selectedApp}
            health={health}
            readiness={readiness}
            pages={pages}
            elements={elements}
            workflows={workflowSummaries}
            jobs={jobs}
            logs={logs}
            latestUiMap={latestUiMap}
            onReview={(workflowId) => {
              void selectWorkflow(workflowId);
              setActiveRoute("workflow-review");
            }}
            onOpenSettings={() => setActiveRoute("settings")}
          />
        )}
        {activeRoute === "settings" && (
          <SettingsPage
            backendUrl={backendUrl}
            setBackendUrl={setBackendUrl}
            apps={apps}
            selectedApp={selectedApp}
            api={api}
            readiness={readiness}
            refresh={refresh}
            showToast={showToast}
          />
        )}
        {activeRoute === "ui-map" && (
          <UiMapPage
            app={selectedApp}
            pages={pages}
            elements={elements}
            latestUiMap={latestUiMap}
            api={api}
            refresh={refresh}
            onOpenPage={(pageId) => {
              setSelectedPageId(pageId);
              setActiveRoute("ui-map-detail");
            }}
            showToast={showToast}
          />
        )}
        {activeRoute === "ui-map-detail" && selectedPage && (
          <UiMapDetailPage
            page={selectedPage}
            elements={elementsByPage[selectedPage.id] ?? []}
            api={api}
            refresh={refresh}
            onBack={() => setActiveRoute("ui-map")}
            showToast={showToast}
          />
        )}
        {activeRoute === "upload" && (
          <UploadWorkflowPage app={selectedApp} api={api} refresh={refresh} showToast={showToast} onJobs={() => setActiveRoute("workflow-jobs")} />
        )}
        {activeRoute === "workflow-jobs" && (
          <WorkflowJobsPage
            jobs={jobs}
            workflows={workflowSummaries}
            api={api}
            refresh={refresh}
            showToast={showToast}
            onOpenWorkflow={(workflowId) => {
              void selectWorkflow(workflowId);
              setActiveRoute("workflow-review");
            }}
          />
        )}
        {activeRoute === "workflow-review" && (
          <WorkflowReviewPage
            workflow={selectedWorkflow}
            workflows={workflowSummaries}
            api={api}
            refresh={refresh}
            selectWorkflow={selectWorkflow}
            showToast={showToast}
          />
        )}
        {activeRoute === "workflows" && (
          <WorkflowsPage
            workflows={workflowSummaries}
            onReview={(workflowId) => {
              void selectWorkflow(workflowId);
              setActiveRoute("workflow-review");
            }}
          />
        )}
        {activeRoute === "logs" && <LogsPage logs={logs} />}
        {activeRoute === "usage" && <UsagePage app={selectedApp} api={api} showToast={showToast} />}
        {activeRoute === "api-keys" && <ApiKeysPage api={api} showToast={showToast} />}
      </main>

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}

export default App;
