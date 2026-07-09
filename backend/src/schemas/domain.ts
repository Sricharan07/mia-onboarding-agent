import { z } from "zod";

export const executionPolicySchema = z.enum(["auto", "requires_confirmation", "manual_only", "blocked"]);
export type ExecutionPolicy = z.infer<typeof executionPolicySchema>;

export const workflowStatusSchema = z.enum(["draft", "needs_review", "approved", "published", "archived"]);
export const jobStatusSchema = z.enum(["uploaded", "analyzing", "mapped", "needs_review", "approved", "published", "archived", "failed"]);

export const uiScanAuthModeSchema = z.enum(["none", "login_form", "manual"]);
export type UiScanAuthMode = z.infer<typeof uiScanAuthModeSchema>;
export const appRuntimeModeSchema = z.enum(["qa_only", "workflow"]);
export const telemetryModeSchema = z.enum(["events_only", "redacted", "full"]);
export type TelemetryMode = z.infer<typeof telemetryModeSchema>;
export const fieldSensitivitySchema = z.enum(["standard", "personal", "secret", "payment"]);
export type FieldSensitivity = z.infer<typeof fieldSensitivitySchema>;

export const targetLocatorSchema = z.discriminatedUnion("strategy", [
  z.object({ strategy: z.literal("css"), selector: z.string().min(1) }),
  z.object({ strategy: z.literal("role"), role: z.string().min(1), name: z.string().min(1).optional() }),
  z.object({ strategy: z.literal("label"), label: z.string().min(1) }),
  z.object({ strategy: z.literal("text"), text: z.string().min(1), tagName: z.string().min(1).optional() })
]);
export type TargetLocator = z.infer<typeof targetLocatorSchema>;

export const appUiScanConfigSchema = z.object({
  runtimeMode: appRuntimeModeSchema.default("workflow"),
  routes: z.array(z.string().min(1)).default(["/"]),
  authMode: uiScanAuthModeSchema.default("none"),
  loginUrl: z.string().optional(),
  username: z.string().optional(),
  passwordConfigured: z.boolean().default(false),
  usernameSelector: z.string().optional(),
  passwordSelector: z.string().optional(),
  submitSelector: z.string().optional(),
  successUrlPattern: z.string().optional(),
  postLoginWaitMs: z.number().int().nonnegative().default(1000),
  ignoredSelectors: z.array(z.string().min(1)).default([]),
  redactedSelectors: z.array(z.string().min(1)).default([]),
  routeDiscovery: z.object({
    enabled: z.boolean().default(false),
    maxRoutes: z.number().int().positive().max(200).default(25)
  }).default({ enabled: false, maxRoutes: 25 })
});
export type AppUiScanConfig = z.infer<typeof appUiScanConfigSchema>;

export const appSchema = z.object({
  id: z.string(),
  name: z.string().min(1),
  slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  baseUrl: z.string().url(),
  uiScanConfig: appUiScanConfigSchema,
  privacyPolicy: z.object({
    telemetryMode: telemetryModeSchema,
    retentionDays: z.number().int().positive().max(3650)
  }),
  createdAt: z.string(),
  updatedAt: z.string(),
  archivedAt: z.string().nullable().optional()
});
export type AppRecord = z.infer<typeof appSchema>;

export const extractedActionStepSchema = z.object({
  id: z.string(),
  order: z.number().int(),
  page: z.string().nullable().optional(),
  route: z.string().nullable().optional(),
  action: z.enum(["navigate", "click", "focus", "fill", "select", "wait", "unknown"]),
  observedElement: z.string().nullable().optional(),
  observedValueType: z.enum(["text", "email", "password", "number", "date", "unknown"]).nullable().optional(),
  observedValueExample: z.string().nullable().optional(),
  visualContext: z.string().nullable().optional(),
  timestampStartMs: z.number().nullable().optional(),
  timestampEndMs: z.number().nullable().optional(),
  confidence: z.number().min(0).max(1).optional()
});

export const extractedActionTimelineSchema = z.object({
  goal: z.string().min(1),
  summary: z.string().optional(),
  steps: z.array(extractedActionStepSchema)
});
export type ExtractedActionTimeline = z.infer<typeof extractedActionTimelineSchema>;
export type ExtractedActionStep = z.infer<typeof extractedActionStepSchema>;

