import { Activity, Clock3, RefreshCw, Search } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { BackendApi } from "../api";
import { RunTable } from "../components/console";
import { Alert, Button, EmptyState, Loading, Metric, Section, Segmented, StatusBadge } from "../components/ui";
import type { RunDetail, RunSummary, TranscriptMode } from "../types";
import { errorMessage, formatDateTime, formatDuration, formatNumber, json } from "../utils/format";

type DetailTab = "conversation" | "steps" | "actions" | "provider" | "events";

export function RunsPage({ api, refreshNonce }: { api: BackendApi; refreshNonce: number }) {
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [transcriptMode, setTranscriptMode] = useState<TranscriptMode>("full");
  const [selectedId, setSelectedId] = useState("");
  const [detail, setDetail] = useState<RunDetail | null>(null);
  const [tab, setTab] = useState<DetailTab>("conversation");
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const load = useCallback(async () => {
    try {
      const result = await api.runs();
      setRuns(result.items); setTranscriptMode(result.transcriptMode); setSelectedId((current) => current && result.items.some((run) => run.id === current) ? current : result.items[0]?.id ?? ""); setError("");
    } catch (cause) { setError(errorMessage(cause)); } finally { setLoading(false); }
  }, [api]);
  useEffect(() => { void load(); }, [load, refreshNonce]);
  useEffect(() => {
    if (!selectedId) { setDetail(null); return; }
    setDetailLoading(true);
    void api.run(selectedId).then((value) => { setDetail(value); setError(""); }).catch((cause) => setError(errorMessage(cause))).finally(() => setDetailLoading(false));
  }, [api, selectedId]);
  const filtered = useMemo(() => runs.filter((run) => (status === "all" || run.status === status) && `${run.goal} ${run.userId} ${run.currentRoute ?? ""}`.toLowerCase().includes(query.toLowerCase())), [runs, status, query]);
  if (loading) return <Loading label="Loading agent runs" />;

  return (
    <div className="page-stack">
      {error ? <Alert tone="danger" onClose={() => setError("")}>{error}</Alert> : null}
      {transcriptMode !== "full" ? <Alert tone="info" title={`Transcript mode: ${transcriptMode}`}>{transcriptMode === "disabled" ? "Conversation transcript content is not stored." : "Conversation and model summaries are redacted in diagnostics."}</Alert> : null}
      <Section title="Agent runs" description={`${runs.length} persisted sessions`} action={<Button size="sm" variant="secondary" onClick={() => void load()}><RefreshCw /> Refresh</Button>}>
        <div className="table-filters"><label className="list-search"><Search /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search goals, users, or routes" aria-label="Search runs" /></label><label className="compact-select"><span>Status</span><select value={status} onChange={(event) => setStatus(event.target.value)}><option value="all">All statuses</option>{["active", "waiting_user", "waiting_confirmation", "completed", "failed", "cancelled"].map((value) => <option key={value} value={value}>{value.replace(/_/g, " ")}</option>)}</select></label></div>
        {filtered.length ? <RunTable runs={filtered} selectedId={selectedId} onSelect={setSelectedId} /> : <EmptyState title="No matching runs" detail="Change the filters or complete a task in the product." />}
      </Section>

      {detailLoading ? <Loading label="Loading run evidence" /> : detail ? <RunInspector run={detail} tab={tab} onTab={setTab} /> : null}
    </div>
  );
}

function RunInspector({ run, tab, onTab }: { run: RunDetail; tab: DetailTab; onTab: (tab: DetailTab) => void }) {
  const totalTokens = run.aiRequests.reduce((sum, request) => sum + (request.inputTokens ?? 0) + (request.outputTokens ?? 0), 0);
  const totalLatency = run.aiRequests.reduce((sum, request) => sum + (request.latencyMs ?? 0), 0);
  const errors = run.aiRequests.filter((request) => request.error).length + run.receipts.filter((receipt) => ["failed", "unverified"].includes(receipt.status)).length;
  return (
    <Section title="Run evidence" description={run.session.id} action={<StatusBadge value={run.session.status} />}>
      <div className="metrics-grid four compact"><Metric label="Steps" value={run.session.stepCount} /><Metric label="Receipts" value={run.receipts.length} /><Metric label="Model tokens" value={formatNumber(totalTokens)} /><Metric label="Errors" value={errors} tone={errors ? "bad" : "good"} /></div>
      <div className="run-meta"><span><strong>Goal</strong>{run.session.goal}</span><span><strong>Route</strong><code>{run.session.currentRoute ?? "-"}</code></span><span><strong>User</strong>{run.session.userId}</span><span><strong>Elapsed model time</strong>{formatDuration(totalLatency)}</span></div>
      <div className="detail-tabs"><Segmented value={tab} onChange={onTab} label="Run evidence view" options={[{ value: "conversation", label: "Conversation", count: run.turns.length }, { value: "steps", label: "Steps", count: run.steps.length }, { value: "actions", label: "Actions", count: run.receipts.length }, { value: "provider", label: "Provider", count: run.aiRequests.length }, { value: "events", label: "Events", count: run.events.length }]} /></div>
      {tab === "conversation" ? <Conversation run={run} /> : null}
      {tab === "steps" ? <Steps run={run} /> : null}
      {tab === "actions" ? <Actions run={run} /> : null}
      {tab === "provider" ? <Provider run={run} /> : null}
      {tab === "events" ? <Events run={run} /> : null}
    </Section>
  );
}

