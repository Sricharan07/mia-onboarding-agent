import { DomAgentActor } from "./agent/DomAgentActuator.js";
import { BackendClient } from "./client/backendClient.js";
import { AgentObservationCollector, redact } from "./context/AgentObservationCollector.js";
import { MiaShadowCursor } from "./cursor/MiaShadowCursor.js";
import type {
  ActionDirective,
  AgentResponse,
  ConfirmationRequest,
  MiaActionDefinition,
  MiaActionManifest,
  MiaContextEntry,
  MiaEvent,
  MiaOptions,
  MiaStatus,
  MiaVisualContext,
  Observation,
  VoiceEvent
} from "./types/index.js";
import { MiaAssistantPanel } from "./ui/MiaAssistantPanel.js";
import { GeminiLiveClient, type VoiceAgentResult } from "./voice/geminiLiveClient.js";

type SessionReference = { sessionId: string; resumeToken: string };
type PendingConfirmationInteraction = {
  claimed: boolean;
  prompt: string;
  promise: Promise<VoiceAgentResult>;
  resolve: (approved: boolean) => boolean;
};
type PendingInputInteraction = {
  claimed: boolean;
  promise: Promise<VoiceAgentResult>;
  resolve: (value: string) => boolean;
};

export class Mia {
  private readonly backend: BackendClient;
  private readonly collector: AgentObservationCollector;
  private readonly cursor: MiaShadowCursor;
  private readonly panel?: MiaAssistantPanel;
  private readonly actor: DomAgentActor;
  private readonly voice: GeminiLiveClient;
  private readonly storageKey: string;
  private session?: SessionReference;
  private revision = 0;
  private operation?: AbortController;
  private destroyed = false;
  private voiceActive = false;
  private pendingConfirmation?: PendingConfirmationInteraction;
  private pendingInput?: PendingInputInteraction;
  private removeHotkeys?: () => void;
  private pushToTalkHeld = false;
  private voiceStart?: Promise<void>;

  static async init(options: MiaOptions): Promise<Mia> {
    validateOptions(options);
    const instance = new Mia(options);
    await instance.initialize();
    return instance;
  }

  private constructor(private readonly options: MiaOptions) {
    this.backend = new BackendClient(options);
    this.collector = new AgentObservationCollector(options);
    this.cursor = new MiaShadowCursor();
    this.cursor.mount(options.ui?.styleNonce);
    this.cursor.setTheme(options.ui?.theme ?? "auto");
    this.cursor.setCursorIcon(options.ui?.cursorIcon);
    this.cursor.setOffset(options.ui?.cursorOffset);
    this.cursor.setBubbleMaxWidth(options.ui?.bubbleMaxWidth ?? 320);
    this.cursor.setBubbleLingerMs(options.ui?.bubbleLingerMs ?? 3_000);
    if (options.ui?.enabled !== false) {
      this.panel = new MiaAssistantPanel({
        voiceEnabled: options.voice?.enabled === true,
        onAsk: (text) => this.ask(text),
        onToggleVoice: () => this.voiceActive ? this.stopVoice() : this.startVoice(),
        onStop: () => this.stop(),
        styleNonce: options.ui?.styleNonce
      });
      this.panel.mount();
    }
    this.actor = new DomAgentActor({
      collector: this.collector,
      cursor: this.cursor,
      config: options,
      onAction: (action, receipt) => {
        if (!receipt) {
          if (action.target) this.panel?.closePanel();
          this.emit({ type: "action_requested", action });
          this.setStatus("guiding");
          this.cursor.setBubbleText(action.message);
        } else {
          this.emit({ type: "action_completed", receipt });
        }
      }
    });
    this.voice = new GeminiLiveClient(this.backend);
    this.storageKey = `mia:v1:${hash(options.backendUrl)}`;
  }

