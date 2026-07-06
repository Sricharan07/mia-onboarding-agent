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
  apiKey: "mia_<prefix>_<secret>",
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

Create an app-bound SDK key in the MIA console with:

- `runtime:write`
- `logs:write`
- the target `appId`
- allowed browser origins for the host app

Do not ship admin API keys in browser code.
The SDK key's allowed origins must include the exact browser origin that loads the host app.

## Configuration

The SDK accepts visual options under `ui`, user identity under `user`, and privacy controls under `privacy`. The assistant panel is enabled by default and gives users an Ask box, start/stop voice controls, suggested prompts, privacy status, and a local transcript.

```ts
AIOnboardingAgent.init({
  appId: "app_example",
  backendUrl: "https://mia.example.com",
  apiKey: "mia_<prefix>_<secret>",
  ui: {
    assistantPanel: true,
    theme: "auto",
    cursorOffset: { x: 20, y: 20 },
    bubbleMaxWidth: 320
  },
  privacy: {
    redactedSelectors: ["[data-private]", ".billing-card"],
    redactText: true
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

Voice user transcripts, final assistant transcripts, runtime resolutions, and voice errors are written to execution logs so operators can debug what Mia heard and said.

If voice fails, check the backend readiness endpoint with an admin credential and confirm the SDK key has `runtime:write`. If Mia talks but does not point or act, use Console -> Test Mia for a resolver dry-run and Console -> Logs to confirm real host-app targets and element actions.

## License

MIT
