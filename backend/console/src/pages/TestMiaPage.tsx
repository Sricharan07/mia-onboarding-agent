import { CheckCircle2, CircleAlert, ExternalLink, MessageSquareText, MousePointer2, Play, RefreshCw, Workflow as WorkflowIcon } from "lucide-react";
import type { ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import type { AppRecord, BackendApi, ExecutionLog, RuntimeResolveResponse, UiElement, UiPage, WorkflowSummary } from "../api";
import { InlineAlert, PageIntro, Panel, StatusBadge, StatusPill, SummaryItem } from "../components/console";
import type { RouteId } from "../types";
import { errorMessage, formatDate, humanizeEventType, summarizePayload } from "../utils/format";

type Notice = { tone: "red" | "green" | "yellow" | "gray"; title: string; message: string };

export function TestMiaPage({
  app,
  pages,
  elements,
  workflows,
  logs,
  api,
  refresh,
  onOpenRoute,
  showToast
}: {
  app: AppRecord | null;
  pages: UiPage[];
  elements: UiElement[];
  workflows: WorkflowSummary[];
  logs: ExecutionLog[];
  api: BackendApi;
  refresh: (preferredAppId?: string) => Promise<void>;
  onOpenRoute: (route: RouteId) => void;
  showToast: (message: string) => void;
}) {
  const [selectedPageId, setSelectedPageId] = useState(pages[0]?.id ?? "");
  const page = pages.find((item) => item.id === selectedPageId) ?? pages[0];
  const pageElements = useMemo(() => elements.filter((element) => element.pageId === page?.id), [elements, page?.id]);
  const firstTarget = useMemo(() => firstReadableElement(pageElements), [pageElements]);
  const [prompt, setPrompt] = useState("What can I do on this page?");
  const [result, setResult] = useState<RuntimeResolveResponse | null>(null);
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);

  const publishedWorkflows = workflows.filter((workflow) => workflow.status === "published");
  const workflowModeReady = app?.uiScanConfig.runtimeMode === "qa_only" || publishedWorkflows.length > 0;
  const runtimeLogs = logs.filter((log) => isRuntimeProofEvent(log.eventType));
  const latestRuntimeLog = runtimeLogs[0];
  const pointReady = elements.some((element) => element.selectorQuality !== "weak");
  const runtimeReady = runtimeLogs.some((log) => log.eventType === "session_started");
  const resolverSeen = runtimeLogs.some((log) => log.eventType === "runtime_resolution" || log.eventType === "voice_resolution");
  const pointed = runtimeLogs.some((log) => log.eventType === "element_pointed");
  const actionAttempted = runtimeLogs.some((log) => log.eventType.startsWith("element_action_"));

  useEffect(() => {
    if (!pages.some((item) => item.id === selectedPageId)) setSelectedPageId(pages[0]?.id ?? "");
  }, [pages, selectedPageId]);

  const runTest = async (nextPrompt = prompt) => {
    if (!app) {
      setNotice({ tone: "yellow", title: "No app selected", message: "Create an app before testing Mia." });
      return;
    }
    setPending(true);
    try {
      const response = await api.resolveRuntime({
        appId: app.id,
        sessionId: `console_test_${crypto.randomUUID()}`,
        utterance: nextPrompt,
        context: buildConsoleRuntimeContext(app, page, pageElements)
      });
      setResult(response);
      setNotice({ tone: response.type === "no_match" ? "yellow" : "green", title: "Preview complete", message: resultSummary(response) });
      showToast("Resolver preview completed");
    } catch (cause) {
      const message = errorMessage(cause, "Unable to test Mia.");
      setNotice({ tone: "red", title: "Test failed", message });
      showToast(message);
    } finally {
      setPending(false);
    }
  };

  if (!app) {
    return (
      <Panel title="Test Mia">
        <div className="empty-state">Create an app before testing Mia from the console.</div>
        <div className="panel-actions">
          <button className="button primary" type="button" onClick={() => onOpenRoute("settings")}>Configure app</button>
        </div>
      </Panel>
    );
  }

  return (
    <div className="page-grid">
      <PageIntro
        title="Test Mia before users see her"
        description="Preview resolver behavior from one mapped page, then verify the separate live SDK evidence produced by a real host-app session."
        action={
          <div className="button-cluster">
            <StatusPill tone={workflowModeReady && pointReady ? "green" : "yellow"} label={workflowModeReady && pointReady ? "ready to preview" : "needs setup"} />
            <a className="button secondary small" href={app.baseUrl} target="_blank" rel="noreferrer">Open host app<ExternalLink size={14} /></a>
          </div>
        }
      />
      {notice && <InlineAlert tone={notice.tone} title={notice.title} message={notice.message} />}

      <section className="mode-grid">
        <ReadinessMode title="Q&A" ready={runtimeReady || elements.length > 0} icon={<MessageSquareText size={16} />} detail={runtimeReady ? "SDK runtime events have reached the backend." : "Available as a console dry-run from the UI map."} />
        <ReadinessMode title="Resolver targets" ready={pointReady} icon={<MousePointer2 size={16} />} detail={pointReady ? "Mapped elements include usable locators for a preview." : "Review the UI map until selectors are strong or medium."} />
        <ReadinessMode title="Runtime mode" ready={workflowModeReady} icon={<WorkflowIcon size={16} />} detail={app.uiScanConfig.runtimeMode === "qa_only" ? "This app is intentionally Q&A and pointing only." : publishedWorkflows.length > 0 ? `${publishedWorkflows.length} workflow(s) published.` : "Publish a reviewed workflow or mark this app Q&A-only."} />
        <ReadinessMode title="Live SDK proof" ready={runtimeReady && resolverSeen && (pointed || actionAttempted)} icon={<CheckCircle2 size={16} />} detail={latestRuntimeLog ? `Last event: ${humanizeEventType(latestRuntimeLog.eventType)} at ${formatDate(latestRuntimeLog.createdAt)}` : "Open the host app with the SDK installed."} />
      </section>

      <section className="two-column test-mia-layout">
        <Panel title="Run a UI map resolver preview" action={<StatusPill tone={result ? "green" : "gray"} label={result?.type ?? "not tested"} />}>
          <div className="form-grid single">
            <label>
              Mapped page
              <select value={page?.id ?? ""} onChange={(event) => setSelectedPageId(event.target.value)}>
                {pages.map((item) => <option value={item.id} key={item.id}>{item.route} - {item.name}</option>)}
              </select>
            </label>
            <label>
              User prompt
              <textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} rows={3} />
            </label>
          </div>
          <InlineAlert tone="gray" title="Preview only" message="This checks backend resolution with mapped context. It does not move a cursor, request confirmation, or execute against the live host DOM." />
          <div className="button-cluster">
            {buildPromptSuggestions(firstTarget).map((suggestion) => (
              <button className="button secondary small" type="button" key={suggestion} onClick={() => {
                setPrompt(suggestion);
                void runTest(suggestion);
              }}>
                {suggestion}
              </button>
            ))}
          </div>
          <div className="panel-actions">
            <button className="button secondary" type="button" onClick={() => void refresh(app.id)}>
              <RefreshCw size={16} />
              Refresh runtime state
            </button>
            <button className="button primary" type="button" disabled={pending} onClick={() => void runTest()}>
              <Play size={16} />
              {pending ? "Testing" : "Test Mia"}
            </button>
          </div>
        </Panel>

        <Panel title="Test result">
          {!result ? (
            <div className="empty-state">Run a prompt to see what Mia would answer, which target she found, and whether the result is a workflow, answer, or action.</div>
          ) : (
            <div className="test-result-stack">
              <SummaryItem label="Result type" value={<StatusBadge status={result.type} />} />
              <SummaryItem label="Message" value={result.message} />
              {"target" in result && result.target && (
                <>
                  <SummaryItem label="Target" value={targetName(result.target)} />
                  <SummaryItem label="Live locator" value={result.target.selector ? <code>{result.target.selector}</code> : "No executable locator"} />
                </>
              )}
              {result.type === "element_action" && (
                <>
                  <SummaryItem label="Action" value={result.action} />
                  <SummaryItem label="Policy" value={<StatusBadge status={result.executionPolicy} />} />
                </>
              )}
              {result.type === "workflow" && (
                <SummaryItem label="Workflow" value={result.workflow.name} />
              )}
            </div>
          )}
        </Panel>
      </section>

      <section className="two-column">
        <Panel title="Live SDK runtime proof">
          <div className="service-grid">
            <div className="service-row"><span>SDK initialized</span><StatusPill tone={runtimeReady ? "green" : "yellow"} label={runtimeReady ? "verified" : "not seen"} /></div>
            <div className="service-row"><span>Live resolver request</span><StatusPill tone={resolverSeen ? "green" : "yellow"} label={resolverSeen ? "verified" : "not seen"} /></div>
            <div className="service-row"><span>Cursor pointed on host page</span><StatusPill tone={pointed ? "green" : "yellow"} label={pointed ? "verified" : "not seen"} /></div>
            <div className="service-row"><span>Action result</span><StatusPill tone={actionAttempted ? "green" : "gray"} label={actionAttempted ? "recorded" : "not tested"} /></div>
            <div className="service-row"><span>Elements in selected preview page</span><strong>{Math.min(pageElements.length, 40)}</strong></div>
            <div className="service-row"><span>Runtime mode</span><strong>{app.uiScanConfig.runtimeMode === "qa_only" ? "Q&A only" : "Workflows"}</strong></div>
            <div className="service-row"><span>Published workflows</span><strong>{publishedWorkflows.length}</strong></div>
            <div className="service-row"><span>Latest runtime event</span><strong>{latestRuntimeLog ? humanizeEventType(latestRuntimeLog.eventType) : "None"}</strong></div>
          </div>
          {!publishedWorkflows.length && app.uiScanConfig.runtimeMode !== "qa_only" && (
            <InlineAlert tone="yellow" title="Workflow mode" message="Mia can answer and point from current context, but guided workflow mode is not user-ready until at least one reviewed workflow is published or the app is intentionally marked Q&A-only." />
          )}
        </Panel>

        <Panel title="Recent runtime timeline">
          <div className="timeline-list">
            {runtimeLogs.length === 0 && <div className="empty-state">No SDK runtime events yet. Open the host app with the SDK snippet installed.</div>}
            {runtimeLogs.slice(0, 8).map((log) => (
              <article className="timeline-item" key={log.id}>
                <span><CircleAlert size={14} /></span>
                <div>
                  <strong>{humanizeEventType(log.eventType)}</strong>
                  <p>{summarizePayload(log.payload)}</p>
                  <small>{formatDate(log.createdAt)}</small>
                </div>
              </article>
            ))}
          </div>
        </Panel>
      </section>
    </div>
  );
}