  async ask(text: string): Promise<void> {
    this.assertActive();
    const utterance = text.trim();
    if (!utterance) return;
    if (this.operation && !this.operation.signal.aborted) await this.stop();
    const controller = new AbortController();
    this.operation = controller;
    try {
      const result = await this.runTurn(utterance, "text", controller.signal, "text");
      if (this.voiceActive) this.voice.speak(result.spokenMessage);
    } catch (error) {
      if (!controller.signal.aborted) this.handleError(error);
    } finally {
      if (this.operation === controller) this.operation = undefined;
    }
  }

  async startVoice(): Promise<void> {
    this.assertActive();
    if (this.options.voice?.enabled !== true) throw new Error("Voice is disabled for this Mia installation.");
    if (this.voiceActive || this.voiceStart) return this.voiceStart;
    const microphoneInitiallyEnabled = this.options.voice.openMic !== false || this.pushToTalkHeld;
    this.setStatus("connecting");
    const start = this.voice.connect({
      voice: this.options.voice.voice || "Aoede",
      microphoneInitiallyEnabled,
      onTurn: (utterance) => this.handleVoiceTurn(utterance),
      onConfirmation: (approved) => this.handleVoiceConfirmation(approved),
      onEvent: (event) => this.handleVoiceEvent(event)
    }).then(() => {
      this.voiceActive = true;
      this.panel?.setVoiceActive(true);
      this.installPushToTalk();
      this.emit({ type: "voice_started" });
      if (this.pendingConfirmation) this.voice.announceConfirmation(this.pendingConfirmation.prompt);
    }).finally(() => { this.voiceStart = undefined; });
    this.voiceStart = start;
    return start;
  }

  async stopVoice(): Promise<void> {
    this.pushToTalkHeld = false;
    await this.voice.disconnect();
    this.voiceActive = false;
    this.panel?.setVoiceActive(false);
    this.setStatus("ended");
    this.emit({ type: "voice_stopped" });
  }

  async stop(): Promise<void> {
    const active = this.operation;
    this.operation = undefined;
    active?.abort(new DOMException("Stopped by user", "AbortError"));
    this.pendingConfirmation = undefined;
    this.pendingInput = undefined;
    this.voice.interrupt();
    this.cursor.cancelNavigation();
    this.cursor.resetBubble();
    if (this.session) await this.backend.cancel(this.session.sessionId).then((value) => { this.revision = value.revision; }).catch(() => undefined);
    this.setStatus("idle");
    this.emit({ type: "cancelled" });
  }

  async confirm(approved: boolean): Promise<void> {
    const pending = this.pendingConfirmation;
    if (!pending || !pending.resolve(approved)) throw new Error("Mia has no pending confirmation.");
    await pending.promise;
  }

  async provideInput(value: string): Promise<void> {
    const pending = this.pendingInput;
    if (!pending || !pending.resolve(value)) throw new Error("Mia has no pending input request.");
    await pending.promise;
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    const active = this.operation;
    this.operation = undefined;
    active?.abort(new DOMException("Mia was destroyed", "AbortError"));
    this.pendingConfirmation = undefined;
    this.pendingInput = undefined;
    this.voice.interrupt();
    void this.voice.disconnect().catch(() => undefined);
    if (this.session) void this.backend.cancel(this.session.sessionId).catch(() => undefined);
    this.removeHotkeys?.();
    this.removeHotkeys = undefined;
    this.collector.destroy();
    this.panel?.destroy();
    this.cursor.destroy();
  }

  private async initialize(): Promise<void> {
    const signal = new AbortController().signal;
    const runtime = await this.runtime(signal);
    const stored = this.readSession();
    let pending: Awaited<ReturnType<BackendClient["resumeSession"]>>["pending"];
    if (stored) {
      try {
        const resumed = await this.backend.resumeSession({ ...runtime, ...stored });
        this.session = stored;
        this.revision = resumed.revision;
        pending = resumed.pending;
      } catch {
        this.clearSession();
      }
    }
    if (!this.session) {
      const created = await this.backend.createSession(runtime);
      this.session = { sessionId: created.sessionId, resumeToken: created.resumeToken };
      this.revision = created.revision;
      this.writeSession(this.session);
    }
    this.setStatus("idle");
    this.emit({ type: "ready", sessionId: this.session.sessionId });
    if (this.options.voice?.enabled === true) this.installPushToTalk();
    void this.backend.recordEvent("sdk_ready", { route: runtime.observation.route }, this.session.sessionId).catch(() => undefined);
    if (pending) void this.recoverPending(pending);
  }

