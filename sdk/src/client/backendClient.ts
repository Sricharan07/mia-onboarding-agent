import type { GeminiLiveTokenResponse, ResolveResponse, SDKConfig, SDKRuntimeContext } from "../types/index.js";

export class BackendClient {
  private cachedToken?: RuntimeTokenCache;
  private tokenRequest?: Promise<RuntimeTokenCache>;

  constructor(private readonly config: SDKConfig) {}

  async resolve(input: { sessionId: string; utterance: string; context: SDKRuntimeContext }): Promise<ResolveResponse> {
    return this.post("/api/v1/runtime/resolve", {
      appId: this.config.appId,
      sessionId: input.sessionId,
      utterance: input.utterance,
      context: {
        currentUrl: input.context.currentUrl,
        currentRoute: input.context.currentRoute,
        pageTitle: input.context.pageTitle,
        focusedElement: input.context.focusedElement ?? null,
        hoveredElement: input.context.hoveredElement ?? null,
        visibleElements: input.context.visibleElements ?? [],
        userMetadata: input.context.userMetadata
      }
    });
  }

  async createWorkflowSession(input: { workflowId: string; clientSessionId: string }): Promise<{ runtimeSessionId: string; status: string }> {
    return this.post("/api/v1/runtime/workflow-sessions", {
      appId: this.config.appId,
      workflowId: input.workflowId,
      clientSessionId: input.clientSessionId
    });
  }

  async updateWorkflowSession(input: { runtimeSessionId: string; status: string; currentStepId?: string; error?: string }): Promise<void> {
    await this.patch(`/api/v1/runtime/workflow-sessions/${input.runtimeSessionId}`, input);
  }

  async logExecution(input: { sessionId: string; workflowId?: string; stepId?: string; eventType: string; payload?: unknown }): Promise<void> {
    const telemetry = this.telemetryRequest();
    await this.post("/api/v1/logs/execution", {
      appId: this.config.appId,
      ...input,
      payload: prepareTelemetryPayload(input.payload, telemetry),
      telemetry
    });
  }

  private telemetryRequest(): { mode: "events_only" | "redacted" | "full"; consent?: boolean } {
    const telemetry = this.config.privacy?.telemetry;
    const mode = telemetry?.mode ?? "events_only";
    if (mode !== "full") return { mode };
    let consent = false;
    try {
      consent = telemetry?.hasConsent?.() === true;
    } catch {
      consent = false;
    }
    return { mode, consent };
  }

  async createGeminiLiveToken(input: { clientSessionId: string }): Promise<GeminiLiveTokenResponse> {
    return this.post("/api/v1/gemini/live-token", {
      appId: this.config.appId,
      clientSessionId: input.clientSessionId
    });
  }

  async getLiveKitToken(input: { sessionId: string }): Promise<{ token: string; url: string }> {
    return this.post("/api/v1/livekit/token", {
      appId: this.config.appId,
      sessionId: input.sessionId,
    });
  }

  private async post<T>(path: string, body: unknown): Promise<T> {
    return this.request<T>(path, { method: "POST", body });
  }

  private async patch<T>(path: string, body: unknown): Promise<T> {
    return this.request<T>(path, { method: "PATCH", body });
  }

