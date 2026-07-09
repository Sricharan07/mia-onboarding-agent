import { Command, EllipsisVertical, LogOut, PanelLeft, RefreshCw, X } from "lucide-react";
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import type { LoadState, RouteId } from "./types";
import { errorMessage } from "./utils/format";

const configuredBackendUrl = (import.meta.env.VITE_MIA_BACKEND_URL as string | undefined)?.trim() || undefined;
const storedBackendUrl = window.localStorage.getItem("mia-console-backend-url")?.trim() || undefined;
const defaultBackendUrl = storedBackendUrl ?? configuredBackendUrl ?? window.location.origin;
const defaultConsoleSessionToken = window.sessionStorage.getItem("mia-console-session-token") ?? "";

const ApiKeysPage = lazy(() => import("./pages/ApiKeysPage").then((module) => ({ default: module.ApiKeysPage })));
const LogsPage = lazy(() => import("./pages/LogsPage").then((module) => ({ default: module.LogsPage })));
const OverviewPage = lazy(() => import("./pages/OverviewPage").then((module) => ({ default: module.OverviewPage })));
const SettingsPage = lazy(() => import("./pages/SettingsPage").then((module) => ({ default: module.SettingsPage })));
const TestMiaPage = lazy(() => import("./pages/TestMiaPage").then((module) => ({ default: module.TestMiaPage })));
const UiMapDetailPage = lazy(() => import("./pages/UiMapPages").then((module) => ({ default: module.UiMapDetailPage })));
const UiMapPage = lazy(() => import("./pages/UiMapPages").then((module) => ({ default: module.UiMapPage })));
const UsagePage = lazy(() => import("./pages/UsagePage").then((module) => ({ default: module.UsagePage })));
const UploadWorkflowPage = lazy(() => import("./pages/WorkflowPages").then((module) => ({ default: module.UploadWorkflowPage })));
const WorkflowReviewPage = lazy(() => import("./pages/WorkflowPages").then((module) => ({ default: module.WorkflowReviewPage })));
const WorkflowsPage = lazy(() => import("./pages/WorkflowPages").then((module) => ({ default: module.WorkflowsPage })));

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
  const [selectedWorkflowLoadState, setSelectedWorkflowLoadState] = useState<LoadState>("idle");
  const [logs, setLogs] = useState<ExecutionLog[]>([]);
  const refreshGeneration = useRef(0);
  const workflowSelectionGeneration = useRef(0);
  const toastTimer = useRef<number | undefined>(undefined);
  const sidebarRef = useRef<HTMLElement>(null);
  const sidebarTriggerRef = useRef<HTMLButtonElement>(null);
  const routeHeadingRef = useRef<HTMLHeadingElement>(null);
  const routeFocusReady = useRef(false);

  const api = useMemo(() => new BackendApi(backendUrl, { sessionToken }), [backendUrl, sessionToken]);
  const selectedApp = apps.find((app) => app.id === selectedAppId) ?? null;
  const latestUiMap = uiMapVersions.find((version) => version.status === "completed") ?? uiMapVersions[0] ?? null;
  const activeUiMapScan = uiMapVersions.find((version) => version.status === "scanning") ?? null;
  const selectedPage = pages.find((page) => page.id === selectedPageId) ?? pages[0] ?? null;
  const elements = Object.values(elementsByPage).flat();

  const showToast = useCallback((message: string) => {
    if (toastTimer.current !== undefined) window.clearTimeout(toastTimer.current);
    setToast(message);
    toastTimer.current = window.setTimeout(() => {
      setToast("");
      toastTimer.current = undefined;
    }, 5000);
  }, []);

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
    const generation = ++refreshGeneration.current;
    workflowSelectionGeneration.current += 1;
    setLoadState("loading");
    setError("");
    try {
      const [nextHealth, nextReadiness, appResponse, apiKeyResponse] = await Promise.all([api.health(), api.readiness(), api.listApps(), api.listApiKeys()]);
      const nextAppId = appResponse.items.some((app) => app.id === preferredAppId)
        ? preferredAppId
        : appResponse.items[0]?.id || "";

      if (!nextAppId) {
        if (generation !== refreshGeneration.current) return;
        setHealth(nextHealth);
        setReadiness(nextReadiness);
        setApps(appResponse.items);
        setApiKeys(apiKeyResponse.items);
        setSelectedAppId("");
        setUiMapVersions([]);
        setPages([]);
        setElementsByPage({});
        setJobs([]);
        setWorkflowSummaries([]);
        setSelectedWorkflow(null);
        setSelectedWorkflowLoadState("idle");
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

      const latestVersion = versionsResponse.items.find((version) => version.status === "completed") ?? versionsResponse.items[0];
      let nextPages: UiPage[] = [];
      let nextElementsByPage: Record<string, UiElement[]> = {};
      if (latestVersion) {
        const [pageResponse, allElements] = await Promise.all([
          api.listPages(latestVersion.id),
          api.listAllElements(latestVersion.id)
        ]);
        nextPages = pageResponse.items;
        nextElementsByPage = groupElementsByPage(pageResponse.items, allElements);
      }

      const selectedWorkflowStillExists = workflowResponse.items.some((workflow) => workflow.workflowId === selectedWorkflowId);
      const nextWorkflowId = selectedWorkflowStillExists ? selectedWorkflowId : workflowResponse.items[0]?.workflowId || "";
      const nextWorkflow = nextWorkflowId ? await api.getWorkflow(nextWorkflowId) : null;
      if (generation !== refreshGeneration.current) return;

      setHealth(nextHealth);
      setReadiness(nextReadiness);
      setApps(appResponse.items);
      setApiKeys(apiKeyResponse.items);
      setSelectedAppId(nextAppId);
      setUiMapVersions(versionsResponse.items);
      setJobs(jobsResponse.items);
      setWorkflowSummaries(workflowResponse.items);
      setLogs(logsResponse.items);
      setPages(nextPages);
      setElementsByPage(nextElementsByPage);
      setSelectedPageId((current) => nextPages.some((page) => page.id === current) ? current : nextPages[0]?.id || "");
      setSelectedWorkflowId(nextWorkflowId);
      setSelectedWorkflow(nextWorkflow);
      setSelectedWorkflowLoadState(nextWorkflow ? "ready" : "idle");
      setLoadState("ready");
    } catch (cause) {
      if (generation !== refreshGeneration.current) return;
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

  useEffect(() => () => {
    if (toastTimer.current !== undefined) window.clearTimeout(toastTimer.current);
  }, []);

  useEffect(() => {
    document.title = authenticated ? `${routeTitle(activeRoute)} | Mia Console` : "Mia Console";
    if (routeFocusReady.current) {
      routeHeadingRef.current?.focus({ preventScroll: true });
    } else {
      routeFocusReady.current = true;
    }
  }, [activeRoute, authenticated]);

  useEffect(() => {
    if (!sidebarOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focusFrame = window.requestAnimationFrame(() => {
      sidebarRef.current?.querySelector<HTMLButtonElement>(".nav-item")?.focus({ preventScroll: true });
    });
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setSidebarOpen(false);
      window.requestAnimationFrame(() => sidebarTriggerRef.current?.focus({ preventScroll: true }));
    };
    document.addEventListener("keydown", handleEscape);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.removeEventListener("keydown", handleEscape);
      document.body.style.overflow = previousOverflow;
    };
  }, [sidebarOpen]);

  useEffect(() => {
    const mobileQuery = window.matchMedia("(max-width: 820px)");
    const closeDesktopDrawer = (event: MediaQueryListEvent) => {
      if (!event.matches) setSidebarOpen(false);
    };
    mobileQuery.addEventListener("change", closeDesktopDrawer);
    return () => mobileQuery.removeEventListener("change", closeDesktopDrawer);
  }, []);

  const selectApp = async (appId: string) => {
    setSelectedAppId(appId);
    setSelectedWorkflowId("");
    setUiMapVersions([]);
    setPages([]);
    setElementsByPage({});
    setSelectedPageId("");
    setJobs([]);
    setWorkflowSummaries([]);
    setSelectedWorkflow(null);
    setSelectedWorkflowLoadState("idle");
    setLogs([]);
    setSidebarOpen(false);
    await refresh(appId);
  };

  const selectWorkflow = async (workflowId: string) => {
    const generation = ++workflowSelectionGeneration.current;
    setSelectedWorkflowId(workflowId);
    setSelectedWorkflow(null);
    setSelectedWorkflowLoadState("loading");
    try {
      const workflow = await api.getWorkflow(workflowId);
      if (generation !== workflowSelectionGeneration.current) return;
      setSelectedWorkflow(workflow);
      setSelectedWorkflowLoadState("ready");
    } catch (cause) {
      if (generation !== workflowSelectionGeneration.current) return;
      setSelectedWorkflowLoadState("error");
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
        <section className="login-card auth-check-card" role="status" aria-live="polite" aria-busy="true">
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
      <a className="skip-link" href="#main-content">Skip to main content</a>
      <aside id="console-sidebar" ref={sidebarRef} className="sidebar" aria-label="Console sidebar">
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
                  aria-current={navRouteFor(activeRoute) === item.id ? "page" : undefined}
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

      <main id="main-content" className="main-shell" tabIndex={-1} inert={sidebarOpen} aria-hidden={sidebarOpen || undefined}>
        <header className="topbar">
          <div className="topbar-title">
            <button ref={sidebarTriggerRef} className="sidebar-trigger" type="button" aria-label={sidebarOpen ? "Close sidebar" : "Open sidebar"} aria-controls="console-sidebar" aria-expanded={sidebarOpen} onClick={() => setSidebarOpen((open) => !open)}>
              {sidebarOpen ? <X size={16} /> : <PanelLeft size={16} />}
            </button>
            <h1 ref={routeHeadingRef} tabIndex={-1}>{routeTitle(activeRoute)}</h1>
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
            <StatusPill
              tone={loadState === "loading" && !health ? "gray" : health?.ok ? "green" : "red"}
              label={loadState === "loading" && !health ? "Checking backend" : health?.ok ? "Backend healthy" : "Backend offline"}
            />
            <button className="button secondary" type="button" disabled={loadState === "loading"} onClick={() => void refresh()}>
              <RefreshCw className={loadState === "loading" ? "is-spinning" : ""} size={15} />
              {loadState === "loading" ? "Refreshing" : "Refresh"}
            </button>
            <button className="button secondary" type="button" onClick={() => void logout()}>
              <LogOut size={15} />
              Sign out
            </button>
          </div>
        </header>

        {error && apps.length > 0 && <InlineAlert tone="red" title="Backend error" message={error} />}
        {loadState === "loading" && apps.length > 0 && <InlineAlert tone="gray" title="Refreshing" message="Fetching the latest backend data for the selected app." />}

        {loadState === "loading" && apps.length === 0 ? (
          <ConsoleLoadState />
        ) : loadState === "error" && apps.length === 0 ? (
          <ConsoleLoadState error={error} onRetry={() => void refresh()} />
        ) : (
          <Suspense fallback={<ConsoleRouteLoadState />}>
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
            loadState={selectedWorkflowLoadState}
            workflows={workflowSummaries}
            api={api}
            refresh={refresh}
            selectWorkflow={selectWorkflow}
            onUpload={() => setActiveRoute("upload")}
            onBack={() => setActiveRoute("workflows")}
            reviewerEmail={consoleUser?.email}
            elements={elements}
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
          </Suspense>
        )}
      </main>

      <button className="sidebar-backdrop" type="button" aria-label="Close sidebar" onClick={() => {
        setSidebarOpen(false);
        window.requestAnimationFrame(() => sidebarTriggerRef.current?.focus({ preventScroll: true }));
      }} />
      {toast && (
        <div className="toast">
          <span role="status" aria-live="polite" aria-atomic="true">{toast}</span>
          <button type="button" aria-label="Dismiss notification" onClick={() => {
            if (toastTimer.current !== undefined) window.clearTimeout(toastTimer.current);
            toastTimer.current = undefined;
            setToast("");
          }}>
            <X size={15} />
          </button>
        </div>
      )}
    </div>
  );
}

function ConsoleLoadState({ error, onRetry }: { error?: string; onRetry?: () => void }) {
  return (
    <section className="console-load-state" role={error ? "alert" : "status"} aria-live="polite" aria-busy={!error}>
      <div className="console-load-copy">
        <h2>{error ? "Console data could not be loaded" : "Loading console data"}</h2>
        <p>{error ?? "Fetching apps, provider readiness, UI maps, workflows, and runtime evidence."}</p>
      </div>
      {!error && (
        <div className="console-load-skeleton" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
      )}
      {onRetry && <button className="button primary" type="button" onClick={onRetry}>Retry</button>}
    </section>
  );
}

function ConsoleRouteLoadState() {
  return (
    <section className="route-load-state" role="status" aria-live="polite" aria-busy="true">
      <span>Loading page</span>
      <div aria-hidden="true" />
    </section>
  );
}

function groupElementsByPage(pages: UiPage[], elements: UiElement[]): Record<string, UiElement[]> {
  const grouped = Object.fromEntries(pages.map((page) => [page.id, [] as UiElement[]]));
  for (const element of elements) {
    grouped[element.pageId]?.push(element);
  }
  return grouped;
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
