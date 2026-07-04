import { Copy, KeyRound, Plus, X } from "lucide-react";
import { useEffect, useState } from "react";
import type { ApiKeyRecord, ApiKeyScope, AppRecord, BackendApi, CreatedApiKey } from "../api";
import { EmptyTableRow, Panel, StatusPill } from "../components/console";
import { formatDate } from "../utils/format";

const scopeOptions: ApiKeyScope[] = ["apps:read", "ui-map:read", "workflows:read", "runtime:write", "logs:write", "logs:read", "admin"];

export function ApiKeysPage({
  api,
  apps,
  selectedAppId,
  showToast
}: {
  api: BackendApi;
  apps: AppRecord[];
  selectedAppId: string;
  showToast: (message: string) => void;
}) {
  const [keys, setKeys] = useState<ApiKeyRecord[]>([]);
  const [name, setName] = useState("Local SDK key");
  const [scopes, setScopes] = useState<ApiKeyScope[]>(["runtime:write", "logs:write"]);
  const [appId, setAppId] = useState(selectedAppId);
  const [allowedOrigins, setAllowedOrigins] = useState(() => defaultOrigin(apps.find((app) => app.id === selectedAppId)));
  const [createdKey, setCreatedKey] = useState<CreatedApiKey | null>(null);
  const [pendingKeyId, setPendingKeyId] = useState<string | null>(null);

  const load = async () => {
    try {
      setKeys((await api.listApiKeys()).items);
    } catch (cause) {
      showToast(cause instanceof Error ? cause.message : "Unable to load API keys");
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api]);

  useEffect(() => {
    if (!selectedAppId || appId) return;
    setAppId(selectedAppId);
    setAllowedOrigins(defaultOrigin(apps.find((app) => app.id === selectedAppId)));
  }, [appId, apps, selectedAppId]);

  const toggleScope = (scope: ApiKeyScope) => {
    setScopes((current) => current.includes(scope) ? current.filter((item) => item !== scope) : [...current, scope]);
  };

  const create = async () => {
    try {
      const next = await api.createApiKey({
        name,
        scopes,
        ...(scopes.includes("admin") ? {} : { appId, allowedOrigins: parseOrigins(allowedOrigins) })
      });
      setCreatedKey(next);
      await load();
      showToast("API key created");
    } catch (cause) {
      showToast(cause instanceof Error ? cause.message : "Unable to create API key");
    }
  };

  const revoke = async (keyId: string) => {
    setPendingKeyId(keyId);
    try {
      await api.revokeApiKey(keyId);
      await load();
      showToast("API key revoked");
    } catch (cause) {
      showToast(cause instanceof Error ? cause.message : "Unable to revoke API key");
    } finally {
      setPendingKeyId(null);
    }
  };

  const copyKey = async () => {
    if (!createdKey) return;
    await navigator.clipboard?.writeText(createdKey.key);
    showToast("API key copied");
  };

  return (
    <div className="page-grid">
      <Panel title="Create API key" action={<StatusPill tone="green" label="Hashed at rest" />}>
        <div className="form-grid single">
          <label>
            Key name
            <input value={name} onChange={(event) => setName(event.target.value)} />
          </label>
          <div>
            <div className="field-label">Scopes</div>
            <div className="scope-grid">
              {scopeOptions.map((scope) => (
                <label className="check-row" key={scope}>
                  <input type="checkbox" checked={scopes.includes(scope)} onChange={() => toggleScope(scope)} />
                  {scope}
                </label>
              ))}
            </div>
          </div>
          {!scopes.includes("admin") && (
            <>
              <label>
                Bound app
                <select value={appId} onChange={(event) => {
                  const nextAppId = event.target.value;
                  setAppId(nextAppId);
                  setAllowedOrigins(defaultOrigin(apps.find((app) => app.id === nextAppId)));
                }}>
                  <option value="">Select app</option>
                  {apps.map((app) => <option key={app.id} value={app.id}>{app.name}</option>)}
                </select>
              </label>
              <label>
                Allowed origins
                <textarea
                  value={allowedOrigins}
                  onChange={(event) => setAllowedOrigins(event.target.value)}
                  placeholder="https://app.example.com"
                />
              </label>
            </>
          )}
        </div>
        <div className="panel-actions">
          <button className="button primary" type="button" onClick={() => void create()}>
            <Plus size={16} />
            Create key
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
        </Panel>
      )}

      <Panel title="API keys" action={<KeyRound size={16} />}>
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
            {keys.length === 0 && <EmptyTableRow colSpan={9} message="No API keys created yet." />}
            {keys.map((key) => (
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
      </Panel>
    </div>
  );
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

function appName(apps: AppRecord[], appId: string): string {
  return apps.find((app) => app.id === appId)?.name ?? appId;
}