export const workflowTargetSchema = z.object({
  elementId: z.string(),
  label: z.string().optional(),
  selector: z.string().min(1),
  fallbackSelectors: z.array(z.string()).optional(),
  locators: z.array(targetLocatorSchema).default([]),
  route: z.string().optional(),
  pageName: z.string().optional(),
  uiMapVersionId: z.string().optional(),
  fingerprint: z.string().optional(),
  elementType: z.string().optional()
});
export type WorkflowTarget = z.infer<typeof workflowTargetSchema>;

const workflowStepBase = z.object({
  id: z.string(),
  label: z.string().optional(),
  description: z.string().optional(),
  executionPolicy: executionPolicySchema.optional(),
  source: z.object({
    extractedStepId: z.string().optional(),
    extractionConfidence: z.number().min(0).max(1).optional(),
    matchConfidence: z.number().min(0).max(1).optional()
  }).optional()
});

export const workflowStepSchema = z.discriminatedUnion("type", [
  workflowStepBase.extend({
    type: z.literal("review_required"),
    message: z.string().min(1),
    observedAction: z.string().optional()
  }),
  workflowStepBase.extend({
    type: z.literal("navigate"),
    route: z.string().min(1)
  }),
  workflowStepBase.extend({
    type: z.literal("click"),
    target: workflowTargetSchema,
    executionPolicy: executionPolicySchema
  }),
  workflowStepBase.extend({
    type: z.literal("focus"),
    target: workflowTargetSchema,
    executionPolicy: executionPolicySchema
  }),
  workflowStepBase.extend({
    type: z.literal("fill"),
    target: workflowTargetSchema,
    valueFrom: z.string().min(1),
    executionPolicy: executionPolicySchema
  }),
  workflowStepBase.extend({
    type: z.literal("select"),
    target: workflowTargetSchema,
    valueFrom: z.string().min(1),
    executionPolicy: executionPolicySchema
  }),
  workflowStepBase.extend({
    type: z.literal("ask_user"),
    field: z.string().min(1),
    prompt: z.string().min(1),
    inputType: z.enum(["text", "email", "password", "number", "date", "choice"]).optional(),
    sensitivity: fieldSensitivitySchema.optional(),
    choices: z.array(z.string()).optional()
  }),
  workflowStepBase.extend({
    type: z.literal("wait_for_element"),
    target: workflowTargetSchema,
    timeoutMs: z.number().int().positive()
  }),
  workflowStepBase.extend({
    type: z.literal("confirm"),
    message: z.string().min(1),
    confirmLabel: z.string().optional(),
    cancelLabel: z.string().optional()
  }),
  workflowStepBase.extend({
    type: z.literal("complete"),
    message: z.string().min(1)
  })
]);
export type WorkflowStep = z.infer<typeof workflowStepSchema>;

export const workflowSchema = z.object({
  workflowId: z.string().min(1),
  appId: z.string().min(1),
  name: z.string().min(1),
  description: z.string().min(1),
  status: workflowStatusSchema,
  version: z.number().int().positive(),
  triggerPhrases: z.array(z.string().min(1)).min(1),
  requiredContext: z.object({
    app: z.string().min(1),
    startingRoutes: z.array(z.string())
  }),
  steps: z.array(workflowStepSchema).min(1),
  createdFrom: z.object({
    videoId: z.string().optional(),
    jobId: z.string().optional(),
    uiMapVersionId: z.string().optional()
  }).optional(),
  review: z.object({
    reviewedBy: z.string().optional(),
    reviewedAt: z.string().optional(),
    notes: z.string().optional(),
    uiMapVersionId: z.string().optional()
  }),
  createdAt: z.string(),
  updatedAt: z.string()
}).superRefine((workflow, ctx) => {
  const stepIds = new Set<string>();
  const askFields = new Set<string>();

  for (const [index, step] of workflow.steps.entries()) {
    if (stepIds.has(step.id)) {
      ctx.addIssue({ code: "custom", path: ["steps", index, "id"], message: "Duplicate step id." });
    }
    stepIds.add(step.id);

    if (step.type === "ask_user") {
      askFields.add(step.field);
      if (step.inputType === "password" || step.sensitivity === "secret" || step.sensitivity === "payment") {
        ctx.addIssue({
          code: "custom",
          path: ["steps", index],
          message: "Secret and payment values must be entered manually and cannot be collected by Mia."
        });
      }
    }

    if ((step.type === "fill" || step.type === "select") && !askFields.has(step.valueFrom)) {
      ctx.addIssue({
        code: "custom",
        path: ["steps", index, "valueFrom"],
        message: "Fill/select step references a value that has not been collected by a previous ask_user step."
      });
    }
  }
});
export type Workflow = z.infer<typeof workflowSchema>;

