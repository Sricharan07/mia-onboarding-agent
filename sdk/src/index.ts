import { BackendClient } from "./client/backendClient.js";
import { collectRuntimeContext } from "./context/collectRuntimeContext.js";
import { CursorOverlay } from "./cursor/CursorOverlay.js";
import { WorkflowExecutor } from "./execution/WorkflowExecutor.js";
import type { SDKConfig } from "./types/index.js";
import { AssistantUI } from "./ui/AssistantUI.js";
import { LiveKitVoiceClient } from "./voice/livekitClient.js";

class AIOnboardingAgentInstance {
  private config?: SDKConfig;
  private backendClient?: BackendClient;
  private cursor?: CursorOverlay;
  private ui?: AssistantUI;
  private voice?: LiveKitVoiceClient;
  private sessionId = `sdk_session_${crypto.randomUUID()}`;

  init(config: SDKConfig): void {
    this.config = config;
    this.backendClient = new BackendClient(config);
    this.cursor = config.ui?.showCursor === false ? undefined : new CursorOverlay();
    this.ui = new AssistantUI((text) => {
      void this.ask(text);
    });
    this.voice = new LiveKitVoiceClient(this.backendClient);
    void this.backendClient.logExecution({
      sessionId: this.sessionId,
      eventType: "session_started",
      payload: { user: config.user?.id }
    });
  }

  async ask(text: string): Promise<void> {
    if (!this.config || !this.backendClient || !this.ui) {
      throw new Error("AIOnboardingAgent.init(config) must be called before ask().");
    }
    const context = collectRuntimeContext(this.config, this.sessionId);
    const result = await this.backendClient.resolve({ sessionId: this.sessionId, utterance: text, context });
    this.ui.say(result.message);
    await this.playTts(result.tts);

    if (result.type === "workflow") {
      const executor = new WorkflowExecutor({
        workflow: result.workflow,
        backendClient: this.backendClient,
        cursor: this.cursor ?? new CursorOverlay(),
        ui: this.ui,
        clientSessionId: this.sessionId
      });
      await executor.start();
    }
  }

  async connectVoice(): Promise<void> {
    if (!this.config || !this.backendClient || !this.voice) {
      throw new Error("AIOnboardingAgent.init(config) must be called before connectVoice().");
    }
    await this.voice.connect({
      sessionId: this.sessionId,
      identity: this.config.user?.id ?? this.sessionId
    });
  }

  private async playTts(tts?: { text: string; audioUrl?: string; mimeType?: string }): Promise<void> {
    if (!this.config?.enableTTS || !tts) return;
    const audioUrl = tts.audioUrl ?? (await this.backendClient?.synthesize(tts.text))?.audioUrl;
    if (!audioUrl) return;
    const absoluteUrl = audioUrl.startsWith("http") ? audioUrl : `${this.config.backendUrl.replace(/\/+$/, "")}${audioUrl}`;
    const audio = new Audio(absoluteUrl);
    await audio.play().catch(() => undefined);
  }
}

export const AIOnboardingAgent = new AIOnboardingAgentInstance();
export type * from "./types/index.js";
