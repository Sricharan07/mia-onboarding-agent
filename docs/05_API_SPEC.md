# API Specification

## 1. Overview

The local backend exposes APIs for:

1. Console.
2. SDK runtime.
3. UI mapper.
4. Workflow jobs.
5. Voice/session handling.
6. Logs.

Base URL for local development:

```text
http://localhost:4000
```

API version prefix:

```text
/api/v1
```

## 2. Conventions

### 2.1 JSON

All REST APIs use JSON unless uploading files.

### 2.2 Error Shape

```ts
export type APIError = {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
};
```

Example:

```json
{
  "error": {
    "code": "WORKFLOW_NOT_FOUND",
    "message": "Workflow not found."
  }
}
```

### 2.3 Pagination

For MVP, simple pagination:

```ts
{
  "items": [],
  "nextCursor": null
}
```

## 3. Health

### GET `/api/v1/health`

Returns service status.

Response:

```json
{
  "ok": true,
  "service": "ai-onboarding-backend",
  "mode": "local",
  "time": "2026-06-07T00:00:00.000Z"
}
```

### GET `/api/v1/system/readiness`

Returns database and provider readiness without running credit-consuming model, voice, transcription, indexing, or room operations.

Response:

```json
{
  "database": {
    "configured": true,
    "reachable": true,
    "status": "ok",
    "message": "SQLite database is reachable."
  },
  "providers": {
    "qwen": {
      "configured": true,
      "reachable": true,
      "status": "ok",
      "message": "Qwen model endpoint is reachable."
    },
    "qwenTts": {
      "configured": true,
      "reachable": null,
      "status": "unverified",
      "message": "Qwen Voice/TTS is configured. No-credit live operation was not run."
    },
    "stt": {
      "configured": true,
      "reachable": null,
      "status": "unverified",
      "message": "STT is configured. No-credit live operation was not run."
    },
    "moss": {
      "configured": true,
      "reachable": null,
      "status": "unverified",
      "message": "Moss is configured. No-credit live operation was not run."
    },
    "livekit": {
      "configured": true,
      "reachable": null,
      "status": "unverified",
      "message": "LiveKit is configured. No-credit live operation was not run."
    }
  }
}
```

## 3.1 Local API Keys

Local API keys protect SDK/runtime-sensitive routes. Store only hashed secrets; return the raw key only once on creation.

Supported scopes:

```text
apps:read
ui-map:read
workflows:read
runtime:write
logs:write
logs:read
admin
```

Keys can be sent with `Authorization: Bearer mia_...` or `x-api-key: mia_...`.

Local console routes remain usable without an API key in development. If a request does include an API key, read APIs enforce the matching read scope.

### GET `/api/v1/api-keys`

List API keys without raw secrets.

### POST `/api/v1/api-keys`

Request:

```json
{
  "name": "Local SDK key",
  "scopes": ["runtime:write", "logs:write"]
}
```

Response includes `key` once.

### DELETE `/api/v1/api-keys/:keyId`

Revokes an API key.

## 4. Apps

### GET `/api/v1/apps`

List apps.

Response:

```json
{
  "items": [
    {
      "id": "app_example_app",
      "name": "Example App",
      "slug": "example-app",
      "baseUrl": "http://localhost:3000"
    }
  ]
}
```

### POST `/api/v1/apps`

Create or update app.

Request:

```json
{
  "name": "Example App",
  "slug": "example-app",
  "baseUrl": "http://localhost:3000"
}
```

Response:

```json
{
  "id": "app_example_app",
  "name": "Example App",
  "slug": "example-app",
  "baseUrl": "http://localhost:3000"
}
```

## 5. UI Mapping

### POST `/api/v1/apps/:appId/ui-map/scan`

Starts a runtime browser scan.

Request:

```json
{
  "routes": [
    "/login",
    "/dashboard",
    "/customers",
    "/customers/new",
    "/settings/team"
  ],
  "auth": {
    "mode": "none"
  }
}
```

Supported auth modes:

```text
none
login_form
```

For `login_form`, credentials and selectors come from backend environment variables, not from the request body.

Response:

```json
{
  "uiMapVersionId": "ui_map_local_001",
  "status": "scanning"
}
```

### POST `/api/v1/apps/:appId/ui-map/interactive-sessions`

Starts a local headed Playwright mapping session. The browser remains open so the developer can manually open dropdowns, popovers, dialogs, and other hidden states before capturing them.

Request:

```json
{
  "routes": ["/dashboard", "/customers"],
  "auth": {
    "mode": "login_form"
  }
}
```

Response:

```json
{
  "sessionId": "ui_scan_session_123",
  "appId": "app_example_app",
  "uiMapVersionId": "ui_map_local_001",
  "currentRoute": "/dashboard",
  "createdAt": "2026-06-07T00:00:00.000Z",
  "initialCapture": {
    "pageId": "page_dashboard",
    "route": "/dashboard",
    "stateName": "default",
    "scannedElements": 24,
    "savedElements": 24,
    "duplicateElements": 0,
    "weakSelectors": 6
  }
}
```

