import { Ban, Check, RefreshCw, Search, ShieldCheck } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { BackendApi } from "../api";
import { ProductLink } from "../components/console";
import { Alert, Button, EmptyState, Field, Loading, Section, StatusBadge } from "../components/ui";
import type { HostAction, Product, RiskLevel } from "../types";
import { errorMessage, formatDateTime, json } from "../utils/format";

const RISKS: RiskLevel[] = ["read", "navigate", "reversible_write", "manual", "blocked"];
const PROHIBITED = ["Delete", "Send", "Publish", "Approve", "Pay", "External communication", "Irreversible submit"];

export function ActionsPage({ api, refreshNonce, notify }: { api: BackendApi; refreshNonce: number; notify: (message: string) => void }) {
  const [actions, setActions] = useState<HostAction[]>([]);
  const [product, setProduct] = useState<Product | null>(null);
  const [selectedName, setSelectedName] = useState("");
  const [risk, setRisk] = useState<RiskLevel>("reversible_write");
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [pendingReview, setPendingReview] = useState<"publish" | "block" | null>(null);
  const load = useCallback(async () => {
    try {
      const [nextActions, nextProduct] = await Promise.all([api.actions(), api.product()]);
      setActions(nextActions); setProduct(nextProduct); setSelectedName((current) => current && nextActions.some((action) => action.name === current) ? current : nextActions[0]?.name ?? ""); setError("");
    } catch (cause) { setError(errorMessage(cause)); } finally { setLoading(false); }
  }, [api]);
  useEffect(() => { void load(); }, [load, refreshNonce]);
  const selected = actions.find((action) => action.name === selectedName) ?? null;
  useEffect(() => { if (selected) setRisk(selected.risk); setPendingReview(null); }, [selected]);
  const visible = useMemo(() => actions.filter((action) => `${action.name} ${action.description} ${action.status}`.toLowerCase().includes(query.toLowerCase())), [actions, query]);
  const perform = async (status: "published" | "blocked") => {
    if (!selected) return;
    setBusy(true); setError("");
    try { await api.reviewAction(selected.name, status, status === "blocked" ? "blocked" : risk); notify(status === "published" ? (selected.status === "published" ? "Host action policy updated." : "Host action published.") : "Host action blocked."); setPendingReview(null); await load(); } catch (cause) { setError(errorMessage(cause)); } finally { setBusy(false); }
  };
  if (loading) return <Loading label="Loading effective safety policy" />;

  return (
    <div className="page-stack">
      {error ? <Alert tone="danger" onClose={() => setError("")}>{error}</Alert> : null}
      {pendingReview && selected ? <Alert tone={pendingReview === "publish" ? "warning" : "danger"} title={pendingReview === "publish" ? (selected.status === "published" ? `Update ${selected.name}?` : `Publish ${selected.name}?`) : `Block ${selected.name}?`}>{pendingReview === "publish" ? `Mia may invoke this action after an exact confirmation when its effective risk is ${risk.replace(/_/g, " ")}.` : "Mia will not be able to invoke this action."}<span className="alert-actions"><Button size="sm" variant={pendingReview === "block" ? "danger" : "primary"} disabled={busy} onClick={() => void perform(pendingReview === "publish" ? "published" : "blocked")}>{pendingReview === "publish" ? <Check /> : <Ban />}{pendingReview === "publish" ? (selected.status === "published" ? "Update" : "Publish") : "Block"}</Button><Button size="sm" variant="secondary" onClick={() => setPendingReview(null)}>Cancel</Button></span></Alert> : null}

      <div className="safety-strip"><ShieldCheck /><div><strong>Global v1 boundary</strong><span>These operations remain blocked regardless of model output, DOM policy, or host manifest.</span></div><div>{PROHIBITED.map((item) => <span key={item}>{item}</span>)}</div></div>

      {actions.length ? (
        <div className="split-workspace actions-workspace">
          <aside className="selection-list">
            <header><strong>Detected actions</strong><span>{actions.filter((action) => ["detected", "needs_review"].includes(action.status)).length} need review</span></header>
            <label className="list-search"><Search /><input aria-label="Search actions" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search actions" /></label>
            {visible.map((action) => <button type="button" key={action.name} data-selected={action.name === selectedName} onClick={() => setSelectedName(action.name)}><div><strong>{action.name}</strong><span>{action.description}</span></div><StatusBadge value={action.status} /></button>)}
          </aside>
          <section className="detail-pane">
            {selected ? <><header className="detail-header"><div><div className="title-with-status"><h2>{selected.name}</h2><StatusBadge value={selected.status} /></div><p>Detected {formatDateTime(selected.firstSeenAt)} - last seen {formatDateTime(selected.lastSeenAt)}</p></div><Button size="sm" variant="secondary" onClick={() => void load()}><RefreshCw /> Refresh</Button></header>
              <div className="detail-copy"><span>Description</span><p>{selected.description}</p></div>
              <div className="policy-review"><Field label="Effective risk" hint="Reversible writes require an exact confirmation naming the action and target."><select value={risk} onChange={(event) => setRisk(event.target.value as RiskLevel)}>{RISKS.map((value) => <option key={value} value={value}>{value.replace(/_/g, " ")}</option>)}</select></Field><div className="effective-policy"><span>Review state</span><strong>{selected.reviewedAt ? `Reviewed ${formatDateTime(selected.reviewedAt)}` : "Not reviewed"}</strong><small>Manifest {selected.manifestHash.slice(0, 12)}</small></div></div>
              <div className="schema-view"><header><h3>Input schema</h3><span>Validated by the backend before execution</span></header><pre>{json(selected.inputSchema)}</pre></div>
              <footer className="detail-actions"><Button variant="danger" disabled={busy} onClick={() => setPendingReview("block")}><Ban /> Block</Button><Button disabled={busy || risk === "blocked"} onClick={() => setPendingReview("publish")}><Check /> {selected.status === "published" ? "Update policy" : "Publish action"}</Button></footer>
            </> : null}
          </section>
        </div>
      ) : (
        <Section title="Detected host actions" description="Actions appear after the SDK connects with registered manifests."><EmptyState title="No actions detected" detail="Open the configured product once the v1 SDK and server token route are deployed." action={product ? <ProductLink origin={product.origin}>Open product</ProductLink> : null} /></Section>
      )}
    </div>
  );
}
