# Architecture and Product Decisions

This document records the main decisions for the MVP.

## Decision Summary

| Area | Decision |
|---|---|
| Product setup | Local product development only for MVP. |
| Cloud infrastructure | Excluded from MVP. No AWS integration. |
| Video understanding | Qwen is the primary multimodal model. |
| MiniMax | Optional experiment only. Not required for MVP. |
| Runtime voice | LiveKit + STT + runtime LLM + workflow search + SDK execution + TTS. |
| TTS | Required for MVP. Qwen Voice can provide natural speech output. |
| Workflow format | Strict JSON workflow DSL. |
| UI mapping | Runtime browser scan. |
| Element descriptions | Hybrid rule-based + LLM-generated descriptions. Human editable. |
| Semantic search | Moss indexes UI element descriptions and workflows. |
| Source of truth | Local database stores full UI map and workflows. Moss is not source of truth. |
| Selectors | Fallback selectors first; recommend `data-ai-id` / `data-testid`. |
| Execution safety | Execution policy is decided during workflow review and save. |
| Human review | Required before publishing workflows. |
| Runtime execution | SDK executes only reviewed and published workflows. |

## 1. Video Understanding Model

### Decision

Use **Qwen** as the primary multimodal model for workflow video understanding.

### Reasoning

The product needs a model that can inspect workflow videos or extracted frames and produce a rough sequence of UI actions. Qwen is the chosen primary provider for this role.

### Implementation Rule

Qwen output must never be executed directly.

Qwen output is only an interpreted action timeline. It must be:

1. Parsed.
2. Validated.
3. Matched to UI map elements.
4. Compiled into workflow JSON.
5. Reviewed by a human.
6. Published before runtime execution.

### Final Flow

```text
Uploaded workflow video
→ Qwen analyzes the video or keyframes
→ Qwen outputs rough workflow actions
→ Moss matches actions to UI map elements
→ Backend generates structured workflow JSON
→ Human reviews and approves the workflow
→ SDK executes the approved workflow
```

### MiniMax Decision

MiniMax is optional.

Use MiniMax only as an experiment or fallback after the core pipeline works.

## 2. Runtime Voice

### Decision

Do not use one omni model for everything.

Use a modular voice pipeline:

```text
LiveKit → STT → Runtime LLM → Moss workflow search → SDK execution → TTS
```

### Rationale

A modular pipeline is easier to debug and safer:

1. LiveKit handles realtime session transport.
2. STT converts speech to text.
3. Runtime LLM classifies intent and chooses the next backend action.
4. Moss retrieves workflows and UI elements.
5. SDK executes approved workflow steps.
6. TTS speaks responses.

### TTS Decision

TTS is required for MVP.

The assistant should respond with spoken output, not only text. Qwen Voice is the preferred TTS candidate, but code must abstract TTS behind an adapter so the implementation can swap providers.

## 3. Workflow Format

### Decision

Store workflows as strict JSON DSL.

### Rationale

Plain text instructions are too ambiguous for execution. JSON workflows are:

1. Reviewable.
2. Validatable.
3. Deterministic.
4. Executable by SDK.
5. Testable.
6. Versionable.

### Required Step Types for MVP

```text
navigate
click
focus
fill
select
ask_user
wait_for_element
confirm
complete
```

### Advanced Step Types Deferred

```text
branch
loop
retry
api_call
assert_state
handoff_to_support
```

## 4. UI Mapping and Element Descriptions

### Decision

Use runtime browser scan for MVP.

### Rationale

Runtime scan sees the actual rendered UI, including labels, accessibility tree, current DOM structure, forms, and modals.

Static code scanning is deferred.

### Element Description Strategy

Use a hybrid approach:

1. Generate a basic description from deterministic fields.
2. Use LLM enhancement only when description is weak.
3. Let human reviewer edit description in console.
4. Store final description in local database.
5. Index searchable version in Moss.

### Source-of-Truth Rule

Local database is the source of truth.

Moss is a retrieval index.

Never store only embeddings.

## 5. Selector Strategy

### Decision

Support existing apps without requiring attributes immediately.

Use two modes:

1. Fallback selector mode.
2. Stable attribute upgrade mode.

### Selector Priority

```text
1. data-ai-id
2. data-testid
3. role + accessible name
4. aria-label
5. label/input association
6. name
7. id
8. placeholder
9. visible text
10. CSS selector
11. DOM path as last resort
```

### Recommended Stable Attribute

Prefer:

```html
data-ai-id="customers.new_customer_button"
```

Allow:

```html
data-testid="customers.new_customer_button"
```

### Existing Application Adoption

Existing SaaS apps adopt in stages:

1. Install SDK.
2. Run mapper.
3. Use fallback selectors.
4. Console shows weak selector warnings.
5. Developer adds recommended `data-ai-id` attributes.
6. Mapper rescans and improves selector quality.

## 6. Execution Safety

### Decision

Execution safety is decided during workflow upload, review, and save.

The generated workflow step contains an `execution_policy`.

The human reviewer approves or changes this policy.

### Execution Policies

```text
auto
requires_confirmation
manual_only
blocked
```

### Runtime Rule

The runtime agent must not independently decide to click anything outside a published workflow.

The SDK can execute only saved workflow steps.

## 7. Human Review

### Decision

Human review is required before generated workflows become available to end users.

### Workflow States

```text
uploaded
analyzing
mapped
needs_review
approved
published
failed
```

### Reviewable Fields

The console must allow editing:

1. Workflow name.
2. Description.
3. Trigger phrases.
4. Step type.
5. Target UI element.
6. Selector.
7. Prompt text.
8. Required field name.
9. Execution policy.
10. Notes or confidence metadata.

## 8. Local Setup

### Decision

The MVP runs locally.

### Local Components

```text
Example app frontend
Console frontend
Local backend
Local database
Local file storage
Moss semantic index
LiveKit dev setup
TrueFoundry model gateway
Qwen model API
Frontend SDK
```

### Clarification

Local setup means the product, backend, storage, and example app run locally.

External model APIs are still allowed during development through TrueFoundry.

If full offline AI is required later, model choices must be revisited.

## 9. Adapter Decision

All external products must be behind interfaces.

Required adapters:

1. `ModelGatewayAdapter`
2. `VideoUnderstandingAdapter`
3. `SemanticSearchAdapter`
4. `VoiceTransportAdapter`
5. `SpeechToTextAdapter`
6. `TextToSpeechAdapter`
7. `FileStorageAdapter`

This lets Codex implement local stubs first and real integrations later.

## 10. Coding Decision

Use shared TypeScript types for:

1. Workflow DSL.
2. UI map.
3. Element records.
4. Runtime context.
5. SDK events.
6. API request/response types.
7. Execution policies.
8. Workflow statuses.

Recommended monorepo language: TypeScript.

Recommended backend: Node.js with Fastify or Express.

Recommended local DB: SQLite.

Recommended frontend: React.

Recommended browser automation: Playwright.
