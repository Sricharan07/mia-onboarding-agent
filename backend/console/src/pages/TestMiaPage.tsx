import { CheckCircle2, Circle, Mic2, MousePointer2, Navigation, RefreshCw, ShieldCheck, Sparkles } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type { BackendApi } from "../api";
import { ProductLink } from "../components/console";
import { Alert, Button, CopyButton, EmptyState, Loading, Section, StatusBadge } from "../components/ui";
import type { RunDetail, RunSummary, SetupChecklist } from "../types";
import { errorMessage, formatDateTime, formatRelative } from "../utils/format";

const SCENARIOS = [
  { id: "answer", title: "Grounded answer", prompt: "What does this page show, and what should I pay attention to?", icon: Sparkles },
  { id: "point", title: "Point and guide", prompt: "Point to the main filter on this page and explain what it changes.", icon: MousePointer2 },
  { id: "navigate", title: "Navigate", prompt: "Take me to another useful page in this product.", icon: Navigation },
  { id: "mutation", title: "Reversible change", prompt: "Help me make one safe, reversible change on this page.", icon: ShieldCheck },
  { id: "voice", title: "Voice parity", prompt: "Explain this page, then point to the next control I should use.", icon: Mic2 }
] as const;

export function TestMiaPage({ api, refreshNonce }: { api: BackendApi; refreshNonce: number }) {
  const [checklist, setChecklist] = useState<SetupChecklist | null>(null);
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [detail, setDetail] = useState<RunDetail | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    try {
      const [nextChecklist, nextRuns] = await Promise.all([api.checklist(), api.runs()]);
      setChecklist(nextChecklist); setRuns(nextRuns.items); setSelectedId((current) => current && nextRuns.items.some((run) => run.id === current)
        ? current
        : nextRuns.items.find((run) => run.status === "completed" && run.stepCount > 0)?.id ?? nextRuns.items[0]?.id ?? ""); setError("");
    } catch (cause) { setError(errorMessage(cause)); } finally { setLoading(false); }
  }, [api]);
  useEffect(() => { void load(); }, [load, refreshNonce]);
  useEffect(() => { if (!selectedId) { setDetail(null); return; } void api.run(selectedId).then(setDetail).catch((cause) => setError(errorMessage(cause))); }, [api, selectedId]);
  useEffect(() => { const timer = window.setInterval(() => void load(), 5_000); return () => window.clearInterval(timer); }, [load]);
  const results = checklist?.acceptance;
  if (loading) return <Loading label="Preparing live validation" />;

  return (
    <div className="page-stack">
      {error ? <Alert tone="danger" onClose={() => setError("")}>{error}</Alert> : null}
      {checklist ? <section className="test-launch"><div><span className="eyebrow">Live product</span><h2>{checklist.product.name}</h2><p>{checklist.product.origin}</p></div><div className="runtime-signal" data-live={checklist.sdk.detected}><span /><div><strong>{checklist.sdk.detected ? "SDK connected" : "Waiting for SDK"}</strong><small>{checklist.sdk.detected ? `${formatRelative(checklist.sdk.lastSeenAt)} on ${checklist.sdk.lastRoute ?? "the product"}` : "No sdk_ready event received"}</small></div></div><ProductLink origin={checklist.product.origin}>Open product</ProductLink></section> : null}

      <Section title="Acceptance scenarios" description="Run each scenario in the product using text, then repeat the voice scenario by microphone." action={<Button size="sm" variant="secondary" onClick={() => void load()}><RefreshCw /> Refresh evidence</Button>}>
        <div className="scenario-grid">{SCENARIOS.map((scenario) => { const Icon = scenario.icon; const passed = results?.[scenario.id]?.passed ?? false; return <article key={scenario.id} data-passed={passed}><header><Icon /><div><strong>{scenario.title}</strong><span>{passed ? "Evidence found" : "Awaiting evidence"}</span></div>{passed ? <CheckCircle2 className="scenario-check" /> : <Circle className="scenario-pending" />}</header><p>{scenario.prompt}</p><CopyButton value={scenario.prompt} label={`Copy ${scenario.title} prompt`} /></article>; })}</div>
      </Section>

      <Section title="Live run evidence" description="Select a recent run to inspect the signals used by these checks." action={runs.length ? <select className="run-select" aria-label="Selected run" value={selectedId} onChange={(event) => setSelectedId(event.target.value)}>{runs.slice(0, 30).map((run) => <option key={run.id} value={run.id}>{run.goal.slice(0, 70)} - {run.status}</option>)}</select> : null}>
        {detail ? <div className="evidence-summary"><div className="facts-grid"><Fact label="Status" value={<StatusBadge value={detail.session.status} />} /><Fact label="Route" value={<code>{detail.session.currentRoute ?? "-"}</code>} /><Fact label="Turns" value={String(detail.turns.length)} /><Fact label="Receipts" value={String(detail.receipts.length)} /></div><div className="evidence-timeline">{detail.steps.map((step) => <div key={step.id}><span>{step.stepIndex}</span><div><strong>{step.progress}</strong><p>{step.assessment}</p><small>{step.model} - {step.latencyMs ?? 0} ms - {formatDateTime(step.createdAt)}</small></div><StatusBadge value={step.status} /></div>)}</div></div> : <EmptyState title="No run evidence" detail="Open the product and complete the first acceptance scenario." />}
      </Section>
    </div>
  );
}

function Fact({ label, value }: { label: string; value: React.ReactNode }) {
  return <div className="fact"><span>{label}</span><strong>{value}</strong></div>;
}
