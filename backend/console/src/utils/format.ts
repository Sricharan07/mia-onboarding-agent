import { ApiError } from "../api";

export function formatDateTime(value?: string | null): string {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date);
}

export function formatRelative(value?: string | null): string {
  if (!value) return "Never";
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return value;
  const seconds = Math.round((timestamp - Date.now()) / 1_000);
  const formatter = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
  if (Math.abs(seconds) < 60) return formatter.format(seconds, "second");
  const minutes = Math.round(seconds / 60);
  if (Math.abs(minutes) < 60) return formatter.format(minutes, "minute");
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 24) return formatter.format(hours, "hour");
  return formatter.format(Math.round(hours / 24), "day");
}

export function formatNumber(value?: number | null): string {
  return new Intl.NumberFormat().format(value ?? 0);
}

export function formatDuration(value?: number | null): string {
  if (value === null || value === undefined) return "-";
  return value < 1_000 ? `${value} ms` : `${(value / 1_000).toFixed(value < 10_000 ? 1 : 0)} s`;
}

export function errorMessage(error: unknown, fallback = "Request failed."): string {
  if (error instanceof ApiError || error instanceof Error) return error.message;
  return fallback;
}

export function lines(value: string): string[] {
  return [...new Set(value.split(/\r?\n/).map((entry) => entry.trim()).filter(Boolean))];
}

export function json(value: unknown): string {
  return JSON.stringify(value, null, 2);
}
