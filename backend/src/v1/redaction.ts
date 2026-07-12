const SENSITIVE_PATTERNS: Array<{ pattern: RegExp; replacement: string }> = [
  { pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, replacement: "[redacted]" },
  { pattern: /\bbearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, replacement: "Bearer [redacted]" },
  { pattern: /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, replacement: "[redacted]" },
  { pattern: /\bAIza[A-Za-z0-9_-]{30,}\b/g, replacement: "[redacted]" },
  { pattern: /\bAKIA[0-9A-Z]{16}\b/g, replacement: "[redacted]" },
  { pattern: /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g, replacement: "[redacted]" },
  { pattern: /\bnpm_[A-Za-z0-9]{20,}\b/g, replacement: "[redacted]" },
  { pattern: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g, replacement: "[redacted]" },
  { pattern: /\b(?:sk|rk|pk)_(?:live|test)_[A-Za-z0-9]{12,}\b/g, replacement: "[redacted]" },
  { pattern: /\bmia_(?:key|rt|admin|resume)_[A-Za-z0-9_-]+\b/g, replacement: "[redacted]" },
  { pattern: /\bsk-[A-Za-z0-9_-]{20,}\b/g, replacement: "[redacted]" },
  { pattern: /\b(?:\d[ -]*?){13,19}\b/g, replacement: "[redacted]" },
  {
    pattern: /((?:password|passcode|passphrase|secret|api.?key|access.?token|auth(?:entication|orization)?.?token|bearer.?token|session.?(?:token|cookie)|one.?time.?(?:code|password)|verification.?code|security.?code|recovery.?code|otp|cvv|cvc|ssn|card.?number|bank.?account|routing.?number|private.?key|seed.?phrase)\s*["']?\s*(?::|=|\bis\b)\s*["']?\s*)[^\s,;}"']+/gi,
    replacement: "$1[redacted]"
  }
];

const SENSITIVE_FIELD = /(?:^|_)(?:password|passcode|passphrase|pin|otp|verification_code|authentication_code|security_code|recovery_code|secret|token|token_hash|api_key|access_key|authorization|cookie|private_key|seed_phrase|cvv|cvc|ssn|tax_id|card_number|payment_details|bank_account|routing_number)(?:_|$)/i;

export function redactSensitiveText(value: string, limit = 20_000): string {
  let result = value;
  for (const { pattern, replacement } of SENSITIVE_PATTERNS) {
    result = result.replace(new RegExp(pattern.source, pattern.flags), replacement);
  }
  return result.slice(0, limit);
}

export function redactSensitiveJson<T>(value: T, fieldName?: string): T {
  if (fieldName && SENSITIVE_FIELD.test(normalizeFieldName(fieldName))) return "[redacted]" as T;
  if (typeof value === "string") return redactSensitiveText(value) as T;
  if (Array.isArray(value)) return value.map((entry) => redactSensitiveJson(entry, fieldName)) as T;
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, entry]) => [key, redactSensitiveJson(entry, key)])) as T;
  }
  return value;
}

function normalizeFieldName(value: string): string {
  return value.replace(/([a-z0-9])([A-Z])/g, "$1_$2").replace(/[^A-Za-z0-9]+/g, "_").toLowerCase();
}
