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
  secrets: ProviderReadiness;
  providers: {
    gemini: ProviderReadiness;
    semanticSearch: ProviderReadiness;
  };
};

export type UiScanAuthMode = "none" | "login_form" | "manual";

export type AppUiScanConfig = {
  runtimeMode: "qa_only" | "workflow";
  routes: string[];
  authMode: UiScanAuthMode;
  loginUrl?: string;
  username?: string;
  passwordConfigured: boolean;
  usernameSelector?: string;
  passwordSelector?: string;
  submitSelector?: string;
  successUrlPattern?: string;
  postLoginWaitMs: number;
  ignoredSelectors: string[];
  redactedSelectors: string[];
  routeDiscovery: {
    enabled: boolean;
    maxRoutes: number;
  };
};

export type AppRecord = {
  id: string;
  name: string;
  slug: string;
  baseUrl: string;
  uiScanConfig: AppUiScanConfig;
  createdAt: string;
  updatedAt: string;
  archivedAt?: string | null;
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
  routes?: string[];
  routeCount?: number;
  pageCount?: number;
  failedPageCount?: number;
  elementCount?: number;
  strongSelectorCount?: number;
  mediumSelectorCount?: number;
  weakSelectorCount?: number;
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
  elementCount?: number;
  stateCount?: number;
  strongSelectorCount?: number;
  mediumSelectorCount?: number;
  weakSelectorCount?: number;
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
  stateName?: string;
  stateReason?: string;
  discoveredBy?: "route_scan" | "auto_expansion" | "manual_capture";
  fingerprint?: string;
  createdAt: string;
  updatedAt: string;
};

export type UiMapCaptureResult = {
  pageId: string;
  route: string;
  url: string;
  stateName: string;
  scannedElements: number;
  savedElements: number;
  duplicateElements: number;
  weakSelectors: number;
};

export type InteractiveUiMapSession = {
  sessionId: string;
  appId: string;
  uiMapVersionId: string;
  currentRoute: string;
  createdAt: string;
  initialCapture?: UiMapCaptureResult;
  capture?: UiMapCaptureResult;
};

export type UiMapPreflightCheck = {
  id: string;
  label: string;
  status: "passed" | "warning" | "failed";
  message: string;
  fix?: string;
};

export type UiMapPreflightReport = {
  appId: string;
  ok: boolean;
  checks: UiMapPreflightCheck[];
};

