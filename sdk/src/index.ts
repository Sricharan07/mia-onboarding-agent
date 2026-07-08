import { BackendClient } from "./client/backendClient.js";
import { collectRuntimeContext } from "./context/collectRuntimeContext.js";
import { MiaShadowCursor } from "./cursor/MiaShadowCursor.js";
import { activateElement } from "./execution/activateElement.js";
import { findElement } from "./execution/elementResolution.js";
import { WorkflowExecutor } from "./execution/WorkflowExecutor.js";
import type { GeminiLiveEvent, MiaStatus, ResolveResponse, RuntimeElementContext, SDKConfig } from "./types/index.js";
import { MiaAssistantPanel } from "./ui/MiaAssistantPanel.js";
import { MiaPromptUI } from "./ui/MiaPromptUI.js";
import { GeminiLiveClient } from "./voice/geminiLiveClient.js";

class AIOnboardingAgentInstance {
  private config?: SDKConfig;
  private backendClient?: BackendClient;
  private cursor?: MiaShadowCursor;
  private assistantPanel?: MiaAssistantPanel;
  private promptUi?: MiaPromptUI;
  private voice?: GeminiLiveClient;
  private activeExecutor?: WorkflowExecutor;
  private sessionId = `sdk_session_${crypto.randomUUID()}`;
  private pendingWorkflowInput?: {
    resolve: (value: string) => void;
    reject: (error: Error) => void;
    prompt: string;
    settled: boolean;
  };
  private pendingWorkflowInputCleanup?: () => void;
  private suppressNextAssistantResponse = false;
  private removePushToTalkListeners?: () => void;
  private pushToTalkHeld = false;
  private pushToTalkVoiceSession = false;
  private voiceStartPromise?: Promise<void>;
  private voiceStoppedLogged = false;
  private manualAssistantResponseSuppressUntil = 0;
  private recentRuntimeResolution?: { key: string; at: number };

  init(config: SDKConfig): void {
    this.destroy();
    this.sessionId = `sdk_session_${crypto.randomUUID()}`;
    this.config = config;
    this.backendClient = new BackendClient(config);
    this.cursor = new MiaShadowCursor();
    this.cursor.mount();
    this.cursor.setCursorIcon(config.ui?.cursorIcon);
    this.cursor.setOffset(config.ui?.cursorOffset);
    this.cursor.setTheme(config.ui?.theme ?? "auto");
    this.cursor.setBubbleMaxWidth(config.ui?.bubbleMaxWidth ?? 320);
    this.cursor.setBubbleLingerMs(config.ui?.bubbleLingerMs ?? 3000);
    if (config.ui?.assistantPanel !== false) {
      this.assistantPanel = new MiaAssistantPanel({
        enableVoice: Boolean(config.enableVoice),
        enableScreenShare: Boolean(config.enableScreenShare),
        textRedacted: config.privacy?.redactText !== false,
        getSuggestions: () => this.buildSuggestedPrompts(),
        onAsk: (text) => this.ask(text),
        onStartVoice: () => this.startVoice(),
        onStopVoice: () => this.stopVoice(),
        onCancel: () => this.cancelCurrentActivity()
      });
      this.assistantPanel.mount();
    }
    this.promptUi = new MiaPromptUI();
    this.voice = new GeminiLiveClient(this.backendClient);
    this.installPushToTalk();
    void this.backendClient.logExecution({
      sessionId: this.sessionId,
      eventType: "session_started",
      payload: { user: config.user?.id }
    }).catch((error) => config.onError?.(toError(error)));
    this.cursor.setState("idle");
  }

  destroy(): void {
    const activeConfig = this.config;
    this.removePushToTalkListeners?.();
    this.removePushToTalkListeners = undefined;
    this.pushToTalkHeld = false;
    this.pushToTalkVoiceSession = false;
    this.voiceStartPromise = undefined;
    this.voiceStoppedLogged = false;
    this.manualAssistantResponseSuppressUntil = 0;
    this.recentRuntimeResolution = undefined;
    this.pendingWorkflowInputCleanup?.();
    this.pendingWorkflowInputCleanup = undefined;
    if (this.pendingWorkflowInput && !this.pendingWorkflowInput.settled) {
      this.pendingWorkflowInput.settled = true;
      this.pendingWorkflowInput.reject(new Error("AIOnboardingAgent was destroyed."));
    }
    this.pendingWorkflowInput = undefined;
    this.suppressNextAssistantResponse = false;

    const executor = this.activeExecutor;
    this.activeExecutor = undefined;
    void executor?.cancel().catch((error) => activeConfig?.onError?.(toError(error)));

    const voice = this.voice;
    this.voice = undefined;
    void voice?.disconnect().catch((error) => activeConfig?.onError?.(toError(error)));

    this.promptUi?.destroy();
    this.promptUi = undefined;
    this.cursor?.destroy();
    this.cursor = undefined;
    this.assistantPanel?.destroy();
    this.assistantPanel = undefined;
    this.backendClient = undefined;
    this.config = undefined;
  }

