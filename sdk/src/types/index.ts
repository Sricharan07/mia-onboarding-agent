export type MiaTheme = "light" | "dark" | "auto";
export type MiaVoiceName = "Aoede" | "Kore" | "Leda";
export type MiaStatus = "idle" | "connecting" | "listening" | "thinking" | "speaking" | "guiding" | "offline" | "error" | "ended";
export type MiaCursorState = Exclude<MiaStatus, "ended"> | "fading";
export type RiskLevel = "read" | "navigate" | "reversible_write" | "manual" | "blocked";
export type UiActionPolicy = "guide_only" | Exclude<RiskLevel, "read">;
export type MiaActionEffect = "read" | "navigate" | "draft_create" | "draft_update" | "reversible_change" | "protected";

export type RuntimeToken = { token: string; expiresAt?: string };
export type RuntimeTokenProvider = () => Promise<string | RuntimeToken>;

export type TargetLocator =
  | { strategy: "css"; selector: string }
  | { strategy: "role"; role: string; name?: string }
  | { strategy: "label"; label: string }
  | { strategy: "text"; text: string; tagName?: string };

export type MiaActionType =
  | "point"
  | "highlight"
  | "hover"
  | "scroll_to"
  | "scroll_by"
  | "navigate"
  | "go_back"
  | "focus"
  | "click"
  | "fill"
  | "clear"
  | "select"
  | "toggle"
  | "press_key"
  | "wait"
  | "request_visual"
  | "host_action";

export type ObservationNode = {
  nodeId: string;
  frameId?: string;
  tagName: string;
  role?: string;
  name?: string;
  description?: string;
  text?: string;
  value?: string;
  inputType?: string;
  formAssociated?: boolean;
  formSubmitter?: boolean;
  route?: string;
  elementKey?: string;
  locators: TargetLocator[];
  bounds: { x: number; y: number; width: number; height: number };
  viewportVisible: boolean;
  disabled?: boolean;
  checked?: boolean;
  selected?: boolean;
  expanded?: boolean;
  pressed?: boolean;
  required?: boolean;
  readOnly?: boolean;
  sensitive: boolean;
  actionPolicy?: RiskLevel;
};

export type Observation = {
  id: string;
  revision: number;
  url: string;
  route: string;
  title?: string;
  viewport: { width: number; height: number; scrollX: number; scrollY: number };
  focusedNodeId?: string;
  hoveredNodeId?: string;
  selectedText?: string;
  pageText?: string;
  nodes: ObservationNode[];
};

export type MiaContextEntry = {
  name: string;
  description: string;
  content: string;
  trusted?: boolean;
};

export type MiaContextProvider = {
  name: string;
  description: string;
  trusted?: boolean;
  getContext: (input: { signal: AbortSignal; observation: Observation }) => string | Promise<string>;
};

export type MiaVisualContext = {
  name: string;
  description: string;
  mimeType?: "image/png" | "image/jpeg";
  data?: string;
};

export type MiaVisualContextProvider = (input: {
  reason: string;
  signal: AbortSignal;
  observation: Observation;
}) => MiaVisualContext | MiaVisualContext[] | null | Promise<MiaVisualContext | MiaVisualContext[] | null>;

export type MiaActionReceiptResult = {
  status: "completed" | "unverified" | "failed" | "cancelled" | "manual";
  message: string;
  evidence?: Record<string, unknown>;
};

export type MiaActionDefinition<TInput extends Record<string, unknown> = Record<string, unknown>> = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  risk: RiskLevel;
  effect: MiaActionEffect;
  execute: { bivarianceHack(input: TInput, context: {
    signal: AbortSignal;
    observation: Observation;
    idempotencyKey: string;
  }): MiaActionReceiptResult | Promise<MiaActionReceiptResult> }["bivarianceHack"];
};

export type MiaActionManifest = Pick<MiaActionDefinition, "name" | "description" | "inputSchema" | "risk" | "effect">;