  private async recoverPending(pending: NonNullable<Awaited<ReturnType<BackendClient["resumeSession"]>>["pending"]>): Promise<void> {
    const controller = new AbortController();
    this.operation = controller;
    try {
      if (pending.recovery === "confirm") {
        await this.processResponse({
          sessionId: this.requireSession().sessionId,
          revision: this.revision,
          status: "waiting_confirmation",
          assessment: pending.assessment,
          progress: pending.progress,
          type: "actions",
          message: pending.message,
          actions: pending.actions
        }, controller.signal, "text");
        return;
      }
      const observedRoute = `${location.pathname}${location.search}${location.hash}`;
      const exactRouteMatch = pending.recovery === "verify_navigation"
        && Boolean(pending.expectedRoute)
        && canonicalRoute(observedRoute) === canonicalRoute(pending.expectedRoute!);
      const receipts = pending.actions.map((action) => ({
        actionId: action.actionId,
        idempotencyKey: action.idempotencyKey,
        type: action.type,
        status: pending.recovery === "verify_navigation"
          ? exactRouteMatch ? "completed" as const : "failed" as const
          : "cancelled" as const,
        message: pending.recovery === "verify_navigation"
          ? exactRouteMatch
            ? `The observed route exactly matches the expected destination ${pending.expectedRoute}.`
            : `The observed route ${observedRoute} does not match the expected destination ${pending.expectedRoute}.`
          : "The pending action was cancelled after reload so Mia can re-observe safely.",
        targetRef: action.target?.ref,
        route: observedRoute,
        evidence: {
          recoveredAfterReload: true,
          route: observedRoute,
          ...(pending.expectedRoute ? { expectedRoute: pending.expectedRoute, exactRouteMatch } : {})
        }
      }));
      const runtime = await this.runtime(controller.signal);
      const response = await this.backend.continueSession({
        ...runtime,
        sessionId: this.requireSession().sessionId,
        revision: this.revision,
        receipts,
        signal: controller.signal
      }, (event) => this.handleStreamEvent(event));
      await this.processResponse(response, controller.signal, "text");
    } catch (error) {
      if (!controller.signal.aborted) this.handleError(error);
    } finally {
      if (this.operation === controller && !this.pendingConfirmation && !this.pendingInput) this.operation = undefined;
    }
  }

  private async runTurn(
    utterance: string,
    source: "text" | "voice",
    signal: AbortSignal,
    mode: "text" | "voice"
  ): Promise<VoiceAgentResult> {
    const session = this.requireSession();
    this.addTranscript("user", utterance);
    this.setStatus("thinking");
    const runtime = await this.runtime(signal);
    let response = await this.backend.submitTurn({
      ...runtime,
      sessionId: session.sessionId,
      revision: this.revision,
      utterance,
      source,
      signal
    }, (event) => this.handleStreamEvent(event));
    return this.processResponse(response, signal, mode);
  }

  private async processResponse(response: AgentResponse, signal: AbortSignal, mode: "text" | "voice"): Promise<VoiceAgentResult> {
    this.revision = response.revision;
    this.panel?.setProgress(response.progress);
    this.emit({ type: "progress", assessment: response.assessment, progress: response.progress });
    if (response.status === "waiting_confirmation") return this.awaitConfirmation(response, signal, mode);
    if (response.type === "actions") return this.executeActions(response, signal, mode);
    if (response.type === "ask_user") return this.awaitInput(response, signal, mode);
    const state = response.type === "unable" ? "error" : response.type === "complete" ? "completed" : "answer";
    this.addTranscript("assistant", response.message);
    this.cursor.setBubbleText(response.message);
    this.cursor.startBubbleFade();
    this.setStatus(response.type === "unable" ? "error" : "idle");
    this.emit(response.status === "completed" ? { type: "completed", message: response.message } : { type: "answer", message: response.message });
    return { spokenMessage: response.message, state };
  }

