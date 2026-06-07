# Data Models and Workflow DSL

## 1. Overview

This document defines the core data structures for the AI Onboarding Agent.

The most important rule:

```text
The local database is the source of truth.
Moss is a semantic retrieval index.
Qwen output is temporary and must be compiled into reviewed workflow JSON.
```

## 2. Core Entities

## 2.1 App

Represents a SaaS app connected to the local system.

```ts
export type App = {
  id: string;
  name: string;
  slug: string;
  baseUrl: string;
  createdAt: string;
  updatedAt: string;
};
```

Example:

```json
{
  "id": "app_example_app",
  "name": "Example App",
  "slug": "example-app",
  "baseUrl": "http://localhost:3000",
  "createdAt": "2026-06-07T00:00:00.000Z",
  "updatedAt": "2026-06-07T00:00:00.000Z"
}
```

## 2.2 UI Map Version

A snapshot of mapped UI for an app.

```ts
export type UIMapVersion = {
  id: string;
  appId: string;
  version: string;
  source: "runtime_browser_scan" | "manual_upload" | "ci_simulation";
  status: "scanning" | "completed" | "failed";
  createdAt: string;
  completedAt?: string;
  error?: string;
};
```

## 2.3 Page Record

```ts
export type PageRecord = {
  id: string;
  appId: string;
  uiMapVersionId: string;
  name: string;
  route: string;
  url: string;
  title?: string;
  status: "mapped" | "failed";
  error?: string;
  createdAt: string;
};
```

## 2.4 UI Element Record

```ts
export type UIElementRecord = {
  id: string;
  elementId: string;
  appId: string;
  uiMapVersionId: string;
  pageId: string;
  pageName: string;
  route: string;

  elementType:
    | "button"
    | "input"
    | "textarea"
    | "select"
    | "link"
    | "checkbox"
    | "radio"
    | "tab"
    | "menuitem"
    | "dialog"
    | "form"
    | "table"
    | "other";

  role?: string;
  label?: string;
  visibleText?: string;
  accessibleName?: string;
  placeholder?: string;
  ariaLabel?: string;
  inputName?: string;
  inputType?: string;

  description: string;

  selector: string;
  selectorType:
    | "data-ai-id"
    | "data-testid"
    | "role-name"
    | "aria-label"
    | "label"
    | "name"
    | "id"
    | "placeholder"
    | "text"
    | "css"
    | "dom-path";

  fallbackSelectors: string[];

  nearbyText: string[];
  parentSection?: string;
  formName?: string;
  modalContext?: string;
  tableContext?: string;

  boundingBox?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };

  tags: string[];

  selectorQuality: "strong" | "medium" | "weak";
  selectorWarnings: string[];

  createdAt: string;
  updatedAt: string;
};
```

## 2.5 Workflow Video

```ts
export type WorkflowVideo = {
  id: string;
  appId: string;
  filename: string;
  localPath: string;
  mimeType: string;
  sizeBytes: number;
  status: "uploaded" | "processing" | "processed" | "failed";
  uploadedAt: string;
};
```

## 2.6 Workflow Job

```ts
export type WorkflowJob = {
  id: string;
  appId: string;
  videoId: string;
  status:
    | "uploaded"
    | "analyzing"
    | "mapped"
    | "needs_review"
    | "approved"
    | "published"
    | "failed";

  qwenRawOutput?: unknown;
  extractedActionTimeline?: ExtractedActionTimeline;
  error?: string;

  createdAt: string;
  updatedAt: string;
};
```

## 3. Qwen Extracted Action Timeline

Qwen should return a rough timeline.

This is not executable.

```ts
export type ExtractedActionTimeline = {
  goal: string;
  summary?: string;
  steps: ExtractedActionStep[];
};
```

```ts
export type ExtractedActionStep = {
  id: string;
  order: number;
  page?: string;
  route?: string;
  action:
    | "navigate"
    | "click"
    | "focus"
    | "fill"
    | "select"
    | "wait"
    | "unknown";

  observedElement?: string;
  observedValueType?: "text" | "email" | "password" | "number" | "date" | "unknown";
  observedValueExample?: string;
  visualContext?: string;
  timestampStartMs?: number;
  timestampEndMs?: number;
  confidence?: number;
};
```

Example:

```json
{
  "goal": "Create a new customer",
  "summary": "The user opens the Customers page, clicks New Customer, fills a form, and saves.",
  "steps": [
    {
      "id": "extracted_step_1",
      "order": 1,
      "page": "Customers",
      "route": "/customers",
      "action": "click",
      "observedElement": "New Customer button",
      "visualContext": "Button near top right of Customers page",
      "confidence": 0.86
    }
  ]
}
```

## 4. Workflow DSL

The Workflow DSL is the reviewed, executable format.

## 4.1 Workflow

```ts
export type Workflow = {
  workflowId: string;
  appId: string;
  name: string;
  description: string;
  status: "draft" | "needs_review" | "approved" | "published" | "archived";
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
```

## 4.2 Workflow Step Union

