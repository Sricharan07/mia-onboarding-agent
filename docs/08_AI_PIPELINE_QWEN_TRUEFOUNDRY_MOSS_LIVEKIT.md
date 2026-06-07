# AI Pipeline: Qwen, TrueFoundry, Moss, LiveKit, and TTS

## 1. Overview

The AI stack is modular.

Do not build the system around one omni model.

Use separate adapters:

```text
Qwen             → workflow video understanding
TrueFoundry      → model gateway and governance
Moss             → semantic search
LiveKit          → realtime voice/session transport
STT Adapter      → speech-to-text
TTS Adapter      → spoken assistant responses, preferably Qwen Voice
Runtime LLM      → intent classification and response planning
```

## 2. Adapter Interfaces

## 2.1 Model Gateway Adapter

```ts
export interface ModelGatewayAdapter {
  generateText(input: GenerateTextInput): Promise<GenerateTextOutput>;
  generateJson<T>(input: GenerateJsonInput): Promise<T>;
  analyzeImagesOrVideo<T>(input: AnalyzeVideoInput): Promise<T>;
}
```

TrueFoundry should be the real implementation.

A mock implementation should exist for local tests.

## 2.2 Video Understanding Adapter

```ts
export interface VideoUnderstandingAdapter {
  extractActionTimeline(input: {
    videoPath: string;
    appContext: {
      appName: string;
      knownRoutes: string[];
      uiMapSummary?: string;
    };
  }): Promise<ExtractedActionTimeline>;
}
```

Qwen should be the primary implementation.

## 2.3 Semantic Search Adapter

```ts
export interface SemanticSearchAdapter {
  index(record: SemanticRecord): Promise<void>;
  upsertMany(records: SemanticRecord[]): Promise<void>;
  search(input: SemanticSearchInput): Promise<SemanticSearchResult[]>;
  deleteByFilter(filter: Record<string, string>): Promise<void>;
}
```

Moss should be the real implementation.

A local in-memory implementation should exist for development fallback.

## 2.4 Voice Transport Adapter

```ts
export interface VoiceTransportAdapter {
  createSession(input: {
    appId: string;
    sessionId: string;
    identity: string;
  }): Promise<{
    token: string;
    url: string;
  }>;
}
```

LiveKit should be the real implementation.

## 2.5 STT Adapter

```ts
export interface SpeechToTextAdapter {
  transcribe(input: {
    audioPath?: string;
    audioBuffer?: Buffer;
    mimeType?: string;
  }): Promise<{
    text: string;
    confidence?: number;
  }>;
}
```

## 2.6 TTS Adapter

```ts
export interface TextToSpeechAdapter {
  synthesize(input: {
    text: string;
    voice?: string;
  }): Promise<{
    audioPath?: string;
    audioUrl?: string;
    mimeType: string;
  }>;
}
```

Qwen Voice can be used here.

## 3. Video Understanding Pipeline

## 3.1 Input

```text
Workflow video uploaded through console.
```

## 3.2 Processing Steps

```text
1. Save uploaded video locally.
2. Create workflow job.
3. Extract keyframes if using frame-based processing.
4. Send video or keyframes to Qwen through TrueFoundry.
5. Request structured JSON action timeline.
6. Validate output.
7. Store raw output and parsed timeline.
```

## 3.3 Qwen Prompt

Use a strict prompt.

```text
You are analyzing a screen recording of a SaaS workflow.

Your task:
- Identify the user's goal.
- Identify the pages used.
- Identify each visible action in order.
- Use only actions visible in the recording.
- Do not guess selectors.
- Do not produce executable instructions.
- Output valid JSON only.

Return this JSON shape:
{
  "goal": "string",
  "summary": "string",
  "steps": [
    {
      "id": "string",
      "order": number,
      "page": "string|null",
      "route": "string|null",
      "action": "navigate|click|focus|fill|select|wait|unknown",
      "observedElement": "string|null",
      "observedValueType": "text|email|password|number|date|unknown|null",
      "observedValueExample": "string|null",
      "visualContext": "string|null",
      "timestampStartMs": number|null,
      "timestampEndMs": number|null,
      "confidence": number
    }
  ]
}
```

Add app context:

```text
Known app: Example App
Known routes:
- /login
- /dashboard
- /customers
- /customers/new
- /settings/team

Known UI summary:
{optional_ui_map_summary}
```

## 3.4 Qwen Output Validation

Validate:

1. JSON is parseable.
2. `goal` exists.
3. `steps` is an array.
4. Each step has an action.
5. Order values are sequential or can be sorted.
6. Confidence is 0 to 1 if present.
7. Unknown actions are allowed but must require review.

If invalid:

1. Store raw output.
2. Mark job failed.
3. Show validation errors in console.

