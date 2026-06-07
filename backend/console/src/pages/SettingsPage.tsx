import { Database, Save } from "lucide-react";
import { useEffect, useState } from "react";
import type { AppRecord, BackendApi, SystemReadiness } from "../api";
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

  useEffect(() => {
    if (selectedApp) {
      setName(selectedApp.name);
      setSlug(selectedApp.slug);
      setBaseUrl(selectedApp.baseUrl);
    }
  }, [selectedApp]);

  const saveBackendUrl = () => {
    window.localStorage.setItem("mia-console-backend-url", urlDraft);
    setBackendUrl(urlDraft);
    showToast("Backend URL saved");
  };

  const saveApp = async () => {
    try {
      const app = await api.saveApp({ name, slug, baseUrl });
      await refresh(app.id);
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
        <div className="panel-actions">
          <button className="button primary" type="button" onClick={() => void saveApp()}>
            <Database size={16} />
            Create or update app
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
          <ServiceRow label="Qwen" value={readinessLabel(readiness?.providers.qwen.status)} />
          <ServiceRow label="Moss" value={readinessLabel(readiness?.providers.moss.status)} />
          <ServiceRow label="LiveKit" value={readinessLabel(readiness?.providers.livekit.status)} />
          <ServiceRow label="Qwen Voice/TTS" value={readinessLabel(readiness?.providers.qwenTts.status)} />
          <ServiceRow label="STT" value={readinessLabel(readiness?.providers.stt.status)} />
        </div>
      </Panel>
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
