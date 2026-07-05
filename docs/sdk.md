# SDK Integration

The SDK runs in a host web app and talks to the self-hosted MIA backend. It collects page context, resolves user requests, logs workflow execution, and can start Gemini Live voice sessions when enabled.

## Install

```bash
npm install @mia/onboarding-agent
```

For local repository development, build and package the SDK with:

```bash
npm run build -w sdk
npm run pack:sdk
```

## Create A Browser SDK Key

In the console, create an app-bound key with:

- `runtime:write`
- `logs:write`
- the target `appId`
- every browser origin that will load the SDK

Do not expose an `admin` key in browser code. Non-admin keys are rejected unless they are bound to an app and origin-restricted.

## Initialize

```ts
import { AIOnboardingAgent } from "@mia/onboarding-agent";

AIOnboardingAgent.init({
  appId: "app_example",
  backendUrl: "https://mia.example.com",
  apiKey: "mia_live_...",
  enableVoice: true,
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

Use selectors to redact sensitive DOM areas before runtime context leaves the browser. Use `redactScreenFrame` for screen regions that should not be sent to voice/screen streaming.

```ts
AIOnboardingAgent.init({
  appId: "app_example",
  backendUrl: "https://mia.example.com",
  apiKey: "mia_live_...",
  privacy: {
    redactText: false,
    redactedSelectors: ["[data-private]", ".billing-card"],
    redactScreenFrame: (canvas, context) => {
      context.clearRect(0, 0, 220, 80);
    }
  }
});
```

Prefer deterministic app selectors such as `data-private` or `data-mia-redact` for stable redaction.

## UI Options

```ts
AIOnboardingAgent.init({
  appId: "app_example",
  backendUrl: "https://mia.example.com",
  apiKey: "mia_live_...",
  ui: {
    theme: "auto",
    cursorOffset: { x: 20, y: 20 },
    bubbleMaxWidth: 320
  }
});
```

## Voice

Voice mode requires:

- backend `GEMINI_API_KEY`;
- a browser SDK key with `runtime:write`;
- `enableVoice: true`.

```ts
await AIOnboardingAgent.startVoice();
await AIOnboardingAgent.stopVoice();
```

The backend mints short-lived Gemini Live tokens. The SDK does not need direct provider credentials.

## Common Integration Issues

- `401 API_KEY_REQUIRED`: pass `apiKey`, or ensure the backend URL points at the MIA backend.
- `403 API_KEY_ORIGIN_FORBIDDEN`: add the host app origin to the SDK key's allowed origins.
- `403 API_KEY_APP_FORBIDDEN`: use a key bound to the same `appId` passed to `init`.
- Voice does not start: confirm backend Gemini config and `/api/v1/system/readiness`.
- Context includes sensitive text: add `privacy.redactedSelectors` or a screen redaction callback.

See [Troubleshooting](troubleshooting.md) for backend and console checks.