### POST `/api/v1/ui-map/interactive-sessions/:sessionId/goto`

Navigates the Playwright browser to a route and captures the default visible state.

Request:

```json
{
  "route": "/customers",
  "captureDefault": true
}
```

### POST `/api/v1/ui-map/interactive-sessions/:sessionId/capture-state`

Captures the current visible DOM state from the open Playwright browser. Use this after manually opening a dropdown, modal, popover, sidebar, or table actions menu.

Request:

```json
{
  "stateName": "row actions menu open",
  "stateReason": "Manual capture after opening customer row actions"
}
```

### POST `/api/v1/ui-map/interactive-sessions/:sessionId/finish`

Marks the UI map version completed and closes the Playwright browser.

### POST `/api/v1/ui-map/interactive-sessions/:sessionId/cancel`

Marks the UI map version failed and closes the Playwright browser.

### GET `/api/v1/apps/:appId/ui-map/versions`

List UI map versions.

Response:

```json
{
  "items": [
    {
      "id": "ui_map_local_001",
      "appId": "app_example_app",
      "version": "local-dev-001",
      "source": "runtime_browser_scan",
      "status": "completed",
      "createdAt": "2026-06-07T00:00:00.000Z"
    }
  ]
}
```

### GET `/api/v1/ui-map/:uiMapVersionId/pages`

List pages in a UI map.

Response:

```json
{
  "items": [
    {
      "id": "page_customers",
      "name": "Customers",
      "route": "/customers",
      "url": "http://localhost:3000/customers",
      "status": "mapped"
    }
  ]
}
```

### GET `/api/v1/pages/:pageId/elements`

List elements for a page.

Query params:

```text
?selectorQuality=weak
?elementType=button
```

Response:

```json
{
  "items": [
    {
      "id": "el_customers_new_customer",
      "elementId": "customers.new_customer_button",
      "pageName": "Customers",
      "route": "/customers",
      "elementType": "button",
      "label": "New Customer",
      "description": "Opens the customer creation form from the Customers page.",
      "selector": "[data-ai-id='customers.new_customer_button']",
      "selectorQuality": "strong",
      "selectorWarnings": []
    }
  ]
}
```

### PATCH `/api/v1/elements/:elementId`

Update element metadata, mostly description/tags.

Request:

```json
{
  "description": "Opens the form for creating a new customer.",
  "tags": ["customer", "create", "crm"]
}
```

Response:

```json
{
  "ok": true
}
```

## 6. Workflow Video Upload

### POST `/api/v1/apps/:appId/workflow-videos`

Multipart upload.

Fields:

```text
file: video file
name: optional workflow name
description: optional description
```

Response:

```json
{
  "videoId": "video_create_customer",
  "jobId": "job_create_customer",
  "status": "uploaded"
}
```

### GET `/api/v1/apps/:appId/workflow-jobs`

List workflow video processing jobs for the console.

Response:

```json
{
  "items": [
    {
      "id": "job_create_customer",
      "appId": "app_example_app",
      "videoId": "video_create_customer",
      "filename": "create-customer.mp4",
      "status": "needs_review",
      "error": null,
      "createdAt": "2026-06-07T00:00:00.000Z",
      "updatedAt": "2026-06-07T00:00:00.000Z",
      "workflowId": "create_customer"
    }
  ]
}
```

### GET `/api/v1/workflow-jobs/:jobId`

Get job status.

Response:

```json
{
  "id": "job_create_customer",
      "appId": "app_example_app",
  "videoId": "video_create_customer",
  "status": "needs_review",
  "error": null
}
```

### POST `/api/v1/workflow-jobs/:jobId/process`

Start or retry processing.

Response:

```json
{
  "jobId": "job_create_customer",
  "status": "analyzing"
}
```

## 7. Workflows

### GET `/api/v1/apps/:appId/workflows`

List workflows.

Query params:

```text
?status=published
```

Response:

```json
{
  "items": [
    {
      "workflowId": "create_customer",
      "name": "Create Customer",
      "description": "Guides the user through creating a new customer.",
      "status": "published",
      "version": 1
    }
  ]
}
```

### GET `/api/v1/workflows/:workflowId`

Get full workflow JSON.

Response:

```json
{
  "workflowId": "create_customer",
      "appId": "app_example_app",
  "name": "Create Customer",
  "status": "needs_review",
  "steps": []
}
```

### PATCH `/api/v1/workflows/:workflowId`

Update workflow during review.

Request:

```json
{
  "name": "Create Customer",
  "description": "Guides the user through creating a new customer.",
  "triggerPhrases": ["create customer", "add customer"],
  "steps": []
}
```

Response:

```json
{
  "ok": true
}
```

### POST `/api/v1/workflows/:workflowId/approve`

Approve workflow.

Request:

```json
{
  "reviewedBy": "local-dev-user",
  "notes": "Looks good for validation."
}
```

Response:

```json
{
  "workflowId": "create_customer",
  "status": "approved"
}
```

### POST `/api/v1/workflows/:workflowId/publish`

Publish workflow.

Response:

```json
{
  "workflowId": "create_customer",
  "status": "published"
}
```

