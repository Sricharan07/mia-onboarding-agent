import { Activity, AlertTriangle, CheckCircle2, Mic, MousePointer2 } from "lucide-react";
import { useMemo, useState } from "react";
import type { ExecutionLog } from "../api";
import { LogTable, PageIntro, Panel, StatusPill } from "../components/console";
import { formatDate, summarizePayload } from "../utils/format";

type RuntimeSessionGroup = {
  id: string;
  logs: ExecutionLog[];
  startedAt: string;
  lastAt: string;
  status: "success" | "error" | "active" | "stopped";
  mode: "voice" | "workflow" | "text" | "runtime";
};

export function LogsPage({ logs }: { logs: ExecutionLog[] }) {
  const sessions = useMemo(() => groupRuntimeSessions(logs), [logs]);
  const [selectedSessionId, setSelectedSessionId] = useState(() => sessions[0]?.id ?? "");
  const [eventType, setEventType] = useState("all");
  const selectedSession = sessions.find((session) => session.id === selectedSessionId) ?? sessions[0];
  const filteredRaw = logs.filter((log) => eventType === "all" || log.eventType === eventType);

  return (
    <div className="page-grid">
      <PageIntro
        title="Runtime sessions and diagnostics"
        description="Inspect what Mia heard, resolved, pointed at, or executed. Raw payloads stay collapsed until an admin needs support-level detail."
        action={<StatusPill tone={sessions.length ? "green" : "gray"} label={`${sessions.length} sessions`} />}
      />
      <section className="two-column logs-layout">
        <Panel title="Runtime sessions" action={<StatusPill tone={sessions.length ? "green" : "gray"} label={`${sessions.length} sessions`} />}>
          <div className="session-list">
            {sessions.length === 0 && <div className="empty-state">No runtime sessions yet. Open a host app with the SDK installed to create the first session.</div>}
            {sessions.map((session) => (
              <button
                className={`session-row ${session.id === selectedSession?.id ? "is-active" : ""}`}
                key={session.id}
                type="button"
                onClick={() => setSelectedSessionId(session.id)}
              >
                <span className="session-icon">{sessionIcon(session)}</span>
                <span className="session-main">
                  <strong>{sessionLabel(session)}</strong>
                  <span>{session.logs.length} events - last {formatDate(session.lastAt)}</span>
                </span>
                <StatusPill tone={session.status === "error" ? "red" : session.status === "stopped" ? "gray" : "green"} label={session.status} />
              </button>
            ))}
          </div>
        </Panel>

        <Panel title="Session timeline" action={selectedSession ? <StatusPill tone="gray" label={selectedSession.mode} /> : undefined}>
          {!selectedSession ? (
            <div className="empty-state">Select a runtime session to inspect what Mia heard, resolved, and did.</div>
          ) : (
            <div className="timeline-list">
              {[...selectedSession.logs].reverse().map((log) => (
                <article className="timeline-item" key={log.id}>
                  <span>{timelineIcon(log)}</span>
                  <div>
                    <strong>{humanEvent(log.eventType)}</strong>
                    <p>{timelineSummary(log)}</p>
                    <small>{formatDate(log.createdAt)}</small>
                  </div>
                </article>
              ))}
            </div>
          )}
        </Panel>
      </section>

      <details className="diagnostic-panel">
        <summary>
          <span>
            <strong>Raw event diagnostics</strong>
            <small>{filteredRaw.length} event(s). Use this when debugging payloads or support tickets.</small>
          </span>
        </summary>
        <div className="diagnostic-content">
          <div className="filter-row compact">
            <label>
              Event type
              <select value={eventType} onChange={(event) => setEventType(event.target.value)}>
                <option value="all">All events</option>
                {[...new Set(logs.map((log) => log.eventType))].map((item) => (
                  <option value={item} key={item}>{item}</option>
                ))}
              </select>
            </label>
          </div>
          <div className="diagnostic-table">
            <LogTable logs={filteredRaw} />
          </div>
        </div>
      </details>
    </div>
  );
}

function groupRuntimeSessions(logs: ExecutionLog[]): RuntimeSessionGroup[] {
  const groups = new Map<string, ExecutionLog[]>();
  for (const log of logs) {
    const id = log.sessionId || log.workflowId || "backend-events";
    groups.set(id, [...(groups.get(id) ?? []), log]);
  }

  return [...groups.entries()]
    .map(([id, sessionLogs]) => {
      const sorted = [...sessionLogs].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
      const mode: RuntimeSessionGroup["mode"] = sorted.some((log) => log.eventType.startsWith("voice_"))
        ? "voice"
        : sorted.some((log) => log.eventType.startsWith("workflow_") || log.workflowId)
          ? "workflow"
          : sorted.some((log) => log.eventType === "runtime_resolution")
            ? "text"
            : "runtime";
      const status: RuntimeSessionGroup["status"] = sorted.some((log) => log.eventType.includes("error") || log.eventType.includes("failed"))
        ? "error"
        : sorted.some((log) => log.eventType === "voice_stopped")
          ? "stopped"
          : sorted.some((log) => log.eventType.includes("completed"))
            ? "success"
            : "active";
      return {
        id,
        logs: sorted,
        startedAt: sorted.at(-1)?.createdAt ?? sorted[0]!.createdAt,
        lastAt: sorted[0]!.createdAt,
        status,
        mode
      };
    })
    .sort((a, b) => Date.parse(b.lastAt) - Date.parse(a.lastAt));
}

function sessionLabel(session: RuntimeSessionGroup): string {
  if (session.id === "backend-events") return "Backend events";
  return session.id.replace(/^sdk_session_/, "SDK ");
}

function sessionIcon(session: RuntimeSessionGroup) {
  if (session.mode === "voice") return <Mic size={15} />;
  if (session.mode === "workflow") return <Activity size={15} />;
  return <MousePointer2 size={15} />;
}

function timelineIcon(log: ExecutionLog) {
  if (log.eventType.includes("error") || log.eventType.includes("failed")) return <AlertTriangle size={14} />;
  if (log.eventType.includes("completed")) return <CheckCircle2 size={14} />;
  if (log.eventType.startsWith("voice_")) return <Mic size={14} />;
  return <Activity size={14} />;
}

function humanEvent(eventType: string): string {
  return eventType.split("_").map((part) => part[0]?.toUpperCase() + part.slice(1)).join(" ");
}

function timelineSummary(log: ExecutionLog): string {
  const payload = log.payload as Record<string, unknown>;
  if (typeof payload.text === "string") return payload.text;
  if (typeof payload.message === "string") return payload.message;
  if (payload.target && typeof payload.target === "object") {
    const target = payload.target as Record<string, unknown>;
    const label = [target.label, target.text, target.elementId, target.selector].find((value) => typeof value === "string");
    if (label) return `Target: ${label}`;
  }
  return summarizePayload(log.payload);
}