  async ask(text: string): Promise<void> {
    if (!this.config || !this.backendClient || !this.cursor) {
      throw new Error("AIOnboardingAgent.init(config) must be called before ask().");
    }
    const context = collectRuntimeContext(this.config, this.sessionId);
    this.assistantPanel?.addTranscript({ role: "user", text });
    if (this.isVoiceConnected() && this.voice) {
      this.voice.sendText(text);
      await this.resolveRuntimeUtterance(text, "voice_text");
      return;
    }
    this.setStatus("thinking");
    this.cursor.setState("thinking");
    this.cursor.setBubbleText("Thinking...");
    const result = await this.backendClient.resolve({ sessionId: this.sessionId, utterance: text, context });
    this.logExecutionEvent("runtime_resolution", { ...resolveLogPayload(result), source: "text" });
    await this.handleResolveResult(result);
  }

  async startVoice(options: { microphoneInitiallyEnabled?: boolean } = {}): Promise<void> {
    if (!this.config || !this.backendClient || !this.cursor || !this.voice) {
      throw new Error("AIOnboardingAgent.init(config) must be called before startVoice().");
    }
    if (!this.config.enableVoice) {
      throw new Error("Voice is disabled. Set enableVoice=true to start a voice session.");
    }
    const context = collectRuntimeContext(this.config, this.sessionId);
    this.pushToTalkVoiceSession = options.microphoneInitiallyEnabled === false;
    this.voiceStoppedLogged = false;
    this.setStatus("connecting");
    this.cursor.setState("connecting");
    await this.voice.connect({
      sessionId: this.sessionId,
      context,
      enableScreenShare: Boolean(this.config.enableScreenShare),
      microphoneInitiallyEnabled: options.microphoneInitiallyEnabled,
      voiceName: this.config.voice?.voiceName,
      getContext: () => collectRuntimeContext(this.config!, this.sessionId),
      redactScreenFrame: this.config.privacy?.redactScreenFrame,
      onInputLevel: (level) => this.cursor?.setListeningLevel(level),
      onStage: (stage) => this.cursor?.setBubbleText(stage),
      onEvent: (event) => void this.handleVoiceEvent(event)
    });
    this.logExecutionEvent("voice_started", {
      mode: this.pushToTalkVoiceSession ? "push_to_talk" : "open_mic",
      screenShareEnabled: Boolean(this.config.enableScreenShare)
    });
    if (this.pushToTalkVoiceSession && !this.pushToTalkHeld) {
      this.showPushToTalkHint();
    }
  }

