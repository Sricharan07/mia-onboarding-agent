import { BackendClient } from "./client/backendClient.js";
import { collectRuntimeContext } from "./context/collectRuntimeContext.js";
import { MiaShadowCursor } from "./cursor/MiaShadowCursor.js";
import { WorkflowExecutor } from "./execution/WorkflowExecutor.js";
import type { GeminiLiveEvent, MiaStatus, ResolveResponse, SDKConfig } from "./types/index.js";
import { MiaPromptUI } from "./ui/MiaPromptUI.js";
import { GeminiLiveClient } from "./voice/geminiLiveClient.js";

class AIOnboardingAgentInstance {
  private config?: SDKConfig;
  private backendClient?: BackendClient;
  private cursor?: MiaShadowCursor;
  private promptUi?: MiaPromptUI;
  private voice?: GeminiLiveClient;
  private activeExecutor?: WorkflowExecutor;
  private sessionId = `sdk_session_${crypto.randomUUID()}`;
  private pendingWorkflowInput?: {
    resolve: (value: string) => void;
    prompt: string;
    settled: boolean;
  };
  private pendingWorkflowInputCleanup?: () => void;
  private suppressNextAssistantResponse = false;

  init(config: SDKConfig): void {
    this.config = config;
    this.backendClient = new BackendClient(config);
    this.cursor = new MiaShadowCursor();
    this.cursor.mount();
    this.cursor.setCursorIcon(config.ui?.cursorIcon);
    this.cursor.setOffset(config.ui?.cursorOffset);
    this.cursor.setTheme(config.ui?.theme ?? "auto");
    this.cursor.setBubbleMaxWidth(config.ui?.bubbleMaxWidth ?? 320);
    this.cursor.setBubbleLingerMs(config.ui?.bubbleLingerMs ?? 3000);
    this.promptUi = new MiaPromptUI();
    this.voice = new GeminiLiveClient(this.backendClient);
    void this.backendClient.logExecution({
      sessionId: this.sessionId,
      eventType: "session_started",
      payload: { user: config.user?.id }
    }).catch((error) => config.onError?.(toError(error)));
    if (config.enableVoice) {
      this.cursor.setState("connecting");
      this.cursor.setBubbleText("Starting Mia voice...");
      queueMicrotask(() => {
        void this.startVoice().catch((error) => {
          const message = error instanceof Error ? error.message : String(error);
          this.cursor?.setState("error");
          this.cursor?.setBubbleText(message);
          this.promptUi?.showError(message);
          this.config?.onError?.(error instanceof Error ? error : new Error(message));
        });
      });
    } else {
      this.cursor.setState("idle");
    }
  }

  async ask(text: string): Promise<void> {
    if (!this.config || !this.backendClient || !this.cursor) {
      throw new Error("AIOnboardingAgent.init(config) must be called before ask().");
    }
    const context = collectRuntimeContext(this.config, this.sessionId);
    if (this.config.enableVoice && this.voice instanceof GeminiLiveClient && this.voice.isConnected()) {
      this.voice.sendText(text);
      return;
    }
    this.setStatus("thinking");
    this.cursor.setState("thinking");
    this.cursor.setBubbleText("Thinking...");
    const result = await this.backendClient.resolve({ sessionId: this.sessionId, utterance: text, context });
    await this.handleResolveResult(result);
  }

  async startVoice(): Promise<void> {
    if (!this.config || !this.backendClient || !this.cursor || !this.voice) {
      throw new Error("AIOnboardingAgent.init(config) must be called before startVoice().");
    }
    if (!this.config.enableVoice) {
      throw new Error("Voice is disabled. Set enableVoice=true to start a voice session.");
    }
    const context = collectRuntimeContext(this.config, this.sessionId);
    this.setStatus("connecting");
    this.cursor.setState("connecting");
    await this.voice.connect({
      sessionId: this.sessionId,
      context,
      enableScreenShare: Boolean(this.config.enableScreenShare),
      getContext: () => collectRuntimeContext(this.config!, this.sessionId),
      redactScreenFrame: this.config.privacy?.redactScreenFrame,
      onInputLevel: (level) => this.cursor?.setListeningLevel(level),
      onStage: (stage) => this.cursor?.setBubbleText(stage),
      onEvent: (event) => void this.handleVoiceEvent(event)
    });
  }

  async stopVoice(): Promise<void> {
    await this.voice?.disconnect();
    this.setStatus("ended");
    this.cursor?.setState("offline");
    this.cursor?.setBubbleText("Mia voice ended");
    this.cursor?.startBubbleFade();
  }

  async connectVoice(): Promise<void> {
    await this.startVoice();
  }