  private async awaitConfirmation(response: AgentResponse, signal: AbortSignal, mode: "text" | "voice"): Promise<VoiceAgentResult> {
    const confirmation = response.actions.find((action) => action.confirmation)?.confirmation;
    if (!confirmation) throw new Error("Mia backend requested confirmation without a confirmation binding.");
    this.emit({ type: "confirmation_required", confirmation, actions: response.actions });
    this.setStatus("idle");
    if (mode === "voice") {
      const pending = this.createPendingConfirmation(response, confirmation, signal, mode);
      pending.promise.then((result) => { if (!pending.claimed && this.voiceActive) this.voice.speak(result.spokenMessage); }).catch((error) => {
        if (!signal.aborted) this.handleError(error);
      });
      return { spokenMessage: confirmation.prompt, state: "confirmation" };
    }
    return this.createPendingConfirmation(response, confirmation, signal, mode).promise;
  }

  private async resolveConfirmation(
    response: AgentResponse,
    confirmation: ConfirmationRequest,
    approved: boolean,
    source: "text" | "voice" | "ui",
    signal: AbortSignal,
    mode: "text" | "voice"
  ): Promise<VoiceAgentResult> {
    const session = this.requireSession();
    const resolved = await this.backend.confirm({
      sessionId: session.sessionId,
      confirmationId: confirmation.id,
      revision: this.revision,
      binding: confirmation.binding,
      approved,
      source,
      observation: this.collector.collect()
    });
    this.revision = resolved.revision;
    if (!approved) {
      const message = "Okay, I did not make that change.";
      this.addTranscript("assistant", message);
      this.setStatus("idle");
      return { spokenMessage: message, state: "answer" };
    }
    return this.executeActions(response, signal, mode);
  }

  private async executeActions(response: AgentResponse, signal: AbortSignal, mode: "text" | "voice"): Promise<VoiceAgentResult> {
    const session = this.requireSession();
    this.setStatus("guiding");
    const before = this.collector.collect();
    const executed = await this.actor.executeBatch(response.actions, before, signal);
    assertActive(signal);
    const runtime = await this.runtime(signal, executed.visualContext);
    const next = await this.backend.continueSession({
      ...runtime,
      sessionId: session.sessionId,
      revision: this.revision,
      receipts: executed.receipts,
      signal
    }, (event) => this.handleStreamEvent(event));
    return this.processResponse(next, signal, mode);
  }

  private async awaitInput(response: AgentResponse, signal: AbortSignal, mode: "text" | "voice"): Promise<VoiceAgentResult> {
    this.addTranscript("assistant", response.message);
    this.setStatus("idle");
    if (mode === "voice") {
      const pending = this.createPendingInput(response, signal, mode);
      pending.promise.then((result) => { if (!pending.claimed && this.voiceActive) this.voice.speak(result.spokenMessage); }).catch((error) => {
        if (!signal.aborted) this.handleError(error);
      });
      return { spokenMessage: response.message, state: "input" };
    }
    return this.createPendingInput(response, signal, mode).promise;
  }

  private async handleVoiceTurn(utterance: string): Promise<VoiceAgentResult> {
    if (this.pendingInput) {
      this.pendingInput.claimed = true;
      if (!this.pendingInput.resolve(utterance)) return { spokenMessage: "I still need the requested information.", state: "input" };
      return this.pendingInput.promise;
    }
    if (this.pendingConfirmation) return { spokenMessage: "Please approve or decline the pending action.", state: "confirmation" };
    if (this.operation && !this.operation.signal.aborted) await this.stop();
    const controller = new AbortController();
    this.operation = controller;
    try {
      return await this.runTurn(utterance, "voice", controller.signal, "voice");
    } finally {
      if (!this.pendingConfirmation && !this.pendingInput && this.operation === controller) this.operation = undefined;
    }
  }

