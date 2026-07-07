import { Command, EllipsisVertical, LogOut, PanelLeft, RefreshCw, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  BackendApi,
  type ApiKeyRecord,
  type AppRecord,
  type BackendHealth,
  type ConsoleAuthUser,
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
import { navGroups, navRouteFor, routeTitle } from "./navigation";
import { LoginPage } from "./pages/LoginPage";
import { LogsPage } from "./pages/LogsPage";
import { OverviewPage } from "./pages/OverviewPage";
import { SettingsPage } from "./pages/SettingsPage";
import { TestMiaPage } from "./pages/TestMiaPage";
import { UiMapDetailPage, UiMapPage } from "./pages/UiMapPages";
import { ApiKeysPage } from "./pages/ApiKeysPage";
import { UsagePage } from "./pages/UsagePage";
import { UploadWorkflowPage, WorkflowReviewPage, WorkflowsPage } from "./pages/WorkflowPages";
import type { LoadState, RouteId } from "./types";
import { errorMessage } from "./utils/format";

const configuredBackendUrl = (import.meta.env.VITE_MIA_BACKEND_URL as string | undefined)?.trim() || undefined;
const storedBackendUrl = window.localStorage.getItem("mia-console-backend-url")?.trim() || undefined;
const defaultBackendUrl = storedBackendUrl ?? configuredBackendUrl ?? window.location.origin;
const defaultConsoleSessionToken = window.sessionStorage.getItem("mia-console-session-token") ?? "";

function App() {
  const [authenticated, setAuthenticated] = useState(() => Boolean(defaultConsoleSessionToken));
  const [authChecked, setAuthChecked] = useState(false);
  const [setupRequired, setSetupRequired] = useState(false);
  const [activeRoute, setActiveRoute] = useState<RouteId>("overview");
  const [backendUrl, setBackendUrl] = useState(defaultBackendUrl);
  const [sessionToken, setSessionToken] = useState(defaultConsoleSessionToken);
  const [consoleUser, setConsoleUser] = useState<ConsoleAuthUser | null>(null);
  const [health, setHealth] = useState<BackendHealth | null>(null);
  const [readiness, setReadiness] = useState<SystemReadiness | null>(null);
  const [loadState, setLoadState] = useState<LoadState>("idle");
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [apps, setApps] = useState<AppRecord[]>([]);
  const [apiKeys, setApiKeys] = useState<ApiKeyRecord[]>([]);
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

  const api = useMemo(() => new BackendApi(backendUrl, { sessionToken }), [backendUrl, sessionToken]);
  const selectedApp = apps.find((app) => app.id === selectedAppId) ?? null;
  const latestUiMap = uiMapVersions.find((version) => version.status === "completed") ?? uiMapVersions[0] ?? null;
  const activeUiMapScan = uiMapVersions.find((version) => version.status === "scanning") ?? null;
  const selectedPage = pages.find((page) => page.id === selectedPageId) ?? pages[0] ?? null;
  const elements = Object.values(elementsByPage).flat();

  const showToast = (message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(""), 2600);
  };

  const reportError = (cause: unknown, fallback = "Request failed") => {
    const message = errorMessage(cause, fallback);
    setError(message);
    showToast(message);
  };

  const clearSession = () => {
    window.sessionStorage.removeItem("mia-console-session-token");
    window.localStorage.removeItem("mia-console-admin-api-key");
    window.localStorage.removeItem("mia-console-bootstrap-token");
    setSessionToken("");
    setConsoleUser(null);
    setAuthenticated(false);
  };

  const refresh = async (preferredAppId = selectedAppId) => {
    setLoadState("loading");
    setError("");
    try {
      const [nextHealth, nextReadiness, appResponse, apiKeyResponse] = await Promise.all([api.health(), api.readiness(), api.listApps(), api.listApiKeys()]);
      setHealth(nextHealth);
      setReadiness(nextReadiness);
      setApps(appResponse.items);
      setApiKeys(apiKeyResponse.items);
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
        setApiKeys(apiKeyResponse.items);
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

      const latestVersion = versionsResponse.items.find((version) => version.status === "completed") ?? versionsResponse.items[0];
      if (latestVersion) {
        const pageResponse = await api.listPages(latestVersion.id);
        const elementEntries = await Promise.all(
          pageResponse.items.map(async (page) => [page.id, (await api.listElements(page.id)).items] as const)
        );
        setPages(pageResponse.items);
        setSelectedPageId((current) => pageResponse.items.some((page) => page.id === current) ? current : pageResponse.items[0]?.id || "");
        setElementsByPage(Object.fromEntries(elementEntries));
      } else {
        setPages([]);
        setElementsByPage({});
        setSelectedPageId("");
      }

      const selectedWorkflowStillExists = workflowResponse.items.some((workflow) => workflow.workflowId === selectedWorkflowId);
      const nextWorkflowId = selectedWorkflowStillExists ? selectedWorkflowId : workflowResponse.items[0]?.workflowId || "";
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
    let cancelled = false;

    const checkAuth = async () => {
      try {
        const status = await new BackendApi(backendUrl, sessionToken ? { sessionToken } : {}).authStatus();
        if (cancelled) return;
        setSetupRequired(status.setupRequired);
        if (status.authenticated && status.user && sessionToken) {
          setConsoleUser(status.user);
          setAuthenticated(true);
        } else {
          clearSession();
        }
      } catch {
        if (!cancelled) {
          clearSession();
        }
      } finally {
        if (!cancelled) {
          setAuthChecked(true);
        }
      }
    };

    void checkAuth();
    return () => {
      cancelled = true;
    };
  }, [backendUrl, sessionToken]);

  useEffect(() => {
    if (authenticated && authChecked) {
      void refresh();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authenticated, authChecked, api]);

  useEffect(() => {
    const hasActiveWorkflowJob = jobs.some((job) => ["uploaded", "analyzing", "mapped"].includes(job.status));
    const hasActiveUiMapScan = uiMapVersions.some((version) => version.status === "scanning");
    if (!authenticated || !selectedAppId || (!hasActiveWorkflowJob && !hasActiveUiMapScan)) {
      return;
    }

    const timer = window.setTimeout(() => {
      void refresh(selectedAppId);
    }, 2500);

    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authenticated, selectedAppId, jobs, uiMapVersions]);

  const selectApp = async (appId: string) => {
    setSelectedAppId(appId);
    setSelectedWorkflowId("");
    setSidebarOpen(false);
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

  const completeAuth = (input: { backendUrl: string; token: string; user: ConsoleAuthUser }) => {
    const nextBackendUrl = input.backendUrl.trim();
    window.localStorage.setItem("mia-console-backend-url", nextBackendUrl);
    window.sessionStorage.setItem("mia-console-session-token", input.token);
    window.localStorage.removeItem("mia-console-admin-api-key");
    window.localStorage.removeItem("mia-console-bootstrap-token");
    setBackendUrl(nextBackendUrl);
    setSessionToken(input.token);
    setConsoleUser(input.user);
    setAuthenticated(true);
    setAuthChecked(true);
    setError("");
    setActiveRoute("overview");
  };

  const login = async (input: { backendUrl: string; email: string; password: string }) => {
    const nextBackendUrl = input.backendUrl.trim();
    const authApi = new BackendApi(nextBackendUrl);
    const result = await authApi.loginConsole({ email: input.email, password: input.password });
    completeAuth({ backendUrl: nextBackendUrl, token: result.token, user: result.user });
  };

  const setup = async (input: { backendUrl: string; email: string; name: string; password: string; bootstrapToken: string }) => {
    const nextBackendUrl = input.backendUrl.trim();
    const authApi = new BackendApi(nextBackendUrl);
    const result = await authApi.setupConsoleUser({
      email: input.email,
      name: input.name,
      password: input.password
    }, input.bootstrapToken);
    completeAuth({ backendUrl: nextBackendUrl, token: result.token, user: result.user });
  };

  const checkSetupRequired = async (inputBackendUrl: string): Promise<boolean> => {
    const status = await new BackendApi(inputBackendUrl.trim()).authStatus();
    return status.setupRequired;
  };

  const logout = async () => {
    try {
      if (sessionToken) {
        await api.logoutConsole();
      }
    } catch {
      // The local session should still be cleared if the backend is unavailable or already expired.
    } finally {
      clearSession();
    }
  };

  if (!authChecked) {
    return (
      <main className="login-page">
        <section className="login-card auth-check-card">
          <div className="login-brand-row">
            <span className="brand-tile">
              <Command size={17} />
            </span>
            <div>
              <div className="brand-name">Mia Console</div>
              <div className="brand-subtitle">Checking session</div>
            </div>
          </div>
        </section>
      </main>
    );
  }

  if (!authenticated) {
    return <LoginPage backendUrl={backendUrl} setupRequired={setupRequired} onLogin={login} onSetup={setup} onCheckSetupRequired={checkSetupRequired} />;
  }

  return (
    <div className={`app-shell ${sidebarOpen ? "sidebar-is-open" : ""}`}>
      <aside className="sidebar" aria-label="Console sidebar">
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
                  className={`nav-item ${navRouteFor(activeRoute) === item.id ? "is-active" : ""}`}
                  key={item.id}
                  type="button"
                  onClick={() => {
                    setActiveRoute(item.id);
                    setSidebarOpen(false);
                  }}
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
            <div>Operator console</div>
            <p>Start from Overview. It shows the current blocker, evidence, and next action for the selected app.</p>
          </div>
          <button className="user-card" type="button" onClick={() => {
            setActiveRoute("settings");
            setSidebarOpen(false);
          }}>
            <span className="avatar">{userInitials(consoleUser)}</span>
            <span className="user-copy">
              <span>{consoleUser?.name ?? "Console admin"}</span>
              <span>{consoleUser?.email ?? selectedApp?.slug ?? "no app selected"}</span>
            </span>
            <EllipsisVertical size={14} />
          </button>
        </div>
      </aside>

      <main className="main-shell">
        <header className="topbar">
          <div className="topbar-title">
            <button className="sidebar-trigger" type="button" aria-label={sidebarOpen ? "Close sidebar" : "Open sidebar"} aria-expanded={sidebarOpen} onClick={() => setSidebarOpen((open) => !open)}>
              {sidebarOpen ? <X size={16} /> : <PanelLeft size={16} />}
            </button>
            <h1>{routeTitle(activeRoute)}</h1>
          </div>
          <div className="topbar-actions">
            {selectedApp && (
              <label className="topbar-app-select">
                <span>Active app</span>
                <select aria-label="Active application" value={selectedApp.id} onChange={(event) => void selectApp(event.target.value)}>
                  {apps.map((app) => (
                    <option value={app.id} key={app.id}>{app.name}</option>
                  ))}
                </select>
              </label>
            )}
            <StatusPill tone={health?.ok ? "green" : "red"} label={health?.ok ? "Backend healthy" : "Backend offline"} />
            <button className="button secondary" type="button" onClick={() => void refresh()}>
              <RefreshCw size={15} />
              Refresh
            </button>
            <button className="button secondary" type="button" onClick={() => void logout()}>
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
            apiKeys={apiKeys}
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
            onOpenRoute={(route) => setActiveRoute(route)}
          />
        )}
        {activeRoute === "settings" && (
          <SettingsPage
            backendUrl={backendUrl}
            setBackendUrl={setBackendUrl}
            apps={apps}
            selectedApp={selectedApp}
            consoleUser={consoleUser}
            api={api}
            readiness={readiness}
            refresh={refresh}
            selectApp={selectApp}
            onOpenRoute={(route) => setActiveRoute(route)}
            showToast={showToast}
          />
        )}
        {activeRoute === "ui-map" && (
          <UiMapPage
            app={selectedApp}
            pages={pages}
            elements={elements}
            latestUiMap={latestUiMap}
            activeUiMapScan={activeUiMapScan}
            uiMapVersions={uiMapVersions}
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
          <UploadWorkflowPage app={selectedApp} api={api} refresh={refresh} showToast={showToast} onJobs={() => setActiveRoute("workflows")} />
        )}
        {activeRoute === "workflow-review" && (
          <WorkflowReviewPage
            workflow={selectedWorkflow}
            workflows={workflowSummaries}
            api={api}
            refresh={refresh}
            selectWorkflow={selectWorkflow}
            onUpload={() => setActiveRoute("upload")}
            onBack={() => setActiveRoute("workflows")}
            reviewerEmail={consoleUser?.email}
            showToast={showToast}
          />
        )}
        {activeRoute === "workflows" && (
          <WorkflowsPage
            jobs={jobs}
            workflows={workflowSummaries}
            api={api}
            refresh={refresh}
            showToast={showToast}
            onUpload={() => setActiveRoute("upload")}
            onReview={(workflowId) => {
              void selectWorkflow(workflowId);
              setActiveRoute("workflow-review");
            }}
          />
        )}
        {activeRoute === "test-mia" && (
          <TestMiaPage
            app={selectedApp}
            pages={pages}
            elements={elements}
            workflows={workflowSummaries}
            logs={logs}
            api={api}
            refresh={refresh}
            onOpenRoute={(route) => setActiveRoute(route)}
            showToast={showToast}
          />
        )}
        {activeRoute === "logs" && <LogsPage logs={logs} />}
        {activeRoute === "usage" && <UsagePage app={selectedApp} api={api} showToast={showToast} />}
        {activeRoute === "api-keys" && (
          <ApiKeysPage
            api={api}
            apps={apps}
            selectedAppId={selectedAppId}
            backendUrl={backendUrl}
            showToast={showToast}
          />
        )}
      </main>

      <button className="sidebar-backdrop" type="button" aria-label="Close sidebar" onClick={() => setSidebarOpen(false)} />
      {toast && <div className="toast" role="status" aria-live="polite">{toast}</div>}
    </div>
  );
}

function userInitials(user: ConsoleAuthUser | null): string {
  const source = user?.name || user?.email || "Mia Console";
  return source
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

export default App;
