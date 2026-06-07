# AI Onboarding Agent Documentation Pack

This documentation pack defines the MVP for a local-development AI onboarding agent for SaaS products.

The project turns recorded SaaS workflows into structured, human-reviewed, executable UI workflows. The frontend SDK then runs those workflows inside a sample SaaS application through an AI cursor, voice interface, and selector-based execution engine.

## Intended Consumer

These files are written for:

1. Codex or another coding agent implementing the project.
2. Engineers building the local backend, console, SDK, mapper, and example app integration.
3. Hackathon team members who need a single source of product and technical truth.

## MVP Scope

The MVP runs locally.

It includes:

1. Example app frontend.
2. Console frontend.
3. Local backend.
4. Local database.
5. Local file storage.
6. Runtime UI mapper.
7. Workflow video upload.
8. Qwen-based workflow video understanding.
9. Moss-based semantic search over UI elements and workflows.
10. Human review before publishing workflows.
11. Frontend SDK inside the example app.
12. LiveKit-based runtime voice session.
13. TTS voice output using Qwen Voice or a compatible TTS adapter.
14. AI cursor execution using approved workflow steps.

## Explicit Non-Goals for MVP

The MVP does not include:

1. AWS or cloud infrastructure.
2. Production multi-tenant billing.
3. Full CI/CD integration.
4. Automatic PR creation for selector improvements.
5. Fully offline local AI models.
6. Workflow branching, loops, or complex conditional execution.
7. Executing arbitrary unapproved agent actions.
8. Browser extension support.
9. Mobile support.
10. Enterprise RBAC.

## Recommended Reading Order

1. `01_PRD.md`
2. `02_DECISIONS.md`
3. `03_SYSTEM_ARCHITECTURE.md`
4. `04_DATA_MODELS_AND_WORKFLOW_DSL.md`
5. `05_API_SPEC.md`
6. `06_FRONTEND_SDK_SPEC.md`
7. `07_UI_MAPPER_AND_SELECTOR_STRATEGY.md`
8. `08_AI_PIPELINE_QWEN_MOSS_LIVEKIT.md`
9. `09_CONSOLE_SPEC.md`
10. `10_IMPLEMENTATION_PLAN_FOR_CODEX.md`
11. `11_TESTING_AND_ACCEPTANCE.md`
12. `12_LOCAL_DEV_SETUP.md`
13. `13_SECURITY_AND_SAFETY.md`

## Project Summary

The system has three major phases:

### Phase 1: Teach the Agent

A developer records a product workflow video in the example app and uploads it in the console.

The backend analyzes the video using Qwen, produces a rough action timeline, matches actions against the runtime-generated UI map using Moss, and compiles a structured workflow JSON.

A human reviews the workflow and publishes it.

### Phase 2: Run the Agent

An end user speaks to the assistant inside the example app.

The SDK streams audio through LiveKit. The backend transcribes the request, determines intent, searches Moss for matching workflows, returns the workflow, and the SDK executes it using the AI cursor.

### Phase 3: Keep Workflows Reliable

The UI mapper scans the rendered app and stores stable selectors, fallback selectors, descriptions, and selector quality. Moss indexes searchable descriptions while the local database remains the source of truth.

If selectors are weak, the console recommends adding `data-ai-id` or `data-testid`.

## Terminology

| Term           | Meaning                                                                              |
| -------------- | ------------------------------------------------------------------------------------ |
| Console        | Local web app where developers upload videos, review workflows, and manage config.   |
| Example app    | Sample SaaS app used to demonstrate and validate the SDK.                            |
| SDK            | Frontend package embedded in the SaaS app.                                           |
| AI Cursor      | Visual overlay cursor controlled by the SDK.                                         |
| UI Map         | Structured representation of pages and interactive elements.                         |
| Element Record | One mapped DOM element with metadata, description, selector, and fallback selectors. |
| Workflow DSL   | Strict JSON format representing executable workflows.                                |
| Qwen           | Primary multimodal model for workflow video understanding.                           |
| Moss           | Semantic search index for UI elements and workflows.                                 |
| LiveKit        | Realtime voice/session transport layer.                                              |
| Qwen Voice     | TTS provider for spoken assistant responses.                                         |

## Codex Instruction

When implementing, follow the docs in this order:

1. Create monorepo structure.
2. Implement shared TypeScript schemas first.
3. Implement local backend with real provider adapters.
4. Implement UI mapper and database persistence.
5. Implement console screens.
6. Implement SDK overlay and workflow execution.
7. Implement Qwen/Moss/LiveKit integrations behind interfaces.
8. Add tests for schemas, workflow execution, mapper extraction, and API routes.
