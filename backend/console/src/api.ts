export type ApiErrorBody = {
  error?: {
    code?: string;
    message?: string;
    details?: unknown;
  };
};

export type BackendHealth = {
  ok: boolean;
  service: string;
  mode: string;
  time: string;
};

export type ProviderReadiness = {
  configured: boolean;
  reachable: boolean | null;
  status: "ok" | "missing_config" | "unverified" | "error";
  message: string;
};

export type SystemReadiness = {
  database: ProviderReadiness;
  providers: {
    qwen: ProviderReadiness;
    qwenTts: ProviderReadiness;
    stt: ProviderReadiness;
    moss: ProviderReadiness;
    livekit: ProviderReadiness;
  };
};

export type AppRecord = {
  id: string;
  name: string;
  slug: string;
  baseUrl: string;
  createdAt: string;
  updatedAt: string;
};

export type UiMapVersion = {
  id: string;
  appId: string;
  version: string;
  source: string;
  status: string;
  createdAt: string;
  completedAt?: string | null;
  error?: string | null;
};

export type UiPage = {
  id: string;
  name: string;
  route: string;
  url: string;
  title?: string | null;
  status: string;
  error?: string | null;
  createdAt: string;
};

export type UiElement = {
  id: string;
  elementId: string;
  appId: string;
  uiMapVersionId: string;
  pageId: string;
  pageName: string;
  route: string;
  elementType: string;
  label?: string;
  description: string;
  selector: string;
  selectorType: string;
  fallbackSelectors: string[];
  tags: string[];
  selectorQuality: "strong" | "medium" | "weak";
  selectorWarnings: string[];
  createdAt: string;
  updatedAt: string;
};

export type WorkflowJob = {
  id: string;
  appId: string;
  videoId: string;
  filename: string;
  status: string;
  error: string | null;
  createdAt: string;
  updatedAt: string;
  workflowId?: string;
};

export type WorkflowSummary = {
  workflowId: string;
  name: string;
  description: string;
  status: string;
  version: number;
};

export type WorkflowStep =
  | {
      id: string;
      type: "navigate";
      route: string;
      label?: string;
      description?: string;
    }
  | {
      id: string;
      type: "click" | "focus";
      target: WorkflowTarget;
      executionPolicy: ExecutionPolicy;
      label?: string;
      description?: string;
      source?: WorkflowStepSource;
    }
  | {
      id: string;
      type: "fill" | "select";
      target: WorkflowTarget;
      valueFrom: string;
      executionPolicy: ExecutionPolicy;
      label?: string;
      description?: string;
      source?: WorkflowStepSource;
    }
  | {
      id: string;
      type: "ask_user";
      field: string;
      prompt: string;
      inputType?: string;
      choices?: string[];
      label?: string;
      description?: string;
    }
  | {
      id: string;
      type: "wait_for_element";
      target: WorkflowTarget;
      timeoutMs: number;
      label?: string;
      description?: string;
    }
  | {
      id: string;
      type: "confirm";
      message: string;
      confirmLabel?: string;
      cancelLabel?: string;
      label?: string;
      description?: string;
    }
  | {
      id: string;
      type: "complete";
      message: string;
      label?: string;
      description?: string;
    };

export type ExecutionPolicy = "auto" | "requires_confirmation" | "manual_only" | "blocked";

export type WorkflowTarget = {
  elementId: string;
  label?: string;
  selector: string;
  fallbackSelectors?: string[];
  route?: string;
  pageName?: string;
};

export type WorkflowStepSource = {
  extractedStepId?: string;
  matchConfidence?: number;
};

export type Workflow = {
  workflowId: string;
  appId: string;
  name: string;
  description: string;
  status: string;
  version: number;
  triggerPhrases: string[];
  requiredContext: {
    app: string;
    startingRoutes: string[];
  };
  steps: WorkflowStep[];
  createdFrom?: {
    videoId?: string;
    jobId?: string;
    uiMapVersionId?: string;
  };
  review: {
    reviewedBy?: string;
    reviewedAt?: string;
    notes?: string;
  };
  createdAt: string;
  updatedAt: string;
};

