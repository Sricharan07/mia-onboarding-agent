# Product Requirements Document: AI Onboarding Agent for SaaS Products

## 1. Product Name

Working name: **AI Onboarding Agent**

Alternative names:

1. Workflow Copilot SDK
2. In-Product AI Guide
3. Video-to-Workflow Agent
4. Interactive SaaS Onboarding Agent

Use **AI Onboarding Agent** in code comments and docs unless renamed later.

## 2. Product Vision

SaaS users should not need to read long documentation, watch static tutorials, or contact support just to complete common product tasks.

The AI Onboarding Agent guides users directly inside the SaaS product UI. It listens to the user, finds the right workflow, shows a Mia Shadow Cursor, highlights elements, asks for required information, and executes approved workflow steps.

The core idea:

```text
Developers record workflows.
The system converts recordings into structured executable workflows.
The SDK brings those workflows into the app through a Mia Shadow Cursor that listens, guides, and acts.
```

## 3. Problem

Modern SaaS products are often difficult to onboard because:

1. Users do not know where to click.
2. Documentation is detached from the actual UI.
3. Tutorial videos are passive and quickly become outdated.
4. Support teams repeatedly answer the same workflow questions.
5. SaaS dashboards contain complex multi-step operations.
6. Existing product tours are manually authored and brittle.
7. AI chatbots answer questions but usually do not perform UI actions.

## 4. Solution

Build an AI onboarding layer that sits inside a SaaS app through a frontend SDK.

The system lets the SaaS developer:

1. Run a UI mapper against the app.
2. Upload videos of workflows.
3. Let Qwen understand the workflow video.
4. Match video actions to real UI elements using Moss.
5. Review and approve generated workflows in the console.
6. Publish workflows for end users.

The end user can then say things like:

```text
Help me create a new customer.
Show me how to invite a teammate.
Help me generate a sales report.
```

The SDK then guides or performs the workflow inside the app.

## 5. Example App

For implementation and validation, use a sample SaaS application as an example integration.

The example app should be realistic enough to demonstrate the SDK inside a convincing product interface. It should include enough UI complexity to cover the core onboarding flows:

1. Login page.
2. Dashboard page.
3. Customers page.
4. Create customer form.
5. Leads page.
6. Pipeline page.
7. Reports page.
8. Settings or team invite page.

## 6. Target Users

### 6.1 Developer / SaaS Team

Uses the console to configure the agent.

Needs:

1. Upload workflow videos.
2. Generate and review workflows.
3. See UI map quality.
4. Improve selectors.
5. Publish workflows.
6. Debug failed workflow generation or execution.

### 6.2 End User

Uses the SaaS app with embedded SDK.

Needs:

1. Ask for help using voice.
2. Get spoken responses.
3. See the Mia Shadow Cursor direct them.
4. Provide required inputs when asked.
5. Confirm sensitive steps.
6. Complete workflows without reading docs.

## 7. MVP Goals

The MVP must demonstrate this full path:

```text
Map example app UI
→ Upload workflow video
→ Qwen extracts rough steps
→ Moss matches steps to UI elements
→ Backend compiles workflow JSON
→ Human reviews and publishes
→ User asks for workflow through voice
→ SDK executes approved workflow with the Mia Shadow Cursor
→ Assistant responds with voice output
```

## 8. MVP Functional Requirements

### 8.1 Console

The console must allow a developer to:

1. View app configuration.
2. Trigger or upload a UI map.
3. Upload workflow videos.
4. See workflow processing status.
5. Review generated workflow steps.
6. Edit workflow name, description, trigger phrases, prompts, selectors, and execution policies.
7. Publish workflows.
8. View published workflows.
9. View UI elements and selector quality warnings.
10. View local logs for debugging.

### 8.2 UI Mapper

The mapper must:

1. Open configured example app routes in a browser.
2. Extract visible interactive elements.
3. Capture element metadata.
4. Generate stable and fallback selectors.
5. Generate descriptions.
6. Store the UI map in the local database.
7. Index searchable UI element records in Moss.
8. Flag weak selectors.

### 8.3 Workflow Video Processing

The backend must:

1. Accept workflow video uploads.
2. Store files locally.
3. Create a processing job.
4. Extract keyframes or send video to Qwen.
5. Ask Qwen for a rough action timeline.
6. Match actions to UI elements using Moss.
7. Compile workflow JSON.
8. Mark workflow as `needs_review`.

### 8.4 Human Review

The console must show each generated step with:

1. Step type.
2. Matched UI element.
3. Selector.
4. Confidence score.
5. Prompt or input field.
6. Execution policy.
7. Editable fields.

The reviewer must be able to:

1. Approve workflow.
2. Edit workflow.
3. Reject workflow.
4. Publish workflow.

### 8.5 Runtime Voice

The SDK/backend must support:

1. Capturing voice from the browser.
2. Streaming or sending audio through LiveKit.
3. Transcribing audio.
4. Detecting intent.
5. Searching workflows using Moss.
6. Returning a selected workflow.
7. Producing spoken response using TTS.
8. Supporting interruption or cancellation where feasible.

### 8.6 SDK and Mia Guide Layer

The SDK must:

1. Render a floating assistant UI.
2. Show the Mia Shadow Cursor as the assistant presence.
3. Highlight target elements.
4. Scroll elements into view.
5. Click elements when policy allows.
6. Focus and fill inputs when policy allows.
7. Ask the user for missing values.
8. Confirm sensitive steps.
9. Pause, resume, cancel, and complete workflows.
10. Send runtime context to the backend.

