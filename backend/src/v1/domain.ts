import { z } from "zod";

export const riskLevelSchema = z.enum(["read", "navigate", "reversible_write", "manual", "blocked"]);
export type RiskLevel = z.infer<typeof riskLevelSchema>;
export const uiActionPolicySchema = z.enum(["guide_only", "navigate", "reversible_write", "manual", "blocked"]);
export type UiActionPolicy = z.infer<typeof uiActionPolicySchema>;

export const targetLocatorSchema = z.discriminatedUnion("strategy", [
  z.object({ strategy: z.literal("css"), selector: z.string().min(1).max(2_000) }),
  z.object({ strategy: z.literal("role"), role: z.string().min(1).max(100), name: z.string().max(500).optional() }),
  z.object({ strategy: z.literal("label"), label: z.string().min(1).max(500) }),
  z.object({ strategy: z.literal("text"), text: z.string().min(1).max(500), tagName: z.string().max(100).optional() })
]);
export type TargetLocator = z.infer<typeof targetLocatorSchema>;

const boxSchema = z.object({
  x: z.number(),
  y: z.number(),
  width: z.number().nonnegative(),
  height: z.number().nonnegative()
});

export const observationNodeSchema = z.object({
  nodeId: z.string().min(1).max(200),
  frameId: z.string().max(200).optional(),
  tagName: z.string().min(1).max(100),
  role: z.string().max(100).optional(),
  name: z.string().max(500).optional(),
  description: z.string().max(1_000).optional(),
  text: z.string().max(2_000).optional(),
  value: z.string().max(2_000).optional(),
  inputType: z.string().max(100).optional(),
  route: z.string().max(2_000).optional(),
  elementKey: z.string().max(300).optional(),
  locators: z.array(targetLocatorSchema).max(12).default([]),
  bounds: boxSchema,
  viewportVisible: z.boolean(),
  disabled: z.boolean().optional(),
  checked: z.boolean().optional(),
  selected: z.boolean().optional(),
  expanded: z.boolean().optional(),
  pressed: z.boolean().optional(),
  required: z.boolean().optional(),
  readOnly: z.boolean().optional(),
  sensitive: z.boolean().default(false),
  actionPolicy: riskLevelSchema.optional()
});
export type ObservationNode = z.infer<typeof observationNodeSchema>;

export const observationSchema = z.object({
  id: z.string().min(1).max(200),
  revision: z.number().int().nonnegative(),
  url: z.string().url(),
  route: z.string().min(1).max(2_000),
  title: z.string().max(1_000).optional(),
  viewport: z.object({
    width: z.number().nonnegative(),
    height: z.number().nonnegative(),
    scrollX: z.number(),
    scrollY: z.number()
  }),
  focusedNodeId: z.string().max(200).optional(),
  hoveredNodeId: z.string().max(200).optional(),
  selectedText: z.string().max(2_000).optional(),
  pageText: z.string().max(20_000).optional(),
  nodes: z.array(observationNodeSchema).max(500)
});
export type Observation = z.infer<typeof observationSchema>;

export const contextEntrySchema = z.object({
  name: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/),
  description: z.string().min(1).max(500),
  content: z.string().max(10_000),
  trusted: z.boolean().default(false)
});
export type ContextEntry = z.infer<typeof contextEntrySchema>;

export const visualContextSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(2_000),
  mimeType: z.enum(["image/png", "image/jpeg"]).optional(),
  data: z.string().max(2_000_000).optional()
}).refine((value) => Boolean(value.description || value.data), "Visual context requires a description or image data.");
export type VisualContext = z.infer<typeof visualContextSchema>;

export const hostActionManifestSchema = z.object({
  name: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/),
  description: z.string().min(1).max(1_000),
  inputSchema: z.record(z.string(), z.unknown()).default({}),
  risk: riskLevelSchema
});
export type HostActionManifest = z.infer<typeof hostActionManifestSchema>;

export const actionTypeSchema = z.enum([
  "point",
  "highlight",
  "hover",
  "scroll_to",
  "scroll_by",
  "navigate",
  "go_back",
  "focus",
  "click",
  "fill",
  "clear",
  "select",
  "toggle",
  "press_key",
  "wait",
  "request_visual",
  "host_action"
]);
export type ActionType = z.infer<typeof actionTypeSchema>;

export const agentTargetSchema = z.object({
  ref: z.string().min(1).max(300),
  nodeId: z.string().max(200).optional(),
  elementKey: z.string().max(300).optional(),
  label: z.string().max(500).optional(),
  role: z.string().max(100).optional(),
  route: z.string().max(2_000).optional(),
  locators: z.array(targetLocatorSchema).max(12).default([]),
  bounds: boxSchema.optional()
});
export type AgentTarget = z.infer<typeof agentTargetSchema>;

export const plannedActionSchema = z.object({
  actionId: z.string().min(1).max(200),
  type: actionTypeSchema,
  message: z.string().min(1).max(1_000),
  expectedOutcome: z.string().min(1).max(1_000),
  targetRef: z.string().max(300).optional(),
  route: z.string().max(2_000).optional(),
  value: z.string().max(4_000).optional(),
  key: z.string().max(100).optional(),
  deltaX: z.number().int().min(-10_000).max(10_000).optional(),
  deltaY: z.number().int().min(-10_000).max(10_000).optional(),
  waitMs: z.number().int().positive().max(10_000).optional(),
  hostAction: z.string().max(64).optional(),
  arguments: z.record(z.string(), z.unknown()).optional()
});
export type PlannedAction = z.infer<typeof plannedActionSchema>;