export const uiElementRecordSchema = z.object({
  id: z.string(),
  elementId: z.string(),
  appId: z.string(),
  uiMapVersionId: z.string(),
  pageId: z.string(),
  pageName: z.string(),
  route: z.string(),
  elementType: z.enum(["button", "input", "textarea", "select", "link", "checkbox", "radio", "tab", "menuitem", "dialog", "form", "table", "other"]),
  role: z.string().optional(),
  label: z.string().optional(),
  visibleText: z.string().optional(),
  accessibleName: z.string().optional(),
  placeholder: z.string().optional(),
  ariaLabel: z.string().optional(),
  inputName: z.string().optional(),
  inputType: z.string().optional(),
  description: z.string(),
  selector: z.string(),
  selectorType: z.enum(["data-ai-id", "data-testid", "role-name", "aria-label", "label", "name", "id", "placeholder", "text", "css", "dom-path"]),
  fallbackSelectors: z.array(z.string()),
  locators: z.array(targetLocatorSchema).default([]),
  nearbyText: z.array(z.string()),
  parentSection: z.string().optional(),
  formName: z.string().optional(),
  modalContext: z.string().optional(),
  tableContext: z.string().optional(),
  boundingBox: z.object({
    x: z.number(),
    y: z.number(),
    width: z.number(),
    height: z.number()
  }).optional(),
  tags: z.array(z.string()),
  selectorQuality: z.enum(["strong", "medium", "weak"]),
  selectorWarnings: z.array(z.string()),
  stateName: z.string().default("default"),
  stateReason: z.string().optional(),
  discoveredBy: z.enum(["route_scan", "auto_expansion", "manual_capture"]).default("route_scan"),
  fingerprint: z.string().default(""),
  createdAt: z.string(),
  updatedAt: z.string()
});
export type UIElementRecord = z.infer<typeof uiElementRecordSchema>;

export const runtimeElementContextSchema = z.object({
  tagName: z.string(),
  role: z.string().optional(),
  label: z.string().optional(),
  text: z.string().optional(),
  selector: z.string().optional(),
  locators: z.array(targetLocatorSchema).optional(),
  elementId: z.string().optional(),
  mappedElementId: z.string().optional(),
  uiMapVersionId: z.string().optional(),
  fingerprint: z.string().optional(),
  boundingBox: z.object({
    x: z.number(),
    y: z.number(),
    width: z.number(),
    height: z.number()
  }).optional()
});

export const sdkRuntimeContextSchema = z.object({
  appId: z.string(),
  sessionId: z.string(),
  currentUrl: z.string(),
  currentRoute: z.string(),
  pageTitle: z.string().optional(),
  focusedElement: runtimeElementContextSchema.nullable().optional(),
  hoveredElement: runtimeElementContextSchema.nullable().optional(),
  visibleElements: z.array(runtimeElementContextSchema).optional(),
  userMetadata: z.record(z.string(), z.unknown()).optional()
});
export type SDKRuntimeContext = z.infer<typeof sdkRuntimeContextSchema>;

export const semanticRecordSchema = z.object({
  id: z.string(),
  kind: z.enum(["ui_element", "workflow"]),
  appId: z.string(),
  searchableText: z.string(),
  metadata: z.record(z.string(), z.unknown())
});
export type SemanticRecord = z.infer<typeof semanticRecordSchema>;
