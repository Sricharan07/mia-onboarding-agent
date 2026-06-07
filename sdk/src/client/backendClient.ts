import type { ResolveResponse, SDKConfig, SDKRuntimeContext, VoiceSessionEvent, VoiceSessionResponse } from "../types/index.js";

export class BackendClient {
  constructor(private readonly config: SDKConfig) {}

  async resolve(input: { sessionId: string; utterance: string; context: SDKRuntimeContext }): Promise<ResolveResponse> {
    return this.post("/api/v1/runtime/resolve", {
      appId: this.config.appId,
      sessionId: input.sessionId,
      utterance: input.utterance,
      includeTts: this.config.enableTTS,
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

  async updateWorkflowSession(input: { runtimeSessionId: string; status: string; currentStepId?: string; values?: Record<string, unknown>; error?: string }): Promise<void> {
    await this.patch(`/api/v1/runtime/workflow-sessions/${input.runtimeSessionId}`, input);
  }

  async logExecution(input: { sessionId: string; workflowId?: string; stepId?: string; eventType: string; payload?: unknown }): Promise<void> {
    await this.post("/api/v1/logs/execution", {
      appId: this.config.appId,
      ...input
    });
  }

  async createVoiceSession(input: { clientSessionId: string; identity: string; context: SDKRuntimeContext }): Promise<VoiceSessionResponse> {
    return this.post("/api/v1/voice/sessions", {
      appId: this.config.appId,
      clientSessionId: input.clientSessionId,
      identity: input.identity,
      context: {
        currentUrl: input.context.currentUrl,
        currentRoute: input.context.currentRoute,
        pageTitle: input.context.pageTitle,
        focusedElement: input.context.focusedElement ?? null,
        hoveredElement: input.context.hoveredElement ?? null,
        visibleElements: input.context.visibleElements ?? [],
        userMetadata: input.context.userMetadata
      },
      userMetadata: this.config.user?.metadata
    });
  }

  async endVoiceSession(voiceSessionId: string): Promise<{ voiceSessionId: string; status: string }> {
    return this.post(`/api/v1/voice/sessions/${encodeURIComponent(voiceSessionId)}/end`, {});
  }

  async beginVoiceInputCapture(voiceSessionId: string, input: { prompt: string }): Promise<{ voiceSessionId: string; status: string }> {
    return this.post(`/api/v1/voice/sessions/${encodeURIComponent(voiceSessionId)}/input-capture`, input);
  }

  async endVoiceInputCapture(voiceSessionId: string): Promise<{ voiceSessionId: string; status: string }> {
    return this.request(`/api/v1/voice/sessions/${encodeURIComponent(voiceSessionId)}/input-capture`, { method: "DELETE" });
  }

  async streamVoiceEvents(voiceSessionId: string, onEvent: (event: VoiceSessionEvent) => void, signal?: AbortSignal): Promise<void> {
    const url = `${this.config.backendUrl.replace(/\/+$/, "")}/api/v1/voice/sessions/${encodeURIComponent(voiceSessionId)}/events`;
    const response = await fetchWithBackendError(url, {
      method: "GET",
      headers: {
        ...(this.config.apiKey ? { authorization: `Bearer ${this.config.apiKey}` } : {})
      },
      signal
    }, this.config.backendUrl);
    if (!response.ok || !response.body) {
      throw new Error(`Voice event stream failed: ${response.status} ${response.statusText}`);
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        onEvent(JSON.parse(trimmed) as VoiceSessionEvent);
      }
    }
  }

  async synthesize(text: string): Promise<{ audioUrl?: string; mimeType?: string }> {
    return this.post("/api/v1/tts", { text });
  }

  private async post<T>(path: string, body: unknown): Promise<T> {
    return this.request<T>(path, { method: "POST", body });
  }

  private async patch<T>(path: string, body: unknown): Promise<T> {
    return this.request<T>(path, { method: "PATCH", body });
  }

  private async request<T>(path: string, input: { method: string; body?: unknown }): Promise<T> {
    const response = await fetchWithBackendError(`${this.config.backendUrl.replace(/\/+$/, "")}${path}`, {
      method: input.method,
      headers: {
        "content-type": "application/json",
        ...(this.config.apiKey ? { authorization: `Bearer ${this.config.apiKey}` } : {})
      },
      body: input.body === undefined ? undefined : JSON.stringify(input.body)
    }, this.config.backendUrl);
    const json = await response.json();
    if (!response.ok || json?.error) {
      throw new Error(json?.error?.message ?? `Backend request failed: ${response.status}`);
    }
    return json as T;
  }
}

async function fetchWithBackendError(url: string, init: RequestInit, backendUrl: string): Promise<Response> {
  try {
    return await fetch(url, init);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`MIA backend is unreachable at ${backendUrl}. Start npm run dev:backend and refresh. Details: ${message}`);
  }
}
