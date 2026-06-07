# Implementation Plan for Codex

## 1. Goal

Implement a local MVP of the AI Onboarding Agent.

The system should support:

1. Example app integration harness.
2. Console.
3. Backend.
4. Shared types.
5. UI mapper.
6. Workflow video upload.
7. Mock or real Qwen pipeline.
8. Mock or real Moss indexing/search.
9. Human workflow review.
10. SDK with AI cursor execution.
11. Runtime voice path with LiveKit adapter and TTS adapter.

## 2. Recommended Monorepo Structure

```text
ai-onboarding-agent/
  package.json
  pnpm-workspace.yaml
  turbo.json
  .env.example
  README.md

  examples/
    example-app/
    console/
    backend/

  packages/
    shared/
    sdk/
    mapper/
    adapters/
      qwen/
      moss/
      truefoundry/
      livekit/
      tts/
      stt/

  data/
    uploads/
    tts/
    sqlite/

  docs/
```

## 3. Tech Stack Recommendation

Use TypeScript across the project.

Suggested stack:

```text
Monorepo: pnpm workspaces
Frontend: React + Vite
Backend: Node.js + Fastify
DB: SQLite
ORM/query: Drizzle or simple SQL wrapper
Validation: Zod
Mapper: Playwright
SDK: TypeScript package
Testing: Vitest
```

If project already has different preferences, keep the docs semantics but adapt implementation.

## 4. Build Order

## Phase 0: Bootstrap

Tasks:

1. Create monorepo.
2. Add TypeScript config.
3. Add lint/test scripts.
4. Add `.env.example`.
5. Add shared package.
6. Add backend, console, and sdk packages; include the example app fixture if needed for validation.

Acceptance:

1. `pnpm install` works.
2. `pnpm dev` starts backend, console, and the example app if included.
3. `pnpm test` runs.

## Phase 1: Shared Types and Schemas

Implement in `packages/shared`.

Files:

```text
packages/shared/src/types/app.ts
packages/shared/src/types/ui-map.ts
packages/shared/src/types/workflow.ts
packages/shared/src/types/runtime.ts
packages/shared/src/types/api.ts
packages/shared/src/schemas/workflow.schema.ts
packages/shared/src/schemas/ui-map.schema.ts
```

Tasks:

1. Define all types from `04_DATA_MODELS_AND_WORKFLOW_DSL.md`.
2. Define Zod schemas.
3. Export types.
4. Add validation tests.

Acceptance:

1. Workflow example validates.
2. Invalid workflow fails.
3. Shared package builds.

## Phase 2: Backend Foundation

Implement:

```text
apps/backend/src/app.ts
apps/backend/src/config.ts
apps/backend/src/db/
apps/backend/src/routes/
apps/backend/src/services/
apps/backend/src/adapters/
```

Tasks:

1. Fastify server.
2. Health endpoint.
3. SQLite setup.
4. Database migrations.
5. App CRUD endpoints.
6. Local file storage helper.
7. Error handling.

Acceptance:

1. `GET /api/v1/health` returns ok.
2. App can be created/listed.
3. DB file is created locally.

## Phase 3: Example App Harness

Implement a simple sample app used to validate the product.

Routes:

```text
/login
/dashboard
/customers
/customers/new
/settings/team
/reports
```

Add stable attributes:

```text
data-ai-id="login.email_input"
data-ai-id="login.password_input"
data-ai-id="login.login_button"
data-ai-id="customers.new_customer_button"
data-ai-id="customers.customer_name_input"
data-ai-id="customers.customer_email_input"
data-ai-id="customers.save_customer_button"
data-ai-id="settings.invite_teammate_button"
data-ai-id="settings.invite_email_input"
data-ai-id="settings.send_invite_button"
```

Acceptance:

1. App runs.
2. Routes are accessible.
3. Key elements exist.

## Phase 4: UI Mapper

Implement `packages/mapper`.

Tasks:

1. Use Playwright to scan configured routes.
2. Extract interactive elements.
3. Generate selectors.
4. Score selector quality.
5. Generate descriptions.
6. Save UI map through backend API or direct service.
7. Index records in mock Moss adapter.

Acceptance:

1. Scan example app routes.
2. Store pages and elements.
3. Console can list them.
4. Weak selector warnings are generated if attributes missing.

## Phase 5: Moss Adapter

Implement interface and mock first.

```ts
SemanticSearchAdapter
```

Mock search:

1. Store records in memory or SQLite table.
2. Tokenize searchable text.
3. Return approximate keyword matches.
4. Same API as real Moss adapter.

Acceptance:

1. UI elements are indexed.
2. Search for “new customer button” returns expected element.
3. Workflow records can be indexed and found.

## Phase 6: Console UI Map Screens

Implement:

1. Overview page.
2. UI map scan page.
3. Page elements table.
4. Selector quality badges.
5. Element description editing.

Acceptance:

1. Developer can trigger scan.
2. Developer can browse UI elements.
3. Developer can see selector quality.

## Phase 7: Workflow Video Upload

