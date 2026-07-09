# SDK Integration

The SDK runs in a host web app and talks to the self-hosted MIA backend. It mounts Mia's cursor and end-user control panel, collects page context, resolves user requests, logs workflow execution, and can start Gemini Live voice sessions when enabled.

## Install

The SDK source and package manifest are prepared for a first release, but `@mia/onboarding-agent` is not published to npm yet. Until that release exists, install from a local package tarball:

```bash
# Build the SDK tarball from the MIA repository.
git clone https://github.com/Sricharan07/mia-onboarding-agent.git
cd mia-onboarding-agent
npm install
npm pack -w sdk

# Then run this in the host web app that loads Mia.
npm install /absolute/path/to/mia-onboarding-agent/mia-onboarding-agent-0.1.0.tgz
```

After the npm release exists, use:

```bash
npm install @mia/onboarding-agent
```

## Create A Server Integration Key

In the console, create an app-bound server key with:

- `runtime:tokens:create`
- the target `appId`
- every browser origin that will load the SDK

Keep this key in the host application's backend. Never expose an admin or integration key in browser code.

Add an authenticated host-backend endpoint that calls `POST /api/v1/runtime/tokens` with the current user's server-verified ID, the configured app ID, and the request origin. Return the backend response to the browser. The included demo shows the server-side key exchange at `/api/mia/runtime-token`, but intentionally uses one fixed, low-privilege demo identity; replace that identity with the host product's authenticated session in a real integration.

## Initialize

```ts
import { AIOnboardingAgent } from "@mia/onboarding-agent";

AIOnboardingAgent.init({
  appId: "app_example",
  backendUrl: "https://mia.example.com",
  tokenProvider: async () => {
    const response = await fetch("/api/mia/runtime-token", { method: "POST" });
    if (!response.ok) throw new Error("Unable to start Mia");
    return response.json();
  },
  enableVoice: true,
  ui: {
    assistantPanel: true
  },
  voice: {
    voiceName: "Kore"
  },
  user: {
    id: "user_123",
    role: "admin"
  }
});
```

Ask Mia to resolve a user request:

```ts
await AIOnboardingAgent.ask("Show me how to invite a teammate");
```

Clean up when the app shell unmounts, a tenant changes, or the signed-in user changes:

```ts
AIOnboardingAgent.destroy();
```

Calling `init` again destroys the previous SDK instance before creating a fresh session.

## Privacy Controls

Visible DOM text is redacted by default before runtime context leaves the browser. Use selectors for sensitive DOM areas, and use `redactScreenFrame` for screen regions that should not be sent to voice/screen streaming. Set `redactText: false` only when the host app has reviewed the data that may leave the browser.

URL query strings, page titles, and user metadata are omitted by default. Runtime telemetry defaults to event names without payloads. `redacted` telemetry removes text, URLs, selectors, user fields, and recognized secrets in the browser and again on the backend. `full` telemetry requires both an app policy that allows it and an explicit `hasConsent` callback.

```ts
AIOnboardingAgent.init({
  appId: "app_example",
  backendUrl: "https://mia.example.com",
  tokenProvider: async () => (await fetch("/api/mia/runtime-token", { method: "POST" })).json(),
  privacy: {
    redactText: true,
    redactedSelectors: ["[data-private]", ".billing-card"],
    telemetry: { mode: "events_only" },
    redactScreenFrame: (canvas, context) => {
      context.clearRect(0, 0, 220, 80);
    }
  }
});
```

Prefer deterministic app selectors such as `data-private` or `data-mia-redact` for stable redaction.

Workflow values are kept only in SDK memory for the active workflow and are cleared on completion, cancellation, or failure. Passwords, payment fields, tokens, and similar secrets are never collected by Mia; the workflow points to those fields and asks the user to complete them manually.

## UI Options

The assistant panel is enabled by default. It gives end users a visible Ask box, start/stop voice controls, a Stop Mia button, suggested prompts from the current page, privacy status, and a local transcript. Disable it only if the host app provides an equivalent control surface.