```ts
export type WorkflowStep =
  | NavigateStep
  | ClickStep
  | FocusStep
  | FillStep
  | SelectStep
  | AskUserStep
  | WaitForElementStep
  | ConfirmStep
  | CompleteStep;
```

## 4.3 Shared Fields

```ts
export type WorkflowStepBase = {
  id: string;
  type: string;
  label?: string;
  description?: string;
  executionPolicy?: ExecutionPolicy;
  source?: {
    extractedStepId?: string;
    matchConfidence?: number;
  };
};
```

```ts
export type ExecutionPolicy =
  | "auto"
  | "requires_confirmation"
  | "manual_only"
  | "blocked";
```

## 4.4 Target Element

```ts
export type WorkflowTarget = {
  elementId: string;
  label?: string;
  selector: string;
  fallbackSelectors?: string[];
  route?: string;
  pageName?: string;
};
```

## 4.5 Step Types

### Navigate Step

```ts
export type NavigateStep = WorkflowStepBase & {
  type: "navigate";
  route: string;
};
```

### Click Step

```ts
export type ClickStep = WorkflowStepBase & {
  type: "click";
  target: WorkflowTarget;
  executionPolicy: ExecutionPolicy;
};
```

### Focus Step

```ts
export type FocusStep = WorkflowStepBase & {
  type: "focus";
  target: WorkflowTarget;
  executionPolicy: ExecutionPolicy;
};
```

### Fill Step

```ts
export type FillStep = WorkflowStepBase & {
  type: "fill";
  target: WorkflowTarget;
  valueFrom: string;
  executionPolicy: ExecutionPolicy;
};
```

### Select Step

```ts
export type SelectStep = WorkflowStepBase & {
  type: "select";
  target: WorkflowTarget;
  valueFrom: string;
  executionPolicy: ExecutionPolicy;
};
```

### Ask User Step

```ts
export type AskUserStep = WorkflowStepBase & {
  type: "ask_user";
  field: string;
  prompt: string;
  inputType?: "text" | "email" | "password" | "number" | "date" | "choice";
  choices?: string[];
};
```

### Wait For Element Step

```ts
export type WaitForElementStep = WorkflowStepBase & {
  type: "wait_for_element";
  target: WorkflowTarget;
  timeoutMs: number;
};
```

### Confirm Step

```ts
export type ConfirmStep = WorkflowStepBase & {
  type: "confirm";
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
};
```

### Complete Step

```ts
export type CompleteStep = WorkflowStepBase & {
  type: "complete";
  message: string;
};
```

## 5. Example Workflow

```json
{
  "workflowId": "create_customer",
  "appId": "app_example_app",
  "name": "Create Customer",
  "description": "Guides the user through creating a new customer in the CRM.",
  "status": "published",
  "version": 1,
  "triggerPhrases": [
    "create customer",
    "add new customer",
    "new client"
  ],
  "requiredContext": {
    "app": "example-app",
    "startingRoutes": ["/dashboard", "/customers"]
  },
  "steps": [
    {
      "id": "step_1",
      "type": "navigate",
      "route": "/customers"
    },
    {
      "id": "step_2",
      "type": "click",
      "target": {
        "elementId": "customers.new_customer_button",
        "label": "New Customer",
        "selector": "[data-ai-id='customers.new_customer_button']",
        "fallbackSelectors": [
          "button[aria-label='New Customer']",
          "button:has-text('New Customer')"
        ],
        "route": "/customers",
        "pageName": "Customers"
      },
      "executionPolicy": "auto"
    },
    {
      "id": "step_3",
      "type": "ask_user",
      "field": "customer_name",
      "prompt": "What is the customer's name?",
      "inputType": "text"
    },
    {
      "id": "step_4",
      "type": "fill",
      "target": {
        "elementId": "customers.customer_name_input",
        "label": "Customer Name",
        "selector": "[data-ai-id='customers.customer_name_input']"
      },
      "valueFrom": "customer_name",
      "executionPolicy": "auto"
    },
    {
      "id": "step_5",
      "type": "ask_user",
      "field": "customer_email",
      "prompt": "What is the customer's email?",
      "inputType": "email"
    },
    {
      "id": "step_6",
      "type": "fill",
      "target": {
        "elementId": "customers.customer_email_input",
        "label": "Email",
        "selector": "[data-ai-id='customers.customer_email_input']"
      },
      "valueFrom": "customer_email",
      "executionPolicy": "auto"
    },
    {
      "id": "step_7",
      "type": "confirm",
      "message": "Do you want me to save this customer?",
      "confirmLabel": "Save",
      "cancelLabel": "Cancel"
    },
    {
      "id": "step_8",
      "type": "click",
      "target": {
        "elementId": "customers.save_customer_button",
        "label": "Save Customer",
        "selector": "[data-ai-id='customers.save_customer_button']"
      },
      "executionPolicy": "requires_confirmation"
    },
    {
      "id": "step_9",
      "type": "complete",
      "message": "Customer created successfully."
    }
  ],
  "createdFrom": {
    "videoId": "video_create_customer",
    "jobId": "job_create_customer",
    "uiMapVersionId": "ui_map_local_001"
  },
  "review": {
    "reviewedBy": "local-dev-user",
    "reviewedAt": "2026-06-07T00:00:00.000Z",
    "notes": "Approved for local validation."
  },
  "createdAt": "2026-06-07T00:00:00.000Z",
  "updatedAt": "2026-06-07T00:00:00.000Z"
}
```

