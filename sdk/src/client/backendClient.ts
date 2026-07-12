import type {
  ActionReceipt,
  AgentResponse,
  GeminiLiveToken,
  MiaActionManifest,
  MiaContextEntry,
  MiaOptions,
  MiaVisualContext,
  Observation,
  RuntimeToken
} from "../types/index.js";

type RuntimePayload = {
  observation: Observation;
  actions: MiaActionManifest[];
  context: MiaContextEntry[];
  visualContext?: MiaVisualContext[];
};
type TokenCache = RuntimeToken & { expiresAtMs?: number };
type StreamEvent = { type: string; data: unknown };
export type RuntimeConfig = { redactedSelectors: string[]; updatedAt: string };

export class BackendClient {
  private readonly baseUrl: string;
  private cachedToken?: TokenCache;
  private tokenRequest?: Promise<TokenCache>;

  constructor(private readonly options: MiaOptions) {
    this.baseUrl = options.backendUrl.replace(/\/+$/, "");
  }

  async createSession(payload: RuntimePayload): Promise<{ sessionId: string; resumeToken: string; revision: number; status: string }> {
    return this.request("/api/v1/runtime/sessions", { method: "POST", body: payload });
  }

  async resumeSession(payload: RuntimePayload & { sessionId: string; resumeToken: string }): Promise<{
    sessionId: string;
    revision: number;
    status: string;
    goal: string;
    pending?: {
      assessment: string;
      progress: string;
      message: string;
      actions: import("../types/index.js").ActionDirective[];
      recovery: "confirm" | "verify_navigation" | "replan";
      expectedRoute?: string;
    };
  }> {
    return this.request("/api/v1/runtime/sessions/resume", { method: "POST", body: payload });
  }

  async submitTurn(input: RuntimePayload & {
    sessionId: string;
    revision: number;
    utterance: string;
    source: "text" | "voice";
    signal?: AbortSignal;
  }, onEvent?: (event: StreamEvent) => void): Promise<AgentResponse> {
    const { sessionId, signal, ...body } = input;
    return this.stream(`/api/v1/runtime/sessions/${encodeURIComponent(sessionId)}/turns/stream`, body, onEvent, signal);
  }

  async continueSession(input: RuntimePayload & {
    sessionId: string;
    revision: number;
    receipts: ActionReceipt[];
    signal?: AbortSignal;
  }, onEvent?: (event: StreamEvent) => void): Promise<AgentResponse> {
    const { sessionId, signal, ...body } = input;
    return this.stream(`/api/v1/runtime/sessions/${encodeURIComponent(sessionId)}/continue/stream`, body, onEvent, signal);
  }

  async confirm(input: {
    sessionId: string;
    confirmationId: string;
    revision: number;
    binding: string;
    approved: boolean;
    source: "text" | "voice" | "ui";
    observation: Observation;
  }): Promise<{ approved: boolean; revision: number; status: string }> {
    const { sessionId, confirmationId, ...body } = input;
    return this.request(`/api/v1/runtime/sessions/${encodeURIComponent(sessionId)}/confirmations/${encodeURIComponent(confirmationId)}`, {
      method: "POST", body
    });
  }

  async cancel(sessionId: string, revision?: number): Promise<{ revision: number; status: "cancelled" }> {
    return this.request(`/api/v1/runtime/sessions/${encodeURIComponent(sessionId)}/cancel`, {
      method: "POST", body: { revision }
    });
  }

  async createLiveToken(voice?: string, sessionHandle?: string): Promise<GeminiLiveToken> {
    return this.request("/api/v1/runtime/voice/token", {
      method: "POST",
      body: { ...(voice ? { voice } : {}), ...(sessionHandle ? { sessionHandle } : {}) }
    });
  }

  async getRuntimeConfig(signal?: AbortSignal): Promise<RuntimeConfig> {
    const value = await this.request<unknown>("/api/v1/runtime/config", { method: "GET", signal });
    if (!value || typeof value !== "object") throw new Error("Mia backend returned an invalid runtime configuration.");
    const config = value as Partial<RuntimeConfig>;
    if (!Array.isArray(config.redactedSelectors) || !config.redactedSelectors.every((selector) => typeof selector === "string")
      || typeof config.updatedAt !== "string") {
      throw new Error("Mia backend returned an invalid runtime configuration.");
    }
    return { redactedSelectors: [...new Set(config.redactedSelectors)].slice(0, 100), updatedAt: config.updatedAt };
  }

