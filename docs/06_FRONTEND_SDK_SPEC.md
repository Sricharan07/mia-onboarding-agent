# Frontend SDK Specification

## 1. Purpose

The frontend SDK is embedded inside a SaaS product and connects the product UI to the AI Onboarding Agent backend.

For the MVP, the SDK is installed inside the example app.

The SDK is responsible for:

1. Rendering assistant UI.
2. Capturing user voice instructions.
3. Sending runtime context to backend.
4. Receiving workflow instructions.
5. Moving the AI cursor.
6. Highlighting elements.
7. Executing approved workflow steps.
8. Asking the user for input.
9. Confirming sensitive actions.
10. Sending execution logs.

## 2. Installation API

Recommended SDK usage:

```tsx
import { AIOnboardingAgent } from "@local/ai-onboarding-sdk";

AIOnboardingAgent.init({
  appId: "app_example_app",
  backendUrl: "http://localhost:4000",
  apiKey: "mia_...",
  enableVoice: true,
  enableTTS: true,
  user: {
    id: "local-user",
    role: "admin"
  }
});
```

## 3. SDK Config

```ts
export type SDKConfig = {
  appId: string;
  backendUrl: string;
  apiKey?: string;
  enableVoice: boolean;
  enableTTS: boolean;
  user?: {
    id?: string;
    email?: string;
    role?: string;
    metadata?: Record<string, unknown>;
  };
  ui?: {
    launcherPosition?: "bottom-right" | "bottom-left";
    showCursor?: boolean;
    showHighlights?: boolean;
  };
};
```

## 4. Runtime Context Collection

The SDK must collect:

1. Current URL.
2. Current route.
3. Page title.
4. Focused element.
5. Hovered element.
6. Optional visible interactive elements.
7. User metadata.
8. SDK session id.

```ts
export type SDKRuntimeContext = {
  appId: string;
  sessionId: string;
  currentUrl: string;
  currentRoute: string;
  pageTitle?: string;
  focusedElement?: RuntimeElementContext;
  hoveredElement?: RuntimeElementContext;
  visibleElements?: RuntimeElementContext[];
  userMetadata?: Record<string, unknown>;
};
```

## 5. Assistant UI

The SDK should render:

1. Floating launcher button.
2. Voice recording state.
3. Transcript preview.
4. Assistant response bubble.
5. Prompt overlay for `ask_user`.
6. Confirmation dialog.
7. Error message.
8. Cancel button.
9. Pause/resume controls if feasible.

## 6. AI Cursor

The cursor is a visual overlay, not the real OS cursor.

It should:

1. Be positioned absolutely/fixed.
2. Move smoothly to target elements.
3. Stay above app UI.
4. Avoid blocking clicks where possible.
5. Highlight target elements before acting.
6. Show a small label such as “Clicking New Customer”.

Recommended cursor states:

```ts
export type CursorState =
  | "idle"
  | "moving"
  | "highlighting"
  | "clicking"
  | "typing"
  | "waiting"
  | "error";
```

## 7. Workflow Executor

The SDK should implement a `WorkflowExecutor`.

```ts
export class WorkflowExecutor {
  constructor(options: {
    workflow: Workflow;
    backendClient: BackendClient;
    cursor: CursorController;
    ui: AssistantUIController;
  });

  start(): Promise<void>;
  pause(): void;
  resume(): void;
  cancel(): void;
}
```

## 8. Step Execution Rules

## 8.1 General Rules

1. Execute steps in order.
2. Before each step, log `step_started`.
3. After success, log `step_completed`.
4. On failure, log `step_failed`.
5. Stop on blocked step.
6. Pause when element cannot be found.
7. Respect `executionPolicy`.

## 8.2 Execution Policies

```ts
export type ExecutionPolicy =
  | "auto"
  | "requires_confirmation"
  | "manual_only"
  | "blocked";
```

### auto

SDK may execute automatically.

### requires_confirmation

SDK must ask the user before execution.

### manual_only

SDK highlights and instructs, but user performs the action.

### blocked

SDK does not execute and should stop or skip based on workflow behavior.

## 9. Step Handlers

## 9.1 navigate

```ts
async function handleNavigate(step: NavigateStep) {
  window.history.pushState({}, "", step.route);
  window.dispatchEvent(new PopStateEvent("popstate"));
}
```

If the app uses a router, Codex should expose a configurable navigation hook later. For MVP, direct route navigation is acceptable if the example app supports it.

## 9.2 click

Algorithm:

1. Resolve element by selector.
2. If not found, try fallback selectors.
3. Scroll into view.
4. Move cursor to element center.
5. Highlight element.
6. Apply execution policy.
7. Click element if allowed.

Pseudo-code:

```ts
const el = findElement(target.selector, target.fallbackSelectors);
await cursor.moveToElement(el);
highlight(el);

if (policy === "requires_confirmation") {
  const approved = await ui.confirm("Should I click " + target.label + "?");
  if (!approved) throw new Error("User denied confirmation");
}

if (policy === "manual_only") {
  await ui.say("Please click " + target.label);
  await waitForUserActionOrContinue();
  return;
}

if (policy === "blocked") {
  throw new Error("Blocked by execution policy");
}

(el as HTMLElement).click();
```

## 9.3 focus

Similar to click but calls `focus()`.

## 9.4 fill

Algorithm:

1. Resolve element.
2. Move cursor and highlight.
3. Get value from runtime state using `valueFrom`.
4. Focus input.
5. Set value using native setter.
6. Dispatch `input` and `change` events.

Important for React:

```ts
function setNativeValue(element: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const valueSetter = Object.getOwnPropertyDescriptor(element, "value")?.set;
  const prototype = Object.getPrototypeOf(element);
  const prototypeValueSetter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;

  if (prototypeValueSetter && valueSetter !== prototypeValueSetter) {
    prototypeValueSetter.call(element, value);
  } else if (valueSetter) {
    valueSetter.call(element, value);
  }

  element.dispatchEvent(new Event("input", { bubbles: true }));
  element.dispatchEvent(new Event("change", { bubbles: true }));
}
```

## 9.5 select

Set selected value and dispatch `change`.

## 9.6 ask_user

Show prompt overlay.

If voice is enabled:

1. Speak prompt through TTS.
2. Allow user to answer by voice or text.
3. Store captured value in runtime state.

If voice is unavailable:

1. Show text input.
2. Store submitted value.

## 9.7 wait_for_element

Poll selector until found or timeout.

## 9.8 confirm

Show confirmation dialog and optionally speak confirmation.

Store confirmation result.

## 9.9 complete

Show success message and speak completion message.

## 10. Element Resolution

```ts
function findElement(selector: string, fallbacks: string[] = []): Element | null {
  const selectors = [selector, ...fallbacks].filter(Boolean);

  for (const s of selectors) {
    try {
      const el = document.querySelector(s);
      if (el) return el;
    } catch {
      // Some selectors may be non-standard. Ignore invalid selector.
    }
  }

  return null;
}
```

For text selectors such as `button:has-text('New Customer')`, implement custom fallback or convert during mapper generation because native `querySelector` does not support Playwright selectors.

## 11. Voice

## 11.1 Voice Input

MVP voice input flow:

```text
User clicks or holds voice button
→ SDK captures audio
→ LiveKit sends audio/session event
→ Backend transcribes
→ Backend resolves intent
→ SDK receives workflow or answer
```

The SDK should also support text input fallback:

```ts
AIOnboardingAgent.ask("Help me create a new customer");
```

## 11.2 TTS Output

TTS is required.

When backend response contains `tts.text` or `tts.audioUrl`, SDK should:

1. Request audio if only text is provided.
2. Play audio.
3. Show matching text bubble.
4. Allow user to interrupt.

## 12. SDK Events

SDK should emit internal and backend events.

```ts
export type SDKEvent =
  | { type: "session_started"; sessionId: string }
  | { type: "voice_started" }
  | { type: "voice_stopped" }
  | { type: "intent_resolved"; resultType: string }
  | { type: "workflow_started"; workflowId: string }
  | { type: "step_started"; workflowId: string; stepId: string }
  | { type: "step_completed"; workflowId: string; stepId: string }
  | { type: "step_failed"; workflowId: string; stepId: string; error: string }
  | { type: "workflow_completed"; workflowId: string }
  | { type: "workflow_cancelled"; workflowId: string };
```

## 13. Safety Requirements

1. SDK must not execute workflows that are not returned by backend.
2. SDK must not invent selectors.
3. SDK must not execute `blocked` steps.
4. SDK must ask confirmation for `requires_confirmation`.
5. SDK must not fill values into a target that is not in the workflow.
6. SDK must not click outside resolved elements.
7. SDK must stop when target is missing.
8. SDK must send logs for failures.

## 14. MVP UI Design

Minimal UI is enough:

1. Floating circular button.
2. Expanded assistant panel.
3. Voice button.
4. Transcript display.
5. Response text.
6. Prompt field.
7. Confirmation modal.
8. Cursor overlay.
9. Highlight ring.

## 15. Test Requirements

SDK tests should cover:

1. Workflow executor step order.
2. Selector fallback resolution.
3. Execution policy enforcement.
4. Fill event dispatch.
5. Missing element behavior.
6. Confirmation denial behavior.
7. Ask user state storage.
8. Runtime context collection.

## 16. Example App Integration Checklist

For key example app elements, add:

```tsx
data-ai-id="customers.new_customer_button"
data-ai-id="customers.customer_name_input"
data-ai-id="customers.customer_email_input"
data-ai-id="customers.save_customer_button"
data-ai-id="settings.invite_teammate_button"
data-ai-id="settings.invite_email_input"
data-ai-id="settings.send_invite_button"
```

The SDK should still work with fallback selectors if these are missing, but selector quality should be lower.
