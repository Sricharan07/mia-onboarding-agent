# @mia/onboarding-agent

Browser SDK for the self-hosted MIA onboarding agent. It mounts Mia's cursor, an end-user Ask/voice control panel, runtime context collection, workflow execution, and optional Gemini Live voice.

Full integration guidance lives in the repository's [SDK guide](https://github.com/Sricharan07/mia-onboarding-agent/blob/main/docs/sdk.md).

## Install

Until the first npm release is published, install from a package tarball built from the repository root:

```bash
# Build the SDK tarball from the MIA repository.
npm install
npm pack -w sdk

# Then run this in the host web app that loads Mia.
npm install /absolute/path/to/mia-onboarding-agent/mia-onboarding-agent-0.1.0.tgz
```

After publication, install with `npm install @mia/onboarding-agent`.

## Usage

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

Clean up when your app shell unmounts or changes tenants:

```ts
AIOnboardingAgent.destroy();
```

Calling `init` again automatically destroys the previous SDK instance before creating a fresh session.

## Required Backend Setup

Create an app-bound server integration key in the MIA console with:

- `runtime:tokens:create`
- the target `appId`
- allowed browser origins for the host app

Keep this key in the host backend and use it to call `POST /api/v1/runtime/tokens` for the authenticated user. Do not ship admin or integration API keys in browser code. The key's allowed origins must include the exact browser origin that loads the host app.

## Configuration

The SDK accepts visual options under `ui`, user identity under `user`, and privacy controls under `privacy`. The assistant panel is enabled by default and gives users an Ask box, start/stop voice controls, suggested prompts, privacy status, and a local transcript.

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
  },
  privacy: {
    redactedSelectors: ["[data-private]", ".billing-card"],
    redactText: true,
    telemetry: { mode: "events_only" }
  }
});
```

## Voice

Voice mode requires the backend to be configured with Gemini Live credentials and the SDK option `enableVoice: true`.

```ts
await AIOnboardingAgent.startVoice();
await AIOnboardingAgent.stopVoice();
```

With `enableVoice: true`, users can also hold `Control+Space` for push-to-talk. Releasing either key pauses microphone streaming.

Mia uses Gemini Live voice `Aoede` by default. Override `voice.voiceName` only after testing the replacement voice in Google AI Studio.

Mia is DOM-first. Runtime pointing, simple visible-element actions such as click/focus, and workflows use collected DOM context, stable selectors, and element bounding boxes. Set `enableScreenShare: true` only for visual content the DOM cannot describe well, such as canvas charts, images, videos, PDFs, or custom-rendered surfaces.

URL query strings, page titles, user metadata, and telemetry payloads are omitted by default. Workflow values remain in memory only, and Mia never collects secret or payment fields. Screen sharing requires a redaction callback or an explicit unredacted-screen decision.

Voice and runtime events follow the app telemetry policy. Transcript content is retained only when full diagnostics are allowed and the SDK consent callback returns true.

If voice fails, check the backend readiness endpoint with an admin credential and confirm runtime tokens include `voice:live`. If Mia talks but does not point or act, use Console -> Test Mia for a resolver dry-run and Console -> Logs to confirm real host-app targets and element actions.

## License

MIT
