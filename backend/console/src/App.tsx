import {
  Activity,
  AlertTriangle,
  BarChart3,
  Bell,
  Check,
  ChevronRight,
  ChevronsUpDown,
  Clipboard,
  Code2,
  Command,
  Database,
  EllipsisVertical,
  Eye,
  FileJson,
  FileVideo,
  Gauge,
  Home,
  KeyRound,
  Layers3,
  ListChecks,
  Loader2,
  Lock,
  LogOut,
  PanelLeft,
  Play,
  Plus,
  RefreshCw,
  Save,
  Search,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  TerminalSquare,
  TrendingUp,
  Upload,
  Workflow,
  X,
  type LucideIcon,
} from "lucide-react";
import { useMemo, useState } from "react";
import { Badge, Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "./components/ui";

type RouteId =
  | "overview"
  | "settings"
  | "ui-map"
  | "ui-map-detail"
  | "upload"
  | "workflow-jobs"
  | "workflow-review"
  | "workflows"
  | "logs"
  | "usage"
  | "api-keys";

type WorkflowStatus = "uploaded" | "analyzing" | "mapped" | "needs_review" | "approved" | "published" | "failed" | "archived";
type SelectorQuality = "strong" | "medium" | "weak";
type JobStatus = "uploaded" | "analyzing" | "mapped" | "needs_review" | "failed";
type LogStatus = "ok" | "warning" | "error";
type StepType = "click" | "fill" | "wait" | "confirm" | "blocked";
type ExecutionPolicy = "auto" | "requires_confirmation" | "guidance_only";

type UiPage = {
  id: string;
  route: string;
  name: string;
  status: "scanned" | "changed" | "failed";
  elementCount: number;
  lastScanned: string;
};

type UiElement = {
  id: string;
  pageId: string;
  type: string;
  label: string;
  description: string;
  selector: string;
  quality: SelectorQuality;
  warnings: string;
  recommendation: string;
  tags: string[];
};

type WorkflowStep = {
  id: string;
  order: number;
  type: StepType;
  targetElementId: string;
  prompt: string;
  fieldName: string;
  policy: ExecutionPolicy;
  extractedAction: string;
  observedElement: string;
  qwenConfidence: number;
  matchConfidence: number;
};

type WorkflowRecord = {
  id: string;
  name: string;
  description: string;
  status: WorkflowStatus;
  version: number;
  triggerPhrases: string[];
  goal: string;
  qwenSummary: string;
  steps: WorkflowStep[];
  lastUpdated: string;
  validationErrors: string[];
};

type WorkflowJob = {
  id: string;
  filename: string;
  status: JobStatus;
  created: string;
  error: string;
  workflowId?: string;
};

type RuntimeLog = {
  id: string;
  type: "AI call" | "Workflow execution" | "SDK event" | "Job error";
  workflow: string;
  session: string;
  status: LogStatus;
  message: string;
  time: string;
};

type ApiKey = {
  id: string;
  name: string;
  prefix: string;
  scopes: string[];
  created: string;
  lastUsed: string;
};

type SettingsState = {
  appName: string;
  appSlug: string;
  exampleBaseUrl: string;
  backendUrl: string;
  modelProvider: "connected" | "missing";
  moss: "connected" | "degraded";
  liveKit: "connected" | "disabled";
  tts: "connected" | "disabled";
};

const navGroups: Array<{
  title: string;
  items: Array<{ id: RouteId; label: string; icon: LucideIcon }>;
}> = [
  {
    title: "Console",
    items: [
      { id: "overview", label: "Overview", icon: Home },
      { id: "settings", label: "Settings", icon: Settings },
    ],
  },
  {
    title: "UI Mapping",
    items: [
      { id: "ui-map", label: "UI map", icon: Layers3 },
      { id: "upload", label: "Upload workflow", icon: FileVideo },
    ],
  },
  {
    title: "Workflows",
    items: [
      { id: "workflow-jobs", label: "Workflow jobs", icon: Loader2 },
      { id: "workflow-review", label: "Review workflow", icon: ListChecks },
      { id: "workflows", label: "Published workflows", icon: Workflow },
    ],
  },
  {
    title: "Runtime",
    items: [
      { id: "logs", label: "Logs", icon: TerminalSquare },
      { id: "usage", label: "Usage", icon: BarChart3 },
      { id: "api-keys", label: "API keys", icon: KeyRound },
    ],
  },
];

const initialPages: UiPage[] = [
  { id: "page-home", route: "/", name: "Employee onboarding home", status: "scanned", elementCount: 32, lastScanned: "2 min ago" },
  { id: "page-crm", route: "/dashboard/crm", name: "CRM lead workspace", status: "scanned", elementCount: 48, lastScanned: "2 min ago" },
  { id: "page-documents", route: "/dashboard/documents", name: "Document checklist", status: "changed", elementCount: 27, lastScanned: "11 min ago" },
  { id: "page-training", route: "/dashboard/training", name: "Training checklist", status: "scanned", elementCount: 21, lastScanned: "13 min ago" },
];

const initialElements: UiElement[] = [
  {
    id: "onboarding.ask_mia_button",
    pageId: "page-home",
    type: "button",
    label: "Ask Mia",
    description: "Opens the Mia assistant popup for guided onboarding help.",
    selector: "[data-ai-id='onboarding.ask_mia_button']",
    quality: "strong",
    warnings: "None",
    recommendation: 'data-ai-id="onboarding.ask_mia_button"',
    tags: ["mia", "assistant"],
  },
  {
    id: "crm.lead_row_demo",
    pageId: "page-crm",
    type: "row",
    label: "HiringBae Demo Lead",
    description: "Assigned lead row used in the first CRM update workflow.",
    selector: "[data-ai-id='crm.lead_row_demo']",
    quality: "strong",
    warnings: "None",
    recommendation: 'data-ai-id="crm.lead_row_demo"',
    tags: ["crm", "lead"],
  },
  {
    id: "crm.status_select",
    pageId: "page-crm",
    type: "select",
    label: "Status",
    description: "Lead stage dropdown used to move a lead from new to contacted.",
    selector: "button:nth-child(4) .status",
    quality: "weak",
    warnings: "Position selector can break when layout changes.",
    recommendation: 'data-ai-id="crm.status_select"',
    tags: ["crm", "stage"],
  },
  {
    id: "documents.upload_id",
    pageId: "page-documents",
    type: "button",
    label: "Upload ID",
    description: "Uploads identity verification during onboarding.",
    selector: "[aria-label='Upload ID']",
    quality: "medium",
    warnings: "Accessible label is stable, but explicit data-ai-id is recommended.",
    recommendation: 'data-ai-id="documents.upload_id"',
    tags: ["documents"],
  },
  {
    id: "training.security_start",
    pageId: "page-training",
    type: "button",
    label: "Start security training",
    description: "Starts the required security training workflow.",
    selector: "[data-ai-id='training.security_start']",
    quality: "strong",
    warnings: "None",
    recommendation: 'data-ai-id="training.security_start"',
    tags: ["training"],
  },
];

const initialWorkflows: WorkflowRecord[] = [
  {
    id: "workflow-crm-access",
    name: "Request CRM access",
    description: "Mia guides a new employee through requesting access when the CRM screen is blocked.",
    status: "needs_review",
    version: 3,
    triggerPhrases: ["I cannot access CRM", "CRM is blocked", "Need CRM access"],
    goal: "Help the employee request CRM access and notify their manager.",
    qwenSummary: "The user opens CRM, sees an access warning, asks Mia for help, submits an access request, and notifies the manager.",
    lastUpdated: "4 min ago",
    validationErrors: [],
    steps: [
      {
        id: "step-1",
        order: 1,
        type: "click",
        targetElementId: "onboarding.ask_mia_button",
        prompt: "Click Ask Mia when the CRM access warning is visible.",
        fieldName: "",
        policy: "requires_confirmation",
        extractedAction: "click",
        observedElement: "Ask Mia button",
        qwenConfidence: 0.88,
        matchConfidence: 0.93,
      },
      {
        id: "step-2",
        order: 2,
        type: "click",
        targetElementId: "crm.lead_row_demo",
        prompt: "Open the CRM access request panel.",
        fieldName: "",
        policy: "auto",
        extractedAction: "click",
        observedElement: "Request access action",
        qwenConfidence: 0.81,
        matchConfidence: 0.74,
      },
      {
        id: "step-3",
        order: 3,
        type: "confirm",
        targetElementId: "crm.status_select",
        prompt: "Confirm that the manager should be notified.",
        fieldName: "manager_notification",
        policy: "requires_confirmation",
        extractedAction: "confirm",
        observedElement: "Notify manager button",
        qwenConfidence: 0.79,
        matchConfidence: 0.61,
      },
    ],
  },
  {
    id: "workflow-documents",
    name: "Submit missing documents",
    description: "Mia detects missing onboarding documents and guides the employee through uploads.",
    status: "published",
    version: 1,
    triggerPhrases: ["What documents are missing?", "Upload my ID", "Help with onboarding docs"],
    goal: "Submit required ID and tax documents.",
    qwenSummary: "The user opens Documents, uploads ID, submits the tax form, and confirms completion.",
    lastUpdated: "22 min ago",
    validationErrors: [],
    steps: [
      {
        id: "step-doc-1",
        order: 1,
        type: "click",
        targetElementId: "documents.upload_id",
        prompt: "Click Upload ID.",
        fieldName: "",
        policy: "auto",
        extractedAction: "click",
        observedElement: "Upload ID",
        qwenConfidence: 0.92,
        matchConfidence: 0.84,
      },
    ],
  },
];

const initialJobs: WorkflowJob[] = [
  { id: "job_1024", filename: "crm-access-blocked.mp4", status: "needs_review", created: "5 min ago", error: "", workflowId: "workflow-crm-access" },
  { id: "job_1023", filename: "missing-documents.mov", status: "mapped", created: "24 min ago", error: "", workflowId: "workflow-documents" },
  { id: "job_1022", filename: "payroll-stuck.mov", status: "failed", created: "41 min ago", error: "No matching payroll page in current UI map." },
];

const initialLogs: RuntimeLog[] = [
  { id: "log_1", type: "SDK event", workflow: "Request CRM access", session: "sess_admin_01", status: "ok", message: "SDK triggered workflow from CRM blocked banner.", time: "Just now" },
  { id: "log_2", type: "AI call", workflow: "Submit missing documents", session: "sess_admin_01", status: "ok", message: "Qwen summary generated with 0.91 confidence.", time: "3 min ago" },
  { id: "log_3", type: "Workflow execution", workflow: "Request CRM access", session: "sess_employee_22", status: "warning", message: "Step requires employee confirmation before notifying manager.", time: "8 min ago" },
  { id: "log_4", type: "Job error", workflow: "Payroll setup", session: "job_1022", status: "error", message: "Unmatched payroll submit button.", time: "41 min ago" },
];

const usageSeries = [31, 44, 39, 62, 58, 76, 84, 73, 91, 106, 98, 121];
const usageBars = [
  { label: "Mia opens", value: 420 },
  { label: "Guided clicks", value: 318 },
  { label: "Workflow runs", value: 184 },
  { label: "Approvals", value: 46 },
];

const id = (prefix: string) => `${prefix}_${Math.random().toString(36).slice(2, 8)}`;

function App() {
  const [authenticated, setAuthenticated] = useState(() => window.localStorage.getItem("mia-console-auth") === "true");
  const [activeRoute, setActiveRoute] = useState<RouteId>("overview");
  const [settings, setSettings] = useState<SettingsState>({
    appName: "HiringBae onboarding",
    appSlug: "hiringbae-onboarding",
    exampleBaseUrl: "http://localhost:3001",
    backendUrl: "http://localhost:8787",
    modelProvider: "connected",
    moss: "connected",
    liveKit: "disabled",
    tts: "connected",
  });
  const [uiPages, setUiPages] = useState(initialPages);
  const [uiElements, setUiElements] = useState(initialElements);
  const [selectedPageId, setSelectedPageId] = useState(initialPages[0].id);
  const [workflows, setWorkflows] = useState(initialWorkflows);
  const [selectedWorkflowId, setSelectedWorkflowId] = useState(initialWorkflows[0].id);
  const [jobs, setJobs] = useState(initialJobs);
  const [logs, setLogs] = useState(initialLogs);
  const [apiKeys, setApiKeys] = useState<ApiKey[]>([
    { id: "key_1", name: "Local SDK demo", prefix: "mia_local_3f9", scopes: ["workflows:read", "runs:create"], created: "Today", lastUsed: "2 min ago" },
  ]);
  const [toast, setToast] = useState("");

  const selectedWorkflow = workflows.find((workflow) => workflow.id === selectedWorkflowId) ?? workflows[0];
  const selectedPage = uiPages.find((page) => page.id === selectedPageId) ?? uiPages[0];

  const showToast = (message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(""), 2600);
  };

  const addLog = (entry: Omit<RuntimeLog, "id" | "time">) => {
    setLogs((current) => [{ ...entry, id: id("log"), time: "Just now" }, ...current]);
  };

  const login = () => {
    window.localStorage.setItem("mia-console-auth", "true");
    setAuthenticated(true);
  };

  const logout = () => {
    window.localStorage.removeItem("mia-console-auth");
    setAuthenticated(false);
  };

  const triggerScan = (routes: string[]) => {
    const routeList = routes.filter(Boolean);
    setUiPages((current) => [
      ...current.map((page) => ({ ...page, status: "scanned" as const, lastScanned: "Just now" })),
      ...routeList
        .filter((route) => !current.some((page) => page.route === route))
        .map((route, index) => ({
          id: id("page"),
          route,
          name: route.replaceAll("/", " ").trim() || "Home",
          status: "scanned" as const,
          elementCount: 18 + index * 7,
          lastScanned: "Just now",
        })),
    ]);
    showToast("UI map scan completed");
    addLog({
      type: "SDK event",
      workflow: "UI mapping",
      session: "local-console",
      status: "ok",
      message: `Scanned ${Math.max(routeList.length, 1)} route(s).`,
    });
  };

  const updateWorkflow = (workflowId: string, patch: Partial<WorkflowRecord>) => {
    setWorkflows((current) => current.map((workflow) => (workflow.id === workflowId ? { ...workflow, ...patch, lastUpdated: "Just now" } : workflow)));
  };

  const updateStep = (stepId: string, patch: Partial<WorkflowStep>) => {
    setWorkflows((current) =>
      current.map((workflow) =>
        workflow.id === selectedWorkflow.id
          ? {
              ...workflow,
              steps: workflow.steps.map((step) => (step.id === stepId ? { ...step, ...patch } : step)),
              lastUpdated: "Just now",
            }
          : workflow,
      ),
    );
  };

  const validateWorkflow = (workflow: WorkflowRecord) => {
    const errors: string[] = [];
    if (!workflow.name.trim()) errors.push("Workflow has no name.");
    if (workflow.triggerPhrases.length === 0) errors.push("Workflow has no trigger phrases.");
    if (workflow.steps.length === 0) errors.push("Workflow has no steps.");
    for (const step of workflow.steps) {
      if (step.type !== "blocked" && !step.targetElementId) errors.push(`Step ${step.order} has no selector target.`);
      if (step.type === "fill" && !step.fieldName) errors.push(`Step ${step.order} fill action has no field name.`);
      if (step.policy === "requires_confirmation" && step.type !== "confirm" && !step.prompt.includes("confirm")) {
        errors.push(`Step ${step.order} needs clear confirmation behavior.`);
      }
      if (step.type === "blocked" && step.policy !== "guidance_only") errors.push(`Step ${step.order} is blocked but not guidance only.`);
      if (!uiElements.some((element) => element.id === step.targetElementId) && step.policy === "auto") {
        errors.push(`Step ${step.order} has an unmatched auto-executable element.`);
      }
    }
    return errors;
  };

  const approveWorkflow = () => {
    const errors = validateWorkflow(selectedWorkflow);
    if (errors.length > 0) {
      updateWorkflow(selectedWorkflow.id, { validationErrors: errors });
      showToast("Workflow has validation errors");
      return;
    }
    updateWorkflow(selectedWorkflow.id, { status: "approved", validationErrors: [] });
    showToast("Workflow approved");
  };

  const publishWorkflow = () => {
    const errors = validateWorkflow(selectedWorkflow);
    if (errors.length > 0) {
      updateWorkflow(selectedWorkflow.id, { validationErrors: errors });
      showToast("Fix validation errors before publishing");
      return;
    }
    updateWorkflow(selectedWorkflow.id, { status: "published", validationErrors: [] });
    addLog({
      type: "Workflow execution",
      workflow: selectedWorkflow.name,
      session: "local-console",
      status: "ok",
      message: "Workflow published and available for SDK trigger phrases.",
    });
    showToast("Workflow published");
  };

  if (!authenticated) {
    return <LoginPage onLogin={login} />;
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <button className="brand-row" type="button" onClick={() => setActiveRoute("overview")}>
          <span className="brand-tile">
            <Command size={17} />
          </span>
          <div>
            <div className="brand-name">Mia Console</div>
            <div className="brand-subtitle">Local onboarding agent</div>
          </div>
          <ChevronsUpDown size={14} className="brand-switch-icon" />
        </button>

        <nav className="sidebar-nav" aria-label="Console navigation">
          {navGroups.map((group) => (
            <div className="nav-group" key={group.title}>
              <div className="nav-title">{group.title}</div>
              {group.items.map((item) => (
                <button
                  className={`nav-item ${activeRoute === item.id ? "is-active" : ""}`}
                  key={item.id}
                  type="button"
                  onClick={() => setActiveRoute(item.id)}
                >
                  <item.icon size={16} />
                  <span>{item.label}</span>
                </button>
              ))}
            </div>
          ))}
        </nav>

        <div className="sidebar-footer">
          <div className="support-card">
            <div>Need workflow help?</div>
            <p>Contact HiringBae support for UI map, workflow review, and onboarding agent setup.</p>
          </div>
          <button className="user-card" type="button" onClick={() => setActiveRoute("settings")}>
            <span className="avatar">AK</span>
            <span className="user-copy">
              <span>Ashwin Kumar</span>
              <span>itachi@hiringbae.com</span>
            </span>
            <EllipsisVertical size={14} />
          </button>
        </div>
      </aside>

      <main className="main-shell">
        <header className="topbar">
          <div className="topbar-title">
            <button className="sidebar-trigger" type="button" aria-label="Sidebar">
              <PanelLeft size={16} />
            </button>
            <div className="breadcrumb">Console / {routeTitle(activeRoute)}</div>
            <h1>{routeTitle(activeRoute)}</h1>
          </div>
          <div className="topbar-actions">
            <button className="search-trigger" type="button">
              <Search size={15} />
              <span>Search</span>
              <kbd>⌘J</kbd>
            </button>
            <button className="layout-chip" type="button">Dark</button>
            <StatusPill tone="green" label="Backend healthy" />
            <button className="icon-button" type="button" aria-label="Notifications">
              <Bell size={15} />
            </button>
            <button className="button secondary" type="button" onClick={logout}>
              <LogOut size={15} />
              Sign out
            </button>
          </div>
        </header>

        {activeRoute === "overview" && (
          <OverviewPage
            settings={settings}
            uiPages={uiPages}
            uiElements={uiElements}
            workflows={workflows}
            jobs={jobs}
            logs={logs}
            onReview={(workflowId) => {
              setSelectedWorkflowId(workflowId);
              setActiveRoute("workflow-review");
            }}
          />
        )}
        {activeRoute === "settings" && <SettingsPage settings={settings} setSettings={setSettings} showToast={showToast} />}
        {activeRoute === "ui-map" && (
          <UiMapPage
            pages={uiPages}
            elements={uiElements}
            onScan={triggerScan}
            onOpenPage={(pageId) => {
              setSelectedPageId(pageId);
              setActiveRoute("ui-map-detail");
            }}
          />
        )}
        {activeRoute === "ui-map-detail" && (
          <UiMapDetailPage
            page={selectedPage}
            elements={uiElements.filter((element) => element.pageId === selectedPage.id)}
            setElements={setUiElements}
            onBack={() => setActiveRoute("ui-map")}
            showToast={showToast}
          />
        )}
        {activeRoute === "upload" && (
          <UploadWorkflowPage
            onUploaded={(job) => {
              setJobs((current) => [job, ...current]);
              showToast("Workflow video uploaded");
              setActiveRoute("workflow-jobs");
            }}
          />
        )}
        {activeRoute === "workflow-jobs" && (
          <WorkflowJobsPage
            jobs={jobs}
            setJobs={setJobs}
            workflows={workflows}
            onOpenWorkflow={(workflowId) => {
              setSelectedWorkflowId(workflowId);
              setActiveRoute("workflow-review");
            }}
            showToast={showToast}
          />
        )}
        {activeRoute === "workflow-review" && (
          <WorkflowReviewPage
            workflow={selectedWorkflow}
            workflows={workflows}
            setSelectedWorkflowId={setSelectedWorkflowId}
            elements={uiElements}
            updateWorkflow={updateWorkflow}
            updateStep={updateStep}
            approveWorkflow={approveWorkflow}
            publishWorkflow={publishWorkflow}
            setWorkflows={setWorkflows}
            showToast={showToast}
          />
        )}
        {activeRoute === "workflows" && (
          <PublishedWorkflowsPage
            workflows={workflows}
            updateWorkflow={updateWorkflow}
            onReview={(workflowId) => {
              setSelectedWorkflowId(workflowId);
              setActiveRoute("workflow-review");
            }}
          />
        )}
        {activeRoute === "logs" && <LogsPage logs={logs} />}
        {activeRoute === "usage" && <UsagePage />}
        {activeRoute === "api-keys" && <ApiKeysPage apiKeys={apiKeys} setApiKeys={setApiKeys} showToast={showToast} />}
      </main>

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}

function LoginPage({ onLogin }: { onLogin: () => void }) {
  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("admin");
  const [error, setError] = useState("");

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (username === "admin" && password === "admin") {
      onLogin();
      return;
    }
    setError("Use admin / admin for the local console.");
  };

  return (
    <main className="login-page">
      <section className="login-visual" aria-hidden="true">
        <div className="login-visual-brand">
          <span className="brand-tile large">
            <Command size={18} />
          </span>
          <span>Mia Console</span>
        </div>
        <div className="login-grid-pattern" />
        <blockquote>
          <p>Review UI maps, approve workflow steps, and publish the onboarding agent from one console.</p>
          <footer>HiringBae internal console</footer>
        </blockquote>
      </section>
      <section className="login-card">
        <div className="login-brand-row">
          <span className="brand-tile">
            <Command size={17} />
          </span>
          <div>
            <div className="brand-name">Mia Console</div>
            <div className="brand-subtitle">Local developer interface</div>
          </div>
        </div>
        <form className="login-form" onSubmit={submit}>
          <div>
            <h1>Sign in</h1>
            <p>Use the local admin credentials to configure and publish onboarding workflows.</p>
          </div>
          <label>
            Username
            <input value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="username" />
          </label>
          <label>
            Password
            <input value={password} onChange={(event) => setPassword(event.target.value)} type="password" autoComplete="current-password" />
          </label>
          {error && <div className="error-line">{error}</div>}
          <button className="button primary full" type="submit">
            <Lock size={16} />
            Sign in
          </button>
          <div className="login-hint">Default credentials: admin / admin</div>
        </form>
      </section>
    </main>
  );
}