export type AgentTarget = {
  ref: string;
  nodeId?: string;
  elementKey?: string;
  fingerprint?: string;
  tagName?: string;
  inputType?: string;
  formAssociated?: boolean;
  formSubmitter?: boolean;
  label?: string;
  role?: string;
  route?: string;
  locators: TargetLocator[];
  bounds?: { x: number; y: number; width: number; height: number };
};

export type ConfirmationRequest = { id: string; prompt: string; binding: string; expiresAt: string };

export type ActionDirective = {
  actionId: string;
  idempotencyKey: string;
  type: MiaActionType;
  message: string;
  expectedOutcome: string;
  risk: RiskLevel;
  target?: AgentTarget;
  route?: string;
  value?: string;
  key?: string;
  deltaX?: number;
  deltaY?: number;
  waitMs?: number;
  hostAction?: string;
  arguments?: Record<string, unknown>;
  confirmation?: ConfirmationRequest;
};

export type ActionReceipt = {
  actionId: string;
  idempotencyKey: string;
  type: MiaActionType;
  status: "completed" | "unverified" | "failed" | "cancelled" | "manual";
  message: string;
  targetRef?: string;
  route?: string;
  evidence: Record<string, unknown>;
};

export type AgentResponse = {
  sessionId: string;
  resumeToken?: string;
  revision: number;
  status: "active" | "waiting_user" | "waiting_confirmation" | "completed" | "failed" | "cancelled";
  assessment: string;
  progress: string;
  type: "actions" | "ask_user" | "answer" | "complete" | "unable";
  message: string;
  actions: ActionDirective[];
  input?: { field: string; inputType?: "text" | "email" | "number" | "date" | "choice"; choices?: string[] };
};

export type MiaEvent =
  | { type: "ready"; sessionId: string }
  | { type: "thinking"; message: string }
  | { type: "progress"; assessment: string; progress: string }
  | { type: "action_requested"; action: ActionDirective }
  | { type: "confirmation_required"; confirmation: ConfirmationRequest; actions: ActionDirective[] }
  | { type: "action_completed"; receipt: ActionReceipt }
  | { type: "answer"; message: string }
  | { type: "completed"; message: string }
  | { type: "cancelled" }
  | { type: "voice_started" }
  | { type: "voice_stopped" }
  | { type: "transcript"; role: "user" | "assistant" | "system"; text: string }
  | { type: "error"; error: Error };

export type MiaOptions = {
  backendUrl: string;
  tokenProvider: RuntimeTokenProvider;
  navigate?: (route: string) => void | Promise<void>;
  voice?: {
    enabled?: boolean;
    voice?: MiaVoiceName;
    openMic?: boolean;
    pushToTalk?: boolean;
  };
  actions?: MiaActionDefinition[];
  contextProviders?: MiaContextProvider[];
  visualContextProvider?: MiaVisualContextProvider;
  privacy?: {
    redactedSelectors?: string[];
    includePageText?: boolean;
    includeUrlQuery?: boolean;
    includePageTitle?: boolean;
    sensitivePatterns?: RegExp[];
    transformObservation?: (observation: Observation) => Observation;
    transformVisualContext?: (context: MiaVisualContext[]) => MiaVisualContext[] | Promise<MiaVisualContext[]>;
  };
  ui?: {
    enabled?: boolean;
    theme?: MiaTheme;
    cursorIcon?: string;
    cursorOffset?: { x: number; y: number };
    bubbleMaxWidth?: number;
    bubbleLingerMs?: number;
    styleNonce?: string;
  };
  onEvent?: (event: MiaEvent) => void;
};

export type GeminiLiveToken = {
  token: string;
  model: string;
  voice: string;
  language: string;
  expiresAt: string;
  websocketUrl: string;
};
export type VoiceEvent =
  | { type: "ready" }
  | { type: "listening" }
  | { type: "thinking" }
  | { type: "speaking" }
  | { type: "user_transcript"; text: string }
  | { type: "assistant_transcript"; text: string }
  | { type: "input_level"; level: number }
  | { type: "error"; error: Error }
  | { type: "ended"; reconnectable: boolean };
