import { ChevronRight, FileJson, RefreshCw } from "lucide-react";
import { useState } from "react";
import type { AppRecord, BackendApi, UiElement, UiMapVersion, UiPage } from "../api";
import { EmptyTableRow, Panel, RawJsonViewer, SelectorQualityBadge, StatusPill } from "../components/console";
import { formatDate } from "../utils/format";

export function UiMapPage({
  app,
  pages,
  elements,
  latestUiMap,
  api,
  refresh,
  onOpenPage,
  showToast
}: {
  app: AppRecord | null;
  pages: UiPage[];
  elements: UiElement[];
  latestUiMap: UiMapVersion | null;
  api: BackendApi;
  refresh: (preferredAppId?: string) => Promise<void>;
  onOpenPage: (pageId: string) => void;
  showToast: (message: string) => void;
}) {
  const [routes, setRoutes] = useState("/\n/dashboard\n/settings");

  const scan = async () => {
    if (!app) {
      showToast("Create an app first.");
      return;
    }
    const routeList = routes.split("\n").map((route) => route.trim()).filter(Boolean);
    try {
      await api.scanUiMap(app.id, routeList);
      await refresh(app.id);
      showToast("UI map scan started");
    } catch (cause) {
      showToast(cause instanceof Error ? cause.message : "Unable to scan UI map");
    }
  };

  return (
    <div className="page-grid">
      <Panel title="Trigger UI mapping scan" action={<StatusPill tone={latestUiMap ? "green" : "gray"} label={latestUiMap?.version ?? "No map"} />}>
        <div className="scan-form">
          <label>
            Routes to scan
            <textarea value={routes} onChange={(event) => setRoutes(event.target.value)} rows={5} />
          </label>
          <button className="button primary" type="button" onClick={() => void scan()}>
            <RefreshCw size={16} />
            Trigger backend scan
          </button>
        </div>
      </Panel>

      <Panel title="Scanned pages" action={<span className="muted">{elements.length} elements indexed</span>}>
        <table>
          <thead>
            <tr>
              <th>Page</th>
              <th>Route</th>
              <th>Status</th>
              <th>Elements</th>
              <th>Created</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {pages.length === 0 && <EmptyTableRow colSpan={6} message="No UI map pages yet. Trigger a scan after creating an app." />}
            {pages.map((page) => (
              <tr key={page.id}>
                <td>{page.name}</td>
                <td><code>{page.route}</code></td>
                <td><StatusPill tone={page.status === "failed" ? "red" : "green"} label={page.status} /></td>
                <td>{elements.filter((element) => element.pageId === page.id).length}</td>
                <td>{formatDate(page.createdAt)}</td>
                <td>
                  <button className="button secondary small" type="button" onClick={() => onOpenPage(page.id)}>
                    Open detail
                    <ChevronRight size={14} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>
    </div>
  );
}

export function UiMapDetailPage({
  page,
  elements,
  api,
  refresh,
  onBack,
  showToast
}: {
  page: UiPage;
  elements: UiElement[];
  api: BackendApi;
  refresh: (preferredAppId?: string) => Promise<void>;
  onBack: () => void;
  showToast: (message: string) => void;
}) {
  const [rawOpen, setRawOpen] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  const saveElement = async (element: UiElement) => {
    try {
      await api.updateElement(element.elementId, { description: drafts[element.elementId] ?? element.description });
      await refresh(element.appId);
      showToast("Element metadata saved");
    } catch (cause) {
      showToast(cause instanceof Error ? cause.message : "Unable to save element");
    }
  };

  return (
    <div className="page-grid">
      <div className="inline-header">
        <button className="button secondary" type="button" onClick={onBack}>Back to UI map</button>
        <div>
          <h2>{page.name}</h2>
          <p>{page.route} - {elements.length} mapped elements</p>
        </div>
      </div>

      <Panel title="Mapped elements" action={<button className="button secondary small" type="button" onClick={() => setRawOpen((open) => !open)}><FileJson size={14} /> Raw JSON</button>}>
        <table>
          <thead>
            <tr>
              <th>Element ID</th>
              <th>Type</th>
              <th>Label</th>
              <th>Description</th>
              <th>Selector</th>
              <th>Quality</th>
              <th>Warnings</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {elements.length === 0 && <EmptyTableRow colSpan={8} message="No elements saved for this page." />}
            {elements.map((element) => (
              <tr key={element.id}>
                <td><code>{element.elementId}</code></td>
                <td>{element.elementType}</td>
                <td>{element.label ?? "Unlabeled"}</td>
                <td>
                  <input
                    className="table-input"
                    value={drafts[element.elementId] ?? element.description}
                    onChange={(event) => setDrafts((current) => ({ ...current, [element.elementId]: event.target.value }))}
                  />
                </td>
                <td><code>{element.selector}</code></td>
                <td><SelectorQualityBadge quality={element.selectorQuality} /></td>
                <td>{element.selectorWarnings.join(", ") || <span className="muted">None</span>}</td>
                <td>
                  <button className="button secondary small" type="button" onClick={() => void saveElement(element)}>
                    Save
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>

      {rawOpen && <RawJsonViewer title="UI element raw records" data={elements} />}
    </div>
  );
}
