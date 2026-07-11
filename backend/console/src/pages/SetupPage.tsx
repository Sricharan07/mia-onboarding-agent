import { ArrowRight, CheckCircle2, KeyRound, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import type { BackendApi } from "../api";
import { Checklist, ProductLink } from "../components/console";
import { Alert, Button, CodeBlock, Field, Loading, Progress, Section } from "../components/ui";
import type { CreatedIntegrationKey, RouteId, SetupChecklist } from "../types";
import { errorMessage, formatRelative } from "../utils/format";

export function SetupPage({ api, refreshNonce, onNavigate, notify }: {
  api: BackendApi;
  refreshNonce: number;
  onNavigate: (route: RouteId) => void;
  notify: (message: string) => void;
}) {
  const [data, setData] = useState<SetupChecklist | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [geminiKey, setGeminiKey] = useState("");
  const [keyName, setKeyName] = useState("Production server");
  const [createdKey, setCreatedKey] = useState<CreatedIntegrationKey | null>(null);
  const [docName, setDocName] = useState("Product documentation");
  const [docUrl, setDocUrl] = useState("");

  const load = useCallback(async () => {
    try { setData(await api.checklist()); setError(""); } catch (cause) { setError(errorMessage(cause)); }
  }, [api]);
  useEffect(() => { void load(); }, [load, refreshNonce]);
  useEffect(() => {
    if (!data || (data.sdk.detected && data.scan?.status !== "scanning" && data.recordings.processing === 0)) return;
    const timer = window.setInterval(() => void load(), 5_000);
    return () => window.clearInterval(timer);
  }, [data, load]);

  const next = useMemo(() => data?.checks.find((check) => !check.complete)?.id, [data]);
  const perform = async (work: () => Promise<unknown>, success: string) => {
    setBusy(true); setError("");
    try { await work(); notify(success); await load(); } catch (cause) { setError(errorMessage(cause)); } finally { setBusy(false); }
  };
  if (!data && !error) return <Loading label="Checking deployment readiness" />;

  return (
    <div className="page-stack">
      {error ? <Alert tone="danger" onClose={() => setError("")}>{error}</Alert> : null}
      {data ? (
        <>
          <section className="setup-summary">
            <div><span className="eyebrow">Deployment readiness</span><strong>{data.completed} of {data.total}</strong><p>{data.completed === data.total ? "Mia is ready for production validation." : "Complete the remaining checks in order."}</p></div>
            <div><Progress value={data.completed} max={data.total} label="Setup progress" /><span>{Math.round((data.completed / data.total) * 100)}%</span></div>
          </section>

          <div className="setup-layout">
            <Section title="Readiness checks" description="Each check reflects live backend and SDK state.">
              <Checklist checks={data.checks} onNavigate={onNavigate} />
            </Section>
            <Section title={data.completed === data.total ? "Deployment ready" : "Next step"} description={nextDescription(next)}>
              {data.completed === data.total ? (
                <div className="completion-panel"><CheckCircle2 /><div><strong>All required checks passed</strong><p>Review recent runs, then keep the console open while you repeat your production acceptance scenarios.</p></div><Button onClick={() => onNavigate("runs")}>Review runs <ArrowRight /></Button></div>
              ) : null}
              {next === "gemini" ? (
                <form className="inline-form" onSubmit={(event) => { event.preventDefault(); void perform(() => api.setGemini(geminiKey).then(() => setGeminiKey("")), "Gemini credential saved."); }}>
                  <Field label="Gemini API key" hint="Encrypted before it is stored."><input type="password" autoComplete="off" required minLength={20} value={geminiKey} onChange={(event) => setGeminiKey(event.target.value)} /></Field>
                  <Button type="submit" disabled={busy}>Connect Gemini <ArrowRight /></Button>
                </form>
              ) : null}
              {next === "runtime_key" ? (
                <div className="inline-form">
                  {!createdKey ? (
                    <form onSubmit={(event) => { event.preventDefault(); void perform(async () => setCreatedKey(await api.createIntegrationKey(keyName)), "Runtime integration key created."); }}>
                      <Field label="Key name"><input required value={keyName} onChange={(event) => setKeyName(event.target.value)} /></Field>
                      <Button type="submit" disabled={busy}><KeyRound /> Create key</Button>
                    </form>
                  ) : (
                    <><Alert tone="warning" title="Shown once">Store this key in the product server, never in browser code.</Alert><CodeBlock label="MIA_INTEGRATION_KEY" value={createdKey.key} /></>
                  )}
                </div>
              ) : null}
              {next === "knowledge" ? (
                <form className="inline-form" onSubmit={(event: FormEvent) => { event.preventDefault(); void perform(() => api.addDocumentationUrl({ name: docName, url: docUrl }), "Documentation indexing started."); }}>
                  <Field label="Source name"><input required value={docName} onChange={(event) => setDocName(event.target.value)} /></Field>
                  <Field label="HTTPS documentation URL"><input type="url" required value={docUrl} onChange={(event) => setDocUrl(event.target.value)} placeholder="https://docs.example.com" /></Field>
                  <Button type="submit" disabled={busy}>Add source <ArrowRight /></Button>
                </form>
              ) : null}
              {next === "ui_map" ? (
                <div className="action-row"><p>The scanner will start at the product root and discover same-origin routes.</p><Button disabled={busy} onClick={() => void perform(() => api.startScan(), "UI scan started.")}><RefreshCw /> Scan product</Button><Button variant="secondary" onClick={() => onNavigate("settings")}>Scan access</Button></div>
              ) : null}
              {next === "sdk" ? (
                <div className="action-row"><p>Open the configured product after its server-side runtime token route and Mia SDK are deployed.</p><ProductLink origin={data.product.origin}>Open product</ProductLink><Button variant="secondary" onClick={() => void load()}><RefreshCw /> Check again</Button></div>
              ) : null}
              {next === "actions" ? <div className="action-row"><p>Review each SDK-detected host action before Mia can use it.</p><Button onClick={() => onNavigate("actions")}>Review actions <ArrowRight /></Button></div> : null}
              {next === "validation" ? <div className="action-row"><p>Run one complete grounded task in the product and verify its result.</p><ProductLink origin={data.product.origin}>Open product</ProductLink><Button variant="secondary" onClick={() => onNavigate("test")}>Validation</Button></div> : null}
            </Section>
          </div>

          <Section title="Live deployment" description="Current signals from the production integration.">
            <div className="facts-grid">
              <Fact label="Product origin" value={data.product.origin} />
              <Fact label="SDK" value={data.sdk.detected ? `Seen ${formatRelative(data.sdk.lastSeenAt)}` : "Not detected"} />
              <Fact label="Published actions" value={`${data.actions.published} of ${data.actions.total}`} />
              <Fact label="Last UI scan" value={data.scan ? `${data.scan.status} - ${formatRelative(data.scan.completedAt ?? data.scan.createdAt)}` : "Not run"} />
            </div>
          </Section>
        </>
      ) : null}
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return <div className="fact"><span>{label}</span><strong>{value}</strong></div>;
}

function nextDescription(id?: string): string {
  if (id === "gemini") return "Connect the Gemini provider used by planning, retrieval, and voice.";
  if (id === "runtime_key") return "Create the server credential used to mint short-lived browser tokens.";
  if (id === "knowledge") return "Give Mia one authoritative product source.";
  if (id === "ui_map") return "Build semantic memory for the production interface.";
  if (id === "sdk") return "Wait for the embedded SDK to report its first live session.";
  if (id === "actions") return "Publish or block every detected host action.";
  if (id === "validation") return "Complete one end-to-end product task.";
  return "All required setup is complete.";
}