  async stopVoice(): Promise<void> {
    this.pushToTalkHeld = false;
    this.pushToTalkVoiceSession = false;
    this.voiceStartPromise = undefined;
    await this.voice?.disconnect();
    this.logVoiceStopped("requested");
    this.setStatus("ended");
    this.cursor?.setState("offline");
    this.cursor?.setBubbleText("Voice stopped");
    this.assistantPanel?.addTranscript({ role: "system", text: "Voice stopped. You can retry voice or keep using text." });
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
    this.recordAssistantResult(result);
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
    } else if (result.type === "element_action") {
      await this.handleElementActionResult(result);
    } else {
      const didPoint = this.pointAtResolveTarget(result);
      const fadeMs = this.cursor.startBubbleFade();
      if (didPoint) window.setTimeout(() => this.cursor?.returnToCursor(), fadeMs);
      this.setStatus(this.isVoiceConnected() ? "listening" : "idle");
    }
  }

  private async handleVoiceEvent(event: GeminiLiveEvent): Promise<void> {
    if (!this.cursor) return;
    if (event.type === "session_ready" || event.type === "listening") {
      if (this.activeExecutor) return;
      if (this.pushToTalkVoiceSession && !this.pushToTalkHeld) {
        this.showPushToTalkHint();
        return;
      }
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
      this.logExecutionEvent("voice_transcript_user", { text: event.text });
      if (this.pendingWorkflowInput) {
        this.resolvePendingWorkflowInput(event.text);
        return;
      }
      this.cursor.setBubbleText(`You: ${event.text}`);
      this.assistantPanel?.addTranscript({ role: "user", text: event.text });
      this.config?.onTranscript?.({ role: "user", text: event.text });
      void this.resolveRuntimeUtterance(event.text, "voice_transcript");
      return;
    }
    if (event.type === "transcript_assistant") {
      this.setStatus("speaking");
      this.cursor.setState("speaking");
      if (event.isFinal) this.logExecutionEvent("voice_transcript_assistant", { text: event.text });
      if (event.isFinal) this.assistantPanel?.addTranscript({ role: "assistant", text: event.text });
      this.config?.onTranscript?.({ role: "assistant", text: event.text });
      return;
    }
    if (event.type === "assistant_response") {
      if (this.suppressNextAssistantResponse) {
        this.suppressNextAssistantResponse = false;
        return;
      }
      if (Date.now() < this.manualAssistantResponseSuppressUntil) return;
      this.config?.onTranscript?.({ role: "assistant", text: event.message });
      this.logExecutionEvent("voice_resolution", resolveLogPayload(event.result));
      await this.handleResolveResult(event.result);
      return;
    }
    if (event.type === "error") {
      const error = new Error(event.message);
      this.logExecutionEvent("voice_error", { message: event.message, code: event.code });
      this.cursor.setState("error");
      this.cursor.setBubbleText(event.message);
      this.assistantPanel?.setError(event.message);
      this.promptUi?.showError(event.message);
      this.config?.onError?.(error);
      this.setStatus("error");
      return;
    }
    if (event.type === "ended") {
      this.pushToTalkHeld = false;
      this.pushToTalkVoiceSession = false;
      this.voiceStartPromise = undefined;
      this.logVoiceStopped("ended");
      this.setStatus("ended");
      this.cursor.setState("offline");
      this.cursor.setBubbleText("Voice stopped");
      this.assistantPanel?.addTranscript({ role: "system", text: "Voice stopped. You can retry voice or keep using text." });
      this.cursor.startBubbleFade();
    }
  }

  private async handleControlResult(result: Extract<ResolveResponse, { type: "control" }>): Promise<void> {
    if (!this.cursor || !this.config) return;
    if (!this.activeExecutor) {
      this.cursor.startBubbleFade();
      this.setStatus(this.isVoiceConnected() ? "listening" : "idle");
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

  private async handleElementActionResult(result: Extract<ResolveResponse, { type: "element_action" }>): Promise<void> {
    if (!this.cursor || !this.promptUi) return;
    this.setStatus("guiding");
    this.cursor.setState("guiding");
    this.cursor.setBubbleText(result.message);

    const element = resolveRuntimeTargetElement(result.target);
    if (!element) {
      this.pointAtResolveTarget({ type: "answer", message: result.message, target: result.target });
      this.cursor.startBubbleFade();
      this.setStatus(this.isVoiceConnected() ? "listening" : "idle");
      return;
    }

    element.scrollIntoView({ behavior: "smooth", block: "center" });
    await wait(260);
    const rect = element.getBoundingClientRect();
    this.cursor.navigateTo(rect.x + rect.width / 2, rect.y + rect.height / 2, targetLabel(result.target));
    await wait(560);

    if (result.executionPolicy === "requires_confirmation") {
      const approved = await this.promptUi.confirm(`Should I continue with ${targetLabel(result.target)}?`);
      if (!approved) {
        this.cursor.setBubbleText("Cancelled");
        this.cursor.startBubbleFade();
        this.setStatus(this.isVoiceConnected() ? "listening" : "idle");
        return;
      }
    }

    if (result.action === "click") {
      activateElement(element as HTMLElement);
    } else {
      (element as HTMLElement).focus();
    }
    this.logExecutionEvent("element_action_completed", {
      action: result.action,
      target: targetLogPayload(result.target)
    });
    this.cursor.returnToCursor();
    this.cursor.setBubbleText("Done");
    this.cursor.startBubbleFade();
    this.setStatus(this.isVoiceConnected() ? "listening" : "idle");
  }

  private pointAtResolveTarget(result: ResolveResponse): boolean {
    if (result.type !== "answer" && result.type !== "no_match") return false;
    const target = result.target;
    const box = target?.boundingBox;
    if (!box || box.width <= 0 || box.height <= 0) return false;
    this.cursor?.navigateTo(box.x + box.width / 2, box.y + box.height / 2, targetLabel(target));
    return true;
  }

  private logExecutionEvent(eventType: string, payload: Record<string, unknown>): void {
    const backendClient = this.backendClient;
    const config = this.config;
    if (!backendClient) return;
    void backendClient.logExecution({
      sessionId: this.sessionId,
      eventType,
      payload
    }).catch((error) => config?.onError?.(toError(error)));
  }

  private logVoiceStopped(reason: string): void {
    if (this.voiceStoppedLogged) return;
    this.voiceStoppedLogged = true;
    this.logExecutionEvent("voice_stopped", { reason });
  }

  private async resolveRuntimeUtterance(text: string, source: "voice_transcript" | "voice_text"): Promise<void> {
    if (!this.config || !this.backendClient || !this.cursor) return;
    const utterance = text.trim();
    if (!utterance) return;

    const key = normalizeRuntimeUtterance(utterance);
    const now = Date.now();
    if (this.recentRuntimeResolution?.key === key && now - this.recentRuntimeResolution.at < 4000) return;
    this.recentRuntimeResolution = { key, at: now };
    this.manualAssistantResponseSuppressUntil = now + 5000;

    this.setStatus("thinking");
    this.cursor.setState("thinking");
    this.cursor.setBubbleText("Thinking...");

    try {
      const result = await this.backendClient.resolve({
        sessionId: this.sessionId,
        utterance,
        context: collectRuntimeContext(this.config, this.sessionId)
      });
      this.logExecutionEvent("voice_resolution", { ...resolveLogPayload(result), source });
      await this.handleResolveResult(result);
    } catch (error) {
      const handled = toError(error);
      this.cursor.setState("error");
      this.cursor.setBubbleText(handled.message);
      this.assistantPanel?.setError(handled.message);
      this.promptUi?.showError(handled.message);
      this.config?.onError?.(handled);
      this.setStatus("error");
      this.logExecutionEvent("voice_error", { message: handled.message, source });
    }
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
        reject,
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
    this.assistantPanel?.addTranscript({ role: "user", text: value });
    this.config?.onTranscript?.({ role: "user", text: value });
    pending.resolve(value);
  }

  private installPushToTalk(): void {
    if (!this.config?.enableVoice) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (!isPushToTalkKey(event)) return;
      event.preventDefault();
      if (event.repeat) return;
      if (this.voice?.isConnected() && !this.pushToTalkVoiceSession) return;
      this.pushToTalkHeld = true;
      void this.startPushToTalk().catch((error) => this.config?.onError?.(toError(error)));
    };

    const handleKeyUp = (event: KeyboardEvent) => {
      if (!this.pushToTalkHeld || (event.code !== "Space" && event.key !== "Control")) return;
      event.preventDefault();
      this.endPushToTalk();
    };

    document.addEventListener("keydown", handleKeyDown);
    document.addEventListener("keyup", handleKeyUp);
    this.removePushToTalkListeners = () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("keyup", handleKeyUp);
    };
  }

  private async startPushToTalk(): Promise<void> {
    if (!this.config || !this.voice || !this.cursor) return;
    if (!this.voice.isConnected()) {
      this.voiceStartPromise ??= this.startVoice({ microphoneInitiallyEnabled: false })
        .finally(() => {
          this.voiceStartPromise = undefined;
        });
      await this.voiceStartPromise;
    }
    if (!this.pushToTalkHeld) {
      this.voice?.setMicrophoneEnabled(false);
      this.showPushToTalkHint();
      return;
    }
    this.pushToTalkVoiceSession = true;
    this.voice.setMicrophoneEnabled(true);
    this.setStatus("listening");
    this.cursor.setState("listening");
    this.cursor.setBubbleText("Listening...");
  }

  private endPushToTalk(): void {
    this.pushToTalkHeld = false;
    if (!this.pushToTalkVoiceSession) return;
    this.voice?.setMicrophoneEnabled(false);
    if (this.voice?.isConnected()) this.showPushToTalkHint();
  }

  private showPushToTalkHint(): void {
    this.setStatus("idle");
    this.cursor?.setState("idle");
    this.cursor?.setBubbleText("Hold Control+Space to talk");
    this.cursor?.startBubbleFade();
  }

  private setStatus(status: MiaStatus): void {
    if (status !== "ended") this.cursor?.setState(status);
    this.assistantPanel?.setStatus(status);
    this.config?.onStatusChange?.(status);
  }

  private isVoiceConnected(): boolean {
    return Boolean(this.config?.enableVoice && this.voice instanceof GeminiLiveClient && this.voice.isConnected());
  }

  private async cancelCurrentActivity(): Promise<void> {
    if (this.activeExecutor) {
      await this.activeExecutor.cancel();
      this.assistantPanel?.addTranscript({ role: "system", text: "Workflow cancelled." });
      this.setStatus(this.isVoiceConnected() ? "listening" : "idle");
      return;
    }
    if (this.isVoiceConnected()) {
      await this.stopVoice();
      return;
    }
    this.cursor?.cancelNavigation();
    this.cursor?.setBubbleText("Stopped");
    this.cursor?.startBubbleFade();
    this.assistantPanel?.addTranscript({ role: "system", text: "Mia stopped the current action." });
    this.setStatus("idle");
  }

  private recordAssistantResult(result: ResolveResponse): void {
    if (this.isVoiceConnected() && result.type === "answer") return;
    const target = "target" in result && result.target ? ` Target: ${targetLabel(result.target)}.` : "";
    const action = result.type === "element_action" ? ` Action: ${result.action}.` : "";
    this.assistantPanel?.addTranscript({ role: "assistant", text: `${result.message}${target}${action}` });
  }

  private buildSuggestedPrompts(): string[] {
    if (!this.config) return defaultPrompts();
    const context = collectRuntimeContext(this.config, this.sessionId);
    const labels = (context.visibleElements ?? [])
      .map((element) => targetLabel(element))
      .filter((label) => label && label !== "that item" && label !== "target")
      .filter(uniqueByNormalized)
      .slice(0, 3);
    const prompts = labels.flatMap((label, index) => index === 0
      ? [`Where is ${label}?`, `Click ${label}`]
      : [`Where is ${label}?`]
    );
    return [...prompts, ...defaultPrompts()].slice(0, 5);
  }

}

