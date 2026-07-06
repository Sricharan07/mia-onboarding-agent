import { AlertTriangle, Copy, KeyRound, Plus, X } from "lucide-react";
import { useEffect, useState } from "react";
import type { ApiKeyRecord, ApiKeyScope, AppRecord, BackendApi, CreatedApiKey } from "../api";
import { EmptyTableRow, InlineAlert, PageIntro, Panel, StatusPill } from "../components/console";
import { formatDate } from "../utils/format";

type Notice = { tone: "red" | "green" | "yellow" | "gray"; title: string; message: string };
type KeyMode = "browser" | "admin";

const browserScopeOptions: ApiKeyScope[] = ["runtime:write", "logs:write", "apps:read", "ui-map:read", "workflows:read", "logs:read"];
const presets: Array<{ label: string; scopes: ApiKeyScope[] }> = [
  { label: "SDK runtime key", scopes: ["runtime:write", "logs:write"] },
  { label: "Read-only integration key", scopes: ["apps:read", "ui-map:read", "workflows:read", "logs:read"] }
];

export function ApiKeysPage({
  api,
  apps,
  selectedAppId,
  backendUrl,
  showToast
}: {
  api: BackendApi;
  apps: AppRecord[];
  selectedAppId: string;
  backendUrl: string;
  showToast: (message: string) => void;
}) {
  const [keys, setKeys] = useState<ApiKeyRecord[]>([]);
  const [keyMode, setKeyMode] = useState<KeyMode>("browser");
  const [name, setName] = useState("Local SDK key");
  const [scopes, setScopes] = useState<ApiKeyScope[]>(["runtime:write", "logs:write"]);
  const [appId, setAppId] = useState(selectedAppId);
  const [allowedOrigins, setAllowedOrigins] = useState(() => defaultOrigin(apps.find((app) => app.id === selectedAppId)));
  const [createdKey, setCreatedKey] = useState<CreatedApiKey | null>(null);
  const [pendingKeyId, setPendingKeyId] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const visibleKeys = keys.filter((key) => keyMode === "admin" ? key.scopes.includes("admin") : !key.scopes.includes("admin"));

  const load = async () => {
    try {
      setKeys((await api.listApiKeys()).items);
    } catch (cause) {
      reportNotice(cause, "Unable to load API keys");
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api]);

  useEffect(() => {
    setAppId(selectedAppId);
    setAllowedOrigins(defaultOrigin(apps.find((app) => app.id === selectedAppId)));
    setCreatedKey(null);
  }, [apps, selectedAppId]);

  const toggleScope = (scope: ApiKeyScope) => {
    setScopes((current) => current.includes(scope) ? current.filter((item) => item !== scope) : [...current, scope]);
  };

  const create = async () => {
    const nextScopes: ApiKeyScope[] = keyMode === "admin" ? ["admin"] : scopes;
    if (keyMode === "browser" && (!appId || parseOrigins(allowedOrigins).length === 0)) {
      const message = "Choose an app and at least one allowed origin for non-admin keys.";
      setNotice({ tone: "yellow", title: "API key needs an app boundary", message });
      showToast(message);
      return;
    }
    try {
      const next = await api.createApiKey({
        name,
        scopes: nextScopes,
        ...(keyMode === "admin" ? {} : { appId, allowedOrigins: parseOrigins(allowedOrigins) })
      });
      setCreatedKey(next);
      await load();
      setNotice(null);
      showToast("API key created");
    } catch (cause) {
      reportNotice(cause, "Unable to create API key");
    }
  };

  const revoke = async (keyId: string) => {
    setPendingKeyId(keyId);
    try {
      await api.revokeApiKey(keyId);
      await load();
      setNotice(null);
      showToast("API key revoked");
    } catch (cause) {
      reportNotice(cause, "Unable to revoke API key");
    } finally {
      setPendingKeyId(null);
    }
  };

  const copyKey = async () => {
    if (!createdKey) return;
    await navigator.clipboard?.writeText(createdKey.key);
    showToast("API key copied");
  };

  const copySnippet = async () => {
    if (!createdKey || !selectedAppForKey(apps, createdKey.appId)) return;
    await navigator.clipboard?.writeText(sdkSnippet(createdKey, selectedAppForKey(apps, createdKey.appId)!, backendUrl));
    showToast("SDK snippet copied");
  };

  return (
    <div className="page-grid">
      <PageIntro
        title={keyMode === "admin" ? "Backend admin keys" : "Browser SDK keys"}
        description={keyMode === "admin"
          ? "Create server-side keys for trusted backend automation. Admin keys are never safe for browser code."
          : "Create app-bound runtime keys for the installed web SDK, with explicit scopes and allowed origins."}
        action={<StatusPill tone={visibleKeys.some((key) => !key.revokedAt) ? "green" : "gray"} label={`${visibleKeys.length} keys`} />}
      />
      {notice && <InlineAlert tone={notice.tone} title={notice.title} message={notice.message} />}
      <div className="segmented-tabs" role="tablist" aria-label="API key type">
        <button className={keyMode === "browser" ? "is-active" : ""} type="button" role="tab" aria-selected={keyMode === "browser"} onClick={() => {
          setKeyMode("browser");
          setName("Local SDK key");
          setScopes(["runtime:write", "logs:write"]);
          setCreatedKey(null);
        }}>
          Browser SDK keys
        </button>
        <button className={keyMode === "admin" ? "is-active" : ""} type="button" role="tab" aria-selected={keyMode === "admin"} onClick={() => {
          setKeyMode("admin");
          setName("Backend admin key");
          setScopes(["admin"]);
          setCreatedKey(null);
        }}>
          Admin keys
        </button>
      </div>

      <Panel title="Create API key" action={<StatusPill tone="green" label="Hashed at rest" />}>
        {keyMode === "admin" && (
          <InlineAlert tone="red" title="Admin key" message="Admin keys can control this backend. Never put an admin key in browser code, demos, screenshots, or client-side environment variables." />
        )}
        <div className="form-grid single">
          <label>
            Key name
            <input value={name} onChange={(event) => {
              setName(event.target.value);
              setCreatedKey(null);
            }} />
          </label>
          {keyMode === "browser" ? (
          <div>
            <div className="field-label">Scopes</div>
            <div className="preset-row">
              {presets.map((preset) => (
                <button className="button secondary small" type="button" key={preset.label} onClick={() => {
                  setScopes(preset.scopes);
                  setCreatedKey(null);
                }}>
                  {preset.label}
                </button>
              ))}
            </div>
            <div className="scope-grid">
              {browserScopeOptions.map((scope) => (
                <label className="check-row" key={scope}>
                  <input type="checkbox" checked={scopes.includes(scope)} onChange={() => {
                    toggleScope(scope);
                    setCreatedKey(null);
                  }} />
                  {scope}
                </label>
              ))}
            </div>
          </div>
          ) : (
            <div className="admin-key-confirm">
              <AlertTriangle size={18} />
              <div>
                <strong>Server-side use only</strong>
                <span>This key skips app and origin boundaries. Use it only for trusted backend automation and rotate it aggressively.</span>
              </div>
            </div>
          )}
          {keyMode === "browser" && (
            <>
              <label>
                Bound app
                <select value={appId} onChange={(event) => {
                  const nextAppId = event.target.value;
                  setAppId(nextAppId);
                  setAllowedOrigins(defaultOrigin(apps.find((app) => app.id === nextAppId)));
                  setCreatedKey(null);
                }}>
                  <option value="">Select app</option>
                  {apps.map((app) => <option key={app.id} value={app.id}>{app.name}</option>)}
                </select>
              </label>
              <label>
                Allowed origins
                <textarea
                  value={allowedOrigins}
                  onChange={(event) => {
                    setAllowedOrigins(event.target.value);
                    setCreatedKey(null);
                  }}
                  placeholder="https://app.example.com"
                />
              </label>
            </>
          )}
        </div>
        <div className="panel-actions">
          <button className="button primary" type="button" onClick={() => void create()}>
            <Plus size={16} />
            {keyMode === "admin" ? "Create admin key" : "Create browser SDK key"}
          </button>
        </div>
      </Panel>

      {createdKey && (
        <Panel title="New API key" action={<StatusPill tone="yellow" label="Shown once" />}>
          <div className="inline-header compact">
            <div>
              <h2>{createdKey.name}</h2>
              <p>Store this key now. The backend will only keep its hash.</p>
            </div>
            <button className="button secondary" type="button" onClick={() => void copyKey()}>
              <Copy size={16} />
              Copy key
            </button>
          </div>
          <pre className="json-viewer">{createdKey.key}</pre>
          {selectedAppForKey(apps, createdKey.appId) && (
            <div className="sdk-handoff">
              <div className="inline-header compact">
                <div>
                  <h2>SDK install snippet</h2>
                  <p>Use this in the customer web app that matches the allowed origin.</p>
                </div>
                <button className="button secondary" type="button" onClick={() => void copySnippet()}>
                  <Copy size={16} />
                  Copy snippet
                </button>
              </div>
              <pre className="json-viewer">{sdkSnippet(createdKey, selectedAppForKey(apps, createdKey.appId)!, backendUrl)}</pre>
            </div>
          )}
        </Panel>
      )}

      <Panel title={keyMode === "admin" ? "Admin keys" : "Browser SDK keys"} action={<KeyRound size={16} />}>
        <div className="table-frame">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Prefix</th>
                <th>Scopes</th>
                <th>App</th>
                <th>Origins</th>
                <th>Created</th>
                <th>Last used</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {visibleKeys.length === 0 && (
                <EmptyTableRow colSpan={9} message={keyMode === "admin" ? "No admin keys created yet." : "No browser SDK keys created yet."} />
              )}
              {visibleKeys.map((key) => (
                <tr key={key.id}>
                  <td>{key.name}</td>
                  <td><code>{key.prefix}</code></td>
                  <td>{key.scopes.join(", ")}</td>
                  <td>{key.appId ? appName(apps, key.appId) : <span className="muted">Global</span>}</td>
                  <td>{key.allowedOrigins.length ? key.allowedOrigins.join(", ") : <span className="muted">None</span>}</td>
                  <td>{formatDate(key.createdAt)}</td>
                  <td>{key.lastUsedAt ? formatDate(key.lastUsedAt) : <span className="muted">Never</span>}</td>
                  <td><StatusPill tone={key.revokedAt ? "red" : "green"} label={key.revokedAt ? "revoked" : "active"} /></td>
                  <td>
                    {!key.revokedAt && (
                      <button
                        className="button secondary small"
                        data-testid={`api-key-revoke-${key.id}`}
                        type="button"
                        disabled={pendingKeyId === key.id}
                        onClick={() => revoke(key.id)}
                      >
                        <X size={14} />
                        {pendingKeyId === key.id ? "Revoking" : "Revoke"}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  );

  function reportNotice(cause: unknown, fallback: string) {
    const message = cause instanceof Error ? cause.message : fallback;
    setNotice({ tone: "red", title: "API key action failed", message });
    showToast(message);
  }
}

function defaultOrigin(app: AppRecord | undefined): string {
  if (!app) return "";
  try {
    return new URL(app.baseUrl).origin;
  } catch {
    return "";
  }
}

function parseOrigins(value: string): string[] {
  return value.split(/[\n,]/).map((origin) => origin.trim()).filter(Boolean);
}

function selectedAppForKey(apps: AppRecord[], appId: string | null): AppRecord | undefined {
  return appId ? apps.find((app) => app.id === appId) : undefined;
}

function appName(apps: AppRecord[], appId: string): string {
  return apps.find((app) => app.id === appId)?.name ?? appId;
}

function sdkSnippet(key: CreatedApiKey, app: AppRecord, backendUrl: string): string {
  return `# Build the SDK tarball from the MIA repository.
git clone https://github.com/Sricharan07/mia-onboarding-agent.git
cd mia-onboarding-agent
npm install
npm pack -w sdk

# Then run this in the host web app that loads Mia.
npm install /absolute/path/to/mia-onboarding-agent/mia-onboarding-agent-0.1.0.tgz

import { AIOnboardingAgent } from "@mia/onboarding-agent";

AIOnboardingAgent.init({
  appId: "${app.id}",
  backendUrl: "${backendUrl.replace(/\/+$/, "")}",
  apiKey: "${key.key}",
  enableVoice: false,
  ui: {
    assistantPanel: true
  }
});

// Then open Console -> Test Mia and Console -> Logs to verify live runtime targets.`;
}