export type UiMapRouteDiscoveryReport = {
  appId: string;
  baseUrl: string;
  routes: string[];
  checkedRoutes: Array<{
    route: string;
    status: "passed" | "failed";
    url?: string;
    discoveredRoutes: string[];
    error?: string;
  }>;
  truncated: boolean;
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

export type WorkflowReviewIssue = {
  id: string;
  severity: "blocker" | "warning" | "info";
  label: string;
  message: string;
  stepId?: string;
  fix?: string;
};

export type WorkflowReviewReport = {
  workflowId: string;
  publishable: boolean;
  blockerCount: number;
  warningCount: number;
  issues: WorkflowReviewIssue[];
};

export type ExecutionLog = {
  id: string;
  appId?: string | null;
  sessionId?: string | null;
  workflowId?: string | null;
  stepId?: string | null;
  eventType: string;
  createdAt: string;
  payload: unknown;
};

export type RuntimeElementContext = {
  tagName: string;
  role?: string;
  label?: string;
  text?: string;
  selector?: string;
  elementId?: string;
  boundingBox?: { x: number; y: number; width: number; height: number };
};

export type RuntimeResolveResponse =
  | { type: "workflow"; workflow: Workflow; message: string }
  | { type: "control"; action: "cancel" | "pause" | "resume"; message: string }
  | { type: "element_action"; action: "click" | "focus"; target: RuntimeElementContext; executionPolicy: "auto" | "requires_confirmation"; message: string }
  | { type: "answer"; message: string; target?: RuntimeElementContext }
  | { type: "no_match"; message: string; target?: RuntimeElementContext };

export type RuntimeResolveContext = {
  currentUrl: string;
  currentRoute: string;
  pageTitle?: string;
  focusedElement?: RuntimeElementContext | null;
  hoveredElement?: RuntimeElementContext | null;
  visibleElements?: RuntimeElementContext[];
  userMetadata?: Record<string, unknown>;
};

export type ApiKeyScope = "apps:read" | "ui-map:read" | "workflows:read" | "runtime:tokens:create" | "logs:read" | "admin";

export type ApiKeyRecord = {
  id: string;
  name: string;
  prefix: string;
  scopes: ApiKeyScope[];
  appId: string | null;
  allowedOrigins: string[];
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
};

export type CreatedApiKey = ApiKeyRecord & {
  key: string;
};

export type ConsoleAuthUser = {
  id: string;
  email: string;
  name: string;
  role: "admin";
  createdAt: string;
  updatedAt: string;
  lastLoginAt: string | null;
  disabledAt: string | null;
};

export type ConsoleAuthStatus = {
  setupRequired: boolean;
  authenticated: boolean;
  user?: ConsoleAuthUser;
};

export type ConsoleLoginResponse = {
  token: string;
  expiresAt: string;
  user: ConsoleAuthUser;
};

export type ConsoleSession = {
  id: string;
  userId: string;
  createdAt: string;
  expiresAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
  user: ConsoleAuthUser;
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

export type BackendApiCredentials = {
  sessionToken?: string;
};

export class BackendApi {
  constructor(
    private readonly baseUrl: string,
    private readonly credentials: BackendApiCredentials = {}
  ) {}

  health(): Promise<BackendHealth> {
    return this.request("/api/v1/health");
  }

  readiness(): Promise<SystemReadiness> {
    return this.request("/api/v1/system/readiness");
  }

  authStatus(): Promise<ConsoleAuthStatus> {
    return this.request("/api/v1/console/auth/status");
  }

  setupConsoleUser(input: { email: string; name: string; password: string }, bootstrapToken: string): Promise<ConsoleLoginResponse> {
    return this.request("/api/v1/console/auth/setup", {
      method: "POST",
      body: input,
      headers: { "x-bootstrap-admin-token": bootstrapToken }
    });
  }

  loginConsole(input: { email: string; password: string }): Promise<ConsoleLoginResponse> {
    return this.request("/api/v1/console/auth/login", { method: "POST", body: input });
  }

  logoutConsole(): Promise<{ ok: true }> {
    return this.request("/api/v1/console/auth/logout", { method: "POST", body: {} });
  }

  listApps(): Promise<Items<AppRecord>> {
    return this.request("/api/v1/apps");
  }

  saveApp(input: {
    name: string;
    slug: string;
    baseUrl: string;
    uiScanConfig?: Partial<Omit<AppUiScanConfig, "passwordConfigured">> & { password?: string; clearPassword?: boolean };
  }): Promise<AppRecord> {
    return this.request("/api/v1/apps", { method: "POST", body: input });
  }

  archiveApp(appId: string): Promise<AppRecord> {
    return this.request(`/api/v1/apps/${encodeURIComponent(appId)}/archive`, { method: "POST", body: {} });
  }

  preflightUiMap(appId: string, routes: string[], authMode: UiScanAuthMode = "none"): Promise<UiMapPreflightReport> {
    return this.request(`/api/v1/apps/${encodeURIComponent(appId)}/ui-map/preflight`, { method: "POST", body: { routes, auth: { mode: authMode } } });
  }

  scanUiMap(appId: string, routes: string[], authMode: UiScanAuthMode = "none"): Promise<{ uiMapVersionId: string; status: string }> {
    return this.request(`/api/v1/apps/${encodeURIComponent(appId)}/ui-map/scan`, { method: "POST", body: { routes, auth: { mode: authMode } } });
  }

  discoverUiMapRoutes(appId: string, input: { routes: string[]; authMode?: UiScanAuthMode; maxRoutes?: number }): Promise<UiMapRouteDiscoveryReport> {
    return this.request(`/api/v1/apps/${encodeURIComponent(appId)}/ui-map/discover-routes`, {
      method: "POST",
      body: { routes: input.routes, auth: { mode: input.authMode ?? "none" }, maxRoutes: input.maxRoutes }
    });
  }

  startInteractiveUiMapSession(appId: string, input: { routes: string[]; authMode: UiScanAuthMode }): Promise<InteractiveUiMapSession> {
    return this.request(`/api/v1/apps/${encodeURIComponent(appId)}/ui-map/interactive-sessions`, {
      method: "POST",
      body: { routes: input.routes, auth: { mode: input.authMode } }
    });
  }

  gotoInteractiveUiMapSession(sessionId: string, input: { route: string; captureDefault?: boolean }): Promise<InteractiveUiMapSession> {
    return this.request(`/api/v1/ui-map/interactive-sessions/${encodeURIComponent(sessionId)}/goto`, { method: "POST", body: input });
  }

  captureInteractiveUiMapState(sessionId: string, input: { stateName: string; stateReason?: string }): Promise<InteractiveUiMapSession> {
    return this.request(`/api/v1/ui-map/interactive-sessions/${encodeURIComponent(sessionId)}/capture-state`, { method: "POST", body: input });
  }

  finishInteractiveUiMapSession(sessionId: string): Promise<{ uiMapVersionId: string; status: string }> {
    return this.request(`/api/v1/ui-map/interactive-sessions/${encodeURIComponent(sessionId)}/finish`, { method: "POST", body: {} });
  }

  cancelInteractiveUiMapSession(sessionId: string, reason?: string): Promise<{ uiMapVersionId: string; status: string }> {
    return this.request(`/api/v1/ui-map/interactive-sessions/${encodeURIComponent(sessionId)}/cancel`, { method: "POST", body: { reason } });
  }

  listUiMapVersions(appId: string): Promise<Items<UiMapVersion>> {
    return this.request(`/api/v1/apps/${encodeURIComponent(appId)}/ui-map/versions`);
  }

  listPages(uiMapVersionId: string): Promise<Items<UiPage>> {
    return this.request(`/api/v1/ui-map/${encodeURIComponent(uiMapVersionId)}/pages`);
  }

  listElements(pageId: string, filters: { selectorQuality?: string; elementType?: string } = {}): Promise<Items<UiElement>> {
    const params = new URLSearchParams();
    if (filters.selectorQuality) params.set("selectorQuality", filters.selectorQuality);
    if (filters.elementType) params.set("elementType", filters.elementType);
    return this.request(`/api/v1/pages/${encodeURIComponent(pageId)}/elements${params.size ? `?${params}` : ""}`);
  }

  updateElement(appId: string, elementRowId: string, input: { description?: string; tags?: string[] }): Promise<{ ok: true }> {
    return this.request(`/api/v1/apps/${encodeURIComponent(appId)}/ui-map/elements/${encodeURIComponent(elementRowId)}`, { method: "PATCH", body: input });
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

  getWorkflowReviewReport(workflowId: string): Promise<WorkflowReviewReport> {
    return this.request(`/api/v1/workflows/${encodeURIComponent(workflowId)}/review-report`);
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

  resolveRuntime(input: {
    appId: string;
    sessionId: string;
    utterance: string;
    context: RuntimeResolveContext;
  }): Promise<RuntimeResolveResponse> {
    return this.request("/api/v1/runtime/resolve", { method: "POST", body: input });
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

  createApiKey(input: { name: string; scopes: ApiKeyScope[]; appId?: string; allowedOrigins?: string[] }): Promise<CreatedApiKey> {
    return this.request("/api/v1/api-keys", { method: "POST", body: input });
  }

  revokeApiKey(keyId: string): Promise<ApiKeyRecord> {
    return this.request(`/api/v1/api-keys/${encodeURIComponent(keyId)}`, { method: "DELETE" });
  }

  listConsoleUsers(): Promise<Items<ConsoleAuthUser>> {
    return this.request("/api/v1/console/users");
  }

  createConsoleUser(input: { email: string; name: string; password: string }): Promise<ConsoleAuthUser> {
    return this.request("/api/v1/console/users", { method: "POST", body: input });
  }

  changeConsoleUserPassword(userId: string, input: { currentPassword?: string; nextPassword: string }): Promise<ConsoleAuthUser> {
    return this.request(`/api/v1/console/users/${encodeURIComponent(userId)}/password`, { method: "PATCH", body: input });
  }

  disableConsoleUser(userId: string): Promise<ConsoleAuthUser> {
    return this.request(`/api/v1/console/users/${encodeURIComponent(userId)}/disable`, { method: "POST", body: {} });
  }

  listConsoleSessions(): Promise<Items<ConsoleSession>> {
    return this.request("/api/v1/console/sessions");
  }

  revokeConsoleSession(sessionId: string): Promise<{ ok: true }> {
    return this.request(`/api/v1/console/sessions/${encodeURIComponent(sessionId)}/revoke`, { method: "POST", body: {} });
  }

  private async request<T>(
    path: string,
    init: { method?: string; body?: unknown; formData?: FormData; headers?: Record<string, string> } = {}
  ): Promise<T> {
    const headers = new Headers();
    for (const [key, value] of Object.entries(init.headers ?? {})) {
      headers.set(key, value);
    }
    let body: BodyInit | undefined;
    const method = init.method ?? "GET";
    if (init.formData) {
      body = init.formData;
    } else if (init.body !== undefined) {
      headers.set("content-type", "application/json");
      body = JSON.stringify(init.body);
    }

    if (this.credentials.sessionToken) {
      headers.set("authorization", `Bearer ${this.credentials.sessionToken}`);
    }

    const response = await fetch(`${this.baseUrl.replace(/\/+$/, "")}${path}`, {
      method,
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