## 4. Action-to-Element Matching with Moss

## 4.1 Matching Input

For each extracted step:

```json
{
  "page": "Customers",
  "route": "/customers",
  "action": "click",
  "observedElement": "Create Customer button",
  "visualContext": "top right of customer list"
}
```

## 4.2 Moss Search Query

Build:

```text
click create customer button on Customers page top right of customer list
```

Filters:

```json
{
  "appId": "app_example_app",
  "kind": "ui_element",
  "route": "/customers",
  "elementType": "button"
}
```

## 4.3 Matching Rules

If top score is high:

```text
match_status = matched
```

If top score is medium:

```text
match_status = needs_review
```

If no acceptable score:

```text
match_status = unmatched
```

Suggested thresholds:

```text
>= 0.80 matched
0.55 - 0.79 needs_review
< 0.55 unmatched
```

The exact threshold depends on Moss scores and should be tuned.

## 5. Workflow Compilation

After matching, compile each action to workflow DSL.

Mapping examples:

| Extracted Action | Matched Element Type | DSL Step |
|---|---|---|
| navigate | route | `navigate` |
| click | button/link | `click` |
| focus | input | `focus` |
| fill | input | `ask_user` + `fill` |
| select | select/dropdown | `ask_user` + `select` |
| wait | any | `wait_for_element` |

## 6. Runtime Intent Pipeline

## 6.1 Input

SDK sends:

```json
{
  "utterance": "Help me create a new customer",
  "context": {
    "currentRoute": "/dashboard",
    "focusedElement": null
  }
}
```

## 6.2 Runtime LLM Decision

The runtime LLM should classify:

```ts
type RuntimeIntent =
  | { type: "workflow_request"; query: string }
  | { type: "product_question"; query: string }
  | { type: "navigation_help"; query: string }
  | { type: "cancel" }
  | { type: "pause" }
  | { type: "resume" }
  | { type: "unknown"; query: string };
```

## 6.3 Intent Prompt

```text
You are an intent classifier for an in-product SaaS onboarding agent.

Classify the user request into one of:
- workflow_request
- product_question
- navigation_help
- cancel
- pause
- resume
- unknown

Return JSON only:
{
  "type": "...",
  "query": "...",
  "confidence": 0.0
}

User utterance:
{utterance}

Current route:
{current_route}
```

## 6.4 Workflow Search

If `workflow_request`:

Search Moss workflow index.

Search text:

```text
{utterance}
Current route: {route}
Focused element: {focused element label if any}
```

Filter:

```json
{
  "kind": "workflow",
  "appId": "app_example_app",
  "status": "published"
}
```

Backend loads workflow from DB using returned `workflowId`.

## 7. TTS Pipeline

TTS is required for MVP.

Backend should produce spoken responses for:

1. Intent resolution.
2. Ask-user prompts.
3. Confirmation prompts.
4. Workflow completion.
5. Errors.

Example:

```text
I can help you create a new customer. Let's start.
```

Backend calls TTS adapter and returns:

```json
{
  "message": "I can help you create a new customer. Let's start.",
  "tts": {
    "text": "I can help you create a new customer. Let's start.",
    "audioUrl": "/local-files/tts/tts_123.wav"
  }
}
```

## 8. LiveKit Runtime Session

LiveKit handles realtime audio/session transport.

For MVP, implement:

1. Token endpoint.
2. SDK connection.
3. Voice button starts session.
4. Audio is sent to backend or STT pipeline.
5. Backend returns intent result.

If full LiveKit integration is too slow, keep adapter and provide fallback text input, but TTS remains required.

## 9. Stubs Required for Codex

Codex should implement stubs:

### Mock Qwen

Returns fixed extracted timeline for example workflow video.

### Mock Moss

In-memory search over indexed records using simple keyword scoring.

### Mock TrueFoundry

Pass-through to mock Qwen or configured provider.

### Mock LiveKit

Returns mock token and allows text-mode fallback.

### Mock TTS

Writes a placeholder audio file or returns a local beep/audio URL.

## 10. Logging

Log all AI calls:

```ts
export type AIRequestLog = {
  id: string;
  provider: "qwen" | "runtime_llm" | "tts" | "moss" | "mock";
  purpose:
    | "video_understanding"
    | "description_generation"
    | "intent_classification"
    | "workflow_search"
    | "tts";
  inputSummary: string;
  outputSummary?: string;
  latencyMs?: number;
  error?: string;
  createdAt: string;
};
```

## 11. Safety

1. Qwen does not generate executable selectors.
2. Moss only returns candidate IDs.
3. Backend compiles draft workflow.
4. Human reviews and publishes.
5. Runtime executes only published workflows.
6. SDK obeys execution policy.
