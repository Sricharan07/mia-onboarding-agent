# System Architecture

## 1. High-Level Architecture

The MVP is a local-development system with four first-party components and several external adapters.

```text
┌───────────────────────────┐
│       Example App          │
│  SaaS app + embedded SDK   │
└─────────────┬─────────────┘
              │
              │ runtime context, voice, workflow execution events
              ▼
┌───────────────────────────┐
│        Local Backend       │
│ API, jobs, workflow engine │
└───────┬─────────┬─────────┘
        │         │
        │         ▼
        │   ┌─────────────────┐
        │   │ Local Database   │
        │   │ SQLite/Postgres  │
        │   └─────────────────┘
        │
        ▼
┌───────────────────────────┐
│          Console           │
│ Upload, review, publish    │
└───────────────────────────┘
```

External/dev adapters:

```text
Qwen              → workflow video understanding
Moss              → semantic search index
LiveKit           → realtime voice/session transport
Qwen Voice / TTS  → spoken assistant responses
```

## 2. Component Responsibilities

## 2.1 Console Frontend

The console is the local web app where developers configure and review the system.

Responsibilities:

1. Show local app configuration.
2. Upload workflow videos.
3. Show processing status.
4. Review generated workflows.
5. Edit workflow steps.
6. Publish workflows.
7. View UI map and element descriptions.
8. Show selector quality warnings.
9. Show logs and errors.

## 2.2 Example App

The example app is the sample SaaS app.

Responsibilities:

1. Provide realistic routes and workflows.
2. Embed the frontend SDK.
3. Expose stable attributes on key elements where possible.
4. Provide enough UI complexity for a convincing product experience.

Recommended routes:

```text
/login
/dashboard
/customers
/customers/new
/leads
/pipeline
/reports
/settings/team
```

## 2.3 Frontend SDK

The SDK is embedded inside the example app or any adopting SaaS app.

Responsibilities:

1. Render assistant launcher.
2. Render AI cursor overlay.
3. Capture runtime UI context.
4. Capture voice instructions.
5. Connect to backend voice/session layer.
6. Receive workflow instructions.
7. Execute approved workflow steps.
8. Highlight elements.
9. Ask user for inputs.
10. Confirm sensitive actions.
11. Emit execution logs.

## 2.4 Local Backend

The backend is the central coordinator.

Responsibilities:

1. Store UI maps.
2. Store workflow videos locally.
3. Create video-processing jobs.
4. Call Qwen through the Qwen adapter.
5. Match video actions to UI elements using Moss.
6. Compile workflow JSON.
7. Serve console APIs.
8. Serve SDK APIs.
9. Manage workflow runtime sessions.
10. Produce TTS responses.
11. Store logs.

## 2.5 Local Database

The local database is the source of truth.

Stores:

1. Apps.
2. UI map versions.
3. Pages.
4. UI elements.
5. Element descriptions.
6. Selector quality.
7. Workflow videos.
8. Workflow jobs.
9. Workflows.
10. Workflow versions.
11. Workflow steps.
12. Runtime sessions.
13. Execution logs.

Recommended MVP database: SQLite.

## 2.6 Moss Semantic Index

Moss is used for semantic retrieval.

Moss indexes:

1. UI element searchable records.
2. Workflow searchable records.
3. Optional documentation records later.

Moss is not the source of truth.

When Moss returns an ID, backend must load full record from local database.

## 2.7 Qwen

Qwen is the primary workflow video understanding model.

Responsibilities:

1. Analyze uploaded workflow videos or extracted keyframes.
2. Produce rough action timeline.
3. Output valid JSON matching expected schema.
4. Include confidence and observed UI context where possible.

Qwen does not decide final workflow execution.

Backend should not call provider APIs directly from business logic. Use adapters.

## 2.8 LiveKit

LiveKit is the realtime voice transport.

Responsibilities:

1. Maintain live voice/session channel.
2. Stream user microphone audio from SDK to backend.
3. Support realtime assistant events.
4. Support interruption/cancel events.

## 2.9 TTS / Qwen Voice

TTS is required for MVP.

Responsibilities:

1. Convert assistant responses to audio.
2. Return audio URL or stream to SDK.
3. Support natural spoken responses.

## 3. Main System Flows

## 3.1 UI Mapping Flow

```text
Developer starts local example app
→ Developer starts backend and console
→ Console triggers mapping job
→ Backend launches Playwright mapper
→ Mapper visits configured routes
→ Mapper extracts interactive elements
→ Mapper generates selectors and descriptions
→ Backend stores UI map in local DB
→ Backend indexes searchable element records in Moss
→ Console shows UI map and selector quality
```