  async recordEvent(eventType: string, payload: Record<string, unknown>, sessionId?: string): Promise<void> {
    await this.request("/api/v1/runtime/events", { method: "POST", body: { sessionId, eventType, payload } });
  }

  clearToken(): void {
    this.cachedToken = undefined;
    this.tokenRequest = undefined;
  }

  private async stream<T extends AgentResponse>(path: string, body: unknown, onEvent?: (event: StreamEvent) => void, signal?: AbortSignal): Promise<T> {
    const response = await this.fetchWithAuth(path, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "text/event-stream" },
      body: JSON.stringify(body),
      signal
    });
    if (!response.ok) throw await responseError(response);
    if (!response.body) throw new Error("Mia backend returned an empty event stream.");
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let final: T | undefined;
    while (true) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      const blocks = buffer.split(/\r?\n\r?\n/);
      buffer = blocks.pop() ?? "";
      for (const block of blocks) {
        const event = parseSseBlock(block);
        if (!event) continue;
        onEvent?.(event);
        if (event.type === "error") throw streamError(event.data);
        if (["confirmation_required", "action_requested", "answer", "completed", "ask_user", "unable"].includes(event.type)) {
          final = event.data as T;
        }
      }
      if (done) break;
    }
    if (!final) throw new Error("Mia backend event stream ended without a result.");
    return final;
  }

  private async request<T>(path: string, input: { method: string; body?: unknown; signal?: AbortSignal }): Promise<T> {
    const response = await this.fetchWithAuth(path, {
      method: input.method,
      headers: { "content-type": "application/json", accept: "application/json" },
      body: input.body === undefined ? undefined : JSON.stringify(input.body),
      signal: input.signal
    });
    if (!response.ok) throw await responseError(response);
    return response.json() as Promise<T>;
  }

  private async fetchWithAuth(path: string, init: RequestInit): Promise<Response> {
    let token = await this.getToken(false);
    let response = await fetch(`${this.baseUrl}${path}`, { ...init, headers: { ...init.headers, authorization: `Bearer ${token}` } });
    if (response.status === 401) {
      this.clearToken();
      token = await this.getToken(true);
      response = await fetch(`${this.baseUrl}${path}`, { ...init, headers: { ...init.headers, authorization: `Bearer ${token}` } });
    }
    return response;
  }

  private async getToken(force: boolean): Promise<string> {
    const now = Date.now();
    if (!force && this.cachedToken && (!this.cachedToken.expiresAtMs || this.cachedToken.expiresAtMs - now > 30_000)) return this.cachedToken.token;
    if (!force && this.tokenRequest) return (await this.tokenRequest).token;
    const request = Promise.resolve(this.options.tokenProvider()).then((provided) => {
      const token = typeof provided === "string" ? provided : provided.token;
      const expiresAt = typeof provided === "string" ? undefined : provided.expiresAt;
      if (!token?.trim()) throw new Error("Mia tokenProvider returned no runtime token.");
      const cached: TokenCache = { token, expiresAt, expiresAtMs: expiresAt ? Date.parse(expiresAt) : undefined };
      this.cachedToken = cached;
      return cached;
    }).finally(() => {
      if (this.tokenRequest === request) this.tokenRequest = undefined;
    });
    this.tokenRequest = request;
    return (await request).token;
  }
}

function parseSseBlock(block: string): StreamEvent | undefined {
  let type = "message";
  const data: string[] = [];
  for (const line of block.split(/\r?\n/)) {
    if (line.startsWith("event:")) type = line.slice(6).trim();
    else if (line.startsWith("data:")) data.push(line.slice(5).trimStart());
  }
  if (data.length === 0) return undefined;
  return { type, data: JSON.parse(data.join("\n")) as unknown };
}

function streamError(data: unknown): Error {
  const error = data && typeof data === "object" && "error" in data ? (data as { error?: { message?: string; code?: string } }).error : undefined;
  const value = new Error(error?.message ?? "Mia agent request failed.");
  value.name = error?.code ?? "MiaError";
  return value;
}

async function responseError(response: Response): Promise<Error> {
  let message = `Mia backend request failed (${response.status}).`;
  let code = "MiaBackendError";
  try {
    const payload = await response.json() as { error?: { message?: string; code?: string } };
    message = payload.error?.message ?? message;
    code = payload.error?.code ?? code;
  } catch {
    // The HTTP status remains sufficient when the body is not JSON.
  }
  const error = new Error(message);
  error.name = code;
  return error;
}
