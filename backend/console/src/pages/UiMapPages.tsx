import { Camera, ChevronRight, FileJson, Navigation, RefreshCw, Square, XCircle } from "lucide-react";
import { useState } from "react";
import type { AppRecord, BackendApi, InteractiveUiMapSession, UiElement, UiMapVersion, UiPage } from "../api";
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
  const [authMode, setAuthMode] = useState<"none" | "login_form">("none");
  const [session, setSession] = useState<InteractiveUiMapSession | null>(null);
  const [routeDraft, setRouteDraft] = useState("/dashboard");
  const [stateName, setStateName] = useState("default");
  const [stateReason, setStateReason] = useState("");

  const scan = async () => {
    if (!app) {
      showToast("Create an app first.");
      return;
    }
    const routeList = routes.split("\n").map((route) => route.trim()).filter(Boolean);
    try {
      await api.scanUiMap(app.id, routeList, authMode);
      await refresh(app.id);
      showToast("UI map scan started");
    } catch (cause) {
      showToast(cause instanceof Error ? cause.message : "Unable to scan UI map");
    }
  };

  const startInteractive = async () => {
    if (!app) {
      showToast("Create an app first.");
      return;
    }
    const routeList = routes.split("\n").map((route) => route.trim()).filter(Boolean);
    try {
      const nextSession = await api.startInteractiveUiMapSession(app.id, { routes: routeList, authMode });
      setSession(nextSession);
      setRouteDraft(nextSession.currentRoute);
      await refresh(app.id);
      showToast("Interactive mapping session started");
    } catch (cause) {
      showToast(cause instanceof Error ? cause.message : "Unable to start interactive mapping");
    }
  };

  const gotoRoute = async () => {
    if (!session) return;
    try {
      const nextSession = await api.gotoInteractiveUiMapSession(session.sessionId, { route: routeDraft, captureDefault: true });
      setSession(nextSession);
      await refresh(app?.id);
      showToast(`Captured default state for ${routeDraft}`);
    } catch (cause) {
      showToast(cause instanceof Error ? cause.message : "Unable to navigate interactive browser");
    }
  };

  const captureState = async () => {
    if (!session) return;
    try {
      const nextSession = await api.captureInteractiveUiMapState(session.sessionId, {
        stateName,
        stateReason: stateReason || undefined
      });
      setSession(nextSession);
      await refresh(app?.id);
      showToast(`Captured ${nextSession.capture?.savedElements ?? 0} new elements`);
    } catch (cause) {
      showToast(cause instanceof Error ? cause.message : "Unable to capture browser state");
    }
  };

  const finishInteractive = async () => {
    if (!session) return;
    try {
      await api.finishInteractiveUiMapSession(session.sessionId);
      setSession(null);
      await refresh(app?.id);
      showToast("Interactive map completed");
    } catch (cause) {
      showToast(cause instanceof Error ? cause.message : "Unable to finish interactive mapping");
    }
  };

  const cancelInteractive = async () => {
    if (!session) return;
    try {
      await api.cancelInteractiveUiMapSession(session.sessionId, "Cancelled from console.");
      setSession(null);
      await refresh(app?.id);
      showToast("Interactive map cancelled");
    } catch (cause) {
      showToast(cause instanceof Error ? cause.message : "Unable to cancel interactive mapping");
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
          <label>
            Auth mode
            <select value={authMode} onChange={(event) => setAuthMode(event.target.value as "none" | "login_form")}>
              <option value="none">None</option>
              <option value="login_form">Login form from backend env</option>
            </select>
          </label>
          <button className="button primary" type="button" onClick={() => void scan()}>
            <RefreshCw size={16} />
            Trigger backend scan
          </button>
        </div>
      </Panel>

      <Panel
        title="Interactive authenticated mapping"
        action={<StatusPill tone={session ? "yellow" : "gray"} label={session ? "Session active" : "Local browser"} />}
      >
        <div className="scan-form">
          <div className="empty-state">
            Start a headed Playwright browser, open hidden menus or modals manually in that browser, then capture the current state here. Set <code>UI_SCAN_HEADLESS=false</code> to see the browser.
          </div>
          {!session ? (
            <button className="button primary" type="button" onClick={() => void startInteractive()}>
              <Camera size={16} />
              Start interactive scan
            </button>
          ) : (
            <>
              <div className="summary-item">
                <span>Session</span>
                <strong><code>{session.sessionId}</code></strong>
              </div>
              <div className="summary-item">
                <span>Current route</span>
                <strong>{session.currentRoute}</strong>
              </div>
              <label>
                Route to open
                <input value={routeDraft} onChange={(event) => setRouteDraft(event.target.value)} />
              </label>
              <button className="button secondary" type="button" onClick={() => void gotoRoute()}>
                <Navigation size={16} />
                Go to route and capture default
              </button>
              <label>
                State name
                <input value={stateName} onChange={(event) => setStateName(event.target.value)} placeholder="row actions menu open" />
              </label>
              <label>
                State reason
                <input value={stateReason} onChange={(event) => setStateReason(event.target.value)} placeholder="Manual capture after opening dropdown" />
              </label>
              <button className="button primary" type="button" onClick={() => void captureState()}>
                <Camera size={16} />
                Capture current browser state
              </button>
              <div className="panel-actions">
                <button className="button secondary" type="button" onClick={() => void finishInteractive()}>
                  <Square size={16} />
                  Finish map
                </button>
                <button className="button secondary" type="button" onClick={() => void cancelInteractive()}>
                  <XCircle size={16} />
                  Cancel session
                </button>
              </div>
              {session.capture && (
                <div className="empty-state">
                  Last capture saved {session.capture.savedElements} new elements, skipped {session.capture.duplicateElements} duplicates, and found {session.capture.weakSelectors} weak selectors.
                </div>
              )}
            </>
          )}
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
              <th>States</th>
              <th>Created</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {pages.length === 0 && <EmptyTableRow colSpan={7} message="No UI map pages yet. Trigger a scan after creating an app." />}
            {pages.map((page) => (
              <tr key={page.id}>
                <td>{page.name}</td>
                <td><code>{page.route}</code></td>
                <td><StatusPill tone={page.status === "failed" ? "red" : "green"} label={page.status} /></td>
                <td>{elements.filter((element) => element.pageId === page.id).length}</td>
                <td>{stateSummary(elements.filter((element) => element.pageId === page.id))}</td>
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

function stateSummary(elements: UiElement[]): string {
  const states = new Set(elements.map((element) => element.stateName ?? "default"));
  return states.size === 0 ? "None" : [...states].join(", ");
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
              <th>State</th>
              <th>Quality</th>
              <th>Warnings</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {elements.length === 0 && <EmptyTableRow colSpan={9} message="No elements saved for this page." />}
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
                <td>
                  <div>{element.stateName ?? "default"}</div>
                  <div className="muted">{element.discoveredBy ?? "route_scan"}</div>
                </td>
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
