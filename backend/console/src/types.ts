export type RouteId = "setup" | "overview" | "knowledge" | "skills" | "actions" | "test" | "runs" | "settings";
export type LoadState = "idle" | "loading" | "ready" | "error";
export type RiskLevel = "read" | "navigate" | "reversible_write" | "manual" | "blocked";
export type MiaVoiceName = "Aoede" | "Kore" | "Leda";
export type UiActionPolicy = "guide_only" | "navigate" | "reversible_write" | "manual" | "blocked";
export type TranscriptMode = "full" | "redacted" | "disabled";

export type AdminUser = {
  id: string;
  email: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  lastLoginAt: string | null;
};

export type Product = {
  name: string;
  origin: string;
  documentationOrigins: string[];
  redactedSelectors: string[];
  transcriptMode: TranscriptMode;
  transcriptRetentionDays: number;
  scanConfig: Record<string, unknown>;
  voiceConfig: { enabled: boolean; voice: MiaVoiceName; language: "en-US" };
  createdAt: string;
  updatedAt: string;
};

export type SetupStatus = {
  setupRequired: boolean;
  authenticated: boolean;
  user?: AdminUser;
  product?: Product;
  gemini: GeminiStatus;
};

export type AuthResponse = {
  token: string;
  expiresAt: string;
  user: AdminUser;
  product?: Product;
};

export type GeminiStatus = { configured: boolean; source?: "database" | "environment" };

export type SetupCheck = { id: string; label: string; complete: boolean };
export type SetupChecklist = {
  checks: SetupCheck[];
  completed: number;
  total: number;
  product: Product;
  gemini: GeminiStatus;
  integrationKeys: { active: number; total: number; lastUsedAt: string | null };
  knowledge: { total: number; ready: number };
  skills: { total: number; published: number; needsReview: number };
  recordings: { total: number; processing: number };
  scan: UiMapVersion | null;
  sdk: { detected: boolean; eventCount: number; lastSeenAt: string | null; lastRoute: string | null };
  acceptance: Record<"answer" | "point" | "navigate" | "mutation" | "voice", { passed: boolean; runId: string | null; at: string | null }>;
  actions: { total: number; published: number; pending: number; blocked: number };
  usage: Usage;
};

export type IntegrationKey = {
  id: string;
  name: string;
  prefix: string;
  allowedOrigin: string;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
};
export type CreatedIntegrationKey = IntegrationKey & { key: string };

export type KnowledgeSource = {
  id: string;
  kind: "documentation_url" | "document_file" | "ui_map" | "recording" | "skill";
  name: string;
  sourceUrl: string | null;
  status: "pending" | "processing" | "ready" | "failed" | "archived";
  metadata: Record<string, unknown>;
  error: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
};

export type UiMapVersion = {
  id: string;
  status: "pending" | "scanning" | "ready" | "failed";
  routes: string[];
  metadata: Record<string, unknown>;
  createdAt: string;
  completedAt: string | null;
  error: string | null;
};

export type MappedElement = {
  elementKey: string;
  route: string;
  role: string | null;
  name: string | null;
  description: string | null;
  locators: Array<Record<string, unknown>>;
  fingerprint: string;
  actionPolicy: UiActionPolicy;
};

export type MappedElementPage = { items: MappedElement[]; total: number; overallTotal: number; routes: string[] };

export type ScanAuth = {
  config: {
    authMode?: "none" | "login_form";
    loginUrl?: string;
    username?: string;
    usernameSelector?: string;
    passwordSelector?: string;
    submitSelector?: string;
    successUrlPattern?: string;
    allowedResourceOrigins?: string[];
    waitAfterLoginMs?: number;
  };
  passwordConfigured: boolean;
};

export type Recording = {
  id: string;
  name: string;
  description: string | null;
  status: "uploaded" | "processing" | "needs_review" | "ready" | "failed";
  analysis: Record<string, unknown> | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
};

export type SkillStep = { intent?: string; context?: string; expectedOutcome?: string; [key: string]: unknown };
export type Skill = {
  id: string;
  name: string;
  description: string;
  goal: string;
  businessContext: string;
  steps: SkillStep[];
  constraints: string[];
  expectedOutcomes: string[];
  status: "draft" | "needs_review" | "published" | "archived";
  version: number;
  recordingId: string | null;
  createdAt: string;
  updatedAt: string;
  publishedAt: string | null;
};

export type HostAction = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  effect: "read" | "navigate" | "draft_create" | "draft_update" | "reversible_change" | "protected";
  proposedRisk: RiskLevel;
  effectiveRisk: RiskLevel;
  status: "detected" | "needs_review" | "published" | "blocked";
  manifestHash: string;
  firstSeenAt: string;
  lastSeenAt: string;
  reviewedAt: string | null;
};

export type Usage = { sessions: number; completed: number; failed: number; actions: number; aiRequests: number };

export type RunSummary = {
  id: string;
  userId: string;
  status: "active" | "waiting_user" | "waiting_confirmation" | "completed" | "failed" | "cancelled";
  goal: string;
  currentRoute: string | null;
  stepCount: number;
  consecutiveFailures: number;
  turnCount: number;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  error: string | null;
};

export type RunDetail = {
  transcriptMode: TranscriptMode;
  transcriptAvailable: boolean;
  session: RunSummary & { revision: number; loopCount: number };
  turns: Array<{ id: string; role: "user" | "assistant" | "system"; source: "text" | "voice" | "runtime"; content: string; createdAt: string }>;
  steps: Array<{
    id: string;
    sessionId: string;
    stepIndex: number;
    observationRevision: number;
    assessment: string;
    progress: string;
    directive: Record<string, unknown>;
    retrievedSources: Array<Record<string, unknown>>;
    model: string;
    latencyMs: number | null;
    inputTokens: number | null;
    outputTokens: number | null;
    status: "issued" | "completed" | "failed" | "cancelled";
    error: string | null;
    createdAt: string;
  }>;
  receipts: Array<{
    actionId: string;
    idempotencyKey: string;
    type: string;
    targetRef: string | null;
    status: "completed" | "unverified" | "failed" | "cancelled" | "manual";
    message: string;
    evidence: Record<string, unknown>;
    createdAt: string;
  }>;
  confirmations: Array<{
    id: string;
    actionId: string;
    prompt: string;
    status: "pending" | "approved" | "denied" | "expired";
    source: "text" | "voice" | "ui" | null;
    expiresAt: string;
    createdAt: string;
    resolvedAt: string | null;
  }>;
  events: Array<{ id: string; eventType: string; payload: Record<string, unknown>; createdAt: string }>;
  aiRequests: Array<{
    id: string;
    purpose: string;
    model: string;
    latencyMs: number | null;
    inputTokens: number | null;
    outputTokens: number | null;
    error: string | null;
    createdAt: string;
  }>;
};
