# HTTP API

Mia serves the console at `/` and versioned JSON/SSE APIs under `/api/v1`. The browser SDK should normally use its bundled client instead of calling runtime routes directly.

## Authentication

### Administrator session

`POST /api/v1/setup` and `POST /api/v1/auth/login` return a `mia_admin_...` bearer token. Send it to administrative routes:

```http
Authorization: Bearer mia_admin_...
```

Administrator tokens are stored hashed, expire according to `CONSOLE_SESSION_TTL_SECONDS`, and can be revoked by logout.

### Integration key

An administrator creates a `mia_key_...` integration key. It is returned once and belongs only on the trusted host backend:

```http
x-mia-key: mia_key_...
```

The key is bound to the configured product origin. Changing that origin revokes existing integration keys and runtime tokens.

### Runtime token

The trusted host backend exchanges its integration key for a short-lived `mia_rt_...` token. Browser runtime calls use:

```http
Authorization: Bearer mia_rt_...
Origin: https://app.example.com
```

The backend validates token hash, expiry, use count, exact origin, and required capability. Capabilities are `agent:run`, `events:write`, and `voice:live`.

## Errors And Concurrency

Errors use this envelope:

```json
{
  "error": {
    "code": "SESSION_REVISION_CONFLICT",
    "message": "The agent session changed while the request was running."
  }
}
```

Validation errors return `400`; missing or invalid credentials return `401`; policy/origin failures return `403`; revision and state conflicts return `409`; rate limits return `429` with `Retry-After`; provider failures return a sanitized `502` response.

Every mutable runtime request carries the last observed session `revision`. Clients must serialize work per session and replace their revision with the value returned by the backend.

## Health And Setup

| Method | Route | Authentication | Purpose |
| --- | --- | --- | --- |
| `GET` | `/api/v1/health` | None | Process liveness |
| `GET` | `/api/v1/ready` | None | Database readiness plus setup/Gemini state |
| `GET` | `/api/v1/setup/status` | Optional admin bearer | First-run or current authentication state |
| `POST` | `/api/v1/setup` | Setup token in body | Create the singleton product and administrator |
| `GET` | `/api/v1/setup/checklist` | Admin | Aggregate production-readiness evidence |

First-run setup body:

```json
{
  "setupToken": "high-entropy-deployment-token",
  "productName": "Acme",
  "origin": "https://app.example.com",
  "adminEmail": "owner@example.com",
  "adminName": "Product Owner",
  "password": "at-least-12-characters"
}
```

Setup is transactional and can succeed only once.

## Administrator API

### Authentication and product

- `POST /api/v1/auth/login`
- `POST /api/v1/auth/logout`
- `PUT /api/v1/auth/password`
- `GET /api/v1/product`
- `PATCH /api/v1/product`
- `GET /api/v1/product/gemini`
- `PUT /api/v1/product/gemini`
- `DELETE /api/v1/product/gemini`

Product updates may change name, exact origin, approved documentation origins, redaction selectors, transcript mode (`full`, `redacted`, `disabled`), retention from 1 to 365 days, and English voice configuration.

### Runtime integration keys

- `GET /api/v1/integration-keys`
- `POST /api/v1/integration-keys` with `{ "name": "Production host" }`
- `DELETE /api/v1/integration-keys/:id`

The raw key appears only in the create response. Store it immediately in the host backend's secret manager.

### Knowledge

- `GET /api/v1/knowledge`
- `POST /api/v1/knowledge/urls`
- `POST /api/v1/knowledge/files`
- `POST /api/v1/knowledge/:id/retry`
- `DELETE /api/v1/knowledge/:id`

URL ingestion accepts `{ "name", "url", "maxPages" }`. Documentation must use HTTPS, remain within approved origins, and pass SSRF checks. File ingestion is multipart with one Markdown, text, or PDF document and optional `name` field. Delete archives the source and removes it from retrieval.

### Recordings and skills

- `GET /api/v1/recordings`
- `POST /api/v1/recordings`
- `POST /api/v1/recordings/:id/retry`
- `GET /api/v1/skills`
- `PATCH /api/v1/skills/:id`
- `POST /api/v1/skills/:id/publish`
- `POST /api/v1/skills/:id/archive`

Recording upload is multipart and produces a reviewed skill, not an executable script. Skill fields are name, description, goal, business context, steps, constraints, and expected outcomes. Only published skills enter retrieval.

