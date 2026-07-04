import { Database, Save } from "lucide-react";
import { useEffect, useState } from "react";
import type { AppRecord, BackendApi, SystemReadiness, UiScanAuthMode } from "../api";
import { Panel, ServiceRow, StatusPill } from "../components/console";
import { formatDate } from "../utils/format";

export function SettingsPage({
  backendUrl,
  setBackendUrl,
  apps,
  selectedApp,
  api,
  readiness,
  refresh,
  showToast
}: {
  backendUrl: string;
  setBackendUrl: (value: string) => void;
  apps: AppRecord[];
  selectedApp: AppRecord | null;
  api: BackendApi;
  readiness: SystemReadiness | null;
  refresh: (preferredAppId?: string) => Promise<void>;
  showToast: (message: string) => void;
}) {
  const [urlDraft, setUrlDraft] = useState(backendUrl);
  const [name, setName] = useState(selectedApp?.name ?? "MIA onboarding app");
  const [slug, setSlug] = useState(selectedApp?.slug ?? "mia-onboarding");
  const [baseUrl, setBaseUrl] = useState(selectedApp?.baseUrl ?? "http://localhost:3000");
  const [routes, setRoutes] = useState(selectedApp?.uiScanConfig.routes.join("\n") ?? "/");
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

  useEffect(() => {
    if (selectedApp) {
      setName(selectedApp.name);
      setSlug(selectedApp.slug);
      setBaseUrl(selectedApp.baseUrl);
      setRoutes(selectedApp.uiScanConfig.routes.join("\n"));
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
    }
  }, [selectedApp]);

  const saveBackendUrl = () => {
    window.localStorage.setItem("mia-console-backend-url", urlDraft);
    setBackendUrl(urlDraft);
    showToast("Backend URL saved");
  };

  const saveApp = async () => {
    try {
      const app = await api.saveApp({
        name,
        slug,
        baseUrl,
        uiScanConfig: {
          routes: splitLines(routes),
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
      showToast("App saved");
    } catch (cause) {
      showToast(cause instanceof Error ? cause.message : "Unable to save app");
    }
  };

  return (
    <div className="page-grid narrow">
      <Panel title="Backend connection" action={<StatusPill tone="green" label="Local backend" />}>
        <div className="form-grid single">
          <label>
            Backend URL
            <input value={urlDraft} onChange={(event) => setUrlDraft(event.target.value)} />
          </label>
        </div>
        <div className="panel-actions">
          <button className="button primary" type="button" onClick={saveBackendUrl}>
            <Save size={16} />
            Save backend URL
          </button>
        </div>
      </Panel>

      <Panel title="Application record" action={<span className="muted">{apps.length} app(s)</span>}>
        <div className="form-grid">
          <label>
            App name
            <input value={name} onChange={(event) => setName(event.target.value)} />
          </label>
          <label>
            App slug
            <input value={slug} onChange={(event) => setSlug(event.target.value)} />
          </label>
          <label>
            Target app base URL
            <input value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} />
          </label>
        </div>
      </Panel>

      <Panel title="UI scan profile">
        <div className="form-grid">
          <label>
            Default routes
            <textarea value={routes} onChange={(event) => setRoutes(event.target.value)} rows={5} placeholder={"/\n/settings\n/billing"} />
          </label>
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
      </Panel>

      <Panel title="Scan safety">
        <div className="form-grid">
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
        <div className="panel-actions">
          <button className="button primary" type="button" onClick={() => void saveApp()}>
            <Database size={16} />
            Save app and scan profile
          </button>
        </div>
      </Panel>

      <Panel title="Existing apps">
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Slug</th>
              <th>Base URL</th>
              <th>Updated</th>
            </tr>
          </thead>
          <tbody>
            {apps.map((app) => (
              <tr key={app.id}>
                <td>{app.name}</td>
                <td><code>{app.slug}</code></td>
                <td>{app.baseUrl}</td>
                <td>{formatDate(app.updatedAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>

      <Panel title="Provider readiness">
        <div className="service-grid">
          <ServiceRow label="Database" value={readinessLabel(readiness?.database.status)} />
          <ServiceRow label="Gemini" value={readinessLabel(readiness?.providers.gemini.status)} />
          <ServiceRow label="Semantic search" value={readinessLabel(readiness?.providers.semanticSearch.status)} />
        </div>
      </Panel>
    </div>
  );
}

function splitLines(value: string): string[] {
  return value.split(/[\n,]/).map((item) => item.trim()).filter(Boolean);
}

function readinessLabel(status?: string): string {
  if (status === "ok") return "connected";
  if (status === "unverified") return "configured";
  if (status === "missing_config") return "missing config";
  if (status === "error") return "error";
  return "unknown";
}