export const AIOnboardingAgent = new AIOnboardingAgentInstance();
export type * from "./types/index.js";

function resolveLogPayload(result: ResolveResponse): Record<string, unknown> {
  if (result.type === "workflow") {
    return {
      resultType: result.type,
      message: result.message,
      workflowId: result.workflow.workflowId,
      workflowName: result.workflow.name
    };
  }
  if (result.type === "control") {
    return {
      resultType: result.type,
      action: result.action,
      message: result.message
    };
  }
  if (result.type === "element_action") {
    return {
      resultType: result.type,
      action: result.action,
      message: result.message,
      executionPolicy: result.executionPolicy,
      target: targetLogPayload(result.target)
    };
  }
  return {
    resultType: result.type,
    message: result.message,
    target: result.target ? targetLogPayload(result.target) : undefined
  };
}

function targetLogPayload(target: RuntimeElementContext): Record<string, unknown> {
  return {
    label: target.label,
    text: target.text,
    elementId: target.elementId,
    selector: target.selector,
    boundingBox: target.boundingBox
  };
}

function targetLabel(target: RuntimeElementContext): string {
  return target.label ?? target.text ?? target.elementId ?? target.selector ?? "target";
}

function resolveRuntimeTargetElement(target: RuntimeElementContext): Element | null {
  if (target.selector) {
    const element = findElement(target.selector);
    if (element) return element;
  }
  const box = target.boundingBox;
  if (!box) return null;
  return document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function isPushToTalkKey(event: KeyboardEvent): boolean {
  return event.ctrlKey && event.code === "Space";
}

function normalizeRuntimeUtterance(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

function defaultPrompts(): string[] {
  return [
    "What can I do on this page?",
    "Show me the most important section",
    "Help me understand this screen"
  ];
}

function uniqueByNormalized(value: string, index: number, values: string[]): boolean {
  const normalized = value.toLowerCase().replace(/\s+/g, " ").trim();
  return values.findIndex((candidate) => candidate.toLowerCase().replace(/\s+/g, " ").trim() === normalized) === index;
}
