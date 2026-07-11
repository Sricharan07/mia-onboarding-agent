import type {
  AdminUser,
  AuthResponse,
  CreatedIntegrationKey,
  GeminiStatus,
  HostAction,
  IntegrationKey,
  KnowledgeSource,
  MappedElementPage,
  Product,
  Recording,
  RiskLevel,
  RunDetail,
  RunSummary,
  ScanAuth,
  SetupChecklist,
  SetupStatus,
  Skill,
  TranscriptMode,
  UiActionPolicy,
  UiMapVersion,
  Usage
} from "./types";

type RequestOptions = {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
  form?: FormData;
  authenticated?: boolean;
};

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
    readonly details?: unknown
  ) {
    super(message);
    this.name = code;
  }
}

export class BackendApi {
  private readonly baseUrl: string;

  constructor(baseUrl: string, private readonly token: string, private readonly onUnauthorized?: () => void) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
  }

  setupStatus(): Promise<SetupStatus> {
    return this.request("/api/v1/setup/status");
  }

  setup(input: {
    setupToken: string;
    productName: string;
    origin: string;
    adminEmail: string;
    adminName: string;
    password: string;
  }): Promise<AuthResponse> {
    return this.request("/api/v1/setup", { method: "POST", body: input, authenticated: false });
  }

  login(email: string, password: string): Promise<AuthResponse> {
    return this.request("/api/v1/auth/login", { method: "POST", body: { email, password }, authenticated: false });
  }

  logout(): Promise<{ ok: boolean }> {
    return this.request("/api/v1/auth/logout", { method: "POST" });
  }

  checklist(): Promise<SetupChecklist> {
    return this.request("/api/v1/setup/checklist");
  }

  product(): Promise<Product> {
    return this.request("/api/v1/product");
  }

  updateProduct(input: Partial<{
    name: string;
    origin: string;
    documentationOrigins: string[];
    redactedSelectors: string[];
    transcriptMode: TranscriptMode;
    transcriptRetentionDays: number;
    voiceConfig: Product["voiceConfig"];
  }>): Promise<Product> {
    return this.request("/api/v1/product", { method: "PATCH", body: input });
  }

  gemini(): Promise<GeminiStatus> {
    return this.request("/api/v1/product/gemini");
  }

  setGemini(apiKey: string): Promise<GeminiStatus> {
    return this.request("/api/v1/product/gemini", { method: "PUT", body: { apiKey } });
  }

  clearGemini(): Promise<GeminiStatus> {
    return this.request("/api/v1/product/gemini", { method: "DELETE" });
  }

  integrationKeys(): Promise<IntegrationKey[]> {
    return this.request<{ items: IntegrationKey[] }>("/api/v1/integration-keys").then((result) => result.items);
  }

  createIntegrationKey(name: string): Promise<CreatedIntegrationKey> {
    return this.request("/api/v1/integration-keys", { method: "POST", body: { name } });
  }

  revokeIntegrationKey(id: string): Promise<{ ok: boolean }> {
    return this.request(`/api/v1/integration-keys/${encodeURIComponent(id)}`, { method: "DELETE" });
  }

  changePassword(currentPassword: string, nextPassword: string): Promise<{ user: AdminUser }> {
    return this.request("/api/v1/auth/password", { method: "PUT", body: { currentPassword, nextPassword } });
  }

  knowledge(): Promise<KnowledgeSource[]> {
    return this.request<{ items: KnowledgeSource[] }>("/api/v1/knowledge").then((result) => result.items);
  }

  addDocumentationUrl(input: { name: string; url: string; maxPages?: number }): Promise<KnowledgeSource> {
    return this.request("/api/v1/knowledge/urls", { method: "POST", body: input });
  }

  uploadDocument(name: string, file: File): Promise<KnowledgeSource> {
    const form = new FormData();
    form.set("name", name);
    form.set("file", file);
    return this.request("/api/v1/knowledge/files", { method: "POST", form });
  }

  retryKnowledge(id: string): Promise<KnowledgeSource> {
    return this.request(`/api/v1/knowledge/${encodeURIComponent(id)}/retry`, { method: "POST" });
  }

  archiveKnowledge(id: string): Promise<KnowledgeSource> {
    return this.request(`/api/v1/knowledge/${encodeURIComponent(id)}`, { method: "DELETE" });
  }

  scans(): Promise<UiMapVersion[]> {
    return this.request<{ items: UiMapVersion[] }>("/api/v1/scans").then((result) => result.items);
  }

  startScan(routes?: string[]): Promise<UiMapVersion> {
    return this.request("/api/v1/scans", { method: "POST", body: { routes: routes?.length ? routes : undefined, discover: true } });
  }

  mappedElements(input: { route?: string; search?: string; limit?: number; offset?: number } = {}): Promise<MappedElementPage> {
    const query = new URLSearchParams();
    if (input.route) query.set("route", input.route);
    if (input.search) query.set("search", input.search);
    query.set("limit", String(input.limit ?? 100));
    query.set("offset", String(input.offset ?? 0));
    return this.request(`/api/v1/scans/elements?${query}`);
  }

  updateElementPolicy(elementKey: string, policy: UiActionPolicy): Promise<{ ok: boolean }> {
    return this.request(`/api/v1/scans/elements/${encodeURIComponent(elementKey)}/policy`, { method: "PATCH", body: { policy } });
  }

  scanAuth(): Promise<ScanAuth> {
    return this.request("/api/v1/product/scan-auth");
  }

  updateScanAuth(input: {
    authMode: "none" | "login_form";
    loginUrl?: string;
    username?: string;
    password?: string;
    usernameSelector?: string;
    passwordSelector?: string;
    submitSelector?: string;
    successUrlPattern?: string;
    allowedResourceOrigins: string[];
    waitAfterLoginMs: number;
  }): Promise<ScanAuth> {
    return this.request("/api/v1/product/scan-auth", { method: "PUT", body: input });
  }

  recordings(): Promise<Recording[]> {
    return this.request<{ items: Recording[] }>("/api/v1/recordings").then((result) => result.items);
  }

  uploadRecording(input: { name: string; description?: string; file: File }): Promise<Recording> {
    const form = new FormData();
    form.set("name", input.name);
    if (input.description) form.set("description", input.description);
    form.set("file", input.file);
    return this.request("/api/v1/recordings", { method: "POST", form });
  }

  retryRecording(id: string): Promise<Recording> {
    return this.request(`/api/v1/recordings/${encodeURIComponent(id)}/retry`, { method: "POST" });
  }

  skills(): Promise<Skill[]> {
    return this.request<{ items: Skill[] }>("/api/v1/skills").then((result) => result.items);
  }

  updateSkill(id: string, input: Partial<Pick<Skill, "name" | "description" | "goal" | "businessContext" | "steps" | "constraints" | "expectedOutcomes">>): Promise<Skill> {
    return this.request(`/api/v1/skills/${encodeURIComponent(id)}`, { method: "PATCH", body: input });
  }

  publishSkill(id: string): Promise<Skill> {
    return this.request(`/api/v1/skills/${encodeURIComponent(id)}/publish`, { method: "POST" });
  }

  archiveSkill(id: string): Promise<Skill> {
    return this.request(`/api/v1/skills/${encodeURIComponent(id)}/archive`, { method: "POST" });
  }

  actions(): Promise<HostAction[]> {
    return this.request<{ items: HostAction[] }>("/api/v1/actions").then((result) => result.items);
  }

  reviewAction(name: string, status: "published" | "blocked", risk: RiskLevel): Promise<HostAction> {
    return this.request(`/api/v1/actions/${encodeURIComponent(name)}`, { method: "PATCH", body: { status, risk } });
  }

  runs(): Promise<{ items: RunSummary[]; transcriptMode: TranscriptMode }> {
    return this.request("/api/v1/runs");
  }

  run(id: string): Promise<RunDetail> {
    return this.request(`/api/v1/runs/${encodeURIComponent(id)}`);
  }

  usage(): Promise<Usage> {
    return this.request("/api/v1/usage");
  }

  private async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const headers: Record<string, string> = { accept: "application/json" };
    const authenticated = options.authenticated !== false;
    if (authenticated && this.token) headers.authorization = `Bearer ${this.token}`;
    let body: BodyInit | undefined;
    if (options.form) body = options.form;
    else if (options.body !== undefined) {
      headers["content-type"] = "application/json";
      body = JSON.stringify(options.body);
    }
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}${path}`, { method: options.method ?? "GET", headers, body, cache: "no-store" });
    } catch {
      throw new ApiError("Mia Console could not reach the backend.", 0, "NETWORK_ERROR");
    }
    const payload = await parsePayload(response);
    if (!response.ok) {
      const error = payload && typeof payload === "object" && "error" in payload
        ? (payload as { error?: { message?: string; code?: string; details?: unknown } }).error
        : undefined;
      if (response.status === 401 && authenticated) this.onUnauthorized?.();
      throw new ApiError(error?.message ?? `Request failed with HTTP ${response.status}.`, response.status, error?.code ?? "REQUEST_FAILED", error?.details);
    }
    return payload as T;
  }
}

async function parsePayload(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new ApiError("Mia backend returned an invalid response.", response.status, "INVALID_RESPONSE");
  }
}
