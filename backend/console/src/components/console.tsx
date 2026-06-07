import { AlertTriangle, FileJson, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import type { ExecutionLog } from "../api";
import { summarizePayload } from "../utils/format";
import type { StatusTone } from "../types";
import { Badge, Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "./ui";

export function MetricCard({
  label,
  value,
  detail,
  icon: Icon,
  badge,
  footer
}: {
  label: string;
  value: string;
  detail: string;
  icon: LucideIcon;
  badge?: ReactNode;
  footer?: string;
}) {
  return (
    <Card className="metric-card">
      <CardHeader>
        <CardDescription>{label}</CardDescription>
        <CardAction>
          <span className="metric-icon">
            <Icon size={16} />
          </span>
        </CardAction>
      </CardHeader>
      <CardContent className="metric-content">
        <div className="metric-value-row">
          <div className={`metric-value ${value.length > 14 ? "is-long" : ""}`}>{value}</div>
          {badge}
        </div>
        <div className="metric-detail">{detail}</div>
        {footer && <div className="metric-footer-line">{footer}</div>}
      </CardContent>
    </Card>
  );
}

export function Panel({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <Card className="panel">
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        {action && <CardAction>{action}</CardAction>}
      </CardHeader>
      <CardContent className="panel-content">{children}</CardContent>
    </Card>
  );
}

export function SummaryItem({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="summary-item">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

export function ServiceRow({ label, value }: { label: string; value: string }) {
  const tone: StatusTone = value === "connected" ? "green" : value.includes("missing") || value === "error" ? "red" : "yellow";
  return (
    <div className="service-row">
      <span>{label}</span>
      <StatusPill tone={tone} label={value} />
    </div>
  );
}

export function StatusBadge({ status }: { status: string }) {
  const tone: StatusTone =
    ["published", "approved", "completed", "mapped", "auto"].includes(status)
      ? "green"
      : ["needs_review", "uploaded", "analyzing", "requires_confirmation", "manual_only", "draft"].includes(status)
        ? "yellow"
        : ["failed", "blocked", "archived"].includes(status)
          ? "red"
          : "gray";
  return <StatusPill tone={tone} label={status} />;
}

export function SelectorQualityBadge({ quality }: { quality: "strong" | "medium" | "weak" }) {
  return <StatusPill tone={quality === "strong" ? "green" : quality === "medium" ? "yellow" : "red"} label={quality} />;
}

export function StatusPill({ tone, label }: { tone: StatusTone; label: string }) {
  return <span className={`status-pill ${tone}`}>{label}</span>;
}

export function InlineAlert({ tone, title, message }: { tone: StatusTone; title: string; message: string }) {
  return (
    <div className={`error-item ${tone}`}>
      <AlertTriangle size={15} />
      <strong>{title}:</strong>
      <span>{message}</span>
    </div>
  );
}

export function LogTable({ logs, compact = false }: { logs: ExecutionLog[]; compact?: boolean }) {
  return (
    <table className={compact ? "compact-table" : ""}>
      <thead>
        <tr>
          <th>Event type</th>
          {!compact && <th>ID</th>}
          <th>Payload</th>
          <th>Time</th>
        </tr>
      </thead>
      <tbody>
        {logs.length === 0 && <EmptyTableRow colSpan={compact ? 3 : 4} message="No execution logs recorded yet." />}
        {logs.map((log) => (
          <tr key={log.id}>
            <td>{log.eventType}</td>
            {!compact && <td><code>{log.id}</code></td>}
            <td><code>{summarizePayload(log.payload)}</code></td>
            <td>{new Date(log.createdAt).toLocaleString()}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function RawJsonViewer({ title, data }: { title: string; data: unknown }) {
  return (
    <Panel title={title} action={<FileJson size={16} />}>
      <pre className="json-viewer">{JSON.stringify(data, null, 2)}</pre>
    </Panel>
  );
}

export function EmptyTableRow({ colSpan, message }: { colSpan: number; message: string }) {
  return (
    <tr>
      <td colSpan={colSpan}>
        <div className="empty-state">{message}</div>
      </td>
    </tr>
  );
}

export { Badge };