## 6. Workflow Runtime Session

```ts
export type WorkflowRuntimeSession = {
  id: string;
  appId: string;
  workflowId: string;
  userId?: string;
  status: "pending" | "running" | "paused" | "completed" | "cancelled" | "failed";
  currentStepId?: string;
  values: Record<string, string | number | boolean>;
  startedAt: string;
  completedAt?: string;
  error?: string;
};
```

## 7. SDK Runtime Context

The SDK sends this when asking the backend to resolve intent.

```ts
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
```

```ts
export type RuntimeElementContext = {
  tagName: string;
  role?: string;
  label?: string;
  text?: string;
  selector?: string;
  elementId?: string;
  boundingBox?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
};
```

## 8. Moss Search Records

## 8.1 UI Element Search Record

```ts
export type UIElementSearchRecord = {
  id: string;
  kind: "ui_element";
  appId: string;
  elementId: string;
  route: string;
  pageName: string;
  searchableText: string;
  metadata: {
    elementType: string;
    label?: string;
    selectorQuality: string;
    tags: string[];
  };
};
```

Example searchable text:

```text
Page: Customers
Route: /customers
Element type: button
Label: New Customer
Description: Opens the customer creation form from the Customers page.
Nearby text: Customers, Import, Export
Tags: customer, create, crm
```

## 8.2 Workflow Search Record

```ts
export type WorkflowSearchRecord = {
  id: string;
  kind: "workflow";
  appId: string;
  workflowId: string;
  searchableText: string;
  metadata: {
    name: string;
    status: string;
    triggerPhrases: string[];
    routes: string[];
  };
};
```

Example searchable text:

```text
Workflow: Create Customer
Description: Guides the user through creating a new customer in the CRM.
Trigger phrases: create customer, add new customer, new client
Steps: Navigate to Customers, click New Customer, ask for customer name, fill customer name, ask for email, fill email, save customer.
```

## 9. Suggested SQLite Tables

Minimum tables:

```sql
CREATE TABLE apps (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  base_url TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE ui_map_versions (
  id TEXT PRIMARY KEY,
  app_id TEXT NOT NULL,
  version TEXT NOT NULL,
  source TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  completed_at TEXT,
  error TEXT
);

CREATE TABLE pages (
  id TEXT PRIMARY KEY,
  app_id TEXT NOT NULL,
  ui_map_version_id TEXT NOT NULL,
  name TEXT NOT NULL,
  route TEXT NOT NULL,
  url TEXT NOT NULL,
  title TEXT,
  status TEXT NOT NULL,
  error TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE ui_elements (
  id TEXT PRIMARY KEY,
  element_id TEXT NOT NULL,
  app_id TEXT NOT NULL,
  ui_map_version_id TEXT NOT NULL,
  page_id TEXT NOT NULL,
  route TEXT NOT NULL,
  page_name TEXT NOT NULL,
  element_type TEXT NOT NULL,
  role TEXT,
  label TEXT,
  description TEXT NOT NULL,
  selector TEXT NOT NULL,
  selector_type TEXT NOT NULL,
  fallback_selectors_json TEXT NOT NULL,
  nearby_text_json TEXT NOT NULL,
  tags_json TEXT NOT NULL,
  selector_quality TEXT NOT NULL,
  selector_warnings_json TEXT NOT NULL,
  raw_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE workflow_videos (
  id TEXT PRIMARY KEY,
  app_id TEXT NOT NULL,
  filename TEXT NOT NULL,
  local_path TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  status TEXT NOT NULL,
  uploaded_at TEXT NOT NULL
);

CREATE TABLE workflow_jobs (
  id TEXT PRIMARY KEY,
  app_id TEXT NOT NULL,
  video_id TEXT NOT NULL,
  status TEXT NOT NULL,
  qwen_raw_output_json TEXT,
  extracted_action_timeline_json TEXT,
  error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE workflows (
  id TEXT PRIMARY KEY,
  workflow_id TEXT NOT NULL,
  app_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  status TEXT NOT NULL,
  version INTEGER NOT NULL,
  workflow_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE execution_logs (
  id TEXT PRIMARY KEY,
  app_id TEXT NOT NULL,
  workflow_id TEXT,
  session_id TEXT,
  step_id TEXT,
  event_type TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);
```

## 10. Validation Rules

Codex should implement schema validation using Zod.

Required rules:

1. Workflow must have at least one step.
2. Published workflows must have at least one trigger phrase.
3. Executable steps must have valid selectors.
4. `fill` and `select` steps must reference a prior `ask_user` field or static value.
5. `blocked` steps cannot be executed.
6. `requires_confirmation` steps must be preceded by confirmation or trigger confirmation in SDK.
7. Each step id must be unique within a workflow.
8. Workflow ids should be stable slugs.
9. Element ids should be globally unique within an app version.