function ReadinessMode({ title, ready, icon, detail }: { title: string; ready: boolean; icon: ReactNode; detail: string }) {
  return (
    <article className={`mode-card ${ready ? "is-ready" : "needs-work"}`}>
      <span>{icon}</span>
      <div>
        <strong>{title}</strong>
        <p>{detail}</p>
      </div>
      <StatusPill tone={ready ? "green" : "yellow"} label={ready ? "ready" : "needs proof"} />
    </article>
  );
}

function firstReadableElement(elements: UiElement[]): UiElement | undefined {
  return elements.find((element) => element.elementType === "button" && isUsefulPromptTarget(element))
    ?? elements.find((element) => element.elementType === "link" && isUsefulPromptTarget(element))
    ?? elements.find((element) => element.selectorQuality !== "weak" && isUsefulPromptTarget(element));
}

function buildPromptSuggestions(target: UiElement | undefined): string[] {
  if (!target) return ["What can I do on this page?", "Point me to the primary action", "Show me where to start"];
  const name = elementName(target);
  return ["What can I do on this page?", `Point me to ${name}`, `Click ${name}`];
}

function buildConsoleRuntimeContext(app: AppRecord, page: UiPage | undefined, elements: UiElement[]) {
  return {
    currentUrl: page?.url ?? app.baseUrl,
    currentRoute: page?.route ?? "/",
    pageTitle: page?.title ?? app.name,
    visibleElements: elements.slice(0, 40).map((element, index) => ({
      tagName: element.elementType === "link" ? "A" : element.elementType === "input" ? "INPUT" : "BUTTON",
      role: element.elementType,
      label: element.label,
      text: element.description,
      selector: element.selector,
      locators: element.locators,
      elementId: element.elementId,
      boundingBox: { x: 24, y: 24 + index * 38, width: 180, height: 32 }
    }))
  };
}