Implement backend endpoints:

1. Upload video.
2. Create workflow job.
3. List jobs.
4. Get job status.
5. Process job.

Use local file storage.

Acceptance:

1. Video uploads to `data/uploads`.
2. Job is created.
3. Job can be processed.

## Phase 8: Qwen / Mock Qwen Pipeline

Implement:

```ts
VideoUnderstandingAdapter
```

Start with mock:

1. For a filename containing `customer`, return Create Customer timeline.
2. For a filename containing `invite`, return Invite Teammate timeline.
3. Otherwise return generic timeline.

Then integrate real Qwen behind TrueFoundry if API keys are available.

Acceptance:

1. Processing job produces extracted action timeline.
2. Raw output is stored.
3. Invalid output is handled.

## Phase 9: Action Matching and Workflow Compilation

Implement:

1. Convert Qwen steps to Moss queries.
2. Match to UI elements.
3. Build workflow DSL.
4. Add `ask_user` before `fill` steps.
5. Add default execution policies.
6. Mark workflow as `needs_review`.

Acceptance:

1. Create Customer video produces draft workflow.
2. Steps reference UI element IDs/selectors.
3. Unmatched steps are marked for review.

## Phase 10: Workflow Review Console

Implement:

1. Workflow list.
2. Review page.
3. Step cards.
4. Step editing.
5. Element picker.
6. Execution policy selector.
7. Approve/publish buttons.
8. Validation errors.

Acceptance:

1. Developer can edit generated workflow.
2. Developer can approve/publish.
3. Published workflow is indexed in Moss.

## Phase 11: SDK Core

Implement SDK:

1. Init API.
2. Floating assistant UI.
3. Text command fallback.
4. Runtime context collection.
5. Backend client.
6. Workflow executor.
7. AI cursor overlay.
8. Highlighting.
9. Step handlers.

Acceptance:

1. SDK initializes in the example app.
2. Text command resolves workflow.
3. Cursor can click/focus/fill elements.
4. Step logs are sent.

## Phase 12: Runtime Intent Resolution

Backend:

1. `/runtime/resolve`.
2. Mock intent classifier.
3. Moss workflow search.
4. Return published workflow.

Acceptance:

1. “Help me create a new customer” resolves workflow.
2. No-match response works.
3. Answer response can be stubbed.

## Phase 13: TTS

Implement TTS adapter.

Start mock:

1. Generate local placeholder audio or return known audio file.
2. Return audio URL.

Then connect Qwen Voice if available.

Acceptance:

1. Backend returns TTS info.
2. SDK plays audio or gracefully shows text if autoplay blocked.
3. TTS is called for workflow start, prompts, confirmations, completion.

## Phase 14: LiveKit Voice

Implement LiveKit adapter.

MVP can include:

1. Token endpoint.
2. SDK LiveKit client wrapper.
3. Push-to-talk UI.
4. Fallback to text input if unavailable.

Acceptance:

1. Voice UI exists.
2. Token endpoint works.
3. Spoken/text input can trigger runtime resolution.
4. TTS output is heard.

## Phase 15: End-to-End Validation

Required validation:

1. Start backend.
2. Start console.
3. Start the example app.
4. Scan UI map.
5. Upload Create Customer workflow video.
6. Generate workflow.
7. Review and publish.
8. Open the example app.
9. Ask agent to create customer.
10. Agent speaks and AI cursor executes workflow.
11. User provides customer name/email.
12. Agent confirms save and completes.

## 5. Environment Variables

`.env.example`:

```text
NODE_ENV=development

BACKEND_PORT=4000
CONSOLE_PORT=3001
EXAMPLE_APP_PORT=3000

DATABASE_URL=file:./data/sqlite/local.db
LOCAL_UPLOAD_DIR=./data/uploads
LOCAL_TTS_DIR=./data/tts

APP_ID=app_example_app
APP_BASE_URL=http://localhost:3000

TRUEFOUNDRY_API_KEY=
TRUEFOUNDRY_BASE_URL=

QWEN_API_KEY=
QWEN_MODEL=
QWEN_VOICE_MODEL=

MOSS_API_KEY=
MOSS_BASE_URL=

LIVEKIT_URL=
LIVEKIT_API_KEY=
LIVEKIT_API_SECRET=

STT_PROVIDER=mock
TTS_PROVIDER=mock
SEMANTIC_SEARCH_PROVIDER=mock
VIDEO_UNDERSTANDING_PROVIDER=mock
```

## 6. Implementation Guardrails

Codex must not:

1. Add AWS/cloud infrastructure.
2. Allow arbitrary unapproved clicks.
3. Store only embeddings without structured DB records.
4. Hardcode external providers into business logic.
5. Skip human review.
6. Execute Qwen output directly.
7. Require `data-ai-id` for every element on day one.
8. Remove TTS from MVP.

Codex should:

1. Implement stubs first.
2. Keep interfaces clean.
3. Add tests.
4. Make validation deterministic.
5. Keep local setup simple.
