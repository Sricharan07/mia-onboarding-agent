import {
  AlertTriangle,
  Camera,
  CheckCircle2,
  ChevronRight,
  ClipboardList,
  FileJson,
  Filter,
  Loader2,
  Navigation,
  Plus,
  RefreshCw,
  Route,
  Save,
  Search,
  Square,
  Trash2,
  XCircle
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type {
  AppRecord,
  BackendApi,
  InteractiveUiMapSession,
  UiElement,
  UiMapPreflightReport,
  UiMapRouteDiscoveryReport,
  UiMapVersion,
  UiPage,
  UiScanAuthMode
} from "../api";
import { EmptyTableRow, InlineAlert, PageIntro, Panel, RawJsonViewer, SelectorQualityBadge, StatusPill } from "../components/console";
import { errorMessage, formatDate } from "../utils/format";

type Notice = { tone: "red" | "green" | "yellow" | "gray"; title: string; message: string };
type SelectorFixGroup = { key: string; title: string; detail: string; count: number; examples: UiElement[] };

export function UiMapPage({
  app,
  pages,
  elements,
  latestUiMap,
  activeUiMapScan,
  uiMapVersions,
  api,
  refresh,
  onOpenPage,
  showToast
}: {
  app: AppRecord | null;
  pages: UiPage[];
  elements: UiElement[];
  latestUiMap: UiMapVersion | null;
  activeUiMapScan: UiMapVersion | null;
  uiMapVersions: UiMapVersion[];
  api: BackendApi;
  refresh: (preferredAppId?: string) => Promise<void>;
  onOpenPage: (pageId: string) => void;
  showToast: (message: string) => void;
}) {
  const [routes, setRoutes] = useState("/");
  const [authMode, setAuthMode] = useState<UiScanAuthMode>("none");
  const [session, setSession] = useState<InteractiveUiMapSession | null>(null);
  const [newRoute, setNewRoute] = useState("/");
  const [interactiveRoute, setInteractiveRoute] = useState("/");
  const [stateName, setStateName] = useState("default");
  const [stateReason, setStateReason] = useState("");
  const [preflight, setPreflight] = useState<UiMapPreflightReport | null>(null);
  const [discovery, setDiscovery] = useState<UiMapRouteDiscoveryReport | null>(null);
  const [pageSearch, setPageSearch] = useState("");
  const [pending, setPending] = useState("");
  const [notice, setNotice] = useState<Notice | null>(null);

  const routeList = useMemo(() => parseRoutes(routes), [routes]);
  const pageElementCounts = useMemo(() => countBy(elements, (element) => element.pageId), [elements]);
  const pageStateCounts = useMemo(() => {
    const counts = new Map<string, Set<string>>();
    for (const element of elements) {
      const states = counts.get(element.pageId) ?? new Set<string>();
      states.add(element.stateName ?? "default");
      counts.set(element.pageId, states);
    }
    return counts;
  }, [elements]);
  const filteredPages = useMemo(() => {
    const query = pageSearch.trim().toLowerCase();
    if (!query) return pages;
    return pages.filter((page) => [page.route, page.name, page.title ?? "", page.status].join(" ").toLowerCase().includes(query));
  }, [pageSearch, pages]);
  const qualityCounts = {
    strong: latestUiMap?.strongSelectorCount ?? elements.filter((element) => element.selectorQuality === "strong").length,
    medium: latestUiMap?.mediumSelectorCount ?? elements.filter((element) => element.selectorQuality === "medium").length,
    weak: latestUiMap?.weakSelectorCount ?? elements.filter((element) => element.selectorQuality === "weak").length
  };
  const newestVersion = uiMapVersions[0] ?? null;
  const routeLimit = app?.uiScanConfig.routeDiscovery.maxRoutes ?? 50;
  const failedPages = pages.filter((page) => page.status === "failed").length;
  const expectedPageCount = latestUiMap?.pageCount ?? 0;
  const displayedPageCount = pages.length || expectedPageCount;
  const pageDataMismatch = pages.length === 0 && expectedPageCount > 0 && latestUiMap?.status === "completed";

  useEffect(() => {
    if (!app) return;
    const nextRoutes = app.uiScanConfig.routes.length ? app.uiScanConfig.routes : ["/"];
    setRoutes(nextRoutes.join("\n"));
    setAuthMode(app.uiScanConfig.authMode);
    setNewRoute(nextRoutes[0] ?? "/");
    setInteractiveRoute(nextRoutes[0] ?? "/");
    setPreflight(null);
    setDiscovery(null);
    setNotice(null);
  }, [app?.id]);

  useEffect(() => {
    setPreflight(null);
  }, [routes, authMode]);

  const setRoutesFromList = (nextRoutes: string[]) => {
    setRoutes(parseRoutes(nextRoutes.join("\n")).join("\n"));
  };

  const addRoute = () => {
    const normalized = normalizeRoute(newRoute);
    if (!normalized) return;
    setRoutesFromList([...routeList, normalized]);
    setNewRoute("/");
  };

  const removeRoute = (route: string) => {
    setRoutesFromList(routeList.filter((item) => item !== route));
  };

  const saveRoutesToProfile = async () => {
    if (!app) return;
    const { passwordConfigured: _passwordConfigured, ...safeUiScanConfig } = app.uiScanConfig;
    setPending("save-routes");
    try {
      await api.saveApp({
        name: app.name,
        slug: app.slug,
        baseUrl: app.baseUrl,
        uiScanConfig: { ...safeUiScanConfig, routes: routeList, authMode }
      });
      await refresh(app.id);
      setNotice({ tone: "green", title: "Scan profile saved", message: `${routeList.length} route(s) are now the default for ${app.name}.` });
      showToast("Scan profile saved");
    } catch (cause) {
      reportNotice(cause, "Unable to save scan profile");
    } finally {
      setPending("");
    }
  };

  const discoverRoutes = async () => {
    if (!app) {
      setNotice({ tone: "yellow", title: "No app selected", message: "Create an app before discovering routes." });
      showToast("Create an app first.");
      return;
    }
    if (authMode === "manual") {
      setNotice({ tone: "yellow", title: "Manual auth selected", message: "Route discovery needs no auth or login-form auth. Use interactive mapping after manual login." });
      showToast("Manual auth uses interactive mapping.");
      return;
    }
    setPending("discover");
    try {
      const report = await api.discoverUiMapRoutes(app.id, { routes: routeList.length ? routeList : ["/"], authMode, maxRoutes: routeLimit });
      const before = new Set(routeList);
      const discoveredRoutes = report.routes.filter((route) => !before.has(route));
      setDiscovery(report);
      setRoutesFromList([...routeList, ...discoveredRoutes]);
      setNotice(report.checkedRoutes.some((route) => route.status === "failed")
        ? { tone: "yellow", title: "Route discovery finished with misses", message: "Some seed routes could not be opened. Keep the discovered routes and review failed seeds below." }
        : { tone: "green", title: "Route discovery finished", message: `${discoveredRoutes.length} new route(s) were added to the scan list.` });
      showToast(`Discovered ${discoveredRoutes.length} new route(s)`);
    } catch (cause) {
      reportNotice(cause, "Unable to discover product routes");
    } finally {
      setPending("");
    }
  };

  const runPreflight = async (): Promise<UiMapPreflightReport | null> => {
    if (!app) {
      setNotice({ tone: "yellow", title: "No app selected", message: "Create an app before running UI mapping." });
      showToast("Create an app first.");
      return null;
    }
    if (routeList.length === 0) {
      setNotice({ tone: "yellow", title: "Routes required", message: "Add at least one route before preflight." });
      return null;
    }
    setPending("preflight");
    try {
      const report = await api.preflightUiMap(app.id, routeList, authMode);
      setPreflight(report);
      setNotice(report.ok ? null : { tone: "yellow", title: "Preflight needs attention", message: "Fix failed checks before starting a scan." });
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
    if (activeUiMapScan) {
      setNotice({ tone: "yellow", title: "Scan already running", message: "Wait for the active UI map scan to finish before starting another one." });
      return;
    }
    if (authMode === "manual") {
      setNotice({ tone: "yellow", title: "Manual auth selected", message: "Use interactive scan for manual browser login." });
      showToast("Manual auth uses interactive scan.");
      return;
    }
    const report = preflight?.ok ? preflight : await runPreflight();
    if (!report?.ok) return;
    setPending("scan");
    try {
      await api.scanUiMap(app.id, routeList, authMode);
      await refresh(app.id);
      setNotice({ tone: "green", title: "Scan started", message: "The console will keep refreshing until the new UI map is complete." });
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
    setPending("interactive");
    try {
      const nextSession = await api.startInteractiveUiMapSession(app.id, { routes: routeList, authMode });
      setSession(nextSession);
      setInteractiveRoute(nextSession.currentRoute);
      await refresh(app.id);
      setNotice({ tone: "green", title: "Interactive browser ready", message: "Use the browser window to sign in and open hidden UI states before capture." });
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
      const nextSession = await api.gotoInteractiveUiMapSession(session.sessionId, { route: interactiveRoute, captureDefault: true });
      setSession(nextSession);
      await refresh(app?.id);
      setNotice(null);
      showToast(`Captured default state for ${interactiveRoute}`);
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
    const message = errorMessage(cause, fallback);
    setNotice({ tone: "red", title: "UI mapping failed", message });
    showToast(message);
  }

  return (
    <div className="page-grid">
      <PageIntro
        title="Map the product UI Mia can use"
        description="Build a reliable UI map from real routes, scan progress, hidden states, and selector quality before letting Mia point at or act on customer screens."
        action={<StatusPill tone={mapReadyTone(latestUiMap, qualityCounts.weak, failedPages)} label={mapReadyLabel(latestUiMap, qualityCounts.weak, failedPages)} />}
      />
      {notice && <InlineAlert tone={notice.tone} title={notice.title} message={notice.message} />}

      <Panel title="UI map readiness" action={<StatusPill tone={activeUiMapScan ? "yellow" : newestVersion ? statusTone(newestVersion.status) : "gray"} label={activeUiMapScan ? "scan running" : newestVersion?.status ?? "no map"} />}>
        <div className="map-readiness-grid">
          <GuideStep index={1} title="Choose coverage" done={routeList.length > 0} detail={app ? `${routeList.length} route(s) queued for ${app.baseUrl}` : "Create an app first."} />
          <GuideStep index={2} title="Verify reachability" done={Boolean(preflight?.ok)} detail={preflight ? preflight.ok ? "Every selected route was checked." : "Fix failed checks below." : "Run full preflight before scanning."} />
          <GuideStep index={3} title="Watch scan progress" done={Boolean(latestUiMap?.status === "completed" && pages.length)} detail={activeUiMapScan ? `${activeUiMapScan.pageCount ?? 0}/${activeUiMapScan.routeCount ?? routeList.length} route(s) captured.` : latestUiMap ? `${latestUiMap.pageCount ?? pages.length} page(s) captured.` : "Start a backend or interactive scan."} />
          <GuideStep index={4} title="Fix weak selectors" done={qualityCounts.weak === 0 && failedPages === 0 && elements.length > 0} detail={qualityCounts.weak ? `${qualityCounts.weak} weak selector(s) need source fixes.` : failedPages ? `${failedPages} failed page(s) need attention.` : elements.length ? "Selector quality is clean." : "No elements indexed yet."} />
        </div>
        <div className="quality-summary">
          <SummaryStat label="Routes selected" value={routeList.length} tone="gray" />
          <SummaryStat label="Pages captured" value={latestUiMap?.pageCount ?? pages.length} tone={failedPages ? "yellow" : "green"} />
          <SummaryStat label="Strong selectors" value={qualityCounts.strong} tone="green" />
          <SummaryStat label="Medium selectors" value={qualityCounts.medium} tone="yellow" />
          <SummaryStat label="Weak selectors" value={qualityCounts.weak} tone={qualityCounts.weak ? "red" : "green"} />
          <SummaryStat label="Captured states" value={new Set(elements.map((element) => element.stateName ?? "default")).size} tone="gray" />
        </div>
        {activeUiMapScan && <ScanProgressPanel scan={activeUiMapScan} />}
        {!activeUiMapScan && latestUiMap?.error && <InlineAlert tone="yellow" title="Last scan warning" message={latestUiMap.error.split("\n")[0] ?? latestUiMap.error} />}
      </Panel>

      <Panel title="Route workbench" action={<StatusPill tone={routeList.length ? "green" : "red"} label={`${routeList.length} route(s)`} />}>
        <div className="route-workbench">
          <div className="route-workbench-main">
            <div className="scan-note">
              Use route discovery to pull same-origin navigation from the target app, then save the list as the default scan profile. Backend scans use this exact list plus any enabled same-origin discovery from Settings.
            </div>
            {app && (
              <div className="service-grid compact">
                <div className="service-row"><span>Base URL</span><code>{app.baseUrl}</code></div>
                <div className="service-row"><span>Saved discovery limit</span><StatusPill tone={app.uiScanConfig.routeDiscovery.enabled ? "yellow" : "gray"} label={app.uiScanConfig.routeDiscovery.enabled ? `${app.uiScanConfig.routeDiscovery.maxRoutes} routes` : "off"} /></div>
                <div className="service-row"><span>Auth profile</span><StatusPill tone={authMode === "manual" ? "yellow" : "gray"} label={authMode} /></div>
              </div>
            )}
            <div className="route-add-row">
              <label>
                Add route
                <input value={newRoute} onChange={(event) => setNewRoute(event.target.value)} onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    addRoute();
                  }
                }} />
              </label>
              <button className="button secondary" type="button" onClick={addRoute}>
                <Plus size={16} />
                Add
              </button>
            </div>
            <label>
              Bulk route list
              <textarea value={routes} onChange={(event) => setRoutes(event.target.value)} rows={7} />
            </label>
            <div className="route-chip-grid" aria-label="Selected routes">
              {routeList.map((route) => (
                <span className="route-chip" key={route}>
                  <Route size={13} />
                  <code>{route}</code>
                  <button type="button" aria-label={`Remove ${route}`} onClick={() => removeRoute(route)}>
                    <Trash2 size={13} />
                  </button>
                </span>
              ))}
              {routeList.length === 0 && <div className="empty-state">Add routes or run discovery before scanning.</div>}
            </div>
          </div>
          <div className="route-workbench-rail">
            <label>
              Auth mode
              <select value={authMode} onChange={(event) => setAuthMode(event.target.value as UiScanAuthMode)}>
                <option value="none">No auth</option>
                <option value="login_form">Login form</option>
                <option value="manual">Manual browser login</option>
              </select>
            </label>
            <button className="button secondary full" type="button" disabled={!app || pending === "discover" || authMode === "manual"} onClick={() => void discoverRoutes()}>
              <Navigation size={16} />
              {pending === "discover" ? "Discovering" : "Discover routes"}
            </button>
            <button className="button secondary full" type="button" disabled={!app || routeList.length === 0 || pending === "save-routes"} onClick={() => void saveRoutesToProfile()}>
              <Save size={16} />
              {pending === "save-routes" ? "Saving" : "Save as scan profile"}
            </button>
            <button className="button secondary full" type="button" disabled={!app || pending === "preflight" || routeList.length === 0} onClick={() => void runPreflight()}>
              <Filter size={16} />
              {pending === "preflight" ? "Checking" : "Run full preflight"}
            </button>
            <button className="button primary full" type="button" disabled={!app || authMode === "manual" || pending === "scan" || Boolean(activeUiMapScan) || routeList.length === 0} onClick={() => void scan()}>
              <RefreshCw size={16} />
              {activeUiMapScan ? "Scan running" : authMode === "manual" ? "Use interactive scan" : pending === "scan" ? "Starting" : "Start backend scan"}
            </button>
          </div>
        </div>
        {discovery && <DiscoveryPanel report={discovery} />}
        {preflight && <PreflightPanel report={preflight} />}
      </Panel>

      <Panel
        title="Interactive authenticated mapping"
        action={<StatusPill tone={session ? "yellow" : "gray"} label={session ? "session active" : "local browser"} />}
      >
        <div className="interactive-map-grid">
          <div className="scan-note">
            Use this when login requires a human or the page has menus, drawers, modals, hover cards, row actions, or tabs that automated route scanning cannot open safely.
          </div>
          {!session ? (
            <button className="button primary" type="button" disabled={!app || pending === "interactive" || routeList.length === 0} onClick={() => void startInteractive()}>
              <Camera size={16} />
              {pending === "interactive" ? "Starting" : "Start interactive scan"}
            </button>
          ) : (
            <div className="interactive-session-grid">
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
                <input value={interactiveRoute} onChange={(event) => setInteractiveRoute(event.target.value)} />
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
            </div>
          )}
        </div>
      </Panel>

      <Panel title="Scanned pages" action={<span className="muted">{latestUiMap?.elementCount ?? elements.length} elements indexed</span>}>
        <div className="table-toolbar">
          <label className="search-field">
            <Search size={15} />
            <span className="visually-hidden">Search scanned pages</span>
            <input value={pageSearch} onChange={(event) => setPageSearch(event.target.value)} placeholder="Search route, page, or status" />
          </label>
          <StatusPill tone={failedPages ? "red" : displayedPageCount ? "green" : "gray"} label={failedPages ? `${failedPages} failed` : `${displayedPageCount} page(s)`} />
        </div>
        {pageDataMismatch && <InlineAlert tone="red" title="Page data missing" message="The completed map reports captured pages, but page records were not returned. Refresh once, then rerun the scan if the mismatch remains." />}
        <table>
          <thead>
            <tr>
              <th>Route</th>
              <th>Status</th>
              <th>Elements</th>
              <th>States</th>
              <th>Title</th>
              <th>Captured</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {filteredPages.length === 0 && (
              <EmptyTableRow
                colSpan={7}
                message={pageDataMismatch ? "Captured page records are unavailable." : "No UI map pages match the current search."}
              />
            )}
            {filteredPages.map((page) => (
              <tr key={page.id}>
                <td>
                  <div className="route-cell">
                    <strong><code>{page.route}</code></strong>
                    <span>{page.name}</span>
                  </div>
                </td>
                <td><StatusPill tone={page.status === "failed" ? "red" : "green"} label={page.status} /></td>
                <td>{page.elementCount ?? pageElementCounts.get(page.id) ?? 0}</td>
                <td>{page.stateCount ?? pageStateCounts.get(page.id)?.size ?? 0}</td>
                <td>{page.title || <span className="muted">No title</span>}</td>
                <td>{formatDate(page.createdAt)}</td>
                <td>
                  <button className="button secondary small" type="button" onClick={() => onOpenPage(page.id)}>
                    Review
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
  const [savingElementId, setSavingElementId] = useState<string | null>(null);
  const [qualityFilter, setQualityFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const [groupFilter, setGroupFilter] = useState("");
  const [search, setSearch] = useState("");
  const [notice, setNotice] = useState<Notice | null>(null);

  const qualityCounts = {
    strong: elements.filter((element) => element.selectorQuality === "strong").length,
    medium: elements.filter((element) => element.selectorQuality === "medium").length,
    weak: elements.filter((element) => element.selectorQuality === "weak").length
  };
  const sourceFixGroups = useMemo(() => buildSelectorFixGroups(elements), [elements]);
  const filteredElements = elements.filter((element) => {
    const query = search.trim().toLowerCase();
    const matchesQuery = !query || [
      element.elementId,
      element.elementType,
      element.label ?? "",
      element.description,
      element.selector,
      element.selectorWarnings.join(" "),
      element.stateName ?? "default"
    ].join(" ").toLowerCase().includes(query);
    const matchesGroup = !groupFilter
      || ((element.selectorQuality === "weak" || element.selectorWarnings.length > 0) && selectorFixForElement(element).key === groupFilter);
    return matchesQuery && matchesGroup && (qualityFilter === "all" || element.selectorQuality === qualityFilter) && (typeFilter === "all" || element.elementType === typeFilter);
  });
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

  const copySourceFixReport = async () => {
    try {
      await navigator.clipboard.writeText(buildSourceFixReport(page, elements, sourceFixGroups));
      showToast("Source fix report copied");
    } catch (cause) {
      reportNotice(cause, "Unable to copy source fix report");
    }
  };

  return (
    <div className="page-grid">
      {notice && <InlineAlert tone={notice.tone} title={notice.title} message={notice.message} />}
      <div className="inline-header compact">
        <button className="button secondary" type="button" onClick={onBack}>Back to UI map</button>
        <div>
          <h2>{page.route}</h2>
          <p>{page.title || page.name} - {elements.length} mapped elements</p>
        </div>
        <StatusPill tone={page.status === "failed" ? "red" : "green"} label={page.status} />
      </div>

      <Panel title="Page selector health" action={<button className="button secondary small" type="button" onClick={() => setRawOpen((open) => !open)}><FileJson size={14} /> Raw JSON</button>}>
        <div className="quality-summary">
          <SummaryStat label="Strong selectors" value={qualityCounts.strong} tone="green" />
          <SummaryStat label="Medium selectors" value={qualityCounts.medium} tone="yellow" />
          <SummaryStat label="Weak selectors" value={qualityCounts.weak} tone={qualityCounts.weak ? "red" : "green"} />
          <SummaryStat label="States captured" value={new Set(elements.map((element) => element.stateName ?? "default")).size} tone="gray" />
        </div>
        {sourceFixGroups.length > 0 ? (
          <div className="selector-fix-grid">
            {sourceFixGroups.map((group) => (
              <button
                className={`selector-fix-card ${groupFilter === group.key ? "is-selected" : ""}`}
                key={group.key}
                type="button"
                aria-pressed={groupFilter === group.key}
                onClick={() => setGroupFilter((current) => current === group.key ? "" : group.key)}
              >
                <div>
                  <StatusPill tone="red" label={`${group.count}`} />
                  <strong>{group.title}</strong>
                </div>
                <p>{group.detail}</p>
                <span>{groupFilter === group.key ? "Showing these elements below. Click to show all." : "Click to review just these elements below."}</span>
              </button>
            ))}
          </div>
        ) : (
          <InlineAlert tone="green" title="Selector source looks clean" message="No weak selector patterns were found on this page." />
        )}
        <div className="button-cluster">
          <button className="button secondary" type="button" onClick={() => setQualityFilter("weak")}>
            <AlertTriangle size={16} />
            Show weak only
          </button>
          <button className="button secondary" type="button" onClick={() => void copySourceFixReport()}>
            <ClipboardList size={16} />
            Copy source fix report
          </button>
        </div>
      </Panel>

      <Panel title="Mapped elements" action={<StatusPill tone={filteredElements.length ? "green" : "gray"} label={`${filteredElements.length} shown`} />}>
        <div className="element-review-toolbar">
          <label className="search-field">
            <Search size={15} />
            <span className="visually-hidden">Search mapped elements</span>
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search label, selector, warning, or state" />
          </label>
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
              <th>Element</th>
              <th>Selector health</th>
              <th>Source fix</th>
              <th>Description</th>
              <th>State</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {filteredElements.length === 0 && <EmptyTableRow colSpan={6} message="No elements match the current filters." />}
            {filteredElements.map((element) => {
              const fix = selectorFixForElement(element);
              return (
                <tr key={element.id}>
                  <td>
                    <div className="element-cell">
                      <strong>{element.label || "Unlabeled element"}</strong>
                      <span>{element.elementType} - <code>{element.elementId}</code></span>
                    </div>
                  </td>
                  <td>
                    <div className="selector-health-cell">
                      <SelectorQualityBadge quality={element.selectorQuality} />
                      <code>{element.selector}</code>
                      <span>{element.selectorWarnings.join(", ") || "No warnings"}</span>
                    </div>
                  </td>
                  <td>
                    <div className="source-fix-cell">
                      <strong>{fix.title}</strong>
                      <span>{fix.detail}</span>
                    </div>
                  </td>
                  <td>
                    <input
                      className="table-input"
                      value={drafts[element.id] ?? element.description}
                      onChange={(event) => setDrafts((current) => ({ ...current, [element.id]: event.target.value }))}
                    />
                  </td>
                  <td>
                    <div>{element.stateName ?? "default"}</div>
                    <div className="muted">{element.discoveredBy ?? "route_scan"}</div>
                  </td>
                  <td>
                    <button
                      className="button secondary small"
                      data-testid={`ui-element-save-${element.elementId}`}
                      type="button"
                      disabled={savingElementId === element.id}
                      onClick={() => void saveElement(element)}
                    >
                      {savingElementId === element.id ? "Saving" : "Save"}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Panel>

      {rawOpen && <RawJsonViewer title="UI element raw records" data={elements} />}
    </div>
  );

  function reportNotice(cause: unknown, fallback: string) {
    const message = errorMessage(cause, fallback);
    setNotice({ tone: "red", title: "Save failed", message });
    showToast(message);
  }
}

function ScanProgressPanel({ scan }: { scan: UiMapVersion }) {
  const routeCount = scan.routeCount || scan.routes?.length || 0;
  const pageCount = scan.pageCount ?? 0;
  const progress = routeCount > 0 ? Math.min(100, Math.round((pageCount / routeCount) * 100)) : 0;
  return (
    <div className="scan-progress-panel">
      <div className="scan-progress-copy">
        <Loader2 size={16} />
        <div>
          <strong>Scan in progress</strong>
          <span>{pageCount}/{routeCount || "?"} routes captured, {scan.elementCount ?? 0} elements indexed so far. Auto-refresh is on.</span>
        </div>
      </div>
      <div className="launch-progress-track" aria-label="UI map scan progress">
        <div style={{ width: `${progress}%` }} />
      </div>
    </div>
  );
}

function DiscoveryPanel({ report }: { report: UiMapRouteDiscoveryReport }) {
  const failed = report.checkedRoutes.filter((route) => route.status === "failed").length;
  const added = report.checkedRoutes.reduce((count, route) => count + route.discoveredRoutes.length, 0);
  return (
    <div className="discovery-panel">
      <div className="discovery-summary">
        <SummaryStat label="Routes now selected" value={report.routes.length} tone="green" />
        <SummaryStat label="New from crawl" value={added} tone="gray" />
        <SummaryStat label="Failed seeds" value={failed} tone={failed ? "red" : "green"} />
      </div>
      <div className="checklist-panel compact">
        {report.checkedRoutes.map((route) => (
          <div className="check-row-item" key={route.route}>
            <StatusPill tone={route.status === "passed" ? "green" : "red"} label={route.status} />
            <span>
              <strong>{route.route}</strong>
              <span>{route.status === "passed" ? `${route.discoveredRoutes.length} linked route(s) found.` : route.error}</span>
            </span>
          </div>
        ))}
        {report.truncated && <InlineAlert tone="yellow" title="Discovery limit reached" message="Increase the saved discovery limit in Settings if this product has more routes." />}
      </div>
    </div>
  );
}

function PreflightPanel({ report }: { report: UiMapPreflightReport }) {
  const failed = report.checks.filter((check) => check.status === "failed").length;
  const warnings = report.checks.filter((check) => check.status === "warning").length;
  const passed = report.checks.filter((check) => check.status === "passed").length;
  return (
    <div className="preflight-panel">
      <div className="discovery-summary">
        <SummaryStat label="Passed" value={passed} tone="green" />
        <SummaryStat label="Warnings" value={warnings} tone={warnings ? "yellow" : "green"} />
        <SummaryStat label="Failed" value={failed} tone={failed ? "red" : "green"} />
      </div>
      <div className="checklist-panel compact">
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
    </div>
  );
}

function GuideStep({ index, title, done, detail }: { index: number; title: string; done: boolean; detail: string }) {
  return (
    <article className={`guide-step ${done ? "is-done" : ""}`}>
      <span>{done ? <CheckCircle2 size={14} /> : index}</span>
      <div>
        <strong>{title}</strong>
        <p>{detail}</p>
      </div>
    </article>
  );
}

function SummaryStat({ label, value, tone }: { label: string; value: number; tone: "green" | "yellow" | "red" | "gray" }) {
  return (
    <div className="summary-stat">
      <StatusPill tone={tone} label={String(value)} />
      <span>{label}</span>
    </div>
  );
}

function mapReadyTone(latestUiMap: UiMapVersion | null, weakSelectors: number, failedPages: number): "green" | "yellow" | "red" | "gray" {
  if (!latestUiMap) return "gray";
  if (latestUiMap.status === "failed" || failedPages > 0) return "red";
  if (latestUiMap.status !== "completed" || weakSelectors > 0) return "yellow";
  return "green";
}

function mapReadyLabel(latestUiMap: UiMapVersion | null, weakSelectors: number, failedPages: number): string {
  if (!latestUiMap) return "not mapped";
  if (latestUiMap.status === "failed") return "failed";
  if (failedPages > 0) return "route errors";
  if (latestUiMap.status !== "completed") return latestUiMap.status;
  return weakSelectors > 0 ? "needs selector fixes" : "ready";
}

function statusTone(status: string): "green" | "yellow" | "red" | "gray" {
  if (status === "completed") return "green";
  if (status === "failed") return "red";
  if (status === "scanning") return "yellow";
  return "gray";
}

function parseRoutes(value: string): string[] {
  return [...new Set(value.split(/\r?\n|,/).map(normalizeRoute).filter((route): route is string => Boolean(route)))];
}

function normalizeRoute(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
}

function countBy<T>(items: T[], key: (item: T) => string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const item of items) {
    const nextKey = key(item);
    counts.set(nextKey, (counts.get(nextKey) ?? 0) + 1);
  }
  return counts;
}

function buildSelectorFixGroups(elements: UiElement[]): SelectorFixGroup[] {
  const groups = new Map<string, SelectorFixGroup>();
  for (const element of elements) {
    if (element.selectorQuality !== "weak" && element.selectorWarnings.length === 0) continue;
    const fix = selectorFixForElement(element);
    const existing = groups.get(fix.key) ?? { ...fix, count: 0, examples: [] };
    existing.count += 1;
    existing.examples.push(element);
    groups.set(fix.key, existing);
  }
  return [...groups.values()].sort((a, b) => b.count - a.count);
}

function selectorFixForElement(element: UiElement): SelectorFixGroup {
  const selector = element.selector.toLowerCase();
  const warnings = element.selectorWarnings.join(" ").toLowerCase();
  if (element.selectorType === "dom-path" || selector.includes(":nth-child") || selector.includes(" > ")) {
    return {
      key: "dom-path",
      title: "DOM path selector",
      detail: "Add a stable data-ai-id or data-testid to this exact control so DOM layout changes do not break Mia.",
      count: 0,
      examples: []
    };
  }
  if (element.selectorType === "text" || selector.includes("has-text") || warnings.includes("text")) {
    return {
      key: "text-selector",
      title: "Text-only selector",
      detail: "Add a stable data-ai-id and an accessible label. Text can repeat, translate, or change with product copy.",
      count: 0,
      examples: []
    };
  }
  if (warnings.includes("ambiguous") || warnings.includes("multiple")) {
    return {
      key: "ambiguous-selector",
      title: "Ambiguous match",
      detail: "Make this selector unique in source. Use route-specific data-ai-id values for repeated nav, table, and action controls.",
      count: 0,
      examples: []
    };
  }
  if (!element.label) {
    return {
      key: "missing-label",
      title: "Missing user-facing label",
      detail: "Add accessible name, aria-label, or visible text so admins can review the control and Mia can explain it clearly.",
      count: 0,
      examples: []
    };
  }
  return {
    key: "weak-selector",
    title: "Weak selector",
    detail: "Prefer stable source identifiers such as data-ai-id over generated CSS, generic roles, or repeated visible text.",
    count: 0,
    examples: []
  };
}

function buildSourceFixReport(page: UiPage, elements: UiElement[], groups: SelectorFixGroup[]): string {
  const weak = elements.filter((element) => element.selectorQuality === "weak").length;
  const medium = elements.filter((element) => element.selectorQuality === "medium").length;
  const strong = elements.filter((element) => element.selectorQuality === "strong").length;
  const lines = [
    `UI selector source fix report for ${page.route}`,
    `Summary: ${strong} strong, ${medium} medium, ${weak} weak selectors.`,
    ""
  ];
  if (groups.length === 0) {
    lines.push("No weak selector source patterns were found on this page.");
    return lines.join("\n");
  }
  for (const group of groups) {
    lines.push(`${group.title} (${group.count})`);
    lines.push(group.detail);
    for (const element of group.examples.slice(0, 6)) {
      lines.push(`- ${element.label || element.elementId}: ${element.selector}`);
    }
    lines.push("");
  }
  return lines.join("\n").trim();
}
