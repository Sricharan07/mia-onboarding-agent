import { AlertTriangle, Archive, Database, Download, KeyRound, RefreshCw, Save, ShieldCheck, Trash2, Users } from "lucide-react";
import { useEffect, useMemo, useState, type KeyboardEvent } from "react";
import type { AppRecord, AppUiScanConfig, BackendApi, ConsoleAuthUser, ConsoleSession, SystemReadiness, TelemetryMode, UiScanAuthMode } from "../api";
import { EmptyTableRow, InlineAlert, PageIntro, Panel, ServiceRow, StatusPill } from "../components/console";
import type { LoadState, RouteId } from "../types";
import { errorMessage, formatDate } from "../utils/format";

type SettingsTab = "backend" | "app" | "scan" | "privacy" | "admins" | "danger";
type Notice = { tone: "red" | "green" | "yellow" | "gray"; title: string; message: string };

const tabs: Array<{ id: SettingsTab; label: string }> = [
  { id: "backend", label: "Backend" },
  { id: "app", label: "App" },
  { id: "scan", label: "Scan profile" },
  { id: "privacy", label: "Privacy" },
  { id: "admins", label: "Admins" },
  { id: "danger", label: "Danger" }
];

export function SettingsPage({
  backendUrl,
  setBackendUrl,
  apps,
  selectedApp,
  consoleUser,
  api,
  readiness,
  refresh,
  selectApp,
  onOpenRoute,
  showToast
}: {
  backendUrl: string;
  setBackendUrl: (value: string) => void;
  apps: AppRecord[];
  selectedApp: AppRecord | null;
  consoleUser: ConsoleAuthUser | null;
  api: BackendApi;
  readiness: SystemReadiness | null;
  refresh: (preferredAppId?: string) => Promise<void>;
  selectApp: (appId: string) => Promise<void>;
  onOpenRoute: (route: RouteId) => void;
  showToast: (message: string) => void;
}) {
  const [tab, setTab] = useState<SettingsTab>("backend");
  const [notice, setNotice] = useState<Notice | null>(null);
  const [urlDraft, setUrlDraft] = useState(backendUrl);
  const [name, setName] = useState(selectedApp?.name ?? "MIA onboarding app");
  const [slug, setSlug] = useState(selectedApp?.slug ?? "mia-onboarding");
  const [baseUrl, setBaseUrl] = useState(selectedApp?.baseUrl ?? "http://localhost:3000");
  const [runtimeMode, setRuntimeMode] = useState<AppUiScanConfig["runtimeMode"]>(selectedApp?.uiScanConfig.runtimeMode ?? "workflow");
  const [authMode, setAuthMode] = useState<UiScanAuthMode>(selectedApp?.uiScanConfig.authMode ?? "none");
  const [loginUrl, setLoginUrl] = useState(selectedApp?.uiScanConfig.loginUrl ?? "");
  const [username, setUsername] = useState(selectedApp?.uiScanConfig.username ?? "");
  const [password, setPassword] = useState("");
  const [clearPassword, setClearPassword] = useState(false);
  const [usernameSelector, setUsernameSelector] = useState(selectedApp?.uiScanConfig.usernameSelector ?? "");
  const [passwordSelector, setPasswordSelector] = useState(selectedApp?.uiScanConfig.passwordSelector ?? "");
  const [submitSelector, setSubmitSelector] = useState(selectedApp?.uiScanConfig.submitSelector ?? "");
  const [successUrlPattern, setSuccessUrlPattern] = useState(selectedApp?.uiScanConfig.successUrlPattern ?? "");
  const [postLoginWaitMs, setPostLoginWaitMs] = useState(String(selectedApp?.uiScanConfig.postLoginWaitMs ?? 1000));
  const [ignoredSelectors, setIgnoredSelectors] = useState(selectedApp?.uiScanConfig.ignoredSelectors.join("\n") ?? "");
  const [redactedSelectors, setRedactedSelectors] = useState(selectedApp?.uiScanConfig.redactedSelectors.join("\n") ?? "");
  const [routeDiscoveryEnabled, setRouteDiscoveryEnabled] = useState(selectedApp?.uiScanConfig.routeDiscovery.enabled ?? false);
  const [routeDiscoveryMaxRoutes, setRouteDiscoveryMaxRoutes] = useState(String(selectedApp?.uiScanConfig.routeDiscovery.maxRoutes ?? 25));
  const [telemetryMode, setTelemetryMode] = useState<TelemetryMode>(selectedApp?.privacyPolicy.telemetryMode ?? "events_only");
  const [retentionDays, setRetentionDays] = useState(String(selectedApp?.privacyPolicy.retentionDays ?? 30));
  const [deleteUserId, setDeleteUserId] = useState("");
  const [pending, setPending] = useState("");
  const [archiveConfirm, setArchiveConfirm] = useState("");
  const [users, setUsers] = useState<ConsoleAuthUser[]>([]);
  const [sessions, setSessions] = useState<ConsoleSession[]>([]);
  const [adminsLoadState, setAdminsLoadState] = useState<LoadState>("idle");
  const [newAdminName, setNewAdminName] = useState("");
  const [newAdminEmail, setNewAdminEmail] = useState("");
  const [newAdminPassword, setNewAdminPassword] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [nextPassword, setNextPassword] = useState("");

  const selectedAppSecretReady = authMode !== "login_form" || readiness?.secrets.status === "ok" || !password;
  const saveDisabledReason = !selectedAppSecretReady ? "Set MIA_SECRET_ENCRYPTION_KEY before saving a scan password." : "";

  useEffect(() => {
    setUrlDraft(backendUrl);
  }, [backendUrl]);

  useEffect(() => {
    if (!selectedApp) return;
    setName(selectedApp.name);
    setSlug(selectedApp.slug);
    setBaseUrl(selectedApp.baseUrl);
    setRuntimeMode(selectedApp.uiScanConfig.runtimeMode ?? "workflow");
    setAuthMode(selectedApp.uiScanConfig.authMode);
    setLoginUrl(selectedApp.uiScanConfig.loginUrl ?? "");
    setUsername(selectedApp.uiScanConfig.username ?? "");
    setPassword("");
    setClearPassword(false);
    setUsernameSelector(selectedApp.uiScanConfig.usernameSelector ?? "");
    setPasswordSelector(selectedApp.uiScanConfig.passwordSelector ?? "");
    setSubmitSelector(selectedApp.uiScanConfig.submitSelector ?? "");
    setSuccessUrlPattern(selectedApp.uiScanConfig.successUrlPattern ?? "");
    setPostLoginWaitMs(String(selectedApp.uiScanConfig.postLoginWaitMs));
    setIgnoredSelectors(selectedApp.uiScanConfig.ignoredSelectors.join("\n"));
    setRedactedSelectors(selectedApp.uiScanConfig.redactedSelectors.join("\n"));
    setRouteDiscoveryEnabled(selectedApp.uiScanConfig.routeDiscovery.enabled);
    setRouteDiscoveryMaxRoutes(String(selectedApp.uiScanConfig.routeDiscovery.maxRoutes));
    setTelemetryMode(selectedApp.privacyPolicy.telemetryMode);
    setRetentionDays(String(selectedApp.privacyPolicy.retentionDays));
    setDeleteUserId("");
    setArchiveConfirm("");
  }, [selectedApp]);

  useEffect(() => {
    if (tab === "admins") void loadAdmins();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  const authSummary = useMemo(() => {
    if (authMode === "none") return "No authentication";
    if (authMode === "manual") return "Interactive browser login";
    return selectedApp?.uiScanConfig.passwordConfigured || password ? "Login form credentials configured" : "Login form missing password";
  }, [authMode, password, selectedApp?.uiScanConfig.passwordConfigured]);

  const saveBackendUrl = () => {
    window.localStorage.setItem("mia-console-backend-url", urlDraft);
    setBackendUrl(urlDraft);
    setNotice(null);
    showToast("Backend URL saved");
  };

  const activateTab = (nextTab: SettingsTab) => {
    setTab(nextTab);
    setNotice(null);
    window.requestAnimationFrame(() => document.getElementById(settingsTabId(nextTab))?.focus());
  };

  const handleTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const nextIndex = event.key === "Home"
      ? 0
      : event.key === "End"
        ? tabs.length - 1
        : (index + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
    activateTab(tabs[nextIndex]!.id);
  };

  const reportNotice = (cause: unknown, fallback: string) => {
    const message = errorMessage(cause, fallback);
    setNotice({ tone: "red", title: "Action failed", message });
    showToast(message);
  };

  const saveApp = async () => {
    if (saveDisabledReason) {
      setNotice({ tone: "yellow", title: "Scan password", message: saveDisabledReason });
      showToast(saveDisabledReason);
      return;
    }
    setPending("save-app");
    try {
      const app = await api.saveApp({
        name: name.trim(),
        slug: slug.trim(),
        baseUrl: baseUrl.trim(),
        privacyPolicy: {
          telemetryMode,
          retentionDays: Math.min(3650, Math.max(1, Number.parseInt(retentionDays, 10) || 30))
        },
        uiScanConfig: {
          runtimeMode,
          routes: selectedApp?.uiScanConfig.routes.length ? selectedApp.uiScanConfig.routes : ["/"],
          authMode,
          loginUrl: loginUrl.trim() || undefined,
          username: username.trim() || undefined,
          password: password || undefined,
          clearPassword,
          usernameSelector: usernameSelector.trim() || undefined,
          passwordSelector: passwordSelector.trim() || undefined,
          submitSelector: submitSelector.trim() || undefined,
          successUrlPattern: successUrlPattern.trim() || undefined,
          postLoginWaitMs: Number.parseInt(postLoginWaitMs, 10) || 0,
          ignoredSelectors: splitLines(ignoredSelectors),
          redactedSelectors: splitLines(redactedSelectors),
          routeDiscovery: {
            enabled: routeDiscoveryEnabled,
            maxRoutes: Number.parseInt(routeDiscoveryMaxRoutes, 10) || 25
          }
        }
      });
      await refresh(app.id);
      setPassword("");
      setClearPassword(false);
      setNotice(null);
      showToast("App and scan profile saved");
    } catch (cause) {
      reportNotice(cause, "Unable to save app");
    } finally {
      setPending("");
    }
  };

  const exportData = async () => {
    if (!selectedApp) return;
    setPending("export-data");
    try {
      const data = await api.exportAppData(selectedApp.id);
      const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = `${selectedApp.slug}-mia-data-${new Date().toISOString().slice(0, 10)}.json`;
      link.click();
      URL.revokeObjectURL(url);
      showToast("App data exported");
    } catch (cause) {
      reportNotice(cause, "Unable to export app data");
    } finally {
      setPending("");
    }
  };

  const purgeExpiredData = async () => {
    if (!selectedApp) return;
    setPending("purge-data");
    try {
      const result = await api.purgeAppData(selectedApp.id);
      showToast(`Purged ${Object.values(result).reduce((sum, count) => sum + count, 0)} expired records`);
    } catch (cause) {
      reportNotice(cause, "Unable to purge expired data");
    } finally {
      setPending("");
    }
  };

  const deleteUserData = async () => {
    if (!selectedApp || !deleteUserId.trim()) return;
    setPending("delete-user-data");
    try {
      const result = await api.deleteAppUserData(selectedApp.id, deleteUserId.trim());
      setDeleteUserId("");
      showToast(`Deleted ${Object.values(result).reduce((sum, count) => sum + count, 0)} user records`);
    } catch (cause) {
      reportNotice(cause, "Unable to delete user data");
    } finally {
      setPending("");
    }
  };

  const archiveApp = async () => {
    if (!selectedApp || archiveConfirm !== selectedApp.slug) return;
    setPending("archive-app");
    try {
      await api.archiveApp(selectedApp.id);
      await refresh();
      setArchiveConfirm("");
      setNotice(null);
      showToast("App archived");
    } catch (cause) {
      reportNotice(cause, "Unable to archive app");
    } finally {
      setPending("");
    }
  };

  const loadAdmins = async () => {
    setAdminsLoadState("loading");
    try {
      const [nextUsers, nextSessions] = await Promise.all([api.listConsoleUsers(), api.listConsoleSessions()]);
      setUsers(nextUsers.items);
      setSessions(nextSessions.items);
      setAdminsLoadState("ready");
      setNotice(null);
    } catch (cause) {
      setAdminsLoadState("error");
      reportNotice(cause, "Unable to load console admins");
    }
  };

  const createAdmin = async () => {
    setPending("create-admin");
    try {
      await api.createConsoleUser({ name: newAdminName, email: newAdminEmail, password: newAdminPassword });
      setNewAdminName("");
      setNewAdminEmail("");
      setNewAdminPassword("");
      await loadAdmins();
      setNotice(null);
      showToast("Console admin created");
    } catch (cause) {
      reportNotice(cause, "Unable to create admin");
    } finally {
      setPending("");
    }
  };

  const changeOwnPassword = async () => {
    if (!consoleUser) return;
    setPending("change-password");
    try {
      await api.changeConsoleUserPassword(consoleUser.id, { currentPassword, nextPassword });
      setCurrentPassword("");
      setNextPassword("");
      setNotice(null);
      showToast("Password changed");
    } catch (cause) {
      reportNotice(cause, "Unable to change password");
    } finally {
      setPending("");
    }
  };

  const disableUser = async (userId: string) => {
    setPending(`disable:${userId}`);
    try {
      await api.disableConsoleUser(userId);
      await loadAdmins();
      setNotice(null);
      showToast("Console user disabled");
    } catch (cause) {
      reportNotice(cause, "Unable to disable user");
    } finally {
      setPending("");
    }
  };

  const revokeSession = async (sessionId: string) => {
    setPending(`session:${sessionId}`);
    try {
      await api.revokeConsoleSession(sessionId);
      await loadAdmins();
      setNotice(null);
      showToast("Session revoked");
    } catch (cause) {
      reportNotice(cause, "Unable to revoke session");
    } finally {
      setPending("");
    }
  };

  return (
    <div className="page-grid">
      <PageIntro
        title={settingsIntro(tab).title}
        description={settingsIntro(tab).description}
        action={<StatusPill tone={tab === "danger" ? "yellow" : "green"} label={selectedApp?.name ?? "No app"} />}
      />
      <div className="segmented-tabs" role="tablist" aria-label="Settings sections">
        {tabs.map((item, index) => (
          <button
            key={item.id}
            id={settingsTabId(item.id)}
            role="tab"
            type="button"
            className={tab === item.id ? "is-active" : ""}
            aria-selected={tab === item.id}
            aria-controls={settingsPanelId(item.id)}
            tabIndex={tab === item.id ? 0 : -1}
            onClick={() => activateTab(item.id)}
            onKeyDown={(event) => handleTabKeyDown(event, index)}
          >
            {item.label}
          </button>
        ))}
      </div>

      {notice && <InlineAlert tone={notice.tone} title={notice.title} message={notice.message} />}

      {tab === "backend" && (
        <section id={settingsPanelId("backend")} role="tabpanel" aria-labelledby={settingsTabId("backend")}>
          <Panel title="Backend connection" action={<StatusPill tone="green" label="Self-hosted" />}>
          <div className="form-grid single">
            <label>
              Backend URL
              <input value={urlDraft} onChange={(event) => setUrlDraft(event.target.value)} />
            </label>
          </div>
          <div className="panel-actions">
            <button className="button secondary" type="button" onClick={() => void refresh(selectedApp?.id)}>
              <RefreshCw size={16} />
              Refresh checks
            </button>
            <button className="button primary" type="button" onClick={saveBackendUrl}>
              <Save size={16} />
              Save backend URL
            </button>
          </div>
          <div className="service-grid">
            <ServiceRow label="Database" value={readinessLabel(readiness?.database.status)} />
            <ServiceRow label="Secret storage" value={readinessLabel(readiness?.secrets.status)} />
            <ServiceRow label="Gemini" value={readinessLabel(readiness?.providers.gemini.status)} />
            <ServiceRow label="Semantic search" value={readinessLabel(readiness?.providers.semanticSearch.status)} />
          </div>
          {readiness?.secrets.status === "missing_config" && (
            <InlineAlert tone="yellow" title="Secret storage" message={readiness.secrets.message} />
          )}
          </Panel>
        </section>
      )}

      {tab === "app" && (
        <section id={settingsPanelId("app")} role="tabpanel" aria-labelledby={settingsTabId("app")}>
          <Panel title="Application record" action={<span className="muted">{apps.length} active app(s)</span>}>
            <div className="form-grid">
              <label>
                App name
                <input value={name} onChange={(event) => setName(event.target.value)} />
              </label>
              <label>
                App slug
                <input
                  value={slug}
                  pattern="[a-z0-9]+(-[a-z0-9]+)*"
                  onChange={(event) => setSlug(event.target.value)}
                />
              </label>
              <label>
                Target app base URL
                <input value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} />
              </label>
              <label>
                Runtime mode
                <select value={runtimeMode} onChange={(event) => setRuntimeMode(event.target.value as AppUiScanConfig["runtimeMode"])}>
                  <option value="workflow">Q&A, pointing, and guided workflows</option>
                  <option value="qa_only">Q&A and pointing only</option>
                </select>
              </label>
            </div>
            <div className="panel-actions">
              <button className="button primary" type="button" disabled={pending === "save-app"} onClick={() => void saveApp()}>
                <Database size={16} />
                {pending === "save-app" ? "Saving" : "Save app"}
              </button>
            </div>
          </Panel>

          <Panel title="Active apps">
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Slug</th>
                  <th>Base URL</th>
                  <th>Updated</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {apps.map((app) => (
                  <tr key={app.id}>
                    <td>{app.name}</td>
                    <td><code>{app.slug}</code></td>
                    <td>{app.baseUrl}</td>
                    <td>{formatDate(app.updatedAt)}</td>
                    <td>
                      <button className="button secondary small" type="button" onClick={() => void selectApp(app.id)}>
                        {app.id === selectedApp?.id ? "Selected" : "Select"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Panel>
        </section>
      )}

      {tab === "scan" && (
        <section id={settingsPanelId("scan")} role="tabpanel" aria-labelledby={settingsTabId("scan")}>
          <Panel title="UI scan profile" action={<StatusPill tone={authMode === "manual" ? "yellow" : "green"} label={authSummary} />}>
          <div className="service-grid compact">
            <div className="service-row">
              <span>Scan routes</span>
              <span>
                <StatusPill tone={selectedApp?.uiScanConfig.routes.length ? "green" : "yellow"} label={`${selectedApp?.uiScanConfig.routes.length ?? 0} saved`} />
                <button className="button secondary small" type="button" onClick={() => onOpenRoute("ui-map")} style={{ marginLeft: 8 }}>
                  Edit routes in UI map
                </button>
              </span>
            </div>
          </div>
          <div className="form-grid">
            <label>
              Auth mode
              <select value={authMode} onChange={(event) => setAuthMode(event.target.value as UiScanAuthMode)}>
                <option value="none">No auth</option>
                <option value="login_form">Login form</option>
                <option value="manual">Manual browser login</option>
              </select>
            </label>
            {authMode === "login_form" && (
              <>
                <label>
                  Login route or URL
                  <input value={loginUrl} onChange={(event) => setLoginUrl(event.target.value)} placeholder="/login" />
                </label>
                <label>
                  Username
                  <input value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="off" />
                </label>
                <label>
                  Password
                  <input
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    type="password"
                    autoComplete="new-password"
                    placeholder={selectedApp?.uiScanConfig.passwordConfigured ? "Password configured" : ""}
                  />
                </label>
                <label className="check-row">
                  <input type="checkbox" checked={clearPassword} onChange={(event) => setClearPassword(event.target.checked)} />
                  Clear saved scan password
                </label>
                <label>
                  Username selector
                  <input value={usernameSelector} onChange={(event) => setUsernameSelector(event.target.value)} placeholder="input[name='email']" />
                </label>
                <label>
                  Password selector
                  <input value={passwordSelector} onChange={(event) => setPasswordSelector(event.target.value)} placeholder="input[type='password']" />
                </label>
                <label>
                  Submit selector
                  <input value={submitSelector} onChange={(event) => setSubmitSelector(event.target.value)} placeholder="button[type='submit']" />
                </label>
                <label>
                  Success URL contains
                  <input value={successUrlPattern} onChange={(event) => setSuccessUrlPattern(event.target.value)} placeholder="/dashboard" />
                </label>
                <label>
                  Post-login wait ms
                  <input value={postLoginWaitMs} onChange={(event) => setPostLoginWaitMs(event.target.value)} inputMode="numeric" />
                </label>
              </>
            )}
          </div>
          {saveDisabledReason && <InlineAlert tone="yellow" title="Scan password" message={saveDisabledReason} />}
          <div className="panel-actions">
            <button className="button primary" type="button" disabled={pending === "save-app"} onClick={() => void saveApp()}>
              <ShieldCheck size={16} />
              {pending === "save-app" ? "Saving" : "Save scan profile"}
            </button>
          </div>
          </Panel>
        </section>
      )}

      {tab === "privacy" && (
        <section id={settingsPanelId("privacy")} role="tabpanel" aria-labelledby={settingsTabId("privacy")}>
          <Panel title="Scan safety and privacy">
          <div className="form-grid">
            <label>
              Runtime telemetry
              <select value={telemetryMode} onChange={(event) => setTelemetryMode(event.target.value as TelemetryMode)}>
                <option value="events_only">Events only</option>
                <option value="redacted">Redacted diagnostics</option>
                <option value="full">Full diagnostics with user consent</option>
              </select>
            </label>
            <label>
              Retention days
              <input value={retentionDays} onChange={(event) => setRetentionDays(event.target.value)} inputMode="numeric" min="1" max="3650" />
            </label>
            <label>
              Ignored selectors
              <textarea value={ignoredSelectors} onChange={(event) => setIgnoredSelectors(event.target.value)} rows={4} placeholder={"[data-private]\n.billing-card"} />
            </label>
            <label>
              Redacted text selectors
              <textarea value={redactedSelectors} onChange={(event) => setRedactedSelectors(event.target.value)} rows={4} placeholder={"[data-redact]\n.user-email"} />
            </label>
            <label className="check-row">
              <input type="checkbox" checked={routeDiscoveryEnabled} onChange={(event) => setRouteDiscoveryEnabled(event.target.checked)} />
              Discover same-origin links from scanned pages
            </label>
            <label>
              Max discovered routes
              <input value={routeDiscoveryMaxRoutes} onChange={(event) => setRouteDiscoveryMaxRoutes(event.target.value)} inputMode="numeric" />
            </label>
          </div>
          <InlineAlert tone="gray" title="Capture boundary" message="UI scans store routes, visible UI text, selectors, and descriptions. Add private regions here before scanning production-like data." />
          <div className="panel-actions">
            <button className="button primary" type="button" disabled={pending === "save-app"} onClick={() => void saveApp()}>
              <ShieldCheck size={16} />
              {pending === "save-app" ? "Saving" : "Save privacy settings"}
            </button>
          </div>
          </Panel>
          <Panel title="Runtime data controls">
            <div className="form-grid single">
              <label>
                User ID
                <input value={deleteUserId} onChange={(event) => setDeleteUserId(event.target.value)} placeholder="user_123" />
              </label>
            </div>
            <div className="panel-actions">
              <button className="button secondary" type="button" disabled={!selectedApp || pending === "export-data"} onClick={() => void exportData()}>
                <Download size={16} />
                Export app data
              </button>
              <button className="button secondary" type="button" disabled={!selectedApp || pending === "purge-data"} onClick={() => void purgeExpiredData()}>
                <Trash2 size={16} />
                Purge expired
              </button>
              <button className="button danger" type="button" disabled={!selectedApp || !deleteUserId.trim() || pending === "delete-user-data"} onClick={() => void deleteUserData()}>
                <Trash2 size={16} />
                Delete user data
              </button>
            </div>
          </Panel>
        </section>
      )}

      {tab === "admins" && (
        <section id={settingsPanelId("admins")} role="tabpanel" aria-labelledby={settingsTabId("admins")}>
          <section className="admin-management-grid">
            <Panel title="Create admin">
              <div className="form-grid single">
                <label>
                  Name
                  <input value={newAdminName} onChange={(event) => setNewAdminName(event.target.value)} />
                </label>
                <label>
                  Email
                  <input value={newAdminEmail} onChange={(event) => setNewAdminEmail(event.target.value)} type="email" />
                </label>
                <label>
                  Temporary password
                  <input value={newAdminPassword} onChange={(event) => setNewAdminPassword(event.target.value)} type="password" autoComplete="new-password" />
                </label>
              </div>
              <div className="panel-actions">
                <button className="button primary" type="button" disabled={pending === "create-admin"} onClick={() => void createAdmin()}>
                  <Users size={16} />
                  {pending === "create-admin" ? "Creating" : "Create admin"}
                </button>
              </div>
            </Panel>

            <Panel title="Current admins" action={<button className="button secondary small" type="button" disabled={adminsLoadState === "loading"} onClick={() => void loadAdmins()}><RefreshCw className={adminsLoadState === "loading" ? "is-spinning" : ""} size={14} />Refresh</button>}>
              <div className="table-frame">
                <table>
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Email</th>
                      <th>Last login</th>
                      <th>Status</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {users.length === 0 && <EmptyTableRow colSpan={5} message={adminsLoadState === "loading" ? "Loading console admins." : adminsLoadState === "error" ? "Console admins could not be loaded." : "No console admins found."} />}
                    {users.map((user) => (
                      <tr key={user.id}>
                        <td>{user.name}</td>
                        <td>{user.email}</td>
                        <td>{user.lastLoginAt ? formatDate(user.lastLoginAt) : <span className="muted">Never</span>}</td>
                        <td><StatusPill tone={user.disabledAt ? "red" : "green"} label={user.disabledAt ? "disabled" : "active"} /></td>
                        <td>
                          {!user.disabledAt && user.id !== consoleUser?.id && (
                            <button className="button secondary small" type="button" disabled={pending === `disable:${user.id}`} onClick={() => void disableUser(user.id)}>
                              Disable
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Panel>
          </section>

          <Panel title="Change my password">
            <div className="form-grid">
              <label>
                Current password
                <input value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} type="password" autoComplete="current-password" />
              </label>
              <label>
                New password
                <input value={nextPassword} onChange={(event) => setNextPassword(event.target.value)} type="password" autoComplete="new-password" />
              </label>
            </div>
            <div className="panel-actions">
              <button className="button primary" type="button" disabled={pending === "change-password"} onClick={() => void changeOwnPassword()}>
                <KeyRound size={16} />
                {pending === "change-password" ? "Changing" : "Change password"}
              </button>
            </div>
          </Panel>

          <Panel title="Console sessions" action={<StatusPill tone={adminsLoadState === "error" ? "red" : sessions.length ? "green" : "gray"} label={adminsLoadState === "loading" ? "loading" : `${sessions.length} sessions`} />}>
            <div className="table-frame bounded-table">
              <table>
                <thead>
                  <tr>
                    <th>User</th>
                    <th>Created</th>
                    <th>Last used</th>
                    <th>Expires</th>
                    <th>Status</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {sessions.length === 0 && <EmptyTableRow colSpan={6} message={adminsLoadState === "loading" ? "Loading console sessions." : adminsLoadState === "error" ? "Console sessions could not be loaded." : "No console sessions found."} />}
                  {sessions.map((session) => (
                    <tr key={session.id}>
                      <td>{session.user.email}</td>
                      <td>{formatDate(session.createdAt)}</td>
                      <td>{session.lastUsedAt ? formatDate(session.lastUsedAt) : <span className="muted">Never</span>}</td>
                      <td>{formatDate(session.expiresAt)}</td>
                      <td><StatusPill tone={session.revokedAt ? "red" : "green"} label={session.revokedAt ? "revoked" : "active"} /></td>
                      <td>
                        {!session.revokedAt && (
                          <button className="button secondary small" type="button" disabled={pending === `session:${session.id}`} onClick={() => void revokeSession(session.id)}>
                            Revoke
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
        </section>
      )}

      {tab === "danger" && (
        <section id={settingsPanelId("danger")} role="tabpanel" aria-labelledby={settingsTabId("danger")}>
          <Panel title="Archive app" action={<AlertTriangle size={16} />}>
          {selectedApp ? (
            <>
              <InlineAlert tone="yellow" title="Archive app" message="Archiving removes this app from active setup and runtime configuration, but keeps historical maps, workflows, logs, and metrics in the database." />
              <label>
                Type the app slug to confirm
                <input value={archiveConfirm} onChange={(event) => setArchiveConfirm(event.target.value)} placeholder={selectedApp.slug} />
              </label>
              <div className="panel-actions">
                <button
                  className="button secondary danger"
                  type="button"
                  disabled={archiveConfirm !== selectedApp.slug || pending === "archive-app"}
                  onClick={() => void archiveApp()}
                >
                  <Archive size={16} />
                  {pending === "archive-app" ? "Archiving" : "Archive app"}
                </button>
              </div>
            </>
          ) : (
            <div className="empty-state">No active app selected.</div>
          )}
          </Panel>
        </section>
      )}
    </div>
  );
}

function settingsTabId(tab: SettingsTab): string {
  return `settings-tab-${tab}`;
}

function settingsPanelId(tab: SettingsTab): string {
  return `settings-panel-${tab}`;
}

function settingsIntro(tab: SettingsTab): { title: string; description: string } {
  if (tab === "backend") {
    return {
      title: "Backend and provider setup",
      description: "Confirm the self-hosted backend URL and provider readiness before admins trust scan, workflow, or runtime behavior."
    };
  }
  if (tab === "app") {
    return {
      title: "Customer app record",
      description: "Define the app Mia is being installed into, including the base URL and whether users should get workflows or Q&A-only assistance."
    };
  }
  if (tab === "scan") {
    return {
      title: "UI scan profile",
      description: "Configure how the scanner signs in to your app. The routes to scan are managed on the UI map page, so there is one source of truth."
    };
  }
  if (tab === "privacy") {
    return {
      title: "Privacy and capture boundaries",
      description: "Exclude private UI regions and redact sensitive text before scanning production-like data."
    };
  }
  if (tab === "admins") {
    return {
      title: "Console admins and sessions",
      description: "Manage who can operate this backend, rotate access, and revoke stale console sessions."
    };
  }
  return {
    title: "Danger zone",
    description: "Archive the selected app only when it should stop being active for setup and runtime operations."
  };
}

function readinessLabel(status?: string): string {
  if (status === "ok") return "connected";
  if (status === "unverified") return "configured";
  if (status === "missing_config") return "missing config";
  if (status === "error") return "error";
  return "unknown";
}

function splitLines(value: string): string[] {
  return value.split("\n").map((line) => line.trim()).filter(Boolean);
}
