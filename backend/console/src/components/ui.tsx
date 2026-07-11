import { AlertTriangle, Check, Copy, Inbox, LoaderCircle, X } from "lucide-react";
import { cloneElement, isValidElement, useId, useState, type ButtonHTMLAttributes, type HTMLAttributes, type ReactElement, type ReactNode } from "react";

export function Button({ className = "", variant = "primary", size = "md", children, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "danger" | "quiet";
  size?: "sm" | "md";
}) {
  return <button className={`button button-${variant} button-${size} ${className}`} {...props}>{children}</button>;
}

export function IconButton({ label, children, className = "", ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return <button type="button" className={`icon-button ${className}`} aria-label={label} title={label} {...props}>{children}</button>;
}

export function Field({ label, hint, error, children, className = "" }: {
  label: string;
  hint?: string;
  error?: string;
  children: ReactNode;
  className?: string;
}) {
  const generatedId = useId();
  const controlId = isValidElement(children) && typeof (children.props as { id?: unknown }).id === "string"
    ? (children.props as { id: string }).id
    : `field-${generatedId.replace(/:/g, "")}`;
  const descriptionId = hint || error ? `${controlId}-description` : undefined;
  const control = isValidElement(children)
    ? cloneElement(children as ReactElement<Record<string, unknown>>, {
        id: controlId,
        ...(descriptionId ? { "aria-describedby": descriptionId } : {}),
        ...(error ? { "aria-invalid": true } : {})
      })
    : children;
  return (
    <div className={`field ${className}`}>
      <label className="field-label" htmlFor={controlId}>{label}</label>
      {control}
      {hint || error ? <span id={descriptionId} className={error ? "field-error" : "field-hint"}>{error ?? hint}</span> : null}
    </div>
  );
}

export function StatusBadge({ value, label }: { value: string; label?: string }) {
  return <span className="status-badge" data-status={statusTone(value)}><span aria-hidden="true" />{label ?? humanize(value)}</span>;
}

export function Alert({ tone = "info", title, children, onClose }: {
  tone?: "info" | "success" | "warning" | "danger";
  title?: string;
  children: ReactNode;
  onClose?: () => void;
}) {
  return (
    <div className="alert" data-tone={tone} role={tone === "danger" ? "alert" : "status"}>
      {tone === "danger" || tone === "warning" ? <AlertTriangle aria-hidden="true" /> : tone === "success" ? <Check aria-hidden="true" /> : null}
      <div>{title ? <strong>{title}</strong> : null}<div>{children}</div></div>
      {onClose ? <IconButton label="Dismiss" onClick={onClose}><X /></IconButton> : null}
    </div>
  );
}

export function Loading({ label = "Loading" }: { label?: string }) {
  return <div className="loading" role="status"><LoaderCircle aria-hidden="true" /><span>{label}</span></div>;
}

export function EmptyState({ title, detail, action }: { title: string; detail: string; action?: ReactNode }) {
  return <div className="empty-state"><Inbox aria-hidden="true" /><strong>{title}</strong><p>{detail}</p>{action}</div>;
}

export function Section({ title, description, action, children, className = "", ...props }: HTMLAttributes<HTMLElement> & {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <section className={`section ${className}`} {...props}>
      <header className="section-header">
        <div><h2>{title}</h2>{description ? <p>{description}</p> : null}</div>
        {action ? <div className="section-action">{action}</div> : null}
      </header>
      {children}
    </section>
  );
}

export function Metric({ label, value, detail, tone = "neutral" }: { label: string; value: ReactNode; detail?: string; tone?: "neutral" | "good" | "warn" | "bad" }) {
  return <div className="metric" data-tone={tone}><span>{label}</span><strong>{value}</strong>{detail ? <small>{detail}</small> : null}</div>;
}

export function Segmented<T extends string>({ value, options, onChange, label }: {
  value: T;
  options: Array<{ value: T; label: string; count?: number }>;
  onChange: (value: T) => void;
  label: string;
}) {
  return (
    <div className="segmented" role="tablist" aria-label={label}>
      {options.map((option) => (
        <button key={option.value} type="button" role="tab" aria-selected={value === option.value} onClick={() => onChange(option.value)}>
          {option.label}{option.count !== undefined ? <span>{option.count}</span> : null}
        </button>
      ))}
    </div>
  );
}

export function Progress({ value, max, label }: { value: number; max: number; label: string }) {
  const percent = max ? Math.min(100, Math.round((value / max) * 100)) : 0;
  return <div className="progress" aria-label={label} role="progressbar" aria-valuemin={0} aria-valuemax={max} aria-valuenow={value}><span style={{ width: `${percent}%` }} /></div>;
}

export function CopyButton({ value, label = "Copy" }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    await navigator.clipboard.writeText(value);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1_500);
  };
  return <IconButton label={copied ? "Copied" : label} onClick={() => void copy()}>{copied ? <Check /> : <Copy />}</IconButton>;
}

export function CodeBlock({ value, label = "Code" }: { value: string; label?: string }) {
  return <div className="code-block"><div><span>{label}</span><CopyButton value={value} /></div><pre>{value}</pre></div>;
}

export function SkeletonRows({ count = 4 }: { count?: number }) {
  return <div className="skeleton-rows" aria-hidden="true">{Array.from({ length: count }, (_, index) => <span key={index} />)}</div>;
}

function statusTone(value: string): string {
  if (["ready", "completed", "published", "approved", "configured", "active", "success"].includes(value)) return "good";
  if (["failed", "blocked", "denied", "error", "expired"].includes(value)) return "bad";
  if (["pending", "processing", "scanning", "needs_review", "waiting_user", "waiting_confirmation", "detected", "issued"].includes(value)) return "warn";
  return "neutral";
}

export function humanize(value: string): string {
  return value.replace(/_/g, " ").replace(/\b\w/g, (character) => character.toUpperCase());
}
