# SDK Integration

`@mia/onboarding-agent` is a framework-neutral, ESM-only browser package. It observes the current product, maintains one persisted Mia session, renders the assistant and visible cursor, executes guarded DOM or host actions, verifies results, and transports voice through the same backend agent used by text.

## Install

For a published release:

```bash
npm install @mia/onboarding-agent@1.0.0
```

Before npm publication, build the release tarball and install it into the host project without a workspace link:

```bash
npm ci
npm pack --workspace sdk
cd /path/to/host-product
npm install /path/to/mia-onboarding-agent-1.0.0.tgz
```

Mia must initialize in a browser after the host knows the authenticated user. It does not run during server rendering.

## Trusted Token Endpoint

Create a runtime integration key in Console **Settings**. Store it only in the host backend's secret manager.

The host endpoint must:

1. Authenticate the current product user from a server session.
2. Authorize that user to use Mia.
3. Use the configured product origin, not an arbitrary request body value.
4. Call Mia with the server integration key.
5. Return only the short-lived runtime token response.

Next.js example:

```ts
import { NextResponse } from "next/server";

export async function POST() {
  const user = await requireAuthenticatedUser();
  const response = await fetch(`${process.env.MIA_BACKEND_URL}/api/v1/runtime/tokens`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-mia-key": process.env.MIA_INTEGRATION_KEY!
    },
    body: JSON.stringify({
      userId: user.id,
      origin: process.env.PRODUCT_ORIGIN,
      capabilities: ["agent:run", "events:write", "voice:live"]
    })
  });
  if (!response.ok) return NextResponse.json({ error: "Mia is unavailable." }, { status: 503 });
  return NextResponse.json(await response.json());
}
```

Never use a public environment prefix for `MIA_INTEGRATION_KEY`.

## Initialize

```ts
import { Mia } from "@mia/onboarding-agent";

const mia = await Mia.init({
  backendUrl: "https://mia.example.com",
  tokenProvider: async () => {
    const response = await fetch("/api/mia/runtime-token", {
      method: "POST",
      credentials: "same-origin"
    });
    if (!response.ok) throw new Error("Unable to start Mia");
    return response.json();
  },
  navigate: async (route) => router.push(route),
  voice: {
    enabled: true,
    voice: "Aoede",
    openMic: true,
    pushToTalk: true
  },
  privacy: {
    redactedSelectors: ["[data-private]", "[data-mia-redact]", ".payment-details"]
  },
  onEvent: (event) => productTelemetry.record("mia", event.type)
});
```

`backendUrl` may include no reusable credential. `tokenProvider` may return the raw token string or `{ token, expiresAt }`; the SDK caches it until close to expiry and requests a replacement when necessary.

Use the host router for `navigate` so client-side route state stays coherent. The SDK verifies the exact approved path, query, and fragment before issuing a completed receipt. Without a host router, Mia falls back only where browser navigation is appropriate.

## Register Host Actions

Use host actions for meaningful product mutations. They are more reliable and auditable than synthesizing many DOM events.

```ts
import { defineMiaAction } from "@mia/onboarding-agent";

const createDraftOpportunity = defineMiaAction({
  name: "create_draft_opportunity",
  description: "Create a reversible CRM opportunity draft without sending or publishing it.",
  inputSchema: {
    type: "object",
    additionalProperties: false,
    properties: {
      account: { type: "string", minLength: 1, maxLength: 200 },
      amount: { type: "number", minimum: 0 }
    },
    required: ["account"]
  },
  risk: "reversible_write",
  effect: "draft_create",
  async execute(input, { signal, observation, idempotencyKey }) {
    const response = await fetch("/api/opportunities/drafts", {
      method: "POST",
      signal,
      headers: {
        "content-type": "application/json",
        "idempotency-key": idempotencyKey
      },
      body: JSON.stringify(input)
    });
    if (!response.ok) {
      return { status: "failed", message: "The opportunity draft could not be created." };
    }
    const draft = await response.json();
    return {
      status: "completed",
      message: `Created draft ${draft.id}.`,
      evidence: { draftId: draft.id, state: "draft", route: observation.route }
    };
  }
});
```

Register it with `actions: [createDraftOpportunity]`. Names must be unique snake case; descriptions must state business effects and exclusions; `inputSchema` must be valid JSON Schema; risk is `read`, `navigate`, `reversible_write`, `manual`, or `blocked`.

The backend detects manifests automatically. An administrator must review and publish each action before Gemini can use it. Changing name, description, schema, risk, or effect changes the manifest hash and returns it to review.

Use the supplied idempotency key for every mutation and return evidence that proves the resulting product state. Never define a reversible action that can delete, send, publish, approve, pay, externally communicate, or irreversibly submit through an indirect flag.

## Product Context

Context providers add product state that the DOM cannot express cleanly:

```ts
contextProviders: [{
  name: "current_workspace",
  description: "Current CRM workspace and the signed-in user's product permissions.",
  trusted: true,
  getContext: async ({ signal, observation }) => JSON.stringify({
    workspaceId,
    permissions,
    route: observation.route
  })
}]
```

Provider names use snake case. Keep content concise and redact it before returning. Set `trusted: true` only for values produced by reviewed host code; page/user/document content remains untrusted evidence even when useful.

## Visual Context

Semantic DOM context is always primary. For canvas, charts, maps, images, or other custom rendering, supply an optional provider:

```ts
visualContextProvider: async ({ reason, signal, observation }) => {
  const description = await describeVisibleChart({ reason, signal, observation });
  return { name: "revenue_chart", description };
},
privacy: {
  transformVisualContext: async (contexts) => redactVisualContexts(contexts)
}
```

The provider runs only after the agent explicitly requests unavailable visual information. It may return a redacted text description or base64 PNG/JPEG data. The SDK never invokes a browser screen-share picker automatically.

## Privacy

The semantic observer collects roles, accessible names, descriptions, visible text, current values/states, focus, selection, viewport geometry, and stable node IDs. It traverses open shadow roots and same-origin frames.

It excludes Mia's own UI and redacts password/payment/authentication controls, token-like values, configured private selectors, and sensitive patterns. Before every observation, the SDK loads the administrator's selectors from `/api/v1/runtime/config` and merges them with host-supplied selectors. Collection fails closed if that privacy configuration cannot be loaded. Defaults omit URL query strings and page title, and page text never includes document-head/title content.

```ts
privacy: {
  redactedSelectors: ["[data-private]", "[data-mia-redact]"],
  includePageText: true,
  includeUrlQuery: false,
  includePageTitle: false,
  sensitivePatterns: [/customer-secret-\w+/gi],
  transformObservation: (observation) => finalHostRedaction(observation),
  transformVisualContext: (contexts) => finalVisualRedaction(contexts)
}
```

`transformObservation` is a final host boundary and must preserve valid node IDs/shape. Do not turn on additional context unless the product's data handling has been reviewed.

Only the opaque session ID and resume token are stored in `sessionStorage`. Conversation, decisions, confirmation state, and receipts remain authoritative in PostgreSQL.

## Voice

```ts
await mia.startVoice();
await mia.stopVoice();
```

Gemini Live carries microphone input and speaks the backend agent's exact response. It cannot independently plan or execute actions. Text and voice share the same session, policy, cursor, confirmations, receipts, and final result.

`Aoede` is the v1 default. The console administrator chooses from the curated `Aoede`, `Kore`, and `Leda` voices, and that product setting remains authoritative over an SDK preference. With `openMic: true`, voice keeps listening until stopped and supports interruption. With `pushToTalk: true`, hold `Control+Space`; release either key to pause the microphone. Blur and page hiding also release push-to-talk safely.

Input audio transcription is authoritative for agent turns. If Gemini's transport tool paraphrases a request, the SDK submits the exact transcription instead, so voice and text reach the same persisted planner input.

The browser requires a secure context and microphone permission. Voice confirmation is supported for every permitted reversible mutation and must resolve the same exact backend binding as the UI.

## Lifecycle And Custom UI

```ts
await mia.ask("Where is the stage filter?");
await mia.confirm(true);          // custom/headless confirmation UI
await mia.provideInput("Avery"); // custom/headless missing-input UI
await mia.stop();                 // emergency stop
mia.destroy();                    // app shell/user teardown
```

- `ask` serializes one turn through observation, reasoning, action, and verification.
- `stop` aborts model requests, queued actors, speech, cursor animation, pending approval/input, and cancels the backend session.
- `destroy` removes observers, hotkeys, panel, cursor, media, and network activity. Call it when the authenticated user or product shell changes.
- Initializing creates or resumes one session. Reload recovery re-verifies navigation and cancels unsafe pending values rather than persisting them in browser storage.
- The visible cursor's pointer hotspot, highlight ring, and verified target coordinates are the same point; Mia never moves the user's physical cursor.

Set `ui.enabled: false` only when the host supplies equivalent transcript, progress, input, microphone, stop, confirmation, and missing-input controls.

## Runtime Events

`onEvent` receives:

```text
ready
thinking
progress
action_requested
confirmation_required
action_completed
answer
completed
cancelled
voice_started
voice_stopped
transcript
error
```

Do not forward complete event objects to third-party analytics without a separate privacy review. Prefer event type and coarse outcome.

## Content Security Policy

The SDK renders isolated Shadow DOM styles. For a strict nonce-based `style-src`, pass the current response nonce:

```ts
ui: { styleNonce: cspNonce }
```

Allow the Mia backend in `connect-src`; Gemini Live connections use the ephemeral WebSocket URL returned by that backend and must also be allowed. Microphone use requires an appropriate `Permissions-Policy` and user permission. The SDK does not require `unsafe-eval`.

## Stable Product Semantics

Use real accessible labels and optional `data-mia-key` values on important controls. Use `data-mia-redact` or configured selectors for private regions. Do not make coordinates, CSS class hashes, or transient generated IDs the only way to identify a product action.

The live observation remains authoritative. UI scans enrich semantic memory and policy, but a stale map cannot force an action against a missing, hidden, disabled, ambiguous, or obstructed control.

## Integration Checklist

- Host token endpoint authenticates and authorizes the current user.
- Integration key never reaches browser code.
- Exact product origin matches console, host endpoint, CORS, and browser.
- Private regions and custom context are reviewed and redacted.
- Every mutation is a narrow idempotent action with verifiable evidence.
- Administrator has reviewed all detected actions and current UI-map policy.
- Q&A, pointing, navigation, confirmed mutation, voice, reload, and stop pass in the real product.
- Chrome, Edge, Firefox, and Safari/WebKit desktop/mobile layouts are tested.

See [HTTP API](api.md), [Security model](security.md), and [Troubleshooting](troubleshooting.md).
