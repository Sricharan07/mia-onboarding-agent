# SDK Integration

The SDK runs in a host web app and talks to the self-hosted MIA backend. It mounts Mia's cursor and end-user control panel, collects page context, resolves user requests, logs workflow execution, and can start Gemini Live voice sessions when enabled.

## Install

The SDK package is publish-ready, but this repository is not authenticated to publish `@mia/onboarding-agent` to npm from this environment. Until the first npm release is published, install from a local package tarball:

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

Add an authenticated host-backend endpoint that calls `POST /api/v1/runtime/tokens` with the current user's server-verified ID, the configured app ID, and the request origin. Return the backend response to the browser. The included demo implements this pattern at `/api/mia/runtime-token`.

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
    voiceName: "Aoede"
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

```ts
AIOnboardingAgent.init({
  appId: "app_example",
  backendUrl: "https://mia.example.com",
  tokenProvider: async () => (await fetch("/api/mia/runtime-token", { method: "POST" })).json(),
  privacy: {
    redactText: true,
    redactedSelectors: ["[data-private]", ".billing-card"],
    redactScreenFrame: (canvas, context) => {
      context.clearRect(0, 0, 220, 80);
    }
  }
});
```

Prefer deterministic app selectors such as `data-private` or `data-mia-redact` for stable redaction.

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

After installing the SDK, use Console -> Test Mia for a resolver dry-run and Console -> Logs to confirm real host-app sessions, prompts, targets, voice transcripts, and element actions.

## Voice

Voice mode requires:

- backend `GEMINI_API_KEY`;
- a host-backend integration key with `runtime:tokens:create`;
- `enableVoice: true`.

```ts
await AIOnboardingAgent.startVoice();
await AIOnboardingAgent.stopVoice();
```

The backend mints short-lived Gemini Live tokens. The SDK does not need direct provider credentials.

When `enableVoice` is true, the SDK also registers push-to-talk: hold `Control+Space` to start a voice session and stream microphone audio, then release either key to pause microphone streaming. Calling `startVoice()` directly still starts a normal open-mic voice session.

Mia uses Gemini Live voice `Aoede` by default. Override `voice.voiceName` only after testing the replacement voice in Google AI Studio.

Mia is DOM-first. Runtime pointing, simple visible-element actions such as click/focus, workflow execution, and screen-aware answers use collected DOM context, stable selectors, and element bounding boxes. Set `enableScreenShare: true` only when Mia must understand visual content the DOM cannot describe well, such as canvas charts, images, videos, PDFs, or custom-rendered surfaces. The browser asks the user before any screen frames are streamed.

The SDK writes voice transcripts, final assistant speech, runtime resolution results, and voice errors to execution logs. Use those logs to diagnose what Mia heard, what she said, and whether she routed a request through the backend.

## Common Integration Issues

- `401 RUNTIME_TOKEN_REQUIRED`: verify `tokenProvider` returns the runtime-token response from your host backend.
- `403 RUNTIME_TOKEN_ORIGIN_FORBIDDEN`: add the host app origin to the integration key and mint the token for that exact origin.
- `403 RUNTIME_TOKEN_APP_FORBIDDEN`: use an integration key bound to the same `appId` passed to `init`.
- Voice does not start: confirm backend Gemini config and check `/api/v1/system/readiness` with an admin credential.
- Mia cannot point at UI: make sure runtime context contains usable selectors or reviewed visible text. Use `enableScreenShare: true` only for non-DOM visual surfaces.
- Mia only talks and does not move the cursor: run Console -> Test Mia, then ask from the host app and inspect Console -> Logs. A point/click request needs a mapped element with a stable selector or current-page bounding box.
- Context includes sensitive text: add `privacy.redactedSelectors` or a screen redaction callback.

See [Troubleshooting](troubleshooting.md) for backend and console checks.