  private async handleVoiceConfirmation(approved: boolean): Promise<VoiceAgentResult> {
    const pending = this.pendingConfirmation;
    if (!pending) return { spokenMessage: "There is no pending action to confirm.", state: "error" };
    pending.claimed = true;
    if (!pending.resolve(approved)) return { spokenMessage: "That confirmation is no longer active.", state: "error" };
    return pending.promise;
  }

  private createPendingConfirmation(
    response: AgentResponse,
    confirmation: ConfirmationRequest,
    signal: AbortSignal,
    mode: "text" | "voice"
  ): PendingConfirmationInteraction {
    const external = this.panel ? undefined : abortableDeferred<boolean>(signal);
    const approval = this.panel
      ? this.panel.requestConfirmation(confirmation, signal)
      : external!.promise;
    const pending = {} as PendingConfirmationInteraction;
    pending.claimed = false;
    pending.prompt = confirmation.prompt;
    pending.resolve = (approved) => this.panel ? this.panel.resolveConfirmation(approved) : external!.resolve(approved);
    pending.promise = approval
      .then((approved) => this.resolveConfirmation(response, confirmation, approved, pending.claimed ? "voice" : "ui", signal, mode))
      .finally(() => {
        if (this.pendingConfirmation === pending) this.pendingConfirmation = undefined;
        this.voice.clearConfirmation();
        this.releaseOperation(signal);
      });
    this.pendingConfirmation = pending;
    return pending;
  }

  private createPendingInput(response: AgentResponse, signal: AbortSignal, mode: "text" | "voice"): PendingInputInteraction {
    const external = this.panel ? undefined : abortableDeferred<string>(signal);
    const answer = this.panel
      ? this.panel.requestInput({ message: response.message, inputType: response.input?.inputType, choices: response.input?.choices }, signal)
      : external!.promise;
    const pending = {} as PendingInputInteraction;
    pending.claimed = false;
    pending.resolve = (value) => {
      const normalized = value.trim();
      if (!normalized) return false;
      return this.panel ? this.panel.resolveInput(normalized) : external!.resolve(normalized);
    };
    pending.promise = answer
      .then((value) => this.runTurn(value, pending.claimed ? "voice" : "text", signal, mode))
      .finally(() => {
        if (this.pendingInput === pending) this.pendingInput = undefined;
        this.releaseOperation(signal);
      });
    this.pendingInput = pending;
    return pending;
  }

  private releaseOperation(signal: AbortSignal): void {
    if (this.operation?.signal === signal && !this.pendingConfirmation && !this.pendingInput) this.operation = undefined;
  }

  private async runtime(signal: AbortSignal, visualContext: MiaVisualContext[] = []) {
    const runtimeConfig = await this.backend.getRuntimeConfig(signal);
    this.collector.setRuntimeRedactedSelectors(runtimeConfig.redactedSelectors);
    const observation = this.collector.collect();
    const context = await Promise.all((this.options.contextProviders ?? []).map(async (provider): Promise<MiaContextEntry> => ({
      name: provider.name,
      description: provider.description,
      trusted: provider.trusted ?? false,
      content: redact((await provider.getContext({ signal, observation })).slice(0, 10_000), this.options)
    })));
    if (this.options.visualContextProvider) {
      context.push({ name: "visual_context_available", description: "An optional visual provider can inspect canvas, chart, map, or image content when semantic context is insufficient.", content: "available", trusted: true });
    }
    return { observation, actions: actionManifests(this.options.actions ?? []), context, visualContext };
  }

  private handleStreamEvent(event: { type: string; data: unknown }): void {
    if (event.type === "thinking") {
      this.setStatus("thinking");
      this.emit({ type: "thinking", message: "Understanding your request" });
    }
    if (event.type === "progress" && event.data && typeof event.data === "object") {
      const data = event.data as { assessment?: string; progress?: string };
      this.panel?.setProgress(data.progress ?? "");
    }
  }