### UI scanning and policy

- `GET /api/v1/scans`
- `POST /api/v1/scans`
- `GET /api/v1/scans/:id`
- `GET /api/v1/scans/elements?route=&search=&limit=&offset=`
- `PATCH /api/v1/scans/elements/:elementKey/policy`
- `GET /api/v1/product/scan-auth`
- `PUT /api/v1/product/scan-auth`

Start a scan with optional relative routes and `discover`:

```json
{ "routes": ["/dashboard", "/settings"], "discover": true }
```

Mapped-element policy is `guide_only`, `navigate`, `reversible_write`, `manual`, or `blocked`. The live SDK observation remains runtime truth; map records provide semantic memory and reviewed policy.

### Host actions, runs, and usage

- `GET /api/v1/actions`
- `PATCH /api/v1/actions/:name`
- `GET /api/v1/runs`
- `GET /api/v1/runs/:id`
- `GET /api/v1/usage`

An SDK action first appears as detected/needs review. Review sets `{ "status": "published" | "blocked", "risk": "read" | "navigate" | "reversible_write" | "manual" | "blocked" }`. Blocked actions cannot be published. Manifest changes return published actions to review.

Run responses honor transcript mode and redact secrets regardless of mode.

## Runtime Token Exchange

Trusted host backend request:

```http
POST /api/v1/runtime/tokens
x-mia-key: mia_key_...
Content-Type: application/json

{
  "userId": "host-user-123",
  "origin": "https://app.example.com",
  "capabilities": ["agent:run", "events:write", "voice:live"]
}
```

Response:

```json
{
  "token": "mia_rt_...",
  "expiresAt": "2026-07-10T18:00:00.000Z",
  "allowedOrigin": "https://app.example.com",
  "capabilities": ["agent:run", "events:write", "voice:live"]
}
```

Derive `userId` and authorization from the host product's authenticated server session. Do not trust a browser-supplied user ID or origin.

## Agent Runtime

- `POST /api/v1/runtime/sessions`
- `POST /api/v1/runtime/sessions/resume`
- `POST /api/v1/runtime/sessions/:sessionId/turns`
- `POST /api/v1/runtime/sessions/:sessionId/turns/stream`
- `POST /api/v1/runtime/sessions/:sessionId/continue`
- `POST /api/v1/runtime/sessions/:sessionId/continue/stream`
- `POST /api/v1/runtime/sessions/:sessionId/confirmations/:confirmationId`
- `POST /api/v1/runtime/sessions/:sessionId/cancel`
- `POST /api/v1/runtime/voice/token`
- `POST /api/v1/runtime/events`

Session creation supplies the current semantic observation, registered action manifests, trusted/untrusted context entries, and optional visual context. It returns `sessionId`, one opaque `resumeToken`, status, and revision. The resume token is not an action credential and is valid only with a runtime token for the same host user.

Turn bodies add `utterance` and source (`text` or `voice`). The response is one of:

- `actions`: up to four guarded directives;
- `ask_user`: one missing-input request;
- `answer`: grounded conversational response;
- `complete`: verified completion;
- `unable`: honest safe stop.

After executing a directive batch, submit the new observation and one receipt per action to `continue`. Receipt status is `completed`, `unverified`, `failed`, `cancelled`, or `manual`. The backend verifies action identity, idempotency key, batch completeness, confirmation state, and session revision before replanning.

Confirmation resolution includes the issued binding, current observation, approval boolean, and source (`text`, `voice`, or `ui`). A stale, expired, altered, or already-resolved binding is rejected.

Streaming endpoints return server-sent events:

```text
thinking
progress
action_requested
confirmation_required
answer
completed
ask_user
unable
error
```

`POST /api/v1/runtime/voice/token` accepts an optional `{ "voice": "Aoede" }` body and returns a short-lived Gemini Live credential, locked model, effective voice/language, expiry, and WebSocket endpoint. The token locks Mia's transport instruction, authoritative tools, audio modality, transcription, voice, language, thinking level, and context compression while permitting only the provider-issued session-resumption handle to vary. The browser never receives the configured Gemini API key.

## Removed v1 Interfaces

There is no `appId`, classifier resolver, `/runtime/resolve`, workflow-session executor, arbitrary selector endpoint, API-key scope matrix, TTS adapter, LiveKit endpoint, or compatibility response union in v1.