function elementName(element: UiElement): string {
  return element.label ?? element.description ?? element.elementId;
}

function isUsefulPromptTarget(element: UiElement): boolean {
  const name = elementName(element);
  return name.length >= 4
    && name.length <= 42
    && /[a-z]/i.test(name)
    && !name.includes("@")
    && !/\bexpanded\b/i.test(name)
    && !/^\d+\s*(day|days|week|weeks|month|months|year|years)$/i.test(name);
}

function targetName(target: { label?: string; text?: string; elementId?: string; selector?: string }): string {
  return target.label ?? target.text ?? target.elementId ?? target.selector ?? "target";
}

function resultSummary(result: RuntimeResolveResponse): string {
  if (result.type === "workflow") return `Mia selected workflow: ${result.workflow.name}.`;
  if (result.type === "element_action") return `Mia would request confirmation before ${result.action} on ${targetName(result.target)}.`;
  if ("target" in result && result.target) return `Mia found ${targetName(result.target)}.`;
  return result.message;
}

function isRuntimeProofEvent(eventType: string): boolean {
  return eventType === "session_started"
    || eventType === "runtime_resolution"
    || eventType === "element_pointed"
    || eventType.startsWith("voice_")
    || eventType.startsWith("workflow_")
    || eventType.startsWith("element_action_")
    || eventType.startsWith("screen_share_");
}