  private handleVoiceEvent(event: VoiceEvent): void {
    if (event.type === "ready") this.setStatus("idle");
    else if (event.type === "listening") this.setStatus("listening");
    else if (event.type === "thinking") this.setStatus("thinking");
    else if (event.type === "speaking") this.setStatus("speaking");
    else if (event.type === "input_level") this.cursor.setListeningLevel(event.level);
    else if (event.type === "user_transcript") this.emit({ type: "transcript", role: "user", text: event.text });
    else if (event.type === "assistant_transcript") this.emit({ type: "transcript", role: "assistant", text: event.text });
    else if (event.type === "error") this.handleError(event.error);
    else if (event.type === "ended") {
      this.voiceActive = false;
      this.panel?.setVoiceActive(false);
      this.setStatus("offline");
    }
  }

  private installPushToTalk(): void {
    if (this.removeHotkeys || this.options.voice?.pushToTalk === false) return;
    const openMic = this.options.voice?.openMic !== false;
    const keydown = (event: KeyboardEvent) => {
      if (event.code !== "Space" || !event.ctrlKey || event.repeat) return;
      event.preventDefault();
      this.pushToTalkHeld = true;
      if (!this.voiceActive) {
        void this.startVoice().then(() => this.voice.setMicrophoneEnabled(this.pushToTalkHeld || openMic)).catch((error) => this.handleError(error));
      } else {
        this.voice.setMicrophoneEnabled(true);
      }
    };
    const keyup = (event: KeyboardEvent) => {
      if (event.code !== "Space" || !this.pushToTalkHeld) return;
      event.preventDefault();
      this.pushToTalkHeld = false;
      this.voice.setMicrophoneEnabled(openMic);
    };
    const blur = () => {
      if (!this.pushToTalkHeld) return;
      this.pushToTalkHeld = false;
      this.voice.setMicrophoneEnabled(openMic);
    };
    window.addEventListener("keydown", keydown, true);
    window.addEventListener("keyup", keyup, true);
    window.addEventListener("blur", blur);
    this.removeHotkeys = () => {
      window.removeEventListener("keydown", keydown, true);
      window.removeEventListener("keyup", keyup, true);
      window.removeEventListener("blur", blur);
    };
  }

  private addTranscript(role: "user" | "assistant" | "system", text: string): void {
    this.panel?.addTranscript({ role, text });
    this.emit({ type: "transcript", role, text });
  }

  private setStatus(status: MiaStatus): void {
    this.panel?.setStatus(status);
    this.cursor.setState(status === "ended" ? "offline" : status);
  }

  private handleError(error: unknown): void {
    const value = toError(error);
    this.panel?.showError(value);
    this.setStatus("error");
    this.emit({ type: "error", error: value });
  }

  private emit(event: MiaEvent): void {
    try { this.options.onEvent?.(event); } catch { /* Host callbacks cannot break Mia. */ }
  }

  private requireSession(): SessionReference {
    if (!this.session) throw new Error("Mia has not finished initializing.");
    return this.session;
  }

  private readSession(): SessionReference | undefined {
    try {
      const value = sessionStorage.getItem(this.storageKey);
      if (!value) return undefined;
      const parsed = JSON.parse(value) as Partial<SessionReference>;
      return parsed.sessionId && parsed.resumeToken ? { sessionId: parsed.sessionId, resumeToken: parsed.resumeToken } : undefined;
    } catch { return undefined; }
  }

  private writeSession(value: SessionReference): void {
    try { sessionStorage.setItem(this.storageKey, JSON.stringify(value)); } catch { /* Session resumption is best effort in restricted storage contexts. */ }
  }

  private clearSession(): void {
    try { sessionStorage.removeItem(this.storageKey); } catch { /* Ignore restricted storage. */ }
  }

  private assertActive(): void {
    if (this.destroyed) throw new Error("This Mia instance has been destroyed.");
  }
}

export function defineMiaAction<TInput extends Record<string, unknown>>(definition: MiaActionDefinition<TInput>): MiaActionDefinition<TInput> {
  validateAction(definition);
  return definition;
}