### POST `/api/v1/workflows/:workflowId/archive`

Archive workflow.

Response:

```json
{
  "workflowId": "create_customer",
  "status": "archived"
}
```

### POST `/api/v1/workflows/:workflowId/steps`

Add a workflow DSL step and revalidate the full workflow.

### PATCH `/api/v1/workflows/:workflowId/steps/:stepId`

Patch a workflow DSL step and revalidate the full workflow. Editing a published workflow changes status back to `needs_review`.

### DELETE `/api/v1/workflows/:workflowId/steps/:stepId`

Delete a workflow DSL step. The workflow must remain valid.

### POST `/api/v1/workflows/:workflowId/steps/reorder`

Request:

```json
{
  "stepIds": ["step_1", "step_2", "step_3"]
}
```

The payload must include every existing step exactly once.

## 8. Runtime Intent Resolution

### POST `/api/v1/runtime/resolve`

SDK sends current context and user utterance/transcript.

Request:

```json
{
      "appId": "app_example_app",
  "sessionId": "runtime_session_123",
  "utterance": "Help me create a new customer",
  "context": {
    "currentUrl": "http://localhost:3000/dashboard",
    "currentRoute": "/dashboard",
    "pageTitle": "Dashboard",
    "focusedElement": null,
    "visibleElements": []
  }
}
```

Response when workflow found:

```json
{
  "type": "workflow",
  "workflow": {
    "workflowId": "create_customer",
    "name": "Create Customer",
    "steps": []
  },
  "message": "I can help you create a new customer. Let's start.",
  "tts": {
    "text": "I can help you create a new customer. Let's start."
  }
}
```

Response when question:

```json
{
  "type": "answer",
  "message": "The Customers page lets you add and manage customer records.",
  "tts": {
    "text": "The Customers page lets you add and manage customer records."
  }
}
```

Response when no match:

```json
{
  "type": "no_match",
  "message": "I could not find a saved workflow for that yet.",
  "tts": {
    "text": "I could not find a saved workflow for that yet."
  }
}
```

## 9. Runtime Workflow Sessions

### POST `/api/v1/runtime/workflow-sessions`

Create workflow execution session.

Request:

```json
{
      "appId": "app_example_app",
  "workflowId": "create_customer",
  "clientSessionId": "sdk_session_123"
}
```

Response:

```json
{
  "runtimeSessionId": "workflow_runtime_123",
  "status": "pending"
}
```

### PATCH `/api/v1/runtime/workflow-sessions/:runtimeSessionId`

Update runtime state.

Request:

```json
{
  "status": "running",
  "currentStepId": "step_2",
  "values": {
    "customer_name": "Acme Inc"
  }
}
```

Response:

```json
{
  "ok": true
}
```

## 10. TTS

### POST `/api/v1/tts`

Generate spoken response.

Request:

```json
{
  "text": "I can help you create a new customer.",
  "voice": "default"
}
```

Response:

```json
{
  "audioUrl": "/local-files/tts/tts_123.wav",
  "mimeType": "audio/wav"
}
```

Implementation note:

For local MVP, this returns a generated audio file URL from the configured TTS provider.

## 11. LiveKit Token

### POST `/api/v1/livekit/token`

SDK requests a LiveKit token.

Request:

```json
{
      "appId": "app_example_app",
  "sessionId": "sdk_session_123",
  "identity": "local-user"
}
```

Response:

```json
{
  "token": "livekit_token_here",
  "url": "wss://livekit-dev-url"
}
```

If LiveKit credentials are missing, return a configuration error.

## 12. Logs

### POST `/api/v1/logs/execution`

SDK sends execution events.

Request:

```json
{
  "appId": "app_example_app",
  "sessionId": "sdk_session_123",
  "workflowId": "create_customer",
  "stepId": "step_2",
  "eventType": "step_started",
  "payload": {
    "type": "click",
    "selector": "[data-ai-id='customers.new_customer_button']"
  }
}
```

Response:

```json
{
  "ok": true
}
```

### GET `/api/v1/logs`

List logs.

Query params:

```text
?appId=app_example_app
?workflowId=create_customer
?sessionId=sdk_session_123
```

Response:

```json
{
  "items": [
    {
      "id": "log_123",
      "eventType": "step_started",
      "createdAt": "2026-06-07T00:00:00.000Z",
      "payload": {}
    }
  ]
}
```

## 12.1 Usage Metrics

### GET `/api/v1/metrics/usage`

Aggregates execution logs and AI request logs.

Query params:

```text
?appId=app_example_app
?from=2026-06-01T00:00:00.000Z
?to=2026-06-07T00:00:00.000Z
```

### GET `/api/v1/metrics/usage/timeseries`

Returns daily usage buckets.

## 13. Backend Implementation Notes

Codex should:

1. Use schema validation for every request.
2. Return typed errors.
3. Keep all external calls behind adapters.
4. Keep external calls behind real provider adapters.
5. Store raw Qwen output for debugging.
6. Store full workflow JSON in database.
7. Index Moss only after local DB writes succeed.
8. Log all state transitions.