export type ExecutionLog = {
  id: string;
  eventType: string;
  createdAt: string;
  payload: unknown;
};

export type ApiKeyScope = "apps:read" | "ui-map:read" | "workflows:read" | "runtime:write" | "logs:write" | "logs:read" | "admin";

export type ApiKeyRecord = {
  id: string;
  name: string;
  prefix: string;
  scopes: ApiKeyScope[];
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
};

export type CreatedApiKey = ApiKeyRecord & {
  key: string;
};

export type UsageSummary = {
  totals: {
    sdkEvents: number;
    workflowRuns: number;
    aiRequests: number;
    errors: number;
    averageAiLatencyMs: number | null;
  };
  eventCounts: Array<{ eventType: string; count: number }>;
  providerCounts: Array<{ provider: string; count: number }>;
};

export type UsageTimeseriesPoint = {
  bucket: string;
  sdkEvents: number;
  workflowRuns: number;
  aiRequests: number;
  errors: number;
};

type Items<T> = { items: T[] };

export class BackendApi {
  constructor(private readonly baseUrl: string) {}

  health(): Promise<BackendHealth> {
    return this.request("/api/v1/health");
  }

  readiness(): Promise<SystemReadiness> {
    return this.request("/api/v1/system/readiness");
  }

  listApps(): Promise<Items<AppRecord>> {
    return this.request("/api/v1/apps");
  }

  saveApp(input: { name: string; slug: string; baseUrl: string }): Promise<AppRecord> {
    return this.request("/api/v1/apps", { method: "POST", body: input });
  }

  scanUiMap(appId: string, routes: string[]): Promise<{ uiMapVersionId: string; status: string }> {
    return this.request(`/api/v1/apps/${encodeURIComponent(appId)}/ui-map/scan`, { method: "POST", body: { routes } });
  }

  listUiMapVersions(appId: string): Promise<Items<UiMapVersion>> {
    return this.request(`/api/v1/apps/${encodeURIComponent(appId)}/ui-map/versions`);
  }

  listPages(uiMapVersionId: string): Promise<Items<UiPage>> {
    return this.request(`/api/v1/ui-map/${encodeURIComponent(uiMapVersionId)}/pages`);
  }

  listElements(pageId: string): Promise<Items<UiElement>> {
    return this.request(`/api/v1/pages/${encodeURIComponent(pageId)}/elements`);
  }

  updateElement(elementId: string, input: { description?: string; tags?: string[] }): Promise<{ ok: true }> {
    return this.request(`/api/v1/elements/${encodeURIComponent(elementId)}`, { method: "PATCH", body: input });
  }

  uploadWorkflowVideo(appId: string, input: { file: File; name?: string; description?: string }): Promise<{ videoId: string; jobId: string; status: string }> {
    const body = new FormData();
    body.set("file", input.file);
    if (input.name) body.set("name", input.name);
    if (input.description) body.set("description", input.description);
    return this.request(`/api/v1/apps/${encodeURIComponent(appId)}/workflow-videos`, { method: "POST", formData: body });
  }

  listWorkflowJobs(appId: string): Promise<Items<WorkflowJob>> {
    return this.request(`/api/v1/apps/${encodeURIComponent(appId)}/workflow-jobs`);
  }

  processWorkflowJob(jobId: string): Promise<{ jobId: string; status: string }> {
    return this.request(`/api/v1/workflow-jobs/${encodeURIComponent(jobId)}/process`, { method: "POST", body: {} });
  }

  listWorkflows(appId: string, status?: string): Promise<Items<WorkflowSummary>> {
    const search = status ? `?status=${encodeURIComponent(status)}` : "";
    return this.request(`/api/v1/apps/${encodeURIComponent(appId)}/workflows${search}`);
  }

  getWorkflow(workflowId: string): Promise<Workflow> {
    return this.request(`/api/v1/workflows/${encodeURIComponent(workflowId)}`);
  }

  updateWorkflow(workflowId: string, input: Partial<Workflow>): Promise<{ ok: true }> {
    return this.request(`/api/v1/workflows/${encodeURIComponent(workflowId)}`, { method: "PATCH", body: input });
  }