function validateOptions(options: MiaOptions): void {
  if (typeof window === "undefined" || typeof document === "undefined") throw new Error("Mia.init must run in a browser.");
  const backend = new URL(options.backendUrl, window.location.href);
  if (!/^https?:$/.test(backend.protocol)) throw new Error("Mia backendUrl must use HTTP or HTTPS.");
  if (typeof options.tokenProvider !== "function") throw new Error("Mia tokenProvider is required.");
  const names = new Set<string>();
  for (const action of options.actions ?? []) {
    validateAction(action);
    if (names.has(action.name)) throw new Error(`Duplicate Mia action: ${action.name}.`);
    names.add(action.name);
  }
  for (const provider of options.contextProviders ?? []) {
    if (!/^[a-z][a-z0-9_]{0,63}$/.test(provider.name)) throw new Error(`Invalid Mia context provider name: ${provider.name}.`);
  }
}

function validateAction<TInput extends Record<string, unknown>>(action: MiaActionDefinition<TInput>): void {
  if (!/^[a-z][a-z0-9_]{0,63}$/.test(action.name)) throw new Error(`Invalid Mia action name: ${action.name}.`);
  if (!action.description.trim()) throw new Error(`Mia action ${action.name} requires a description.`);
  if (!action.inputSchema || typeof action.inputSchema !== "object") throw new Error(`Mia action ${action.name} requires a JSON input schema.`);
  if (!["read", "navigate", "reversible_write", "manual", "blocked"].includes(action.risk)) throw new Error(`Mia action ${action.name} has an invalid risk classification.`);
  const effectMatchesRisk = action.risk === "read" ? action.effect === "read"
    : action.risk === "navigate" ? action.effect === "navigate"
      : action.risk === "reversible_write" ? ["draft_create", "draft_update", "reversible_change"].includes(action.effect)
        : action.effect === "protected";
  if (!effectMatchesRisk) throw new Error(`Mia action ${action.name} effect ${action.effect} is incompatible with risk ${action.risk}.`);
}

function actionManifests(actions: MiaActionDefinition[]): MiaActionManifest[] {
  return actions.map(({ name, description, inputSchema, risk, effect }) => ({ name, description, inputSchema, risk, effect }));
}

function hash(value: string): string {
  let result = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    result ^= value.charCodeAt(index);
    result = Math.imul(result, 0x01000193);
  }
  return (result >>> 0).toString(36);
}

function canonicalRoute(value: string): string {
  const url = new URL(value, location.origin);
  const path = url.pathname.length > 1 ? url.pathname.replace(/\/+$/, "") : url.pathname || "/";
  return `${path}${url.search}${url.hash}`;
}

function assertActive(signal: AbortSignal): void {
  if (signal.aborted) throw signal.reason ?? new DOMException("Aborted", "AbortError");
}

function toError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}

function abortableDeferred<T>(signal: AbortSignal): { promise: Promise<T>; resolve: (value: T) => boolean } {
  let settled = false;
  let resolvePromise!: (value: T) => void;
  let rejectPromise!: (reason: unknown) => void;
  const promise = new Promise<T>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });
  const abort = () => {
    if (settled) return;
    settled = true;
    rejectPromise(signal.reason ?? new DOMException("Aborted", "AbortError"));
  };
  if (signal.aborted) abort();
  else signal.addEventListener("abort", abort, { once: true });
  return {
    promise,
    resolve: (value) => {
      if (settled) return false;
      settled = true;
      signal.removeEventListener("abort", abort);
      resolvePromise(value);
      return true;
    }
  };
}

export type {
  ActionDirective,
  AgentResponse,
  MiaActionDefinition,
  MiaActionEffect,
  MiaActionReceiptResult,
  MiaContextEntry,
  MiaContextProvider,
  MiaEvent,
  MiaOptions,
  MiaVisualContext,
  MiaVisualContextProvider,
  Observation,
  ObservationNode,
  RiskLevel
} from "./types/index.js";
