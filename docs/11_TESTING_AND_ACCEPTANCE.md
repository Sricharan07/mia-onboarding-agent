# Testing and Acceptance Plan

## 1. Testing Goals

The MVP must prove that the complete workflow works locally:

```text
UI map → video upload → Qwen extraction → Moss matching → workflow review → publish → voice/text trigger → SDK cursor execution → TTS response
```

## 2. Unit Tests

## 2.1 Shared Schemas

Test:

1. Valid workflow passes.
2. Missing name fails.
3. Empty steps fail.
4. `fill` without `valueFrom` fails.
5. Invalid execution policy fails.
6. Duplicate step ids fail.

## 2.2 Selector Generation

Test:

1. `data-ai-id` selector is preferred.
2. `data-testid` is second.
3. Accessible role/name fallback works.
4. Weak CSS selector gets weak quality.
5. Duplicate label creates warning.
6. Dynamic id creates warning.

## 2.3 Description Generation

Test:

1. Button description template.
2. Input description template.
3. Nearby text included where useful.
4. Empty label produces generic but safe description.
5. LLM description handles provider errors clearly.

## 2.4 Moss Search

Test:

1. Indexed element can be found by label.
2. Indexed element can be found by description.
3. Route filter works.
4. Element type filter works.
5. Workflow trigger phrase search works.

## 2.5 Workflow Compiler

Test:

1. Click action becomes click step.
2. Fill action becomes ask_user + fill steps.
3. Unmatched step is marked.
4. Execution policies are assigned.
5. Workflow validates after compilation.

## 2.6 SDK Executor

Test:

1. Steps execute in order.
2. Missing element stops execution.
3. Fallback selectors are attempted.
4. `auto` click performs click.
5. `requires_confirmation` asks before click.
6. `manual_only` highlights but does not click.
7. `blocked` does not execute.
8. Fill dispatches input/change events.
9. Ask user stores value.

## 3. Integration Tests

## 3.1 UI Mapping Integration

Scenario:

1. Start the example app.
2. Run mapper.
3. Verify pages stored.
4. Verify elements stored.
5. Verify Moss records created.

Acceptance:

1. At least 5 pages mapped.
2. At least 10 elements mapped.
3. Key elements have strong selectors.
4. Descriptions are non-empty.

## 3.2 Workflow Processing Integration

Scenario:

1. Upload Create Customer workflow video.
2. Process job with Qwen.
3. Match actions using Moss.
4. Compile workflow.
5. Mark as `needs_review`.

Acceptance:

1. Job completes.
2. Workflow has steps.
3. Workflow includes `ask_user` steps.
4. Workflow includes selectors.
5. Workflow can be opened in review UI.

## 3.3 Review and Publish Integration

Scenario:

1. Open generated workflow.
2. Edit trigger phrase.
3. Change execution policy.
4. Approve workflow.
5. Publish workflow.
6. Search workflow by trigger phrase.

Acceptance:

1. Status becomes `published`.
2. Moss workflow index includes it.
3. Runtime resolve finds it.

## 3.4 Runtime Execution Integration

Scenario:

1. Open the example app.
2. Initialize SDK.
3. Enter text command or voice command.
4. Backend resolves workflow.
5. SDK executes workflow.

Acceptance:

1. Cursor moves.
2. Target elements highlight.
3. Inputs are filled.
4. Confirmation appears.
5. Workflow completes.
6. Logs are stored.

## 4. End-to-End Validation Script

## 4.1 Preparation

1. Start backend.
2. Start console.
3. Start the example app.
4. Ensure env values exist.
5. Ensure the example app has stable `data-ai-id` attributes.

## 4.2 UI Mapping Validation

1. Open console.
2. Go to UI Map.
3. Click Scan.
4. Show mapped pages.
5. Open Customers page detail.
6. Show New Customer button record.
7. Show selector and description.

Expected result:

```text
customers.new_customer_button
Selector quality: strong
Description: Opens the customer creation form from the Customers page.
```

## 4.3 Workflow Upload Validation

1. Go to Upload Workflow.
2. Upload Create Customer video.
3. Start processing.
4. Show job status moving to analyzing, mapped, needs_review.
5. Open review page.

Expected result:

1. Qwen generated action timeline.
2. Moss matched New Customer button.
3. Workflow JSON generated.

## 4.4 Human Review Validation

1. Review step cards.
2. Show execution policy.
3. Edit a prompt.
4. Approve.
5. Publish.

Expected result:

```text
Workflow status: published
```

## 4.5 Runtime SDK Validation

1. Open the example app dashboard.
2. Click assistant.
3. Say or type: “Help me create a new customer.”
4. Assistant speaks: “I can help you create a new customer. Let's start.”
5. Cursor navigates to Customers.
6. Cursor clicks New Customer.
7. Assistant asks for customer name.
8. User enters name.
9. Assistant asks for email.
10. User enters email.
11. Assistant asks confirmation.
12. User confirms.
13. Cursor clicks Save.
14. Assistant says workflow complete.

## 5. Acceptance Criteria by Component

## 5.1 Backend

Passes if:

1. Health endpoint works.
2. DB initializes.
3. Apps can be created.
4. UI map endpoints work.
5. Video upload works.
6. Workflow job processing works with Qwen.
7. Workflows can be reviewed/published.
8. Runtime resolve works.
9. TTS endpoint returns playable audio.

## 5.2 Console

Passes if:

1. Shows overview.
2. Triggers UI scan.
3. Lists UI elements.
4. Uploads video.
5. Shows job status.
6. Reviews workflow.
7. Publishes workflow.
8. Shows logs.

## 5.3 SDK

Passes if:

1. Initializes in the example app.
2. Renders assistant button.
3. Captures text/voice command.
4. Calls backend resolve.
5. Executes workflow.
6. Shows cursor.
7. Highlights elements.
8. Asks for input.
9. Confirms sensitive actions.
10. Logs events.

## 5.4 Mapper

Passes if:

1. Scans routes.
2. Extracts interactive elements.
3. Generates selectors.
4. Scores selectors.
5. Generates descriptions.
6. Stores DB records.
7. Indexes Moss records.

## 6. Manual QA Checklist

Before validation:

- [ ] Backend starts.
- [ ] Console starts.
- [ ] Example app starts.
- [ ] SDK visible in the example app.
- [ ] UI scan completes.
- [ ] Create Customer workflow is published.
- [ ] Invite Teammate workflow is published.
- [ ] Runtime search finds workflows.
- [ ] TTS response plays.
- [ ] Cursor overlay visible.
- [ ] Fill events update React state.
- [ ] Confirmation dialog works.
- [ ] Logs appear in console.

## 7. Known MVP Limitations

Acceptable for MVP:

1. Mock providers are allowed.
2. Voice can have text fallback.
3. Route list can be manual.
4. Video processing can be triggered manually.
5. Only the example app harness is supported.
6. Workflows can be simple linear flows.
7. UI mapper can miss hidden modals unless route or interaction opens them.
8. TTS must use the configured provider and fail clearly if provider credentials are unavailable.