  approveWorkflow(workflowId: string, input: { reviewedBy: string; notes?: string }): Promise<{ workflowId: string; status: string }> {
    return this.request(`/api/v1/workflows/${encodeURIComponent(workflowId)}/approve`, { method: "POST", body: input });
  }

  publishWorkflow(workflowId: string): Promise<{ workflowId: string; status: string }> {
    return this.request(`/api/v1/workflows/${encodeURIComponent(workflowId)}/publish`, { method: "POST", body: {} });
  }

  archiveWorkflow(workflowId: string): Promise<{ workflowId: string; status: string }> {
    return this.request(`/api/v1/workflows/${encodeURIComponent(workflowId)}/archive`, { method: "POST", body: {} });
  }

  addWorkflowStep(workflowId: string, step: WorkflowStep): Promise<Workflow> {
    return this.request(`/api/v1/workflows/${encodeURIComponent(workflowId)}/steps`, { method: "POST", body: step });
  }

  updateWorkflowStep(workflowId: string, stepId: string, patch: Partial<WorkflowStep>): Promise<Workflow> {
    return this.request(`/api/v1/workflows/${encodeURIComponent(workflowId)}/steps/${encodeURIComponent(stepId)}`, { method: "PATCH", body: patch });
  }

  deleteWorkflowStep(workflowId: string, stepId: string): Promise<Workflow> {
    return this.request(`/api/v1/workflows/${encodeURIComponent(workflowId)}/steps/${encodeURIComponent(stepId)}`, { method: "DELETE" });
  }

  reorderWorkflowSteps(workflowId: string, stepIds: string[]): Promise<Workflow> {
    return this.request(`/api/v1/workflows/${encodeURIComponent(workflowId)}/steps/reorder`, { method: "POST", body: { stepIds } });
  }

  listLogs(filters: { appId?: string; workflowId?: string; sessionId?: string } = {}): Promise<Items<ExecutionLog>> {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(filters)) {
      if (value) params.set(key, value);
    }
    return this.request(`/api/v1/logs${params.size ? `?${params}` : ""}`);
  }

  usage(filters: { appId?: string; from?: string; to?: string } = {}): Promise<UsageSummary> {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(filters)) {
      if (value) params.set(key, value);
    }
    return this.request(`/api/v1/metrics/usage${params.size ? `?${params}` : ""}`);
  }

  usageTimeseries(filters: { appId?: string; from?: string; to?: string; bucket?: "day" } = {}): Promise<Items<UsageTimeseriesPoint>> {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(filters)) {
      if (value) params.set(key, value);
    }
    return this.request(`/api/v1/metrics/usage/timeseries${params.size ? `?${params}` : ""}`);
  }

  listApiKeys(): Promise<Items<ApiKeyRecord>> {
    return this.request("/api/v1/api-keys");
  }

  createApiKey(input: { name: string; scopes: ApiKeyScope[] }): Promise<CreatedApiKey> {
    return this.request("/api/v1/api-keys", { method: "POST", body: input });
  }

  revokeApiKey(keyId: string): Promise<ApiKeyRecord> {
    return this.request(`/api/v1/api-keys/${encodeURIComponent(keyId)}`, { method: "DELETE" });
  }

  private async request<T>(path: string, init: { method?: string; body?: unknown; formData?: FormData } = {}): Promise<T> {
    const headers = new Headers();
    let body: BodyInit | undefined;
    if (init.formData) {
      body = init.formData;
    } else if (init.body !== undefined) {
      headers.set("content-type", "application/json");
      body = JSON.stringify(init.body);
    }

    const response = await fetch(`${this.baseUrl.replace(/\/+$/, "")}${path}`, {
      method: init.method ?? "GET",
      headers,
      body
    });

    const contentType = response.headers.get("content-type") ?? "";
    const payload = contentType.includes("application/json") ? await response.json() as unknown : await response.text();
    if (!response.ok) {
      const errorBody = payload as ApiErrorBody;
      const message = errorBody.error?.message ?? `Backend request failed with ${response.status}`;
      throw new Error(message);
    }
    return payload as T;
  }
}