function OverviewPage({
  settings,
  uiPages,
  uiElements,
  workflows,
  jobs,
  logs,
  onReview,
}: {
  settings: SettingsState;
  uiPages: UiPage[];
  uiElements: UiElement[];
  workflows: WorkflowRecord[];
  jobs: WorkflowJob[];
  logs: RuntimeLog[];
  onReview: (workflowId: string) => void;
}) {
  const statusCounts = useMemo(
    () =>
      workflows.reduce<Record<string, number>>((counts, workflow) => {
        counts[workflow.status] = (counts[workflow.status] ?? 0) + 1;
        return counts;
      }, {}),
    [workflows],
  );
  const workflowStatuses: WorkflowStatus[] = ["uploaded", "analyzing", "mapped", "needs_review", "approved", "published", "failed"];
  const workflowTotal = Math.max(1, workflows.length);

  return (
    <div className="dashboard-page">
      <section className="dashboard-section">
        <div className="section-heading">
          <h2>Console Overview</h2>
          <p>Track UI maps, workflow review status, SDK jobs, and runtime events for Mia onboarding.</p>
        </div>
        <div className="metric-grid">
        <MetricCard
          label="App name"
          value={settings.appName}
          detail={settings.appSlug}
          icon={Database}
          badge={<Badge tone="green"><TrendingUp size={12} />connected</Badge>}
          footer="Example app target is ready"
        />
        <MetricCard
          label="UI map version"
          value="v12"
          detail={`${uiPages.length} pages scanned`}
          icon={Layers3}
          badge={<Badge tone="green"><TrendingUp size={12} />latest</Badge>}
          footer={`${uiElements.length} selectors indexed`}
        />
        <MetricCard
          label="Mapped elements"
          value={uiElements.length.toString()}
          detail="Stable selectors tracked"
          icon={Clipboard}
          badge={<Badge tone="yellow">review weak</Badge>}
          footer="2 recommendations pending"
        />
        <MetricCard
          label="Runtime health"
          value="Healthy"
          detail="Backend, model, Moss ready"
          icon={ShieldCheck}
          badge={<Badge tone="green"><TrendingUp size={12} />online</Badge>}
          footer="SDK sessions accepting triggers"
        />
        </div>
      </section>

      <section className="overview-grid">
        <Panel title="Workflows by status" action={<StatusBadge status="needs_review" />}>
          <div className="workflow-status-list">
            {workflowStatuses.map((status) => {
              const count = statusCounts[status] ?? 0;
              const width = Math.max(count === 0 ? 0 : 8, Math.round((count / workflowTotal) * 100));
              return (
                <div className="workflow-status-row" key={status}>
                  <div className="workflow-status-meta">
                    <StatusBadge status={status} />
                    <span>{count === 1 ? "1 workflow" : `${count} workflows`}</span>
                  </div>
                  <strong>{count}</strong>
                  <div className={`status-track ${status}`}>
                    <div style={{ width: `${width}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        </Panel>
        <Panel title="Recent workflow jobs" action={<button className="text-button">View all</button>}>
          <div className="job-list">
            {jobs.slice(0, 4).map((job) => (
              <button className="job-row" key={job.id} type="button" onClick={() => job.workflowId && onReview(job.workflowId)}>
                <span className="job-icon"><FileVideo size={16} /></span>
                <span className="job-main">
                  <strong>{job.filename}</strong>
                  <span><code>{job.id}</code> · {job.created}</span>
                </span>
                <StatusBadge status={job.status} />
              </button>
            ))}
          </div>
        </Panel>
      </section>

      <section className="overview-grid overview-lower">
        <Panel title="Recent runtime executions">
          <LogTable logs={logs.slice(0, 5)} compact />
        </Panel>
        <Panel title="Usage graph" action={<StatusPill tone="gray" label="12 weeks" />}>
          <div className="usage-card-content">
            <div className="usage-copy">
              <strong>3,846</strong>
              <span>assistant events</span>
            </div>
            <LineChart values={usageSeries} />
          </div>
        </Panel>
      </section>
    </div>
  );
}

function SettingsPage({
  settings,
  setSettings,
  showToast,
}: {
  settings: SettingsState;
  setSettings: React.Dispatch<React.SetStateAction<SettingsState>>;
  showToast: (message: string) => void;
}) {
  const update = (key: keyof SettingsState, value: string) => {
    setSettings((current) => ({ ...current, [key]: value }));
  };

  return (
    <div className="page-grid narrow">
      <Panel title="App configuration" action={<StatusPill tone="green" label="Editable MVP fields" />}>
        <div className="form-grid">
          <label>
            App name
            <input value={settings.appName} onChange={(event) => update("appName", event.target.value)} />
          </label>
          <label>
            App slug
            <input value={settings.appSlug} onChange={(event) => update("appSlug", event.target.value)} />
          </label>
          <label>
            Example app base URL
            <input value={settings.exampleBaseUrl} onChange={(event) => update("exampleBaseUrl", event.target.value)} />
          </label>
          <label>
            Backend URL
            <input value={settings.backendUrl} onChange={(event) => update("backendUrl", event.target.value)} />
          </label>
        </div>
        <div className="panel-actions">
          <button className="button primary" type="button" onClick={() => showToast("Settings saved locally")}>
            <Save size={16} />
            Save settings
          </button>
        </div>
      </Panel>

      <Panel title="Local service status">
        <div className="service-grid">
          <ServiceRow label="Model provider" value={settings.modelProvider} />
          <ServiceRow label="Moss" value={settings.moss} />
          <ServiceRow label="LiveKit" value={settings.liveKit} />
          <ServiceRow label="TTS" value={settings.tts} />
        </div>
      </Panel>
    </div>
  );
}

function UiMapPage({
  pages,
  elements,
  onScan,
  onOpenPage,
}: {
  pages: UiPage[];
  elements: UiElement[];
  onScan: (routes: string[]) => void;
  onOpenPage: (pageId: string) => void;
}) {
  const [routes, setRoutes] = useState("/\n/dashboard/crm\n/dashboard/documents\n/dashboard/training");

  return (
    <div className="page-grid">
      <Panel title="Trigger UI mapping scan" action={<StatusPill tone="green" label="Latest map v12" />}>
        <div className="scan-form">
          <label>
            Routes to scan
            <textarea value={routes} onChange={(event) => setRoutes(event.target.value)} rows={5} />
          </label>
          <button className="button primary" type="button" onClick={() => onScan(routes.split("\n").map((route) => route.trim()))}>
            <RefreshCw size={16} />
            Trigger scan
          </button>
        </div>
      </Panel>

      <Panel title="Scanned pages" action={<span className="muted">{elements.length} elements indexed</span>}>
        <table>
          <thead>
            <tr>
              <th>Page</th>
              <th>Route</th>
              <th>Status</th>
              <th>Elements</th>
              <th>Last scanned</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {pages.map((page) => (
              <tr key={page.id}>
                <td>{page.name}</td>
                <td><code>{page.route}</code></td>
                <td><StatusPill tone={page.status === "failed" ? "red" : page.status === "changed" ? "yellow" : "green"} label={page.status} /></td>
                <td>{page.elementCount}</td>
                <td>{page.lastScanned}</td>
                <td>
                  <button className="button secondary small" type="button" onClick={() => onOpenPage(page.id)}>
                    Open detail
                    <ChevronRight size={14} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>
    </div>
  );
}

function UiMapDetailPage({
  page,
  elements,
  setElements,
  onBack,
  showToast,
}: {
  page: UiPage;
  elements: UiElement[];
  setElements: React.Dispatch<React.SetStateAction<UiElement[]>>;
  onBack: () => void;
  showToast: (message: string) => void;
}) {
  const [rawOpen, setRawOpen] = useState(false);

  const updateElement = (elementId: string, patch: Partial<UiElement>) => {
    setElements((current) => current.map((element) => (element.id === elementId ? { ...element, ...patch } : element)));
  };

  const copy = async (value: string, label: string) => {
    await navigator.clipboard?.writeText(value);
    showToast(`${label} copied`);
  };

  return (
    <div className="page-grid">
      <div className="inline-header">
        <button className="button secondary" type="button" onClick={onBack}>Back to UI map</button>
        <div>
          <h2>{page.name}</h2>
          <p>{page.route} - {page.elementCount} mapped elements</p>
        </div>
      </div>

      <Panel title="Mapped elements" action={<button className="button secondary small" type="button" onClick={() => setRawOpen((open) => !open)}><FileJson size={14} /> Raw JSON</button>}>
        <table>
          <thead>
            <tr>
              <th>Element ID</th>
              <th>Type</th>
              <th>Label</th>
              <th>Description</th>
              <th>Selector</th>
              <th>Quality</th>
              <th>Warnings</th>
              <th>Recommendation</th>
            </tr>
          </thead>
          <tbody>
            {elements.map((element) => (
              <tr key={element.id}>
                <td><code>{element.id}</code></td>
                <td>{element.type}</td>
                <td>{element.label}</td>
                <td>
                  <input
                    className="table-input"
                    value={element.description}
                    onChange={(event) => updateElement(element.id, { description: event.target.value })}
                  />
                </td>
                <td>
                  <button className="selector-copy" type="button" onClick={() => copy(element.selector, "Selector")}>
                    <code>{element.selector}</code>
                  </button>
                </td>
                <td><SelectorQualityBadge quality={element.quality} /></td>
                <td>{element.warnings}</td>
                <td>
                  <button className="selector-copy" type="button" onClick={() => copy(element.recommendation, "Recommended attribute")}>
                    <code>{element.recommendation}</code>
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>

      {rawOpen && <RawJsonViewer title="UI element raw records" data={elements} />}
    </div>
  );
}

function UploadWorkflowPage({ onUploaded }: { onUploaded: (job: WorkflowJob) => void }) {
  const [workflowName, setWorkflowName] = useState("Request CRM access");
  const [description, setDescription] = useState("Employee tries to use CRM and needs Mia to guide an access request.");
  const [filename, setFilename] = useState("");

  const upload = () => {
    onUploaded({
      id: id("job"),
      filename: filename || "mia-workflow-demo.mp4",
      status: "uploaded",
      created: "Just now",
      error: "",
    });
  };

  return (
    <div className="page-grid narrow">
      <Panel title="Upload workflow video" action={<StatusBadge status="uploaded" />}>
        <div className="form-grid single">
          <label>
            Video file
            <input type="file" accept="video/*" onChange={(event) => setFilename(event.target.files?.[0]?.name ?? "")} />
          </label>
          <label>
            Workflow name
            <input value={workflowName} onChange={(event) => setWorkflowName(event.target.value)} />
          </label>
          <label>
            Description
            <textarea value={description} onChange={(event) => setDescription(event.target.value)} rows={4} />
          </label>
        </div>
        <div className="panel-actions">
          <button className="button primary" type="button" onClick={upload}>
            <Upload size={16} />
            Upload and create job
          </button>
        </div>
      </Panel>
    </div>
  );
}

function WorkflowJobsPage({
  jobs,
  setJobs,
  workflows,
  onOpenWorkflow,
  showToast,
}: {
  jobs: WorkflowJob[];
  setJobs: React.Dispatch<React.SetStateAction<WorkflowJob[]>>;
  workflows: WorkflowRecord[];
  onOpenWorkflow: (workflowId: string) => void;
  showToast: (message: string) => void;
}) {
  const retry = (jobId: string) => {
    setJobs((current) => current.map((job) => (job.id === jobId ? { ...job, status: "analyzing", error: "" } : job)));
    showToast("Workflow job retry started");
  };

  return (
    <Panel title="Workflow processing jobs">
      <table>
        <thead>
          <tr>
            <th>Job ID</th>
            <th>Video filename</th>
            <th>Status</th>
            <th>Created</th>
            <th>Error</th>
            <th>Generated workflow</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {jobs.map((job) => (
            <tr key={job.id}>
              <td><code>{job.id}</code></td>
              <td>{job.filename}</td>
              <td><StatusBadge status={job.status} /></td>
              <td>{job.created}</td>
              <td>{job.error || <span className="muted">None</span>}</td>
              <td>{job.workflowId ? workflows.find((workflow) => workflow.id === job.workflowId)?.name ?? "Generated workflow" : <span className="muted">Not ready</span>}</td>
              <td className="table-actions">
                {job.status === "failed" && (
                  <button className="button secondary small" type="button" onClick={() => retry(job.id)}>
                    <RefreshCw size={14} />
                    Retry
                  </button>
                )}
                {job.workflowId && (
                  <button className="button secondary small" type="button" onClick={() => onOpenWorkflow(job.workflowId!)}>
                    Open workflow
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Panel>
  );
}

function WorkflowReviewPage({
  workflow,
  workflows,
  setSelectedWorkflowId,
  elements,
  updateWorkflow,
  updateStep,
  approveWorkflow,
  publishWorkflow,
  setWorkflows,
  showToast,
}: {
  workflow: WorkflowRecord;
  workflows: WorkflowRecord[];
  setSelectedWorkflowId: (workflowId: string) => void;
  elements: UiElement[];
  updateWorkflow: (workflowId: string, patch: Partial<WorkflowRecord>) => void;
  updateStep: (stepId: string, patch: Partial<WorkflowStep>) => void;
  approveWorkflow: () => void;
  publishWorkflow: () => void;
  setWorkflows: React.Dispatch<React.SetStateAction<WorkflowRecord[]>>;
  showToast: (message: string) => void;
}) {
  const [rawOpen, setRawOpen] = useState(false);
  const [elementSearch, setElementSearch] = useState("");

  const filteredElements = elements.filter((element) => `${element.label} ${element.description} ${element.id}`.toLowerCase().includes(elementSearch.toLowerCase()));

  const addStep = () => {
    const nextOrder = workflow.steps.length + 1;
    setWorkflows((current) =>
      current.map((item) =>
        item.id === workflow.id
          ? {
              ...item,
              steps: [
                ...item.steps,
                {
                  id: id("step"),
                  order: nextOrder,
                  type: "click",
                  targetElementId: elements[0]?.id ?? "",
                  prompt: "Describe what Mia should tell the employee.",
                  fieldName: "",
                  policy: "requires_confirmation",
                  extractedAction: "click",
                  observedElement: "New step",
                  qwenConfidence: 0.72,
                  matchConfidence: 0.7,
                },
              ],
              lastUpdated: "Just now",
            }
          : item,
      ),
    );
    showToast("Step added");
  };

  const removeStep = (stepId: string) => {
    setWorkflows((current) =>
      current.map((item) =>
        item.id === workflow.id
          ? {
              ...item,
              steps: item.steps.filter((step) => step.id !== stepId).map((step, index) => ({ ...step, order: index + 1 })),
              lastUpdated: "Just now",
            }
          : item,
      ),
    );
  };

  const reorder = (stepId: string, direction: -1 | 1) => {
    const index = workflow.steps.findIndex((step) => step.id === stepId);
    const targetIndex = index + direction;
    if (targetIndex < 0 || targetIndex >= workflow.steps.length) return;
    const next = [...workflow.steps];
    const [step] = next.splice(index, 1);
    next.splice(targetIndex, 0, step);
    setWorkflows((current) =>
      current.map((item) => (item.id === workflow.id ? { ...item, steps: next.map((nextStep, nextIndex) => ({ ...nextStep, order: nextIndex + 1 })) } : item)),
    );
  };

  return (
    <div className="page-grid">
      <Panel
        title="Workflow review"
        action={
          <select value={workflow.id} onChange={(event) => setSelectedWorkflowId(event.target.value)}>
            {workflows.map((item) => (
              <option value={item.id} key={item.id}>{item.name}</option>
            ))}
          </select>
        }
      >
        <div className="review-header">
          <div className="form-grid">
            <label>
              Workflow name
              <input value={workflow.name} onChange={(event) => updateWorkflow(workflow.id, { name: event.target.value })} />
            </label>
            <label>
              Description
              <input value={workflow.description} onChange={(event) => updateWorkflow(workflow.id, { description: event.target.value })} />
            </label>
          </div>
          <div className="summary-grid">
            <SummaryItem label="Status" value={<StatusBadge status={workflow.status} />} />
            <SummaryItem label="Generated goal" value={workflow.goal} />
            <SummaryItem label="Qwen summary" value={workflow.qwenSummary} />
            <SummaryItem label="Trigger phrases" value={workflow.triggerPhrases.join(", ")} />
          </div>
        </div>
      </Panel>

      <section className="review-layout">
        <div className="step-stack">
          <div className="inline-header compact">
            <div>
              <h2>Step editor</h2>
              <p>Separate AI-extracted action, Moss match, and executable step.</p>
            </div>
            <button className="button secondary small" type="button" onClick={addStep}>
              <Plus size={14} />
              Add step
            </button>
          </div>
          {workflow.steps.map((step) => {
            const target = elements.find((element) => element.id === step.targetElementId);
            return (
              <WorkflowStepCard
                key={step.id}
                step={step}
                target={target}
                elements={elements}
                updateStep={updateStep}
                removeStep={removeStep}
                moveStep={reorder}
              />
            );
          })}
        </div>

        <aside className="review-side">
          <Panel title="Element picker">
            <label className="search-box">
              <Search size={15} />
              <input value={elementSearch} onChange={(event) => setElementSearch(event.target.value)} placeholder="Search elements" />
            </label>
            <div className="element-list">
              {filteredElements.slice(0, 6).map((element) => (
                <div className="element-option" key={element.id}>
                  <div>
                    <strong>{element.label}</strong>
                    <span>{element.type} - {element.id}</span>
                  </div>
                  <SelectorQualityBadge quality={element.quality} />
                </div>
              ))}
            </div>
          </Panel>

          <Panel title="Validation errors">
            {workflow.validationErrors.length > 0 ? (
              <div className="error-stack">
                {workflow.validationErrors.map((error) => (
                  <div className="error-item" key={error}>
                    <AlertTriangle size={15} />
                    {error}
                  </div>
                ))}
              </div>
            ) : (
              <div className="empty-state">No validation errors recorded.</div>
            )}
          </Panel>

          <Panel title="Actions">
            <div className="action-grid">
              <button className="button secondary" type="button" onClick={() => showToast("Draft saved")}>
                <Save size={16} />
                Save draft
              </button>
              <button className="button secondary" type="button" onClick={approveWorkflow}>
                <Check size={16} />
                Approve
              </button>
              <button className="button primary" type="button" onClick={publishWorkflow}>
                <Play size={16} />
                Publish
              </button>
              <button className="button secondary" type="button" onClick={() => updateWorkflow(workflow.id, { status: "archived" })}>
                <X size={16} />
                Reject/archive
              </button>
              <button className="button secondary" type="button" onClick={() => showToast("Matching retry queued")}>
                <RefreshCw size={16} />
                Retry matching
              </button>
              <button className="button secondary" type="button" onClick={() => setRawOpen((open) => !open)}>
                <FileJson size={16} />
                Raw JSON
              </button>
            </div>
          </Panel>
        </aside>
      </section>

      {rawOpen && <RawJsonViewer title="Compiled workflow JSON" data={workflow} />}
    </div>
  );
}

function WorkflowStepCard({
  step,
  target,
  elements,
  updateStep,
  removeStep,
  moveStep,
}: {
  step: WorkflowStep;
  target?: UiElement;
  elements: UiElement[];
  updateStep: (stepId: string, patch: Partial<WorkflowStep>) => void;
  removeStep: (stepId: string) => void;
  moveStep: (stepId: string, direction: -1 | 1) => void;
}) {
  return (
    <article className="step-card">
      <div className="step-card-header">
        <div>
          <h3>Step {step.order}: {step.prompt}</h3>
          <p>Confidence {step.qwenConfidence.toFixed(2)} / match {step.matchConfidence.toFixed(2)}</p>
        </div>
        <div className="step-actions">
          <button className="icon-button" type="button" onClick={() => moveStep(step.id, -1)}>Up</button>
          <button className="icon-button" type="button" onClick={() => moveStep(step.id, 1)}>Down</button>
          <button className="icon-button danger" type="button" onClick={() => removeStep(step.id)}>Remove</button>
        </div>
      </div>
      <div className="step-columns">
        <div className="step-column">
          <h4>AI-extracted action</h4>
          <p>Action: {step.extractedAction}</p>
          <p>Observed element: {step.observedElement}</p>
          <p>Confidence: {step.qwenConfidence.toFixed(2)}</p>
        </div>
        <div className="step-column">
          <h4>Moss-matched element</h4>
          <p>Element ID: {target?.id ?? "Unmatched"}</p>
          <p>Label: {target?.label ?? "None"}</p>
          <p>Selector: <code>{target?.selector ?? "Missing selector"}</code></p>
          <p>Match confidence: {step.matchConfidence.toFixed(2)}</p>
        </div>
        <div className="step-column editor">
          <h4>Final executable step</h4>
          <label>
            Step type
            <select value={step.type} onChange={(event) => updateStep(step.id, { type: event.target.value as StepType })}>
              <option value="click">click</option>
              <option value="fill">fill</option>
              <option value="wait">wait</option>
              <option value="confirm">confirm</option>
              <option value="blocked">blocked</option>
            </select>
          </label>
          <label>
            Target element
            <select value={step.targetElementId} onChange={(event) => updateStep(step.id, { targetElementId: event.target.value })}>
              {elements.map((element) => (
                <option value={element.id} key={element.id}>{element.label}</option>
              ))}
            </select>
          </label>
          <label>
            Prompt
            <input value={step.prompt} onChange={(event) => updateStep(step.id, { prompt: event.target.value })} />
          </label>
          <label>
            Field name
            <input value={step.fieldName} onChange={(event) => updateStep(step.id, { fieldName: event.target.value })} />
          </label>
          <label>
            Execution policy
            <select value={step.policy} onChange={(event) => updateStep(step.id, { policy: event.target.value as ExecutionPolicy })}>
              <option value="auto">auto</option>
              <option value="requires_confirmation">requires_confirmation</option>
              <option value="guidance_only">guidance_only</option>
            </select>
          </label>
        </div>
      </div>
    </article>
  );
}

function PublishedWorkflowsPage({
  workflows,
  updateWorkflow,
  onReview,
}: {
  workflows: WorkflowRecord[];
  updateWorkflow: (workflowId: string, patch: Partial<WorkflowRecord>) => void;
  onReview: (workflowId: string) => void;
}) {
  return (
    <Panel title="Published workflows">
      <table>
        <thead>
          <tr>
            <th>Workflow name</th>
            <th>Status</th>
            <th>Version</th>
            <th>Trigger phrases</th>
            <th>Steps</th>
            <th>Last updated</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {workflows.map((workflow) => (
            <tr key={workflow.id}>
              <td>{workflow.name}</td>
              <td><StatusBadge status={workflow.status} /></td>
              <td>v{workflow.version}</td>
              <td>{workflow.triggerPhrases.join(", ")}</td>
              <td>{workflow.steps.length}</td>
              <td>{workflow.lastUpdated}</td>
              <td className="table-actions">
                <button className="button secondary small" type="button" onClick={() => onReview(workflow.id)}>Review</button>
                {workflow.status === "published" ? (
                  <button className="button secondary small" type="button" onClick={() => updateWorkflow(workflow.id, { status: "approved" })}>Unpublish</button>
                ) : (
                  <button className="button secondary small" type="button" onClick={() => updateWorkflow(workflow.id, { status: "published" })}>Publish</button>
                )}
                <button className="button secondary small" type="button" onClick={() => updateWorkflow(workflow.id, { status: "archived" })}>Archive</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Panel>
  );
}

function LogsPage({ logs }: { logs: RuntimeLog[] }) {
  const [workflow, setWorkflow] = useState("all");
  const [status, setStatus] = useState("all");
  const [session, setSession] = useState("");

  const filtered = logs.filter((log) => {
    const workflowMatch = workflow === "all" || log.workflow === workflow;
    const statusMatch = status === "all" || log.status === status;
    const sessionMatch = !session || log.session.toLowerCase().includes(session.toLowerCase());
    return workflowMatch && statusMatch && sessionMatch;
  });

  return (
    <div className="page-grid">
      <Panel title="Log filters">
        <div className="filter-row">
          <label>
            Workflow
            <select value={workflow} onChange={(event) => setWorkflow(event.target.value)}>
              <option value="all">All workflows</option>
              {[...new Set(logs.map((log) => log.workflow))].map((item) => (
                <option value={item} key={item}>{item}</option>
              ))}
            </select>
          </label>
          <label>
            Status
            <select value={status} onChange={(event) => setStatus(event.target.value)}>
              <option value="all">All statuses</option>
              <option value="ok">ok</option>
              <option value="warning">warning</option>
              <option value="error">error</option>
            </select>
          </label>
          <label>
            Session
            <input value={session} onChange={(event) => setSession(event.target.value)} placeholder="Filter by session" />
          </label>
        </div>
      </Panel>
      <Panel title="Runtime logs">
        <LogTable logs={filtered} />
      </Panel>
    </div>
  );
}

function UsagePage() {
  return (
    <div className="page-grid">
      <section className="metric-grid">
        <MetricCard label="SDK sessions" value="1,248" detail="+12% this week" icon={Activity} />
        <MetricCard label="AI calls" value="842" detail="Qwen + matching requests" icon={Code2} />
        <MetricCard label="Workflow runs" value="184" detail="41 required confirmation" icon={Workflow} />
        <MetricCard label="Mean latency" value="642 ms" detail="Runtime execution path" icon={Gauge} />
      </section>
      <section className="two-column">
        <Panel title="Runtime usage trend">
          <LineChart values={usageSeries} />
        </Panel>
        <Panel title="Event volume">
          <BarList data={usageBars} />
        </Panel>
      </section>
    </div>
  );
}

function ApiKeysPage({
  apiKeys,
  setApiKeys,
  showToast,
}: {
  apiKeys: ApiKey[];
  setApiKeys: React.Dispatch<React.SetStateAction<ApiKey[]>>;
  showToast: (message: string) => void;
}) {
  const [name, setName] = useState("SDK install key");
  const [scopes, setScopes] = useState(["workflows:read", "runs:create"]);
  const scopeOptions = ["workflows:read", "workflows:write", "runs:create", "logs:read", "ui-map:read"];

  const toggleScope = (scope: string) => {
    setScopes((current) => (current.includes(scope) ? current.filter((item) => item !== scope) : [...current, scope]));
  };

  const createKey = () => {
    const nextKey: ApiKey = {
      id: id("key"),
      name,
      prefix: `mia_${Math.random().toString(36).slice(2, 11)}`,
      scopes,
      created: "Just now",
      lastUsed: "Never",
    };
    setApiKeys((current) => [nextKey, ...current]);
    showToast("API key created");
  };

  return (
    <div className="page-grid">
      <Panel title="Create API key" action={<StatusPill tone="green" label="Local secret preview" />}>
        <div className="form-grid single">
          <label>
            Key name
            <input value={name} onChange={(event) => setName(event.target.value)} />
          </label>
          <div>
            <div className="field-label">Scopes</div>
            <div className="scope-grid">
              {scopeOptions.map((scope) => (
                <label className="check-row" key={scope}>
                  <input type="checkbox" checked={scopes.includes(scope)} onChange={() => toggleScope(scope)} />
                  {scope}
                </label>
              ))}
            </div>
          </div>
        </div>
        <div className="panel-actions">
          <button className="button primary" type="button" onClick={createKey}>
            <Plus size={16} />
            Create key
          </button>
        </div>
      </Panel>

      <Panel title="API keys">
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Prefix</th>
              <th>Scopes</th>
              <th>Created</th>
              <th>Last used</th>
            </tr>
          </thead>
          <tbody>
            {apiKeys.map((key) => (
              <tr key={key.id}>
                <td>{key.name}</td>
                <td><code>{key.prefix}</code></td>
                <td>{key.scopes.join(", ")}</td>
                <td>{key.created}</td>
                <td>{key.lastUsed}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>
    </div>
  );
}

function MetricCard({
  label,
  value,
  detail,
  icon: Icon,
  badge,
  footer,
}: {
  label: string;
  value: string;
  detail: string;
  icon: LucideIcon;
  badge?: React.ReactNode;
  footer?: string;
}) {
  return (
    <Card className="metric-card">
      <CardHeader>
        <CardDescription>{label}</CardDescription>
        <CardAction>
          <span className="metric-icon">
            <Icon size={16} />
          </span>
        </CardAction>
      </CardHeader>
      <CardContent className="metric-content">
        <div className="metric-value-row">
          <div className={`metric-value ${value.length > 14 ? "is-long" : ""}`}>{value}</div>
          {badge}
        </div>
        <div className="metric-detail">{detail}</div>
        {footer && <div className="metric-footer-line">{footer}</div>}
      </CardContent>
    </Card>
  );
}

function Panel({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <Card className="panel">
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        {action && <CardAction>{action}</CardAction>}
      </CardHeader>
      <CardContent className="panel-content">{children}</CardContent>
    </Card>
  );
}

function SummaryItem({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="summary-item">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function ServiceRow({ label, value }: { label: string; value: string }) {
  const tone = value === "connected" ? "green" : value === "degraded" ? "yellow" : "gray";
  return (
    <div className="service-row">
      <span>{label}</span>
      <StatusPill tone={tone} label={value} />
    </div>
  );
}

function StatusBadge({ status }: { status: WorkflowStatus | JobStatus }) {
  const tone =
    status === "published" || status === "approved" || status === "mapped"
      ? "green"
      : status === "needs_review" || status === "uploaded" || status === "analyzing"
        ? "yellow"
        : status === "failed"
          ? "red"
          : "gray";
  return <StatusPill tone={tone} label={status} />;
}

function SelectorQualityBadge({ quality }: { quality: SelectorQuality }) {
  return <StatusPill tone={quality === "strong" ? "green" : quality === "medium" ? "yellow" : "red"} label={quality} />;
}

function StatusPill({ tone, label }: { tone: "green" | "yellow" | "red" | "gray"; label: string }) {
  return <span className={`status-pill ${tone}`}>{label}</span>;
}

function LogTable({ logs, compact = false }: { logs: RuntimeLog[]; compact?: boolean }) {
  return (
    <table className={compact ? "compact-table" : ""}>
      <thead>
        <tr>
          <th>Type</th>
          <th>Workflow</th>
          {!compact && <th>Session</th>}
          <th>Status</th>
          <th>Message</th>
          <th>Time</th>
        </tr>
      </thead>
      <tbody>
        {logs.map((log) => (
          <tr key={log.id}>
            <td>{log.type}</td>
            <td>{log.workflow}</td>
            {!compact && <td><code>{log.session}</code></td>}
            <td><StatusPill tone={log.status === "ok" ? "green" : log.status === "warning" ? "yellow" : "red"} label={log.status} /></td>
            <td>{log.message}</td>
            <td>{log.time}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function RawJsonViewer({ title, data }: { title: string; data: unknown }) {
  return (
    <Panel title={title} action={<FileJson size={16} />}>
      <pre className="json-viewer">{JSON.stringify(data, null, 2)}</pre>
    </Panel>
  );
}

function LineChart({ values }: { values: number[] }) {
  const max = Math.max(...values);
  const points = values
    .map((value, index) => {
      const x = (index / (values.length - 1)) * 100;
      const y = 100 - (value / max) * 82 - 8;
      return `${x},${y}`;
    })
    .join(" ");

  return (
    <div className="chart-shell">
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" role="img" aria-label="Usage line chart">
        <polyline className="chart-grid-line" points="0,80 100,80" />
        <polyline className="chart-grid-line" points="0,50 100,50" />
        <polyline className="chart-line" points={points} />
      </svg>
      <div className="chart-axis">
        <span>12 weeks ago</span>
        <span>Now</span>
      </div>
    </div>
  );
}

function BarList({ data }: { data: Array<{ label: string; value: number }> }) {
  const max = Math.max(...data.map((item) => item.value));
  return (
    <div className="bar-list">
      {data.map((item) => (
        <div className="bar-row" key={item.label}>
          <div className="bar-meta">
            <span>{item.label}</span>
            <strong>{item.value}</strong>
          </div>
          <div className="bar-track"><div style={{ width: `${(item.value / max) * 100}%` }} /></div>
        </div>
      ))}
    </div>
  );
}

function routeTitle(route: RouteId) {
  const titles: Record<RouteId, string> = {
    overview: "Overview",
    settings: "Settings",
    "ui-map": "UI mapping",
    "ui-map-detail": "UI map page detail",
    upload: "Upload workflow",
    "workflow-jobs": "Workflow jobs",
    "workflow-review": "Workflow review",
    workflows: "Published workflows",
    logs: "Logs",
    usage: "Usage",
    "api-keys": "API keys",
  };
  return titles[route];
}

export default App;
