import type { Repositories } from "../../db/repositories.js";
import type { TelemetryMode } from "../../schemas/domain.js";

const modeRank: Record<TelemetryMode, number> = {
  events_only: 0,
  redacted: 1,
  full: 2
};

const alwaysSecretKey = /(?:password|passcode|secret|token|authorization|api.?key|cookie|session.?key|cvv|cvc|card.?number|bank.?account|routing.?number|ssn)/i;
const redactedKey = /(?:text|message|prompt|utterance|transcript|value|email|phone|address|name|user|url|route|title|selector|screen|frame|image|audio)/i;
const secretValue = /(?:bearer\s+[a-z0-9._~+/=-]+|(?:password|passcode|secret|token|api.?key|cvv|cvc|ssn)\s*[:=]\s*\S+|\b(?:\d[ -]*?){13,19}\b)/i;

export class TelemetryService {
  constructor(private readonly repositories: Repositories) {}

  prepareExecutionLog(input: {
    appId: string;
    requestedMode?: TelemetryMode;
    consent?: boolean;
    payload: unknown;
  }): { telemetryLevel: TelemetryMode; payload: unknown } {
    const policy = this.repositories.getActiveApp(input.appId).privacyPolicy;
    const requestedMode = input.requestedMode ?? "events_only";
    const consentedMode = requestedMode === "full" && input.consent !== true ? "events_only" : requestedMode;
    const telemetryLevel = modeRank[consentedMode] <= modeRank[policy.telemetryMode]
      ? consentedMode
      : policy.telemetryMode;

    if (telemetryLevel === "events_only") return { telemetryLevel, payload: {} };
    return {
      telemetryLevel,
      payload: sanitizeValue(input.payload, telemetryLevel, 0)
    };
  }
}

function sanitizeValue(value: unknown, mode: "redacted" | "full", depth: number, key = ""): unknown {
  if (alwaysSecretKey.test(key)) return "[redacted]";
  if (mode === "redacted" && redactedKey.test(key)) return "[redacted]";
  if (depth >= 6) return "[truncated]";
  if (value === null || typeof value === "boolean" || typeof value === "number") return value;
  if (typeof value === "string") return secretValue.test(value) ? "[redacted]" : value.slice(0, mode === "full" ? 2_000 : 200);
  if (Array.isArray(value)) return value.slice(0, 100).map((item) => sanitizeValue(item, mode, depth + 1));
  if (typeof value !== "object") return String(value).slice(0, 200);

  const result: Record<string, unknown> = {};
  for (const [entryKey, entryValue] of Object.entries(value).slice(0, 100)) {
    result[entryKey] = sanitizeValue(entryValue, mode, depth + 1, entryKey);
  }
  return result;
}
