import { BackendClient } from "./client/backendClient.js";
import { collectRuntimeContext } from "./context/collectRuntimeContext.js";
import { MiaShadowCursor } from "./cursor/MiaShadowCursor.js";
import { WorkflowExecutor } from "./execution/WorkflowExecutor.js";
import type { MiaStatus, ResolveResponse, SDKConfig, VoiceSessionEvent } from "./types/index.js";
import { MiaPromptUI } from "./ui/MiaPromptUI.js";
import { LiveKitVoiceClient } from "./voice/livekitClient.js";

class AIOnboardingAgentInstance {
  private config?: SDKConfig;
  private backendClient?: BackendClient;
  private cursor?: MiaShadowCursor;
  private promptUi?: MiaPromptUI;
  private voice?: LiveKitVoiceClient;
  private sessionId = `sdk_session_${crypto.randomUUID()}`;
  private speakingMeter?: number;

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
    this.voice = new LiveKitVoiceClient(this.backendClient);
    void this.backendClient.logExecution({
      sessionId: this.sessionId,
      eventType: "session_started",
      payload: { user: config.user?.id }
    });
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
    this.setStatus("thinking");
    this.cursor.setState("thinking");
    this.cursor.setBubbleText("Thinking...");
    const result = await this.backendClient.resolve({ sessionId: this.sessionId, utterance: text, context });
    await this.handleResolveResult(result, { playTts: true });
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
      identity: this.config.user?.id ?? this.sessionId,
      context,
      onInputLevel: (level) => this.cursor?.setListeningLevel(level),
      onEvent: (event) => void this.handleVoiceEvent(event)
    });
  }

  async stopVoice(): Promise<void> {
    await this.voice?.disconnect();
    this.stopSpeakingMeter();
    this.setStatus("ended");
    this.cursor?.setState("offline");
    this.cursor?.setBubbleText("Mia voice ended");
    this.cursor?.startBubbleFade();
  }

  async connectVoice(): Promise<void> {
    await this.startVoice();
  }

  private async handleResolveResult(result: ResolveResponse, options: { playTts: boolean }): Promise<void> {
    if (!this.config || !this.backendClient || !this.promptUi || !this.cursor) {
      throw new Error("AIOnboardingAgent.init(config) must be called before handling runtime results.");
    }
    this.cursor.setBubbleText(result.message);
    if (options.playTts) await this.playTts(result.tts);
    if (result.type === "workflow") {
      this.setStatus("guiding");
      const executor = new WorkflowExecutor({
        workflow: result.workflow,
        backendClient: this.backendClient,
        cursor: this.cursor,
        promptUi: this.promptUi,
        clientSessionId: this.sessionId,
        onWorkflowEvent: this.config.onWorkflowEvent
      });
      await executor.start();
    } else {
      this.cursor.startBubbleFade();
      this.setStatus(this.config.enableVoice ? "listening" : "idle");
    }
  }

  private async handleVoiceEvent(event: VoiceSessionEvent): Promise<void> {
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
      this.cursor.setBubbleText(`You: ${event.text}`);
      this.config?.onTranscript?.({ role: "user", text: event.text });
      return;
    }
    if (event.type === "assistant_response") {
      this.config?.onTranscript?.({ role: "assistant", text: event.message });
      await this.handleResolveResult(event.result, { playTts: false });
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

  private async playTts(tts?: { text: string; audioUrl?: string; mimeType?: string }): Promise<void> {
    if (!this.config?.enableTTS || !tts) return;
    const audioUrl = tts.audioUrl ?? (await this.backendClient?.synthesize(tts.text))?.audioUrl;
    if (!audioUrl) return;
    const absoluteUrl = audioUrl.startsWith("http") ? audioUrl : `${this.config.backendUrl.replace(/\/+$/, "")}${audioUrl}`;
    const audio = new Audio(absoluteUrl);
    this.startSpeakingMeter();
    await new Promise<void>((resolve) => {
      audio.onended = () => resolve();
      audio.onerror = () => resolve();
      void audio.play().catch(() => resolve());
    });
    this.stopSpeakingMeter();
    if (this.config.enableVoice) this.cursor?.setState("listening");
  }

  private setStatus(status: MiaStatus): void {
    if (status !== "ended") this.cursor?.setState(status);
    this.config?.onStatusChange?.(status);
  }

  private startSpeakingMeter(): void {
    this.stopSpeakingMeter();
    let t = 0;
    this.speakingMeter = window.setInterval(() => {
      t += 0.22;
      const wave = Math.abs(Math.sin(t)) * 0.42;
      const jitter = Math.random() * 0.1;
      this.cursor?.setSpeakingLevel(Math.min(1, 0.18 + wave + jitter));
    }, 60);
  }

  private stopSpeakingMeter(): void {
    if (this.speakingMeter) window.clearInterval(this.speakingMeter);
    this.speakingMeter = undefined;
    this.cursor?.setSpeakingLevel(0);
  }
}

export const AIOnboardingAgent = new AIOnboardingAgentInstance();
export type * from "./types/index.js";