## 9. MVP Non-Functional Requirements

### 9.1 Reliability

1. SDK must not execute steps outside approved workflows.
2. SDK must fail gracefully if an element is missing.
3. Weak selectors must be visible in the console.
4. Workflow execution must log step-level results.

### 9.2 Developer Experience

1. Local setup should be documented.
2. Environment variables should be centralized.
3. Stubs should be available when external providers are unavailable.
4. Codex should be able to implement modules independently.

### 9.3 Performance

1. Runtime workflow search should feel fast.
2. UI cursor movement should be smooth.
3. Workflow video processing can be async and slower.
4. Local database queries should be simple and indexed by app, route, workflow state, and element id.

### 9.4 Safety

1. Human review is required before workflow publishing.
2. Each step has an execution policy.
3. Runtime agent cannot invent new clicks outside a published workflow.
4. Sensitive steps require confirmation or manual execution.
5. User-provided values should only be filled into approved fields.

## 10. User Stories

### Developer Stories

#### Story 1: Upload a Workflow Video

As a developer, I want to upload a workflow video so the system can generate a workflow draft.

Acceptance criteria:

1. Developer can upload a video file.
2. Console shows upload progress or success.
3. Backend creates a workflow job.
4. Job status becomes `analyzing`.
5. When complete, workflow status becomes `needs_review`.

#### Story 2: Review a Generated Workflow

As a developer, I want to review generated steps before publishing so users do not receive unsafe or broken workflows.

Acceptance criteria:

1. Console lists all generated steps.
2. Each step shows target element and selector.
3. Reviewer can edit step fields.
4. Reviewer can set execution policy.
5. Reviewer can publish workflow.

#### Story 3: Improve Weak Selectors

As a developer, I want to see weak selectors and recommended `data-ai-id` attributes so workflows become more reliable.

Acceptance criteria:

1. Console shows selector quality per element.
2. Weak elements have recommendations.
3. Recommendation includes exact attribute to add.
4. Element record remains usable with fallback selector.

### End-User Stories

#### Story 4: Ask for a Workflow

As an end user, I want to say “Help me create a new customer” so the agent can guide me through it.

Acceptance criteria:

1. SDK captures voice.
2. Backend identifies the workflow.
3. Assistant speaks a response.
4. Cursor starts workflow execution.
5. User can pause or cancel.

#### Story 5: Provide Required Input

As an end user, I want the assistant to ask for missing information so I do not need to know which field comes next.

Acceptance criteria:

1. SDK pauses on `ask_user`.
2. Assistant asks the configured prompt.
3. User response is captured.
4. Value is stored in workflow runtime state.
5. Later fill step uses the value.

#### Story 6: Confirm Sensitive Step

As an end user, I want to confirm sensitive actions before the SDK performs them.

Acceptance criteria:

1. Step with `requires_confirmation` asks for confirmation.
2. User can approve or deny.
3. SDK only executes after approval.
4. Denial stops or skips based on workflow config.

## 11. Success Metrics for MVP

For the MVP, success means:

1. UI map is generated for the example app.
2. At least 2 workflows are uploaded, generated, reviewed, and published.
3. Voice instruction triggers a published workflow.
4. The Mia Shadow Cursor visibly guides the user.
5. At least one workflow asks for user input.
6. At least one workflow includes confirmation.
7. The assistant responds with spoken output.
8. Console shows the generated workflow JSON and selector mappings.

## 12. Recommended Example Workflows

Implement at least two:

### Workflow A: Create Customer

1. Navigate to Customers.
2. Click New Customer.
3. Ask for customer name.
4. Fill customer name.
5. Ask for email.
6. Fill email.
7. Confirm save.
8. Click Save Customer.

### Workflow B: Invite Teammate

1. Navigate to Settings or Team.
2. Click Invite Teammate.
3. Ask for teammate email.
4. Fill email.
5. Confirm invite.
6. Click Send Invite.

Optional third workflow:

### Workflow C: Generate Report

1. Navigate to Reports.
2. Select report type.
3. Choose date range.
4. Click Generate.
5. Highlight generated report area.

## 13. Risks

| Risk | Mitigation |
|---|---|
| Qwen output is noisy | Use keyframe extraction, strict prompt, JSON validation, and human review. |
| Element matching fails | Use Moss plus page/route filters and manual correction in console. |
| Selectors break | Use `data-ai-id` recommendations and selector quality scoring. |
| Voice integration takes too long | Use Moss Voice Agents for realtime voice and keep backend responsible for token minting plus safe runtime resolution. |
| Moss voice setup slows MVP | Keep voice configuration explicit and fail clearly when Moss voice agent credentials are missing. |
| Moss integration uncertain | Keep Moss behind an adapter and fail clearly when credentials are missing. |
| Qwen integration uncertain | Keep Qwen behind a model gateway adapter and validate every model response. |

## 14. Open Questions

These are not blockers for MVP but should be tracked:

1. Which exact Qwen model endpoint will be used for video/keyframe understanding?
2. Which Moss voice agent will be used for the local demo app?
3. Should optional backend TTS remain available for non-voice text responses?
4. Will the UI mapper require authentication state for protected example app pages?
5. Will workflow videos include narration, or only screen recording?
6. Will users be allowed to upload multiple videos for the same workflow?
7. Will workflow publishing require a separate `approved` then `published` step?
