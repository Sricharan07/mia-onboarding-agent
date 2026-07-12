import type { HostActionEffect } from "./domain.js";

const PROHIBITED_PATTERNS = [
  /\b(?:delete|erase|destroy|purge|wipe)\b/i,
  /\bremove\s+(?:permanently|account|record|workspace|organization|user|customer|lead|opportunity|invoice|file)\b/i,
  /\b(?:send|dispatch|transmit|deliver)\b/i,
  /\b(?:email|message|notify|invite|share)\s+(?:(?:the|a|an|this|that)\s+)?(?:externally|customer|client|contact|recipient|user|team|public|outside)\b/i,
  /\b(?:publish|post\s+publicly|make\s+public|go\s+live|release\s+publicly)\b/i,
  /\b(?:approve|authorize|countersign|sign\s+(?:the\s+)?(?:contract|agreement|document))\b/i,
  /\b(?:pay|purchase|buy|checkout|charge|debit|transfer|wire|refund)\b/i,
  /\b(?:submit|finalize|place\s+(?:the\s+)?order|complete\s+(?:the\s+)?(?:order|purchase|application)|commit\s+(?:the\s+)?transaction)\b/i,
  /\b(?:cancel\s+subscription|close\s+account)\b/i
];

export function isProhibitedOperation(...values: Array<string | null | undefined>): boolean {
  const semantic = values.filter(Boolean).join(" ").replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
  return semantic.length > 0 && PROHIBITED_PATTERNS.some((pattern) => pattern.test(semantic));
}

export function executableHostEffect(effect: HostActionEffect): boolean {
  return ["read", "navigate", "draft_create", "draft_update", "reversible_change"].includes(effect);
}

export function isProtectedInputSemantic(...values: Array<string | null | undefined>): boolean {
  const semantic = values.filter(Boolean).join(" ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ");
  return /\b(password|passcode|passphrase|credential|pin|otp|one time code|verification code|authentication code|security code|recovery code|token|secret|api key|access key|private key|seed phrase|authorization|session cookie|credit card|debit card|card number|payment|cvv|cvc|bank account|routing number|ssn|social security|tax id|webauthn|passkey|captcha|file picker|file upload|attachment)\b/i.test(semantic);
}

export function hasProtectedInputSchema(schema: Record<string, unknown>): boolean {
  const visit = (value: unknown, parentKey?: string): boolean => {
    if (!value || typeof value !== "object") return false;
    if (Array.isArray(value)) return value.some((entry) => visit(entry, parentKey));
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      if (parentKey === "properties" && (isProtectedInputSemantic(key) || /^(?:file|attachment|blob)$/i.test(key))) return true;
      if (["format", "contentEncoding", "contentMediaType"].includes(key) && typeof entry === "string"
        && (isProtectedInputSemantic(entry) || /(?:file|attachment|octet-stream)/i.test(entry))) return true;
      if (visit(entry, key)) return true;
    }
    return false;
  };
  return visit(schema);
}
