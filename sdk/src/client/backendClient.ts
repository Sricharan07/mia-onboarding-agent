import type { ResolveResponse, SDKConfig, SDKRuntimeContext } from "../types/index.js";

export class BackendClient {
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

  async updateWorkflowSession(input: { runtimeSessionId: string; status: string; currentStepId?: string; values?: Record<string, unknown>; error?: string }): Promise<void> {
    await this.patch(`/api/v1/runtime/workflow-sessions/${input.runtimeSessionId}`, input);
  }

  async logExecution(input: { sessionId: string; workflowId?: string; stepId?: string; eventType: string; payload?: unknown }): Promise<void> {
    await this.post("/api/v1/logs/execution", {
      appId: this.config.appId,
      ...input
    });
  }

  async getLiveKitToken(input: { sessionId: string; identity: string }): Promise<{ token: string; url: string }> {
    return this.post("/api/v1/livekit/token", {
      appId: this.config.appId,
      sessionId: input.sessionId,
      identity: input.identity
    });
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
    const response = await fetch(`${this.config.backendUrl.replace(/\/+$/, "")}${path}`, {
      method: input.method,
      headers: {
        "content-type": "application/json",
        ...(this.config.apiKey ? { authorization: `Bearer ${this.config.apiKey}` } : {})
      },
      body: input.body === undefined ? undefined : JSON.stringify(input.body)
    });
    const json = await response.json();
    if (!response.ok || json?.error) {
      throw new Error(json?.error?.message ?? `Backend request failed: ${response.status}`);
    }
    return json as T;
  }
}