## 3.2 Workflow Upload and Compilation Flow

```text
Developer uploads workflow video
→ Backend stores video locally
→ Backend creates job with status uploaded
→ Job transitions to analyzing
→ Backend extracts keyframes or sends video to Qwen
→ Qwen returns rough action timeline
→ Backend validates Qwen JSON
→ Backend searches Moss for matching UI elements
→ Backend compiles workflow DSL
→ Workflow status becomes needs_review
→ Console shows workflow for review
```

## 3.3 Human Review Flow

```text
Developer opens generated workflow
→ Console displays steps and matched elements
→ Developer edits fields and policies
→ Developer approves workflow
→ Backend validates workflow DSL
→ Workflow becomes approved
→ Developer publishes workflow
→ Workflow becomes published
→ Moss indexes published workflow searchable text
```

## 3.4 Runtime Workflow Execution Flow

```text
End user opens example app
→ SDK initializes with local backend URL and app id
→ User speaks: "Help me create a new customer"
→ SDK streams audio through LiveKit
→ Backend transcribes audio
→ Runtime LLM classifies request as workflow intent
→ Backend searches Moss for matching published workflow
→ Backend returns workflow execution plan
→ SDK starts AI cursor execution
→ SDK asks for inputs where needed
→ SDK confirms sensitive steps
→ SDK completes workflow
→ Backend stores execution logs
→ TTS speaks status messages
```

## 4. Module Boundaries

## 4.1 Backend Modules

Recommended folders:

```text
backend/src/
  app.ts
  config/
  db/
  routes/
  services/
    ui-map/
    workflows/
    jobs/
    runtime/
    execution/
    logs/
  adapters/
    qwen/
    moss/
    livekit/
    stt/
    tts/
    storage/
  schemas/
  workers/
  utils/
```

## 4.2 Console Modules

Recommended folders:

```text
console/src/
  pages/
    Dashboard.tsx
    UploadWorkflow.tsx
    WorkflowReview.tsx
    Workflows.tsx
    UIMap.tsx
    Settings.tsx
    Logs.tsx
  components/
    WorkflowStepEditor.tsx
    SelectorQualityBadge.tsx
    ElementPicker.tsx
    StatusBadge.tsx
  api/
  types/
```

## 4.3 SDK Modules

Recommended folders:

```text
sdk/src/
  index.ts
  client.ts
  context/
    collectRuntimeContext.ts
    elementInspector.ts
  cursor/
    CursorOverlay.ts
    highlight.ts
    movement.ts
  execution/
    WorkflowExecutor.ts
    stepHandlers.ts
    policies.ts
  voice/
    livekitClient.ts
    microphone.ts
  ui/
    AssistantLauncher.ts
    PromptOverlay.ts
    ConfirmationDialog.ts
  events/
  types/
```

## 4.4 Mapper Modules

Recommended folders:

```text
mapper/src/
  scanApp.ts
  routeRunner.ts
  extractElements.ts
  selectorGenerator.ts
  descriptionGenerator.ts
  selectorQuality.ts
  mossIndexer.ts
  types.ts
```

## 5. Local Runtime Topology

Recommended local ports:

```text
Example app:     http://localhost:3000
Console:         http://localhost:3001
Backend API:     http://localhost:4000
LiveKit dev:     configured by environment
Moss dev:        configured by environment
```

## 6. Data Ownership Rules

1. Backend owns workflow state.
2. Local database owns full UI map and workflow records.
3. Moss owns searchable semantic copies only.
4. SDK owns visual execution in browser.
5. Console owns review UI but not business rules.
6. Qwen output is temporary until compiled and reviewed.

## 7. Failure Handling

### 7.1 UI Mapper Failure

If route scan fails:

1. Mark route as failed.
2. Store error message.
3. Continue scanning other routes.
4. Show route-level error in console.

### 7.2 Video Processing Failure

If Qwen call fails:

1. Mark job as `failed`.
2. Store raw error.
3. Allow retry.

If Qwen JSON is invalid:

1. Store raw output.
2. Mark job as `failed` or `needs_manual_fix`.
3. Show validation errors in console.

### 7.3 Element Matching Failure

If Moss cannot match an action:

1. Create step with `match_status: "unmatched"`.
2. Mark workflow as `needs_review`.
3. Let reviewer manually choose element.

### 7.4 Runtime Execution Failure

If SDK cannot find element:

1. Pause workflow.
2. Highlight error message.
3. Send execution error to backend.
4. Offer retry or cancel.
5. Do not proceed automatically.

## 8. Implementation Principle

Build every external dependency behind an interface.

If API keys or endpoints are missing, fail with a clear configuration error instead of silently changing provider behavior.
