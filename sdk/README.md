# `@mia/onboarding-agent`

Framework-neutral browser SDK for Mia v1. It observes the live product UI, streams user turns to the self-hosted Mia backend, renders a separate visible guide cursor, executes guarded DOM or reviewed host actions, verifies outcomes, and uses the same backend session for text and voice.

## Install

```bash
npm install @mia/onboarding-agent
```

The package is ESM-only and requires a modern browser.

## Initialize

```ts
import { Mia, defineMiaAction } from "@mia/onboarding-agent";

const createDraftLead = defineMiaAction({
  name: "create_draft_lead",
  description: "Create a reversible CRM lead draft without sending it.",
  inputSchema: {
    type: "object",
    additionalProperties: false,
    properties: {
      name: { type: "string", minLength: 1 },
      email: { type: "string", format: "email" }
    },
    required: ["name"]
  },
  risk: "reversible_write",
  effect: "draft_create",
  async execute(input, { signal, idempotencyKey }) {
    const response = await fetch("/api/leads/drafts", {
      method: "POST",
      signal,
      headers: {
        "content-type": "application/json",
        "idempotency-key": idempotencyKey
      },
      body: JSON.stringify(input)
    });
    if (!response.ok) return { status: "failed", message: "The lead draft could not be created." };
    const draft = await response.json();
    return {
      status: "completed",
      message: "The lead draft was created.",
      evidence: { draftId: draft.id, state: "draft" }
    };
  }
});

const mia = await Mia.init({
  backendUrl: "https://mia.example.com",
  tokenProvider: async () => {
    const response = await fetch("/api/mia/runtime-token", { method: "POST" });
    return response.json();
  },
  navigate: (route) => router.push(route),
  voice: { enabled: true, voice: "Aoede", openMic: true, pushToTalk: true },
  actions: [createDraftLead],
  contextProviders: [{
    name: "current_workspace",
    description: "Current CRM workspace context.",
    trusted: true,
    getContext: () => JSON.stringify({ workspaceId, permissions })
  }],
  privacy: {
    redactedSelectors: ["[data-private]", ".payment-details"]
  },
  ui: { styleNonce: window.__CSP_NONCE__ },
  onEvent: (event) => console.debug("Mia", event)
});

await mia.ask("Create a draft lead for Avery");
await mia.startVoice();
await mia.stopVoice();
mia.destroy();
```

Keep the integration key on your server. `tokenProvider` should call your server endpoint, which mints a short-lived, origin-bound runtime token from Mia's `/api/v1/runtime/tokens` endpoint.

## Actions And Safety

`defineMiaAction` requires a unique name, clear description, JSON input schema, risk classification, typed effect, and receipt-producing executor. Actions are detected by the backend but unavailable to Gemini until an administrator reviews and publishes them.

Allowed risk values are `read`, `navigate`, `reversible_write`, `manual`, and `blocked`. The backend blocks delete, send, publish, approve, payment, external communication, and irreversible submission operations in v1 regardless of the manifest.

Effects are `read`, `navigate`, `draft_create`, `draft_update`, `reversible_change`, and `protected`. The SDK and backend reject incompatible risk/effect pairs, and `protected` effects are never executable.

Use the supplied idempotency key for every host mutation. Return evidence that lets Mia verify the resulting product state.

## Privacy

The observer reads accessibility semantics and visible product text, not arbitrary JavaScript state. It traverses open shadow roots and same-origin frames. Passwords, authentication codes, payment fields, token-like values, configured private regions, and Mia's own UI are redacted before observations leave the browser. Administrator selectors are loaded before every observation and merged with SDK selectors; URL queries and page titles remain off unless explicitly enabled.

Canvas, chart, map, and image inspection is opt-in through `visualContextProvider`. The provider is invoked only after the agent explicitly determines semantic context is insufficient. Use `privacy.transformVisualContext` to apply any final image or description redaction before upload.

Only the backend session ID and opaque resume token are stored in `sessionStorage`. Conversation state, plans, confirmations, and receipts remain authoritative on the backend.

For nonce-based Content Security Policy, pass the response nonce as `ui.styleNonce`. Allow the Mia backend and returned Gemini Live WebSocket endpoint in `connect-src`; the SDK does not require `unsafe-eval`.

## Voice

Gemini Live is used as a microphone and speech transport. Every user utterance is submitted to the same persisted agent used by text. The Live model is constrained to speak the backend agent's exact response and cannot independently plan or execute product actions.

`Aoede` is the default voice. The administrator's configured `Aoede`, `Kore`, or `Leda` voice is authoritative over an SDK preference. Open mic and hold `Control+Space` push-to-talk can be enabled together. When `openMic` is `false`, holding the shortcut starts voice if needed, enables the microphone for the hold, and pauses it on release. Mia submits the provider's exact input transcription to the shared planner rather than trusting a paraphrased voice-tool argument.

## Lifecycle

- `Mia.init(options)` creates or resumes a session and returns a ready instance.
- `mia.ask(text)` runs a text turn through observe, reason, act, and verify.
- `mia.startVoice()` and `mia.stopVoice()` control the shared voice session.
- `mia.confirm(approved)` and `mia.provideInput(value)` support headless/custom UI integrations.
- `mia.stop()` aborts the active model request, queued actions, speech, animation, and pending approval.
- `mia.destroy()` removes observers, UI, cursor, hotkeys, media, and network activity.
