# Mia

[![CI](https://github.com/Sricharan07/mia-onboarding-agent/actions/workflows/ci.yml/badge.svg)](https://github.com/Sricharan07/mia-onboarding-agent/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-1f6f50.svg)](LICENSE)

Mia is a self-hosted, embedded product agent. Users can ask questions by text or voice, see Mia point at the live interface, navigate with her, and approve reversible work that she performs for them.

Version `1.0.0` is intentionally one product, one production origin, one administrator, and one Gemini-powered agent. It has no classifier router, fixed workflow executor, multi-tenant compatibility layer, or arbitrary browser control.

## What Mia Does

- Answers from the current product UI, approved documentation, live host context, UI maps, and published skills.
- Observes accessibility semantics and the live DOM, including open shadow roots and same-origin frames.
- Points, highlights, hovers, scrolls, navigates, focuses, clicks, fills, clears, selects, toggles, and presses supported keys.
- Invokes reviewed host actions for reliable product mutations and verifies every result through UI state or structured receipts.
- Uses one persisted observe-reason-act-verify session for text and Gemini Live voice.
- Supports open microphone, interruption, reconnection, and hold `Control+Space` push-to-talk with the feminine `Aoede` voice by default.
- Stops safely on cancellation, repeated failures, loops, stale targets, invalid model output, or unverified outcomes.

Mia never moves the user's physical pointer. The SDK renders a separate visible cursor that scrolls to and follows validated product targets.

## Safety Boundary

Gemini decides what would help; deterministic code decides what is allowed and whether it worked.

| Operation | v1 behavior |
| --- | --- |
| Answer, explain, point, highlight, hover, scroll, focus | Allowed when grounded in supplied product context |
| Approved same-origin navigation | Exact path/query/fragment is verified and re-observed after navigation |
| Click, fill, clear, select, toggle, reversible host action | Requires an exact confirmation naming the change and target |
| Passwords, payment details, CAPTCHA, WebAuthn, file pickers | Manual only |
| Delete, send, publish, approve, pay, purchase, transfer, externally communicate, irreversible submit | Blocked before execution |

The model cannot invent selectors, run arbitrary JavaScript, call unregistered actions, or bypass confirmation. Runtime targets must be present in the current semantic observation or reviewed UI map. Host action inputs are checked against JSON Schema and every mutation receives an idempotency key.

## Architecture

```mermaid
flowchart LR
    subgraph Product["Customer product"]
        User["Product user"]
        SDK["Mia browser SDK"]
        UI["Live DOM and accessibility tree"]
        Host["Trusted host backend"]
        Actions["Reviewed host actions"]
        User <--> SDK
        SDK <--> UI
        SDK --> Actions
        Host -->|"short-lived runtime token"| SDK
    end

    subgraph Deployment["Self-hosted Mia deployment"]
        Console["Mia Console"]
        API["Fastify agent API"]
        Agent["Observe-reason-act-verify loop"]
        Scanner["Playwright UI scanner"]
        DB[("PostgreSQL + pgvector")]
        Files[("Persistent uploads")]
        Console <--> API
        API <--> Agent
        API <--> Scanner
        API <--> DB
        API <--> Files
    end

    Host -->|"server integration key"| API
    SDK <--> API
    Agent <--> Gemini["Gemini planning, embeddings, and Live voice"]
    Scanner --> Product
```

PostgreSQL stores product configuration, sessions, revisions, confirmations, receipts, diagnostics, knowledge metadata, full-text indexes, and `pgvector` embeddings. Uploaded documents and recordings live on a configured persistent volume.

## Requirements

- Node.js 22 or newer and npm 10 or newer for source development.
- Docker with Compose for the supported self-hosted deployment.
- PostgreSQL 17 with the `vector` extension when running outside Compose.
- A Gemini API key configured in the console or backend environment.
- An HTTPS product origin in production. Localhost HTTP is accepted for development.

## Quick Start With Docker

Create configuration and generate three independent secrets:

```bash
cp .env.example .env
openssl rand -hex 32
openssl rand -hex 32
openssl rand -hex 32
```

Put the values in `.env` as `POSTGRES_PASSWORD`, `MIA_SECRET_ENCRYPTION_KEY`, and `SETUP_TOKEN`. Set `CORS_ORIGIN` to the Mia console origin and the exact host-product origin, then start an empty deployment:

```bash
docker compose up --build -d
curl http://localhost:4000/api/v1/ready
```

Open [http://localhost:4000](http://localhost:4000). First-run setup asks for the setup token, product name and origin, administrator identity, and a password of at least 12 characters. No default account or password exists.

Compose creates:

- `mia-postgres` for PostgreSQL and pgvector data.
- `mia-uploads` for uploaded documents and recordings.
- A non-root Mia backend that also serves the compiled console.

Read [Production deployment](docs/production.md) and [Database operations](docs/database.md) before exposing Mia publicly.

## Configure The Product

The console has eight workflows, in deployment order:

1. **Setup**: finish product, Gemini, runtime key, knowledge, UI map, SDK, safety review, and live validation checks.
2. **Overview**: monitor readiness, agent activity, usage, and the next operational task.
3. **Knowledge**: crawl approved HTTPS documentation, upload Markdown/text/PDF files, and scan product routes.
4. **Skills**: turn MP4/MOV/WebM video or MP3/WAV/M4A/WebM audio recordings into editable, reviewed agent guidance and publish only approved skills.
5. **Actions & Safety**: review SDK-detected host actions, JSON schemas, risks, and effective policy.
6. **Test Mia**: prove Q&A, pointing, navigation, confirmed mutation, and voice against the live SDK.
7. **Runs**: inspect transcripts, model assessments, retrieved sources, directives, approvals, receipts, retries, timing, tokens, and errors.
8. **Settings**: manage the product origin, redaction, Gemini credential, scan access, transcript policy, runtime keys, voice, and administrator password.

Changing the product origin revokes existing runtime keys and tokens so credentials cannot silently remain valid for another site.

## Install The SDK

The repository prepares `@mia/onboarding-agent@1.0.0` as an ESM package. Until it is published to npm, create and install the exact release tarball:

```bash
npm ci
npm pack --workspace sdk
npm install /absolute/path/to/mia-onboarding-agent-1.0.0.tgz
```

Create a runtime integration key in **Settings**, keep it on the trusted host backend, and exchange it for short-lived browser tokens through `POST /api/v1/runtime/tokens`.

```ts
import { Mia, defineMiaAction } from "@mia/onboarding-agent";

const createDraftLead = defineMiaAction({
  name: "create_draft_lead",
  description: "Create a reversible lead draft without sending it.",
  inputSchema: {
    type: "object",
    additionalProperties: false,
    properties: { name: { type: "string", minLength: 1 } },
    required: ["name"]
  },
  risk: "reversible_write",
  effect: "draft_create",
  async execute(input, { signal, idempotencyKey }) {
    const response = await fetch("/api/leads/drafts", {
      method: "POST",
      signal,
      headers: { "content-type": "application/json", "idempotency-key": idempotencyKey },
      body: JSON.stringify(input)
    });
    if (!response.ok) return { status: "failed", message: "The draft was not created." };
    const draft = await response.json();
    return { status: "completed", message: "Draft created.", evidence: { draftId: draft.id } };
  }
});

const mia = await Mia.init({
  backendUrl: "https://mia.example.com",
  tokenProvider: async () => {
    const response = await fetch("/api/mia/runtime-token", { method: "POST" });
    if (!response.ok) throw new Error("Unable to start Mia");
    return response.json();
  },
  navigate: (route) => router.push(route),
  voice: { enabled: true, voice: "Aoede", openMic: true, pushToTalk: true },
  actions: [createDraftLead],
  privacy: { redactedSelectors: ["[data-private]", ".payment-details"] }
});
```

See the [SDK guide](docs/sdk.md), [SDK API README](sdk/README.md), and [working CRM integration](example/demo-crm+sdk/README.md).

## Develop From Source

Start a PostgreSQL instance with pgvector, create an empty database whose name contains `test` for integration tests, and configure the local URLs:

```bash
npm ci
npm ci --prefix backend/console
npm ci --prefix example/demo-crm+sdk
cp .env.example .env
```

For local development, set `DATABASE_URL`, use `NODE_ENV=development`, and start each surface in its own terminal:

```bash
npm run dev:backend
npm run dev:console
npm --prefix example/demo-crm+sdk run dev
```

The default ports are backend/console `4000`, Vite console `5173`, and demo `3000`.

## Verification

```bash
MIA_TEST_DATABASE_URL=postgres://mia:password@127.0.0.1:5432/mia_test npm run verify
npm run audit:all
docker compose config
```

`verify` runs the PostgreSQL backend suite, SDK browser-unit suite, demo source check, all production builds, dependency audit, and SDK package-content check. CI also boots Docker from empty PostgreSQL and upload volumes, performs secure first-run setup, and verifies the bundled console.

`npm run benchmark:agent` exercises the built SDK in the demo across Q&A, pointing, navigation, draft creation/editing, field filling, filter selection, reload recovery, and protected refusal. `npm run acceptance:browsers` validates Chrome, Edge, Firefox, and WebKit with WCAG 2.2 AA checks, while the separate macOS gate drives real Safari. `npm run acceptance:voice` feeds real spoken microphone fixtures through Gemini Live and proves text/voice policy parity, exact trusted speech, cursor geometry, and a bound voice-approved draft action. The `Release Acceptance` workflow creates a fresh database, builds and starts the current commit, generates one-run credentials, indexes the current demo, reviews its typed actions, and makes every gate mandatory.

## Repository

```text
backend/               Fastify API, agent loop, PostgreSQL repositories, scanner
backend/console/       Single-product administrator console
sdk/                   Framework-neutral ESM browser SDK
example/demo-crm+sdk/  Next.js CRM with real host actions and Mia installed
docs/                  API, operations, integration, security, and release guides
```

## Documentation

- [Production deployment](docs/production.md)
- [SDK integration](docs/sdk.md)
- [HTTP API](docs/api.md)
- [Security model](docs/security.md)
- [Database operations](docs/database.md)
- [Troubleshooting](docs/troubleshooting.md)
- [Release process](docs/releasing.md)
- [Contributing](CONTRIBUTING.md)
- [Security policy](SECURITY.md)
- [Third-party notices](THIRD_PARTY_NOTICES.md)

## License

Mia is available under the [MIT License](LICENSE). Bundled and adapted third-party work is listed in [Third-party notices](THIRD_PARTY_NOTICES.md).
