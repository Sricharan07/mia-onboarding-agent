# Console Specification

## 1. Purpose

The console is the local developer interface for configuring, training, reviewing, and publishing the AI onboarding agent.

It is not called a developer dashboard. Use the term **console** everywhere.

## 2. Primary Console Jobs

The console allows the developer to:

1. Configure the example app.
2. Trigger UI mapping.
3. View UI map and selector quality.
4. Upload workflow videos.
5. Monitor workflow processing jobs.
6. Review generated workflows.
7. Edit workflow steps.
8. Approve and publish workflows.
9. View runtime execution logs.
10. Manage local environment settings.

## 3. Pages

## 3.1 Home / Overview

Route:

```text
/
```

Shows:

1. App name.
2. Backend health.
3. Current UI map version.
4. Number of mapped pages.
5. Number of mapped elements.
6. Number of workflows by status.
7. Recent workflow jobs.
8. Recent runtime executions.

## 3.2 Settings

Route:

```text
/settings
```

Fields:

1. App name.
2. App slug.
3. Example app base URL.
4. Backend URL.
5. Model provider status.
6. Moss status.
7. LiveKit status.
8. TTS status.

For MVP, many settings can read from env and show read-only.

## 3.3 UI Mapping

Route:

```text
/ui-map
```

Features:

1. Trigger scan.
2. Enter routes to scan.
3. Show latest UI map version.
4. Show scanned pages.
5. Show page status.
6. Show element count.
7. Link to page detail.

## 3.4 UI Map Page Detail

Route:

```text
/ui-map/pages/:pageId
```

Shows table:

| Field | Description |
|---|---|
| Element ID | Stable semantic id. |
| Type | button/input/link/etc. |
| Label | Visible or accessible label. |
| Description | Editable description. |
| Selector | Primary selector. |
| Quality | strong/medium/weak. |
| Warnings | Selector warnings. |
| Recommendation | Suggested `data-ai-id`. |

Actions:

1. Edit description.
2. Edit tags.
3. Copy selector.
4. Copy recommended attribute.
5. View raw JSON.

## 3.5 Upload Workflow

Route:

```text
/workflows/upload
```

Features:

1. File picker for video.
2. Optional workflow name.
3. Optional description.
4. Upload button.
5. Status after upload.
6. Link to processing job.

## 3.6 Workflow Jobs

Route:

```text
/workflow-jobs
```

Shows:

1. Job id.
2. Video filename.
3. Status.
4. Created time.
5. Error if failed.
6. Retry button.
7. Open generated workflow if available.

## 3.7 Workflow Review

Route:

```text
/workflows/:workflowId/review
```

This is one of the most important screens.

Shows:

1. Workflow name.
2. Description.
3. Trigger phrases.
4. Generated goal.
5. Qwen summary.
6. Step list.
7. Matched elements.
8. Confidence scores.
9. Execution policies.
10. Validation errors.
11. Raw JSON toggle.

Step editor should allow:

1. Change step type.
2. Change target element.
3. Edit prompt.
4. Edit field name.
5. Edit execution policy.
6. Remove step.
7. Add step.
8. Reorder steps.

Actions:

1. Save draft.
2. Approve.
3. Publish.
4. Reject/archive.
5. Retry matching.

## 3.8 Published Workflows

Route:

```text
/workflows
```

Shows:

1. Workflow name.
2. Status.
3. Version.
4. Trigger phrases.
5. Number of steps.
6. Last updated.
7. Publish/unpublish/archive actions.

## 3.9 Logs

Route:

```text
/logs
```

Shows:

1. AI call logs.
2. Workflow execution logs.
3. SDK events.
4. Job errors.
5. Filter by workflow/session/status.

## 4. Workflow Review UX

The workflow review page should clearly separate:

1. AI-extracted action.
2. Moss-matched element.
3. Final executable step.

Example step card:

```text
Step 2: Click New Customer

Extracted from video:
- Action: click
- Observed element: Create Customer button
- Confidence: 0.86

Matched UI element:
- Element ID: customers.new_customer_button
- Label: New Customer
- Selector: [data-ai-id='customers.new_customer_button']
- Match confidence: 0.91

Executable step:
- Type: click
- Execution policy: auto
```

## 5. Selector Quality UI

Show badges:

```text
strong  → green
medium  → yellow
weak    → red
```

Do not rely only on color. Include text.

Weak selector recommendation example:

```text
Recommendation:
Add this attribute to the element:

data-ai-id="customers.new_customer_button"
```

## 6. Workflow States

Console should display:

```text
uploaded
analyzing
mapped
needs_review
approved
published
failed
```

State transitions:

```text
uploaded → analyzing → mapped → needs_review → approved → published
uploaded → analyzing → failed
needs_review → approved
approved → published
published → archived
```

## 7. Validation Errors

Before approval/publish, validate:

1. Workflow has name.
2. Workflow has trigger phrases.
3. Workflow has steps.
4. Each executable step has selector.
5. Each `fill` step references known field.
6. `requires_confirmation` steps have confirmation behavior.
7. No `blocked` step is published unless intentionally kept for guidance only.
8. No unmatched element remains in auto-executable step.

## 8. Console Components

Suggested components:

```text
StatusBadge
SelectorQualityBadge
WorkflowStepCard
WorkflowStepEditor
ElementPicker
TriggerPhraseEditor
ExecutionPolicySelect
RawJsonViewer
LogTable
RouteScanForm
```

## 9. Element Picker

The Element Picker lets reviewer manually choose a UI element for unmatched steps.

Features:

1. Search elements by label/description.
2. Filter by page.
3. Filter by type.
4. Show selector quality.
5. Select element and update step target.

## 10. Raw JSON Viewer

Allow showing:

1. Qwen raw output.
2. Extracted action timeline.
3. Compiled workflow JSON.
4. UI element raw record.

Useful for debugging and Codex implementation.

## 11. Console Acceptance Criteria

1. Developer can create/update app config.
2. Developer can scan UI map.
3. Developer can see mapped pages and elements.
4. Developer can upload workflow video.
5. Developer can see job status.
6. Developer can review generated workflow.
7. Developer can edit workflow steps.
8. Developer can publish workflow.
9. Published workflow appears in workflow list.
10. SDK can trigger published workflow.