function Conversation({ run }: { run: RunDetail }) {
  if (!run.transcriptAvailable) return <EmptyState title="Transcript logging disabled" detail="Operational session state remains private and is not shown in diagnostics." />;
  if (!run.turns.length) return <EmptyState title="No transcript entries" detail="This session has not recorded a user turn." />;
  return <div className="transcript">{run.turns.map((turn) => <article key={turn.id} data-role={turn.role}><header><strong>{turn.role === "assistant" ? "Mia" : turn.role === "user" ? "User" : "System"}</strong><span>{turn.source} - {formatDateTime(turn.createdAt)}</span></header><p>{turn.content}</p></article>)}</div>;
}

function Steps({ run }: { run: RunDetail }) {
  return run.steps.length ? <div className="run-steps">{run.steps.map((step) => { const actions = Array.isArray(step.directive.actions) ? step.directive.actions as Array<Record<string, unknown>> : []; return <article key={step.id}><header><span>{step.stepIndex}</span><div><strong>{step.progress}</strong><p>{step.assessment}</p></div><StatusBadge value={step.status} /></header><div className="step-facts"><span>Observation {step.observationRevision}</span><span>{step.model}</span><span>{formatDuration(step.latencyMs)}</span><span>{formatNumber((step.inputTokens ?? 0) + (step.outputTokens ?? 0))} tokens</span></div>{actions.length ? <div className="directive-list">{actions.map((action, index) => <div key={String(action.actionId ?? index)}><strong>{String(action.type ?? "action")}</strong><span>{String(action.message ?? "")}</span><code>{String((action.target as Record<string, unknown> | undefined)?.ref ?? action.route ?? action.hostAction ?? "")}</code></div>)}</div> : <pre className="json-inline">{json(step.directive)}</pre>}{step.retrievedSources.length ? <details><summary>{step.retrievedSources.length} retrieved sources</summary><pre className="json-inline">{json(step.retrievedSources)}</pre></details> : null}{step.error ? <Alert tone="danger">{step.error}</Alert> : null}</article>; })}</div> : <EmptyState title="No planner steps" detail="The agent has not planned this session yet." />;
}

function Actions({ run }: { run: RunDetail }) {
  return <div className="action-evidence"><div><h3>Confirmations</h3>{run.confirmations.length ? run.confirmations.map((confirmation) => <article key={confirmation.id}><StatusBadge value={confirmation.status} /><div><strong>{confirmation.prompt}</strong><span>{confirmation.source ? `Accepted by ${confirmation.source}` : "Not resolved"} - {formatDateTime(confirmation.createdAt)}</span></div></article>) : <p className="muted">No confirmation was required.</p>}</div><div><h3>Receipts</h3>{run.receipts.length ? run.receipts.map((receipt) => <article key={receipt.actionId}><StatusBadge value={receipt.status} /><div><strong>{receipt.type} {receipt.targetRef ? <code>{receipt.targetRef}</code> : null}</strong><span>{receipt.message}</span><details><summary>Evidence</summary><pre className="json-inline">{json(receipt.evidence)}</pre></details></div></article>) : <p className="muted">No action receipts were submitted.</p>}</div></div>;
}

function Provider({ run }: { run: RunDetail }) {
  return run.aiRequests.length ? <div className="table-scroll"><table className="data-table"><thead><tr><th>Purpose</th><th>Model</th><th>Latency</th><th>Tokens</th><th>Time</th></tr></thead><tbody>{run.aiRequests.map((request) => <tr key={request.id}><td><div className="table-primary"><strong>{request.purpose}</strong>{request.error ? <span className="text-danger">{request.error}</span> : null}</div></td><td><code>{request.model}</code></td><td>{formatDuration(request.latencyMs)}</td><td>{formatNumber((request.inputTokens ?? 0) + (request.outputTokens ?? 0))}</td><td>{formatDateTime(request.createdAt)}</td></tr>)}</tbody></table></div> : <EmptyState title="No provider calls" detail="This run has not called Gemini yet." />;
}

function Events({ run }: { run: RunDetail }) {
  return run.events.length ? <div className="event-stream">{run.events.map((event) => <article key={event.id}><Activity /><div><strong>{event.eventType.replace(/_/g, " ")}</strong><span>{formatDateTime(event.createdAt)}</span>{Object.keys(event.payload).length ? <pre className="json-inline">{json(event.payload)}</pre> : null}</div></article>)}</div> : <EmptyState title="No runtime events" detail="The SDK has not emitted diagnostics for this run." />;
}
