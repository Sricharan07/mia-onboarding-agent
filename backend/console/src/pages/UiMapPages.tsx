import { Camera, ChevronRight, FileJson, Filter, Navigation, RefreshCw, Save, Square, XCircle } from "lucide-react";
import { useEffect, useState } from "react";
import type { AppRecord, BackendApi, InteractiveUiMapSession, UiElement, UiMapPreflightReport, UiMapVersion, UiPage, UiScanAuthMode } from "../api";
import { EmptyTableRow, InlineAlert, Panel, RawJsonViewer, SelectorQualityBadge, StatusPill } from "../components/console";
import { formatDate } from "../utils/format";

type Notice = { tone: "red" | "green" | "yellow" | "gray"; title: string; message: string };

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
  const [routes, setRoutes] = useState("/");
  const [authMode, setAuthMode] = useState<UiScanAuthMode>("none");
  const [session, setSession] = useState<InteractiveUiMapSession | null>(null);
  const [routeDraft, setRouteDraft] = useState("/");
  const [stateName, setStateName] = useState("default");
  const [stateReason, setStateReason] = useState("");
  const [preflight, setPreflight] = useState<UiMapPreflightReport | null>(null);
  const [pending, setPending] = useState("");
  const [notice, setNotice] = useState<Notice | null>(null);

  useEffect(() => {
    if (!app) return;
    const nextRoutes = app.uiScanConfig.routes.length ? app.uiScanConfig.routes : ["/"];
    setRoutes(nextRoutes.join("\n"));
    setAuthMode(app.uiScanConfig.authMode);
    setRouteDraft(nextRoutes[0] ?? "/");
    setPreflight(null);
    setNotice(null);
  }, [app?.id]);

  useEffect(() => {
    setPreflight(null);
  }, [routes, authMode]);

  const runPreflight = async (): Promise<UiMapPreflightReport | null> => {
    if (!app) {
      setNotice({ tone: "yellow", title: "No app selected", message: "Create an app before running UI mapping." });
      showToast("Create an app first.");
      return null;
    }
    const routeList = routes.split("\n").map((route) => route.trim()).filter(Boolean);
    setPending("preflight");
    try {
      const report = await api.preflightUiMap(app.id, routeList, authMode);
      setPreflight(report);
      setNotice(report.ok ? null : { tone: "yellow", title: "Preflight needs attention", message: "Review the failed checks before starting a scan." });
      showToast(report.ok ? "Preflight passed" : "Preflight needs attention");
      return report;
    } catch (cause) {
      reportNotice(cause, "Unable to run UI map preflight");
      return null;
    } finally {
      setPending("");
    }
  };

  const scan = async () => {
    if (!app) {
      setNotice({ tone: "yellow", title: "No app selected", message: "Create an app before running UI mapping." });
      showToast("Create an app first.");
      return;
    }
    if (authMode === "manual") {
      setNotice({ tone: "yellow", title: "Manual auth selected", message: "Use interactive scan for manual browser login." });
      showToast("Manual auth uses interactive scan.");
      return;
    }
    const routeList = routes.split("\n").map((route) => route.trim()).filter(Boolean);
    const report = preflight?.ok ? preflight : await runPreflight();
    if (!report?.ok) return;
    setPending("scan");
    try {
      await api.scanUiMap(app.id, routeList, authMode);
      await refresh(app.id);
      setNotice(null);
      showToast("UI map scan started");
    } catch (cause) {
      reportNotice(cause, "Unable to scan UI map");
    } finally {
      setPending("");
    }
  };

  const startInteractive = async () => {
    if (!app) {
      setNotice({ tone: "yellow", title: "No app selected", message: "Create an app before starting interactive mapping." });
      showToast("Create an app first.");
      return;
    }
    const routeList = routes.split("\n").map((route) => route.trim()).filter(Boolean);
    setPending("interactive");
    try {
      const nextSession = await api.startInteractiveUiMapSession(app.id, { routes: routeList, authMode });
      setSession(nextSession);
      setRouteDraft(nextSession.currentRoute);
      await refresh(app.id);
      setNotice(null);
      showToast("Interactive mapping session started");
    } catch (cause) {
      reportNotice(cause, "Unable to start interactive mapping");
    } finally {
      setPending("");
    }
  };

  const gotoRoute = async () => {
    if (!session) return;
    try {
      const nextSession = await api.gotoInteractiveUiMapSession(session.sessionId, { route: routeDraft, captureDefault: true });
      setSession(nextSession);
      await refresh(app?.id);
      setNotice(null);
      showToast(`Captured default state for ${routeDraft}`);
    } catch (cause) {
      reportNotice(cause, "Unable to navigate interactive browser");
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
      setNotice(null);
      showToast(`Captured ${nextSession.capture?.savedElements ?? 0} new elements`);
    } catch (cause) {
      reportNotice(cause, "Unable to capture browser state");
    }
  };

  const finishInteractive = async () => {
    if (!session) return;
    try {
      await api.finishInteractiveUiMapSession(session.sessionId);
      setSession(null);
      await refresh(app?.id);
      setNotice(null);
      showToast("Interactive map completed");
    } catch (cause) {
      reportNotice(cause, "Unable to finish interactive mapping");
    }
  };

  const cancelInteractive = async () => {
    if (!session) return;
    try {
      await api.cancelInteractiveUiMapSession(session.sessionId, "Cancelled from console.");
      setSession(null);
      await refresh(app?.id);
      setNotice(null);
      showToast("Interactive map cancelled");
    } catch (cause) {
      reportNotice(cause, "Unable to cancel interactive mapping");
    }
  };

  function reportNotice(cause: unknown, fallback: string) {
    const message = cause instanceof Error ? cause.message : fallback;
    setNotice({ tone: "red", title: "UI mapping failed", message });
    showToast(message);
  }

  return (
    <div className="page-grid">
      {notice && <InlineAlert tone={notice.tone} title={notice.title} message={notice.message} />}
      <Panel title="Trigger UI mapping scan" action={<StatusPill tone={latestUiMap ? "green" : "gray"} label={latestUiMap?.version ?? "No map"} />}>
        <div className="scan-form">
          <div className="empty-state">
            Scan explicit routes for the selected app. Use Settings to save default routes, auth, redaction, and optional same-origin route discovery.
          </div>
          {app && (
            <div className="service-grid">
              <div className="service-row"><span>Base URL</span><code>{app.baseUrl}</code></div>
              <div className="service-row"><span>Route discovery</span><StatusPill tone={app.uiScanConfig.routeDiscovery.enabled ? "yellow" : "gray"} label={app.uiScanConfig.routeDiscovery.enabled ? `up to ${app.uiScanConfig.routeDiscovery.maxRoutes}` : "off"} /></div>
            </div>
          )}
          <label>
            Routes to scan
            <textarea value={routes} onChange={(event) => setRoutes(event.target.value)} rows={5} />
          </label>
          <label>
            Auth mode
            <select value={authMode} onChange={(event) => setAuthMode(event.target.value as UiScanAuthMode)}>
              <option value="none">No auth</option>
              <option value="login_form">Login form</option>
              <option value="manual">Manual browser login</option>
            </select>
          </label>
          <div className="button-cluster">
            <button className="button secondary" type="button" disabled={pending === "preflight"} onClick={() => void runPreflight()}>
              <Filter size={16} />
              {pending === "preflight" ? "Checking" : "Run preflight"}
            </button>
            <button className="button primary" type="button" disabled={authMode === "manual" || pending === "scan"} onClick={() => void scan()}>
              <RefreshCw size={16} />
              {authMode === "manual" ? "Use interactive scan" : pending === "scan" ? "Starting" : "Trigger backend scan"}
            </button>
          </div>
          {preflight && <PreflightPanel report={preflight} />}
        </div>
      </Panel>

      <Panel
        title="Interactive authenticated mapping"
        action={<StatusPill tone={session ? "yellow" : "gray"} label={session ? "Session active" : "Local browser"} />}
      >
        <div className="scan-form">
          <div className="empty-state">
            Start a headed Playwright browser, sign in manually when needed, open hidden menus, modals, drawers, or table actions, then capture each meaningful state. Set <code>UI_SCAN_HEADLESS=false</code> locally to see the browser.
          </div>
          {!session ? (
            <button className="button primary" type="button" disabled={pending === "interactive"} onClick={() => void startInteractive()}>
              <Camera size={16} />
              {pending === "interactive" ? "Starting" : "Start interactive scan"}
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

function PreflightPanel({ report }: { report: UiMapPreflightReport }) {
  return (
    <div className="checklist-panel">
      {report.checks.map((check) => (
        <div className="check-row-item" key={check.id}>
          <StatusPill tone={check.status === "passed" ? "green" : check.status === "warning" ? "yellow" : "red"} label={check.status} />
          <span>
            <strong>{check.label}</strong>
            <span>{check.message}{check.fix ? ` ${check.fix}` : ""}</span>
          </span>
        </div>
      ))}
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
  const [savingElementId, setSavingElementId] = useState<string | null>(null);
  const [qualityFilter, setQualityFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const [notice, setNotice] = useState<Notice | null>(null);
  const filteredElements = elements.filter((element) => (qualityFilter === "all" || element.selectorQuality === qualityFilter) && (typeFilter === "all" || element.elementType === typeFilter));
  const dirtyElements = filteredElements.filter((element) => drafts[element.id] !== undefined && drafts[element.id] !== element.description);

  const saveElement = async (element: UiElement) => {
    setSavingElementId(element.id);
    try {
      await api.updateElement(element.appId, element.id, { description: drafts[element.id] ?? element.description });
      await refresh(element.appId);
      setNotice(null);
      showToast("Element metadata saved");
    } catch (cause) {
      reportNotice(cause, "Unable to save element");
    } finally {
      setSavingElementId(null);
    }
  };

  const saveAll = async () => {
    setSavingElementId("all");
    try {
      await Promise.all(dirtyElements.map((element) => api.updateElement(element.appId, element.id, { description: drafts[element.id] })));
      await refresh(dirtyElements[0]?.appId);
      setDrafts({});
      setNotice(null);
      showToast(`${dirtyElements.length} element metadata records saved`);
    } catch (cause) {
      reportNotice(cause, "Unable to save element metadata");
    } finally {
      setSavingElementId(null);
    }
  };

  return (
    <div className="page-grid">
      {notice && <InlineAlert tone={notice.tone} title={notice.title} message={notice.message} />}
      <div className="inline-header">
        <button className="button secondary" type="button" onClick={onBack}>Back to UI map</button>
        <div>
          <h2>{page.name}</h2>
          <p>{page.route} - {elements.length} mapped elements</p>
        </div>
      </div>

      <Panel title="Mapped elements" action={<button className="button secondary small" type="button" onClick={() => setRawOpen((open) => !open)}><FileJson size={14} /> Raw JSON</button>}>
        <div className="filter-row compact">
          <label>
            Selector quality
            <select value={qualityFilter} onChange={(event) => setQualityFilter(event.target.value)}>
              <option value="all">All qualities</option>
              <option value="strong">Strong</option>
              <option value="medium">Medium</option>
              <option value="weak">Weak</option>
            </select>
          </label>
          <label>
            Element type
            <select value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)}>
              <option value="all">All types</option>
              {[...new Set(elements.map((element) => element.elementType))].map((type) => <option key={type} value={type}>{type}</option>)}
            </select>
          </label>
          <button className="button primary" type="button" disabled={dirtyElements.length === 0 || savingElementId === "all"} onClick={() => void saveAll()}>
            <Save size={16} />
            {savingElementId === "all" ? "Saving" : `Save ${dirtyElements.length || ""}`.trim()}
          </button>
        </div>
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
            {filteredElements.length === 0 && <EmptyTableRow colSpan={9} message="No elements match the current filters." />}
            {filteredElements.map((element) => (
              <tr key={element.id}>
                <td><code>{element.elementId}</code></td>
                <td>{element.elementType}</td>
                <td>{element.label ?? "Unlabeled"}</td>
                <td>
                  <input
                    className="table-input"
                    value={drafts[element.id] ?? element.description}
                    onChange={(event) => setDrafts((current) => ({ ...current, [element.id]: event.target.value }))}
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
                  <button
                    className="button secondary small"
                    data-testid={`ui-element-save-${element.elementId}`}
                    type="button"
                    disabled={savingElementId === element.id}
                    onClick={() => saveElement(element)}
                  >
                    {savingElementId === element.id ? "Saving" : "Save"}
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

  function reportNotice(cause: unknown, fallback: string) {
    const message = cause instanceof Error ? cause.message : fallback;
    setNotice({ tone: "red", title: "Save failed", message });
    showToast(message);
  }
}