  private async handleResolveResult(result: ResolveResponse): Promise<void> {
    if (!this.config || !this.backendClient || !this.promptUi || !this.cursor) {
      throw new Error("AIOnboardingAgent.init(config) must be called before handling runtime results.");
    }
    this.cursor.setBubbleText(result.message);
    if (result.type === "workflow") {
      this.setStatus("guiding");
      const executor = new WorkflowExecutor({
        workflow: result.workflow,
        backendClient: this.backendClient,
        cursor: this.cursor,
        promptUi: this.promptUi,
        clientSessionId: this.sessionId,
        navigate: this.config.navigate,
        requestUserInput: (input) => this.requestWorkflowInput(input),
        onWorkflowEvent: this.config.onWorkflowEvent
      });
      this.activeExecutor = executor;
      try {
        await executor.start();
      } finally {
        if (this.activeExecutor === executor) this.activeExecutor = undefined;
      }
    } else if (result.type === "control") {
      await this.handleControlResult(result);
    } else {
      this.cursor.startBubbleFade();
      this.setStatus(this.config.enableVoice ? "listening" : "idle");
    }
  }

  private async handleVoiceEvent(event: GeminiLiveEvent): Promise<void> {
    if (!this.cursor) return;
    if (event.type === "session_ready" || event.type === "listening") {
      this.setStatus("listening");
      this.cursor.setState("listening");
      return;
    }
    if (event.type === "thinking") {
      this.setStatus("thinking");
      this.cursor.setState("thinking");
      this.cursor.setBubbleText("Thinking...");
      return;
    }
    if (event.type === "transcript_user") {
      if (this.pendingWorkflowInput) {
        this.resolvePendingWorkflowInput(event.text);
        return;
      }
      this.cursor.setBubbleText(`You: ${event.text}`);
      this.config?.onTranscript?.({ role: "user", text: event.text });
      return;
    }
    if (event.type === "transcript_assistant") {
      this.config?.onTranscript?.({ role: "assistant", text: event.text });
      return;
    }
    if (event.type === "assistant_response") {
      if (this.suppressNextAssistantResponse) {
        this.suppressNextAssistantResponse = false;
        return;
      }
      this.config?.onTranscript?.({ role: "assistant", text: event.message });
      await this.handleResolveResult(event.result);
      return;
    }
    if (event.type === "error") {
      const error = new Error(event.message);
      this.cursor.setState("error");
      this.cursor.setBubbleText(event.message);
      this.promptUi?.showError(event.message);
      this.config?.onError?.(error);
      this.setStatus("error");
      return;
    }
    if (event.type === "ended") {
      this.setStatus("ended");
      this.cursor.setState("offline");
      this.cursor.setBubbleText("Mia voice ended");
      this.cursor.startBubbleFade();
    }
  }

  private async handleControlResult(result: Extract<ResolveResponse, { type: "control" }>): Promise<void> {
    if (!this.cursor || !this.config) return;
    if (!this.activeExecutor) {
      this.cursor.startBubbleFade();
      this.setStatus(this.config.enableVoice ? "listening" : "idle");
      return;
    }

    if (result.action === "cancel") {
      await this.activeExecutor.cancel();
      return;
    }
    if (result.action === "pause") {
      await this.activeExecutor.pause();
      this.setStatus("guiding");
      return;
    }
    await this.activeExecutor.resume();
    this.setStatus("guiding");
  }

  private async requestWorkflowInput(input: { prompt: string; inputType?: string; choices?: string[]; signal?: AbortSignal }): Promise<string> {
    if (!this.config || !this.backendClient || !this.cursor || !this.promptUi) {
      throw new Error("AIOnboardingAgent.init(config) must be called before collecting workflow input.");
    }

    if (!this.config.enableVoice || !this.voice?.isConnected()) {
      return this.promptUi.ask(input.prompt, input.inputType, input.choices, input.signal);
    }

    if (input.choices?.length) {
      return this.promptUi.ask(input.prompt, input.inputType, input.choices, input.signal);
    }

    this.cursor.setState("listening");
    this.cursor.setBubbleText(input.prompt);
    this.promptUi.showListening(input.prompt);
    const inputPromise = new Promise<string>((resolve, reject) => {
      const abort = () => {
        this.pendingWorkflowInput = undefined;
        this.promptUi?.clear();
        reject(new Error("Workflow cancelled."));
      };
      if (input.signal?.aborted) {
        abort();
        return;
      }
      input.signal?.addEventListener("abort", abort, { once: true });
      this.pendingWorkflowInput = {
        resolve,
        prompt: input.prompt,
        settled: false
      };
      this.pendingWorkflowInputCleanup = () => input.signal?.removeEventListener("abort", abort);
    });

    try {
      return await inputPromise;
    } finally {
      this.pendingWorkflowInputCleanup?.();
      this.pendingWorkflowInputCleanup = undefined;
      this.pendingWorkflowInput = undefined;
      this.promptUi.clear();
    }
  }

  private resolvePendingWorkflowInput(text: string): void {
    const pending = this.pendingWorkflowInput;
    if (!pending || pending.settled) return;
    const value = text.trim();
    if (!value) return;
    pending.settled = true;
    this.pendingWorkflowInput = undefined;
    this.suppressNextAssistantResponse = true;
    this.cursor?.setBubbleText(`Got it: ${value}`);
    this.config?.onTranscript?.({ role: "user", text: value });
    pending.resolve(value);
  }

  private setStatus(status: MiaStatus): void {
    if (status !== "ended") this.cursor?.setState(status);
    this.config?.onStatusChange?.(status);
  }

}

export const AIOnboardingAgent = new AIOnboardingAgentInstance();
export type * from "./types/index.js";

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
