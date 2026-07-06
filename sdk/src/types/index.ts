export type ExecutionPolicy = "auto" | "requires_confirmation" | "manual_only" | "blocked";
export type MiaTheme = "light" | "dark" | "auto";
export type MiaCursorState = "idle" | "connecting" | "listening" | "thinking" | "speaking" | "guiding" | "fading" | "offline" | "error";
export type MiaStatus = MiaCursorState | "ended";
export type VoiceSessionStatus = "connecting" | "listening" | "thinking" | "speaking" | "ended" | "error";

export type SDKConfig = {
  appId: string;
  backendUrl: string;
  apiKey?: string;
  enableVoice: boolean;
  enableScreenShare?: boolean;
  voice?: {
    voiceName?: string;
  };
  navigate?: (route: string) => void | Promise<void>;
  privacy?: {
    redactText?: boolean;
    redactedSelectors?: string[];
    redactScreenFrame?: (canvas: HTMLCanvasElement, context: CanvasRenderingContext2D) => void;
  };
  user?: {
    id?: string;
    email?: string;
    role?: string;
    metadata?: Record<string, unknown>;
  };
  ui?: {
    cursorIcon?: string;
    cursorOffset?: { x: number; y: number };
    theme?: MiaTheme;
    bubbleMaxWidth?: number;
    bubbleLingerMs?: number;
    assistantPanel?: boolean;
  };
  onStatusChange?: (status: MiaStatus) => void;
  onTranscript?: (entry: { role: "user" | "assistant" | "system"; text: string }) => void;
  onError?: (error: Error) => void;
  onWorkflowEvent?: (event: { type: string; workflowId?: string; stepId?: string; message?: string }) => void;
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
  | { type: "workflow"; workflow: Workflow; message: string }
  | { type: "control"; action: "cancel" | "pause" | "resume"; message: string }
  | { type: "element_action"; action: "click" | "focus"; target: RuntimeElementContext; executionPolicy: "auto" | "requires_confirmation"; message: string }
  | { type: "answer"; message: string; target?: RuntimeElementContext }
  | { type: "no_match"; message: string; target?: RuntimeElementContext };

export type GeminiLiveTokenResponse = {
  token: string;
  model: string;
  expiresAt: string;
  websocketUrl: string;
};

export type GeminiLiveEvent =
  | { type: "session_ready"; status: VoiceSessionStatus }
  | { type: "listening"; status: VoiceSessionStatus }
  | { type: "thinking"; status: VoiceSessionStatus }
  | { type: "transcript_user"; text: string; isFinal: true }
  | { type: "transcript_assistant"; text: string; isFinal: boolean }
  | { type: "assistant_response"; message: string; result: ResolveResponse }
  | { type: "workflow_resolved"; result: Extract<ResolveResponse, { type: "workflow" }> }
  | { type: "error"; message: string; code?: string }
  | { type: "ended"; status: VoiceSessionStatus };

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
