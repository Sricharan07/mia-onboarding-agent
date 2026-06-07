export type ExecutionPolicy = "auto" | "requires_confirmation" | "manual_only" | "blocked";

export type SDKConfig = {
  appId: string;
  backendUrl: string;
  apiKey?: string;
  enableVoice: boolean;
  enableTTS: boolean;
  user?: {
    id?: string;
    email?: string;
    role?: string;
    metadata?: Record<string, unknown>;
  };
  ui?: {
    launcherPosition?: "bottom-right" | "bottom-left";
    showCursor?: boolean;
    showHighlights?: boolean;
  };
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

export type SDKRuntimeContext = {
  appId: string;
  sessionId: string;
  currentUrl: string;
  currentRoute: string;
  pageTitle?: string;
  focusedElement?: RuntimeElementContext;
  hoveredElement?: RuntimeElementContext;
  visibleElements?: RuntimeElementContext[];
  userMetadata?: Record<string, unknown>;
};

export type WorkflowTarget = {
  elementId: string;
  label?: string;
  selector: string;
  fallbackSelectors?: string[];
  route?: string;
  pageName?: string;
};

export type WorkflowStep =
  | { id: string; type: "navigate"; route: string; label?: string }
  | { id: string; type: "click"; target: WorkflowTarget; executionPolicy: ExecutionPolicy; label?: string }
  | { id: string; type: "focus"; target: WorkflowTarget; executionPolicy: ExecutionPolicy; label?: string }
  | { id: string; type: "fill"; target: WorkflowTarget; valueFrom: string; executionPolicy: ExecutionPolicy; label?: string }
  | { id: string; type: "select"; target: WorkflowTarget; valueFrom: string; executionPolicy: ExecutionPolicy; label?: string }
  | { id: string; type: "ask_user"; field: string; prompt: string; inputType?: "text" | "email" | "password" | "number" | "date" | "choice"; choices?: string[]; label?: string }
  | { id: string; type: "wait_for_element"; target: WorkflowTarget; timeoutMs: number; label?: string }
  | { id: string; type: "confirm"; message: string; confirmLabel?: string; cancelLabel?: string; label?: string }
  | { id: string; type: "complete"; message: string; label?: string };

export type Workflow = {
  workflowId: string;
  appId: string;
  name: string;
  description: string;
  status: "draft" | "needs_review" | "approved" | "published" | "archived";
  version: number;
  triggerPhrases: string[];
  steps: WorkflowStep[];
};

export type ResolveResponse =
  | { type: "workflow"; workflow: Workflow; message: string; tts?: { text: string; audioUrl?: string; mimeType?: string } }
  | { type: "answer"; message: string; tts?: { text: string; audioUrl?: string; mimeType?: string } }
  | { type: "no_match"; message: string; tts?: { text: string; audioUrl?: string; mimeType?: string } };

export type SDKEvent =
  | { type: "session_started"; sessionId: string }
  | { type: "voice_started" }
  | { type: "voice_stopped" }
  | { type: "intent_resolved"; resultType: string }
  | { type: "workflow_started"; workflowId: string }
  | { type: "step_started"; workflowId: string; stepId: string }
  | { type: "step_completed"; workflowId: string; stepId: string }
  | { type: "step_failed"; workflowId: string; stepId: string; error: string }
  | { type: "workflow_completed"; workflowId: string }
  | { type: "workflow_cancelled"; workflowId: string };