  private async request<T>(path: string, input: { method: string; body?: unknown }): Promise<T> {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const token = await this.getRuntimeToken(attempt > 0);
      const response = await fetchWithBackendError(`${this.config.backendUrl.replace(/\/+$/, "")}${path}`, {
        method: input.method,
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${token}`
        },
        body: input.body === undefined ? undefined : JSON.stringify(input.body)
      }, this.config.backendUrl);
      const json = await response.json();
      if (response.ok && !json?.error) return json as T;
      const code = typeof json?.error?.code === "string" ? json.error.code : undefined;
      if (attempt === 0 && response.status === 401 && isRefreshableRuntimeTokenError(code)) {
        this.cachedToken = undefined;
        continue;
      }
      throw new Error(json?.error?.message ?? `Backend request failed: ${response.status}`);
    }
    throw new Error("Runtime token refresh failed.");
  }

  private async getRuntimeToken(forceRefresh: boolean): Promise<string> {
    if (!forceRefresh && this.cachedToken && this.cachedToken.refreshAt > Date.now()) {
      return this.cachedToken.token;
    }
    if (!forceRefresh && this.tokenRequest) return (await this.tokenRequest).token;
    this.tokenRequest = this.config.tokenProvider().then((result) => {
      if (!result?.token) throw new Error("Mia tokenProvider returned an empty runtime token.");
      const expiresAt = result.expiresAt ? Date.parse(result.expiresAt) : Number.NaN;
      const refreshAt = Number.isFinite(expiresAt)
        ? Math.max(Date.now(), expiresAt - 30_000)
        : Date.now() + 60_000;
      const next = { token: result.token, refreshAt };
      this.cachedToken = next;
      return next;
    }).finally(() => {
      this.tokenRequest = undefined;
    });
    return (await this.tokenRequest).token;
  }
}

type RuntimeTokenCache = {
  token: string;
  refreshAt: number;
};

function isRefreshableRuntimeTokenError(code: string | undefined): boolean {
  return code === "INVALID_RUNTIME_TOKEN"
    || code === "RUNTIME_TOKEN_EXPIRED"
    || code === "RUNTIME_TOKEN_EXHAUSTED"
    || code === "RUNTIME_TOKEN_REVOKED"
    || code === "RUNTIME_TOKEN_UNAVAILABLE";
}

const secretTelemetryKey = /(?:password|passcode|secret|token|authorization|api.?key|cookie|session.?key|cvv|cvc|card.?number|bank.?account|routing.?number|ssn)/i;
const redactedTelemetryKey = /(?:text|message|prompt|utterance|transcript|value|email|phone|address|name|user|url|route|title|selector|screen|frame|image|audio)/i;
const secretTelemetryValue = /(?:bearer\s+[a-z0-9._~+/=-]+|(?:password|passcode|secret|token|api.?key|cvv|cvc|ssn)\s*[:=]\s*\S+|\b(?:\d[ -]*?){13,19}\b)/i;

function prepareTelemetryPayload(payload: unknown, telemetry: { mode: "events_only" | "redacted" | "full"; consent?: boolean }): unknown {
  if (telemetry.mode === "events_only" || (telemetry.mode === "full" && telemetry.consent !== true)) return {};
  return sanitizeTelemetryValue(payload, telemetry.mode, 0);
}

function sanitizeTelemetryValue(value: unknown, mode: "redacted" | "full", depth: number, key = ""): unknown {
  if (secretTelemetryKey.test(key)) return "[redacted]";
  if (mode === "redacted" && redactedTelemetryKey.test(key)) return "[redacted]";
  if (depth >= 6) return "[truncated]";
  if (value === null || typeof value === "boolean" || typeof value === "number") return value;
  if (typeof value === "string") return secretTelemetryValue.test(value) ? "[redacted]" : value.slice(0, mode === "full" ? 2_000 : 200);
  if (Array.isArray(value)) return value.slice(0, 100).map((item) => sanitizeTelemetryValue(item, mode, depth + 1));
  if (typeof value !== "object") return String(value).slice(0, 200);
  const result: Record<string, unknown> = {};
  for (const [entryKey, entryValue] of Object.entries(value).slice(0, 100)) {
    result[entryKey] = sanitizeTelemetryValue(entryValue, mode, depth + 1, entryKey);
  }
  return result;
}

async function fetchWithBackendError(url: string, init: RequestInit, backendUrl: string): Promise<Response> {
  try {
    return await fetch(url, init);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`MIA backend is unreachable at ${backendUrl}. Start npm run dev:backend and refresh. Details: ${message}`);
  }
}
