# @mia/onboarding-agent

Browser SDK for the self-hosted MIA onboarding agent.

Full integration guidance lives in the repository's [SDK guide](https://github.com/Sricharan07/mia-onboarding-agent/blob/main/docs/sdk.md).

## Install

```bash
npm install @mia/onboarding-agent
```

## Usage

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

The SDK accepts visual options under `ui`, user identity under `user`, and privacy controls under `privacy`.

```ts
AIOnboardingAgent.init({
  appId: "app_example",
  backendUrl: "https://mia.example.com",
  apiKey: "mia_live_...",
  ui: {
    theme: "auto",
    cursorOffset: { x: 20, y: 20 },
    bubbleMaxWidth: 320
  },
  privacy: {
    redactedSelectors: ["[data-private]", ".billing-card"],
    redactText: false
  }
});
```

## Voice

Voice mode requires the backend to be configured with Gemini Live credentials and the SDK option `enableVoice: true`.

```ts
await AIOnboardingAgent.startVoice();
await AIOnboardingAgent.stopVoice();
```

If voice fails, check the backend readiness endpoint and confirm the SDK key has `runtime:write`.

## License

MIT
