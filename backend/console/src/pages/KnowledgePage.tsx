import { Archive, ChevronLeft, ChevronRight, FileText, Globe2, RefreshCw, ScanSearch, Search, Upload } from "lucide-react";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import type { BackendApi } from "../api";
import { Alert, Button, EmptyState, Field, Loading, Section, Segmented, StatusBadge } from "../components/ui";
import type { KnowledgeSource, MappedElement, UiActionPolicy, UiMapVersion } from "../types";
import { errorMessage, formatDateTime, formatRelative, lines } from "../utils/format";

type Tab = "sources" | "ui-map";

export function KnowledgePage({ api, refreshNonce, notify }: { api: BackendApi; refreshNonce: number; notify: (message: string) => void }) {
  const [tab, setTab] = useState<Tab>("sources");
  const [sources, setSources] = useState<KnowledgeSource[]>([]);
  const [scans, setScans] = useState<UiMapVersion[]>([]);
  const [elements, setElements] = useState<MappedElement[]>([]);
  const [elementTotal, setElementTotal] = useState(0);
  const [elementOverallTotal, setElementOverallTotal] = useState(0);
  const [elementRoutes, setElementRoutes] = useState<string[]>([]);
  const [elementPage, setElementPage] = useState(0);
  const [mapQuery, setMapQuery] = useState("");
  const [debouncedMapQuery, setDebouncedMapQuery] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [showUrl, setShowUrl] = useState(false);
  const [showFile, setShowFile] = useState(false);
  const [urlForm, setUrlForm] = useState({ name: "Product documentation", url: "", maxPages: "25" });
  const [fileName, setFileName] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [scanRoutes, setScanRoutes] = useState("");
  const [routeFilter, setRouteFilter] = useState("all");
  const [archiveTarget, setArchiveTarget] = useState<KnowledgeSource | null>(null);

  const load = useCallback(async () => {
    try {
      const [nextSources, nextScans] = await Promise.all([api.knowledge(), api.scans()]);
      setSources(nextSources); setScans(nextScans); setError("");
    } catch (cause) { setError(errorMessage(cause)); } finally { setLoading(false); }
  }, [api]);
  const loadElements = useCallback(async () => {
    try {
      const result = await api.mappedElements({
        route: routeFilter === "all" ? undefined : routeFilter,
        search: debouncedMapQuery || undefined,
        limit: 100,
        offset: elementPage * 100
      });
      setElements(result.items); setElementTotal(result.total); setElementOverallTotal(result.overallTotal); setElementRoutes(result.routes);
    } catch (cause) { setError(errorMessage(cause)); }
  }, [api, routeFilter, debouncedMapQuery, elementPage]);
  useEffect(() => { void load(); }, [load, refreshNonce]);
  useEffect(() => { void loadElements(); }, [loadElements, refreshNonce]);
  useEffect(() => {
    const timer = window.setTimeout(() => { setElementPage(0); setDebouncedMapQuery(mapQuery.trim()); }, 250);
    return () => window.clearTimeout(timer);
  }, [mapQuery]);
  const processing = sources.some((source) => ["pending", "processing"].includes(source.status)) || scans.some((scan) => ["pending", "scanning"].includes(scan.status));
  useEffect(() => {
    if (!processing) return;
    const timer = window.setInterval(() => { void load(); void loadElements(); }, 4_000);
    return () => window.clearInterval(timer);
  }, [processing, load, loadElements]);
  const activeSources = sources.filter((source) => source.status !== "archived" && ["documentation_url", "document_file"].includes(source.kind));
  const routes = elementRoutes;
  const visibleElements = elements;
  const perform = async (work: () => Promise<unknown>, message: string) => {
    setBusy(true); setError("");
    try { await work(); notify(message); await Promise.all([load(), loadElements()]); } catch (cause) { setError(errorMessage(cause)); } finally { setBusy(false); }
  };
  if (loading) return <Loading label="Loading product knowledge" />;

  return (
    <div className="page-stack">
      {error ? <Alert tone="danger" onClose={() => setError("")}>{error}</Alert> : null}
      {archiveTarget ? <Alert tone="warning" title={`Archive ${archiveTarget.name}?`}>This source will stop contributing to retrieval. <span className="alert-actions"><Button size="sm" variant="danger" disabled={busy} onClick={() => void perform(async () => { await api.archiveKnowledge(archiveTarget.id); setArchiveTarget(null); }, "Knowledge source archived.")}>Archive</Button><Button size="sm" variant="secondary" onClick={() => setArchiveTarget(null)}>Cancel</Button></span></Alert> : null}
      <div className="page-tools"><Segmented value={tab} onChange={setTab} label="Knowledge view" options={[{ value: "sources", label: "Sources", count: activeSources.length }, { value: "ui-map", label: "UI map", count: elementOverallTotal }]} /></div>

      {tab === "sources" ? (
        <>
          <Section title="Product sources" description="Approved documentation is indexed automatically." action={<div className="button-group"><Button size="sm" variant="secondary" onClick={() => { setShowUrl((value) => !value); setShowFile(false); }}><Globe2 /> Add website</Button><Button size="sm" variant="secondary" onClick={() => { setShowFile((value) => !value); setShowUrl(false); }}><Upload /> Upload file</Button></div>}>
            {showUrl ? (
              <form className="panel-form three" onSubmit={(event: FormEvent) => { event.preventDefault(); void perform(async () => { await api.addDocumentationUrl({ name: urlForm.name, url: urlForm.url, maxPages: Number(urlForm.maxPages) }); setUrlForm({ name: "Product documentation", url: "", maxPages: "25" }); setShowUrl(false); }, "Documentation indexing started."); }}>
                <Field label="Name"><input required value={urlForm.name} onChange={(event) => setUrlForm((current) => ({ ...current, name: event.target.value }))} /></Field>
                <Field label="HTTPS URL"><input type="url" required placeholder="https://docs.example.com" value={urlForm.url} onChange={(event) => setUrlForm((current) => ({ ...current, url: event.target.value }))} /></Field>
                <Field label="Maximum pages"><input type="number" min={1} max={100} required value={urlForm.maxPages} onChange={(event) => setUrlForm((current) => ({ ...current, maxPages: event.target.value }))} /></Field>
                <div className="form-actions span-3"><Button type="submit" disabled={busy}>Index website</Button><Button type="button" variant="quiet" onClick={() => setShowUrl(false)}>Cancel</Button></div>
              </form>
            ) : null}
            {showFile ? (
              <form className="panel-form two" onSubmit={(event) => { event.preventDefault(); if (file) void perform(async () => { await api.uploadDocument(fileName || file.name, file); setFile(null); setFileName(""); setShowFile(false); }, "Document indexing started."); }}>
                <Field label="Name"><input value={fileName} onChange={(event) => setFileName(event.target.value)} placeholder={file?.name ?? "Product guide"} /></Field>
                <Field label="Markdown, text, or PDF"><input type="file" accept=".md,.markdown,.txt,.pdf,text/markdown,text/plain,application/pdf" required onChange={(event) => setFile(event.target.files?.[0] ?? null)} /></Field>
                <div className="form-actions span-2"><Button type="submit" disabled={busy || !file}>Upload and index</Button><Button type="button" variant="quiet" onClick={() => setShowFile(false)}>Cancel</Button></div>
              </form>
            ) : null}
            {activeSources.length ? (
              <div className="table-scroll"><table className="data-table"><thead><tr><th>Source</th><th>Type</th><th>Status</th><th>Indexed</th><th><span className="sr-only">Actions</span></th></tr></thead><tbody>{activeSources.map((source) => <tr key={source.id}><td><div className="table-primary"><strong>{source.name}</strong><span>{source.sourceUrl ?? source.filePath?.split("/").at(-1)}</span>{source.error ? <small className="text-danger">{source.error}</small> : null}</div></td><td>{source.kind === "documentation_url" ? <><Globe2 className="inline-icon" /> Website</> : <><FileText className="inline-icon" /> File</>}</td><td><StatusBadge value={source.status} /></td><td>{formatRelative(source.completedAt ?? source.updatedAt)}</td><td><div className="row-actions">{source.status === "failed" ? <Button size="sm" variant="quiet" disabled={busy} onClick={() => void perform(() => api.retryKnowledge(source.id), "Indexing restarted.")}><RefreshCw /> Retry</Button> : null}<Button size="sm" variant="quiet" onClick={() => setArchiveTarget(source)}><Archive /> Archive</Button></div></td></tr>)}</tbody></table></div>
            ) : <EmptyState title="No product knowledge" detail="Add an approved HTTPS documentation site, Markdown file, text file, or PDF." />}
          </Section>
        </>
      ) : (
        <>
          <Section title="Production UI scan" description="Semantic memory supplements the SDK's live observation; live DOM remains authoritative." action={<Button size="sm" disabled={busy || scans.some((scan) => ["pending", "scanning"].includes(scan.status))} onClick={() => void perform(() => api.startScan(lines(scanRoutes)), "UI scan started.")}><ScanSearch /> Start scan</Button>}>
            <div className="scan-controls"><Field label="Starting routes" hint="One relative route per line. Leave blank to start at /. "><textarea rows={3} value={scanRoutes} onChange={(event) => setScanRoutes(event.target.value)} placeholder={"/dashboard\n/settings"} /></Field><div className="scan-latest">{scans[0] ? <><StatusBadge value={scans[0].status} /><strong>{(scans[0].metadata.elementCount as number | undefined) ?? 0} controls across {scans[0].routes.length} routes</strong><span>{formatDateTime(scans[0].completedAt ?? scans[0].createdAt)}</span>{scans[0].error ? <small className="text-danger">{scans[0].error}</small> : null}</> : <span>No scan has run.</span>}</div></div>
            {scans.length ? <details className="history"><summary>Scan history</summary><div className="compact-list">{scans.map((scan) => <div key={scan.id}><StatusBadge value={scan.status} /><code>{scan.id}</code><span>{scan.routes.length} routes</span><time>{formatDateTime(scan.createdAt)}</time></div>)}</div></details> : null}
          </Section>

          <Section title="Effective UI policies" description="Policies apply to the latest ready map. The backend still enforces global v1 safety rules." action={routes.length ? <div className="map-filters"><label className="list-search"><Search /><input aria-label="Search mapped controls" value={mapQuery} onChange={(event) => setMapQuery(event.target.value)} placeholder="Search controls" /></label><label className="compact-select"><span>Route</span><select value={routeFilter} onChange={(event) => { setRouteFilter(event.target.value); setElementPage(0); }}><option value="all">All routes</option>{routes.map((route) => <option key={route} value={route}>{route}</option>)}</select></label></div> : null}>
            {visibleElements.length ? <><div className="table-scroll"><table className="data-table"><thead><tr><th>Control</th><th>Route</th><th>Role</th><th>Policy</th></tr></thead><tbody>{visibleElements.map((element) => <tr key={`${element.route}:${element.elementKey}`}><td><div className="table-primary"><strong>{element.name ?? element.elementKey}</strong><span>{element.elementKey}</span></div></td><td><code>{element.route}</code></td><td>{element.role ?? "element"}</td><td><select className="policy-select" aria-label={`Policy for ${element.name ?? element.elementKey}`} value={element.actionPolicy} disabled={busy} onChange={(event) => void perform(() => api.updateElementPolicy(element.elementKey, event.target.value as UiActionPolicy), "UI policy updated.")}>{POLICIES.map((policy) => <option key={policy} value={policy}>{policy.replace(/_/g, " ")}</option>)}</select></td></tr>)}</tbody></table></div><div className="pagination"><span>Showing {elementPage * 100 + 1}-{Math.min((elementPage + 1) * 100, elementTotal)} of {elementTotal}</span><div><Button size="sm" variant="secondary" disabled={elementPage === 0} onClick={() => setElementPage((value) => Math.max(0, value - 1))}><ChevronLeft /> Previous</Button><Button size="sm" variant="secondary" disabled={(elementPage + 1) * 100 >= elementTotal} onClick={() => setElementPage((value) => value + 1)}>Next <ChevronRight /></Button></div></div></> : <EmptyState title={debouncedMapQuery || routeFilter !== "all" ? "No matching controls" : "No mapped controls"} detail={debouncedMapQuery || routeFilter !== "all" ? "Change the search or route filter." : "Run a production UI scan to review route and control policies."} />}
          </Section>
        </>
      )}
    </div>
  );
}

const POLICIES: UiActionPolicy[] = ["guide_only", "navigate", "reversible_write", "manual", "blocked"];