export const actionDirectiveSchema = z.object({
  actionId: z.string(),
  idempotencyKey: z.string(),
  type: actionTypeSchema,
  message: z.string(),
  expectedOutcome: z.string(),
  risk: riskLevelSchema,
  target: agentTargetSchema.optional(),
  route: z.string().optional(),
  value: z.string().optional(),
  key: z.string().optional(),
  deltaX: z.number().optional(),
  deltaY: z.number().optional(),
  waitMs: z.number().optional(),
  hostAction: z.string().optional(),
  arguments: z.record(z.string(), z.unknown()).optional(),
  confirmation: z.object({
    id: z.string(),
    prompt: z.string(),
    binding: z.string(),
    expiresAt: z.string()
  }).optional()
});
export type ActionDirective = z.infer<typeof actionDirectiveSchema>;

export const actionReceiptSchema = z.object({
  actionId: z.string().min(1),
  idempotencyKey: z.string().min(1),
  type: actionTypeSchema,
  status: z.enum(["completed", "unverified", "failed", "cancelled", "manual"]),
  message: z.string().max(2_000),
  targetRef: z.string().max(300).optional(),
  route: z.string().max(2_000).optional(),
  evidence: z.record(z.string(), z.unknown()).default({})
});
export type ActionReceipt = z.infer<typeof actionReceiptSchema>;

export const plannerDecisionSchema = z.object({
  assessment: z.string().min(1).max(1_000),
  progress: z.string().min(1).max(500),
  type: z.enum(["actions", "ask_user", "answer", "complete", "unable"]),
  message: z.string().min(1).max(3_000),
  actions: z.array(plannedActionSchema).max(4).default([]),
  field: z.string().max(100).optional(),
  inputType: z.enum(["text", "email", "number", "date", "choice"]).optional(),
  choices: z.array(z.string().min(1).max(200)).max(20).optional(),
  successEvidence: z.array(z.string().min(1).max(500)).max(10).default([])
}).superRefine((decision, context) => {
  if (decision.type === "actions" && decision.actions.length === 0) {
    context.addIssue({ code: "custom", path: ["actions"], message: "Action decisions require at least one action." });
  }
  if (decision.type !== "actions" && decision.actions.length > 0) {
    context.addIssue({ code: "custom", path: ["actions"], message: "Only action decisions may include actions." });
  }
  if (decision.type === "ask_user" && !decision.field) {
    context.addIssue({ code: "custom", path: ["field"], message: "User questions require a field name." });
  }
});
export type PlannerDecision = z.infer<typeof plannerDecisionSchema>;

export const agentResponseSchema = z.object({
  sessionId: z.string(),
  resumeToken: z.string().optional(),
  revision: z.number().int().nonnegative(),
  status: z.enum(["active", "waiting_user", "waiting_confirmation", "completed", "failed", "cancelled"]),
  assessment: z.string().max(1_000),
  progress: z.string().max(500),
  type: z.enum(["actions", "ask_user", "answer", "complete", "unable"]),
  message: z.string(),
  actions: z.array(actionDirectiveSchema).max(4).default([]),
  input: z.object({
    field: z.string(),
    inputType: z.enum(["text", "email", "number", "date", "choice"]).optional(),
    choices: z.array(z.string()).optional()
  }).optional()
});
export type AgentResponse = z.infer<typeof agentResponseSchema>;

export const createSessionSchema = z.object({
  observation: observationSchema,
  actions: z.array(hostActionManifestSchema).max(100).default([]),
  context: z.array(contextEntrySchema).max(20).default([]),
  visualContext: z.array(visualContextSchema).max(5).default([])
});

export const resumeSessionSchema = z.object({
  sessionId: z.string().min(1),
  resumeToken: z.string().min(1),
  observation: observationSchema,
  actions: z.array(hostActionManifestSchema).max(100).default([]),
  context: z.array(contextEntrySchema).max(20).default([])
});

export const submitTurnSchema = z.object({
  revision: z.number().int().nonnegative(),
  utterance: z.string().min(1).max(4_000),
  source: z.enum(["text", "voice"]),
  observation: observationSchema,
  actions: z.array(hostActionManifestSchema).max(100).default([]),
  context: z.array(contextEntrySchema).max(20).default([]),
  visualContext: z.array(visualContextSchema).max(5).default([])
});

export const continueSessionSchema = z.object({
  revision: z.number().int().nonnegative(),
  observation: observationSchema,
  receipts: z.array(actionReceiptSchema).min(1).max(4),
  actions: z.array(hostActionManifestSchema).max(100).default([]),
  context: z.array(contextEntrySchema).max(20).default([]),
  visualContext: z.array(visualContextSchema).max(5).default([])
});

export const resolveConfirmationSchema = z.object({
  revision: z.number().int().nonnegative(),
  binding: z.string().min(1),
  approved: z.boolean(),
  source: z.enum(["text", "voice", "ui"]),
  observation: observationSchema
});