```ts
AIOnboardingAgent.init({
  appId: "app_example",
  backendUrl: "https://mia.example.com",
  tokenProvider: async () => (await fetch("/api/mia/runtime-token", { method: "POST" })).json(),
  ui: {
    assistantPanel: true,
    theme: "auto",
    cursorOffset: { x: 20, y: 20 },
    bubbleMaxWidth: 320
  }
});
```

After installing the SDK, use Console -> Test Mia for a resolver preview. Then open the real host app so the console can verify live SDK evidence, and use Console -> Logs to confirm runtime targets and element actions. A preview alone does not prove the integration is ready. Transcript content appears only under consented full telemetry.

## Voice

Voice mode requires:

- backend `GEMINI_API_KEY`;
- a host-backend integration key with `runtime:tokens:create`;
- `enableVoice: true`.

```ts
await AIOnboardingAgent.startVoice();
await AIOnboardingAgent.stopVoice();

// Optional and always user-initiated. Requires enableScreenShare: true.
await AIOnboardingAgent.startScreenShare();
AIOnboardingAgent.stopScreenShare();
```

The backend mints short-lived Gemini Live tokens. The SDK does not need direct provider credentials.

Apps configured as Q&A-only are restricted by the backend to answers and pointing. They cannot return workflows or element actions even if a client asks for a click.

When `enableVoice` is true, the SDK also registers push-to-talk: hold `Control+Space` to start a voice session and stream microphone audio, then release either key to disable the microphone track and end the audio turn. The same release happens if the window loses focus or the page becomes hidden. Calling `startVoice()` directly still starts a normal open-mic voice session. Voice sessions use context compression and session resumption so provider connection refreshes do not appear as a terminal "voice ended" state.

Mia uses Gemini Live voice `Kore` by default. Override `voice.voiceName` only after testing the replacement voice in Google AI Studio.

Mia is DOM-first. Runtime pointing, click/focus actions, workflow execution, and screen-aware answers reconcile the reviewed UI map with the current DOM through structured CSS, role/name, label, and exact-text locators. Bounding boxes position the visible cursor but are never used to choose an element for execution. Direct element actions always ask for confirmation. Workflow and direct actions run uniqueness, visibility, enabled-state, route, and obstruction checks, then report completion only when the page exposes a verifiable result. Set `enableScreenShare: true` only when Mia must understand visual content the DOM cannot describe well, such as canvas charts, images, videos, PDFs, or custom-rendered surfaces. The flag adds a **Share screen** control; it never requests screen access during voice startup. The browser picker opens only after that explicit user action or an explicit `startScreenShare()` call.

Screen sharing also requires `privacy.redactScreenFrame` or an explicit `privacy.allowUnredactedScreenShare: true` decision. Enabling the feature flag alone is not consent to stream an unredacted screen.

The SDK emits voice and runtime events under the configured telemetry policy. Transcript content is stored only when full diagnostics are enabled by the app and the user-consent callback returns true.

## Common Integration Issues

- `401 RUNTIME_TOKEN_REQUIRED`: verify `tokenProvider` returns the runtime-token response from your host backend.
- `403 RUNTIME_TOKEN_ORIGIN_FORBIDDEN`: add the host app origin to the integration key and mint the token for that exact origin.
- `403 RUNTIME_TOKEN_APP_FORBIDDEN`: use an integration key bound to the same `appId` passed to `init`.
- Voice does not start: confirm backend Gemini config and check `/api/v1/system/readiness` with an admin credential.
- Mia cannot point at UI: make sure runtime context contains usable selectors or reviewed visible text. Use `enableScreenShare: true` only for non-DOM visual surfaces.
- Mia only talks and does not move the cursor: run Console -> Test Mia, then ask from the host app and inspect Console -> Logs. Pointing needs a matched visible target. Clicking also requires a current reviewed UI-map binding, a unique live structured locator, and user confirmation.
- Context includes sensitive text: add `privacy.redactedSelectors` or a screen redaction callback.

See [Troubleshooting](troubleshooting.md) for backend and console checks.
