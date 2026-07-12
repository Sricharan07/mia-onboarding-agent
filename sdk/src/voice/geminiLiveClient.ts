import type { BackendClient } from "../client/backendClient.js";
import type { VoiceEvent } from "../types/index.js";
import { MicLevelMeter } from "./micLevelMeter.js";

const CONNECT_TIMEOUT_MS = 15_000;
const INPUT_RATE = 16_000;
const OUTPUT_RATE = 24_000;
const TOOL_GRACE_MS = 400;
// Gemini can deliver a tool call before the final transcription frame for the
// same audio turn. Keep the call pending long enough for that authoritative
// transcript instead of treating normal provider reordering as a voice error.
const TRANSCRIPT_WAIT_MS = 10_000;
const TRANSCRIPT_SETTLE_MS = 250;
const AUDIO_PROCESSOR = "mia-pcm-capture";
const RESULT_PREFIX = "[MIA_AGENT_RESULT]";

export type VoiceAgentResult = {
  spokenMessage: string;
  state: "answer" | "completed" | "confirmation" | "input" | "progress" | "error";
};
type VoiceHandlers = {
  voice: string;
  microphoneInitiallyEnabled: boolean;
  onTurn: (utterance: string) => Promise<VoiceAgentResult>;
  onConfirmation: (approved: boolean) => Promise<VoiceAgentResult>;
  onEvent: (event: VoiceEvent) => void;
};
type FunctionCall = { id?: string; name?: string; args?: Record<string, unknown> };
type AudioChunk = { data: string; mimeType?: string };
type FinalizedVoiceInput = {
  utterance: string;
  consumedByTool: boolean;
  result?: Promise<VoiceAgentResult>;
};
type TranscriptWaiter = {
  resolve: (input: FinalizedVoiceInput) => void;
  reject: (error: Error) => void;
  timer: number;
};

export class GeminiLiveClient {
  private socket?: WebSocket;
  private handlers?: VoiceHandlers;
  private connected = false;
  private intentionalClose = false;
  private lifecycle = 0;
  private sessionHandle?: string;
  private reconnecting?: Promise<void>;
  private setupResolve?: () => void;
  private setupReject?: (error: Error) => void;

  private micStream?: MediaStream;
  private micContext?: AudioContext;
  private micSource?: MediaStreamAudioSourceNode;
  private micProcessor?: AudioWorkletNode;
  private micSink?: GainNode;
  private meter?: MicLevelMeter;
  private microphoneEnabled = true;
  private stoppingMicrophone = false;

  private outputContext?: AudioContext;
  private readonly outputSources = new Set<AudioBufferSourceNode>();
  private nextAudioTime = 0;
  private playbackTimer?: number;
  private removeAudioUnlock?: () => void;
  private pendingAudio: AudioChunk[] = [];
  private expectedSpeech?: string;
  private outputTranscript = "";
  private retrySpeech = 0;

  private inputTranscript = "";
  private fallbackTimer?: number;
  private transcriptSettleTimer?: number;
  private finalizedInput?: FinalizedVoiceInput;
  private readonly transcriptWaiters = new Set<TranscriptWaiter>();
  private activeUtterance?: string;
  private activeTurn?: Promise<VoiceAgentResult>;
  private cancelledCalls = new Set<string>();
  private awaitingConfirmation = false;

  constructor(private readonly backend: BackendClient) {}

  isConnected(): boolean {
    return this.connected && this.socket?.readyState === WebSocket.OPEN;
  }

  async connect(handlers: VoiceHandlers): Promise<void> {
    if (this.isConnected()) return;
    this.handlers = handlers;
    this.intentionalClose = false;
    this.microphoneEnabled = handlers.microphoneInitiallyEnabled;
    const lifecycle = ++this.lifecycle;
    this.prepareOutputAudio();
    try {
      await this.openSocket(lifecycle);
      await this.startMicrophone();
      handlers.onEvent({ type: "ready" });
      if (this.microphoneEnabled) handlers.onEvent({ type: "listening" });
    } catch (error) {
      await this.disconnect();
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    this.intentionalClose = true;
    this.lifecycle += 1;
    this.connected = false;
    this.clearFallback();
    this.clearTranscriptSettle();
    this.rejectTranscriptWaiters(new Error("Mia voice was stopped."));
    this.finalizedInput = undefined;
    this.inputTranscript = "";
    this.clearOutput();
    this.stopMicrophone();
    this.stopOutputAudio();
    this.setupReject?.(new Error("Mia voice was stopped."));
    this.setupResolve = undefined;
    this.setupReject = undefined;
    const socket = this.socket;
    this.socket = undefined;
    if (socket && socket.readyState !== WebSocket.CLOSED && socket.readyState !== WebSocket.CLOSING) socket.close();
    this.handlers = undefined;
  }

  setMicrophoneEnabled(enabled: boolean): void {
    const changed = this.microphoneEnabled !== enabled;
    this.microphoneEnabled = enabled;
    for (const track of this.micStream?.getAudioTracks() ?? []) track.enabled = enabled;
    if (!enabled) {
      this.handlers?.onEvent({ type: "input_level", level: 0 });
      this.handlers?.onEvent({ type: "ready" });
      if (changed && this.isConnected()) this.send({ realtimeInput: { audioStreamEnd: true } });
    } else if (changed) {
      this.interruptOutput();
      this.handlers?.onEvent({ type: "listening" });
    }
  }

  interrupt(): void {
    this.interruptOutput();
    if (this.isConnected()) this.send({ realtimeInput: { activityEnd: {} } });
  }

  speak(message: string): void {
    const text = message.trim();
    if (!text || !this.isConnected()) return;
    this.expectSpeech(text);
    this.send({
      clientContent: {
        turns: [{ role: "user", parts: [{ text: `${RESULT_PREFIX}\n${JSON.stringify({ spokenMessage: text })}` }] }],
        turnComplete: true
      }
    });
  }

  announceConfirmation(message: string): void {
    this.awaitingConfirmation = true;
    this.speak(message);
  }

  clearConfirmation(): void {
    this.awaitingConfirmation = false;
  }

  private async openSocket(lifecycle: number): Promise<void> {
    const token = await withTimeout(
      this.backend.createLiveToken(this.handlers?.voice, this.sessionHandle),
      CONNECT_TIMEOUT_MS,
      "Gemini Live token request timed out."
    );
    this.assertLifecycle(lifecycle);
    const socket = new WebSocket(`${token.websocketUrl}?access_token=${encodeURIComponent(token.token)}`);
    socket.binaryType = "arraybuffer";
    this.socket = socket;
    socket.onmessage = (event) => void this.handleMessage(event);
    socket.onerror = () => this.setupReject?.(new Error("Gemini Live connection failed."));
    socket.onclose = (event) => this.handleClose(socket, event);
    await withTimeout(waitForOpen(socket), CONNECT_TIMEOUT_MS, "Gemini Live connection timed out.");
    this.assertLifecycle(lifecycle);
    this.connected = true;
    const setup = new Promise<void>((resolve, reject) => { this.setupResolve = resolve; this.setupReject = reject; });
    this.sendSetup(token.model, token.voice, token.language);
    await withTimeout(setup, CONNECT_TIMEOUT_MS, "Gemini Live setup timed out.");
    this.setupResolve = undefined;
    this.setupReject = undefined;
  }

  private sendSetup(model: string, voice: string, language: string): void {
    this.send({
      setup: {
        model: model.startsWith("models/") ? model : `models/${model}`,
        generationConfig: {
          responseModalities: ["AUDIO"],
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } },
            languageCode: language
          },
          thinkingConfig: { thinkingLevel: "MINIMAL" }
        },
        systemInstruction: { role: "system", parts: [{ text: voiceSystemInstruction(voice) }] },
        inputAudioTranscription: {},
        outputAudioTranscription: {},
        sessionResumption: this.sessionHandle ? { handle: this.sessionHandle } : {},
        contextWindowCompression: { slidingWindow: {} },
        tools: [{ functionDeclarations: [
          {
            name: "submit_mia_turn",
            description: "Submit every complete user request or answer to Mia's authoritative product agent. Never answer independently.",
            parameters: { type: "OBJECT", properties: { utterance: { type: "STRING" } }, required: ["utterance"] }
          },
          {
            name: "respond_to_mia_confirmation",
            description: "Use only when Mia has asked for confirmation and the user clearly approves or declines.",
            parameters: { type: "OBJECT", properties: { approved: { type: "BOOLEAN" } }, required: ["approved"] }
          }
        ] }]
      }
    });
  }

  private async startMicrophone(): Promise<void> {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error("Microphone capture is unavailable in this browser.");
    const stream = await withTimeout(navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
    }), CONNECT_TIMEOUT_MS, "Microphone permission timed out.");
    this.micStream = stream;
    const track = stream.getAudioTracks()[0];
    if (!track) throw new Error("No microphone audio track was available.");
    track.enabled = this.microphoneEnabled;
    track.addEventListener("ended", () => {
      if (this.intentionalClose || this.stoppingMicrophone) return;
      void this.endUnexpectedly(new Error("Microphone capture stopped."), false);
    }, { once: true });
    this.meter = new MicLevelMeter(track, (level) => this.handlers?.onEvent({ type: "input_level", level: this.microphoneEnabled ? level : 0 }));
    this.meter.start();
    const context = new AudioContext();
    this.micContext = context;
    if (context.state === "suspended") await context.resume();
    if (!context.audioWorklet) throw new Error("AudioWorklet microphone capture is unavailable in this browser.");
    await context.audioWorklet.addModule(new URL("./micCaptureProcessor.js", import.meta.url).toString());
    this.micSource = context.createMediaStreamSource(stream);
    this.micProcessor = new AudioWorkletNode(context, AUDIO_PROCESSOR, { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] });
    this.micProcessor.port.onmessage = (event: MessageEvent<ArrayBuffer>) => {
      if (!this.isConnected() || !this.microphoneEnabled) return;
      const samples = new Float32Array(event.data);
      const pcm = encodePcm16(downsample(samples, context.sampleRate, INPUT_RATE));
      if (pcm.byteLength) this.send({ realtimeInput: { audio: { data: toBase64(pcm), mimeType: `audio/pcm;rate=${INPUT_RATE}` } } });
    };
    this.micSink = context.createGain();
    this.micSink.gain.value = 0;
    this.micSource.connect(this.micProcessor);
    this.micProcessor.connect(this.micSink);
    this.micSink.connect(context.destination);
  }

  private stopMicrophone(): void {
    this.stoppingMicrophone = true;
    this.meter?.stop();
    this.meter = undefined;
    this.micProcessor?.disconnect();
    if (this.micProcessor) {
      this.micProcessor.port.onmessage = null;
      this.micProcessor.port.close();
    }
    this.micProcessor = undefined;
    this.micSink?.disconnect();
    this.micSink = undefined;
    this.micSource?.disconnect();
    this.micSource = undefined;
    void this.micContext?.close();
    this.micContext = undefined;
    this.micStream?.getTracks().forEach((track) => track.stop());
    this.micStream = undefined;
    this.stoppingMicrophone = false;
  }

  private async handleMessage(event: MessageEvent): Promise<void> {
    const message = await parseFrame(event.data);
    if (!message) return;
    const providerError = providerErrorFrom(message);
    if (providerError) {
      this.setupReject?.(providerError);
      this.handlers?.onEvent({ type: "error", error: providerError });
      return;
    }
    if (message.setupComplete ?? message.setup_complete) this.setupResolve?.();
    const resumption = object(message.sessionResumptionUpdate) ?? object(message.session_resumption_update);
    const handle = string(resumption?.newHandle ?? resumption?.new_handle);
    if (handle) this.sessionHandle = handle;
    const cancellation = object(message.toolCallCancellation) ?? object(message.tool_call_cancellation);
    for (const id of array(cancellation?.ids).filter((value): value is string => typeof value === "string")) this.cancelledCalls.add(id);
    const content = object(message.serverContent) ?? object(message.server_content);
    if (content) this.handleContent(content);
    const tool = object(message.toolCall) ?? object(message.tool_call);
    const calls = array(tool?.functionCalls ?? tool?.function_calls).map(object).filter((value): value is FunctionCall => Boolean(value));
    if (calls.length) await this.handleCalls(calls);
    if (message.goAway ?? message.go_away) this.refreshConnection(new Error("Gemini Live requested a connection refresh."));
  }

  private handleContent(content: Record<string, unknown>): void {
    if (content.interrupted) this.interruptOutput();
    const input = object(content.inputTranscription) ?? object(content.input_transcription);
    const inputText = string(input?.text);
    if (inputText && !inputText.startsWith(RESULT_PREFIX)) {
      if (!this.inputTranscript) this.interruptOutput();
      this.inputTranscript = mergeTranscript(this.inputTranscript, inputText);
      this.scheduleTranscriptFinalization();
    }
    const output = object(content.outputTranscription) ?? object(content.output_transcription);
    const outputText = string(output?.text);
    if (outputText) this.outputTranscript = mergeTranscript(this.outputTranscript, outputText);
    const turn = object(content.modelTurn) ?? object(content.model_turn);
    for (const raw of array(turn?.parts)) {
      const part = object(raw);
      const inline = object(part?.inlineData) ?? object(part?.inline_data);
      const data = string(inline?.data);
      const mimeType = string(inline?.mimeType ?? inline?.mime_type);
      if (data && (!mimeType || mimeType.startsWith("audio/"))) this.pendingAudio.push({ data, mimeType });
    }
    if (content.turnComplete ?? content.turn_complete) {
      this.finishInputTurn();
      this.finishOutputTurn();
    }
  }

  private finishInputTurn(): void {
    this.finalizeInputTurn();
  }

  private finalizeInputTurn(): FinalizedVoiceInput | undefined {
    this.clearTranscriptSettle();
    const utterance = this.inputTranscript.trim();
    this.inputTranscript = "";
    if (!utterance || utterance.startsWith(RESULT_PREFIX)) return undefined;
    const input: FinalizedVoiceInput = { utterance, consumedByTool: false };
    this.finalizedInput = input;
    this.handlers?.onEvent({ type: "user_transcript", text: utterance });
    this.resolveTranscriptWaiter(input);
    this.clearFallback();
    if (this.awaitingConfirmation || input.consumedByTool) return input;
    this.fallbackTimer = window.setTimeout(() => {
      this.fallbackTimer = undefined;
      void this.executeFinalizedInput(input).then((result) => this.deliverResult(result)).catch((error) => this.report(error));
    }, TOOL_GRACE_MS);
    return input;
  }

  private finishOutputTurn(): void {
    if (!this.expectedSpeech) {
      this.pendingAudio = [];
      this.outputTranscript = "";
      return;
    }
    const expected = this.expectedSpeech;
    const actual = this.outputTranscript.trim();
    const valid = actual && normalizeSpeech(actual) === normalizeSpeech(expected);
    if (valid) {
      const chunks = this.pendingAudio;
      this.pendingAudio = [];
      this.outputTranscript = "";
      this.expectedSpeech = undefined;
      this.retrySpeech = 0;
      this.handlers?.onEvent({ type: "assistant_transcript", text: expected });
      this.handlers?.onEvent({ type: "speaking" });
      for (const chunk of chunks) this.playAudio(chunk);
      this.scheduleReadyAfterPlayback();
      return;
    }
    this.pendingAudio = [];
    this.outputTranscript = "";
    if (this.retrySpeech < 1) {
      this.retrySpeech += 1;
      this.send({ clientContent: { turns: [{ role: "user", parts: [{ text: `${RESULT_PREFIX}\nSpeak exactly this and nothing else: ${JSON.stringify(expected)}` }] }], turnComplete: true } });
      return;
    }
    this.expectedSpeech = undefined;
    this.retrySpeech = 0;
    this.report(new Error("Gemini Live did not return the trusted Mia response."));
  }

  private async handleCalls(calls: FunctionCall[]): Promise<void> {
    const responses: Array<Record<string, unknown>> = [];
    for (const call of calls) {
      if (call.id && this.cancelledCalls.delete(call.id)) continue;
      try {
        let result: VoiceAgentResult;
        if (call.name === "submit_mia_turn") {
          const input = await this.awaitAuthoritativeInput();
          this.clearFallback();
          result = await this.executeFinalizedInput(input);
        } else if (call.name === "respond_to_mia_confirmation") {
          if (typeof call.args?.approved !== "boolean") throw new Error("Voice confirmation did not include approval state.");
          await this.awaitAuthoritativeInput();
          this.clearFallback();
          this.awaitingConfirmation = false;
          result = await this.handlers!.onConfirmation(call.args.approved);
        } else {
          throw new Error(`Unsupported voice tool: ${call.name ?? "unknown"}.`);
        }
        if (call.id && this.cancelledCalls.delete(call.id)) continue;
        this.awaitingConfirmation = result.state === "confirmation";
        this.expectSpeech(result.spokenMessage);
        responses.push({ id: call.id, name: call.name, response: { state: result.state, spokenMessage: result.spokenMessage } });
      } catch (error) {
        const value = toError(error);
        responses.push({ id: call.id, name: call.name, response: { error: value.message } });
        this.report(value);
      }
    }
    if (responses.length) this.send({ toolResponse: { functionResponses: responses } });
  }

  private async runTurn(utterance: string): Promise<VoiceAgentResult> {
    const key = normalizeSpeech(utterance);
    if (this.activeTurn && this.activeUtterance && normalizeSpeech(this.activeUtterance) === key) return this.activeTurn;
    this.activeUtterance = utterance;
    this.handlers?.onEvent({ type: "thinking" });
    const turn = this.handlers!.onTurn(utterance).finally(() => {
      if (this.activeTurn === turn) {
        this.activeTurn = undefined;
        this.activeUtterance = undefined;
      }
    });
    this.activeTurn = turn;
    return turn;
  }

  private executeFinalizedInput(input: FinalizedVoiceInput): Promise<VoiceAgentResult> {
    input.result ??= this.runTurn(input.utterance);
    return input.result;
  }

  private awaitAuthoritativeInput(): Promise<FinalizedVoiceInput> {
    const available = this.takeFinalizedInput();
    if (available) return Promise.resolve(available);
    return new Promise((resolve, reject) => {
      const waiter = {
        resolve,
        reject,
        timer: window.setTimeout(() => {
          this.transcriptWaiters.delete(waiter);
          reject(new Error("Gemini Live did not provide an authoritative input transcription for this turn."));
        }, TRANSCRIPT_WAIT_MS)
      };
      this.transcriptWaiters.add(waiter);
      this.scheduleTranscriptFinalization();
    });
  }

  private scheduleTranscriptFinalization(): void {
    if (!this.transcriptWaiters.size || !this.inputTranscript.trim()) return;
    this.clearTranscriptSettle();
    this.transcriptSettleTimer = window.setTimeout(() => {
      this.transcriptSettleTimer = undefined;
      this.finalizeInputTurn();
    }, TRANSCRIPT_SETTLE_MS);
  }

  private clearTranscriptSettle(): void {
    if (this.transcriptSettleTimer) window.clearTimeout(this.transcriptSettleTimer);
    this.transcriptSettleTimer = undefined;
  }

  private takeFinalizedInput(): FinalizedVoiceInput | undefined {
    const input = this.finalizedInput;
    if (!input || input.consumedByTool) return undefined;
    input.consumedByTool = true;
    return input;
  }

  private resolveTranscriptWaiter(input: FinalizedVoiceInput): void {
    const waiter = this.transcriptWaiters.values().next().value as TranscriptWaiter | undefined;
    if (!waiter || input.consumedByTool) return;
    input.consumedByTool = true;
    window.clearTimeout(waiter.timer);
    this.transcriptWaiters.delete(waiter);
    waiter.resolve(input);
  }

  private rejectTranscriptWaiters(error: Error): void {
    this.clearTranscriptSettle();
    for (const waiter of this.transcriptWaiters) {
      window.clearTimeout(waiter.timer);
      waiter.reject(error);
    }
    this.transcriptWaiters.clear();
  }

  private deliverResult(result: VoiceAgentResult): void {
    this.awaitingConfirmation = result.state === "confirmation";
    this.speak(result.spokenMessage);
  }

  private expectSpeech(message: string): void {
    this.clearOutput();
    this.expectedSpeech = message.trim();
    this.handlers?.onEvent({ type: "thinking" });
  }

  private interruptOutput(): void {
    this.clearOutputAudio();
    this.pendingAudio = [];
    this.outputTranscript = "";
    this.expectedSpeech = undefined;
    this.retrySpeech = 0;
  }

  private clearOutput(): void {
    this.interruptOutput();
    this.inputTranscript = "";
  }

  private clearFallback(): void {
    if (this.fallbackTimer) window.clearTimeout(this.fallbackTimer);
    this.fallbackTimer = undefined;
  }

  private handleClose(socket: WebSocket, event: CloseEvent): void {
    if (this.socket !== socket) return;
    this.socket = undefined;
    this.connected = false;
    const error = closeError(event);
    if (this.setupReject) {
      this.setupReject(error);
      return;
    }
    if (!this.intentionalClose) this.refreshConnection(error);
  }

  private refreshConnection(cause: Error): void {
    if (this.intentionalClose || this.reconnecting || !this.handlers) return;
    const lifecycle = this.lifecycle;
    this.reconnecting = (async () => {
      let last = cause;
      for (let attempt = 1; attempt <= 3; attempt += 1) {
        if (this.intentionalClose || lifecycle !== this.lifecycle) return;
        if (attempt > 1) await wait(500 * attempt);
        try {
          await this.openSocket(lifecycle);
          this.handlers?.onEvent({ type: this.microphoneEnabled ? "listening" : "ready" });
          return;
        } catch (error) {
          last = toError(error);
        }
      }
      await this.endUnexpectedly(last, true);
    })().finally(() => { this.reconnecting = undefined; });
  }

  private async endUnexpectedly(error: Error, reconnectable: boolean): Promise<void> {
    if (this.intentionalClose) return;
    const handlers = this.handlers;
    handlers?.onEvent({ type: "error", error });
    await this.disconnect();
    handlers?.onEvent({ type: "ended", reconnectable });
  }

  private assertLifecycle(value: number): void {
    if (this.intentionalClose || value !== this.lifecycle) throw new Error("Mia voice was stopped.");
  }

  private playAudio(chunk: AudioChunk): void {
    const rate = audioRate(chunk.mimeType) ?? OUTPUT_RATE;
    const pcm = pcm16ToFloat32(fromBase64(chunk.data));
    if (!pcm.length) return;
    const context = this.outputContext ?? new AudioContext({ sampleRate: rate });
    this.outputContext = context;
    const buffer = context.createBuffer(1, pcm.length, rate);
    buffer.getChannelData(0).set(pcm);
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(context.destination);
    const start = Math.max(context.currentTime + 0.02, this.nextAudioTime);
    source.start(start);
    this.nextAudioTime = start + buffer.duration;
    this.outputSources.add(source);
    source.onended = () => this.outputSources.delete(source);
  }

  private prepareOutputAudio(): void {
    const context = this.outputContext ?? new AudioContext({ sampleRate: OUTPUT_RATE });
    this.outputContext = context;
    if (context.state !== "suspended" || this.removeAudioUnlock) return;
    const unlock = () => void context.resume().catch(() => undefined);
    document.addEventListener("pointerdown", unlock, true);
    document.addEventListener("keydown", unlock, true);
    this.removeAudioUnlock = () => {
      document.removeEventListener("pointerdown", unlock, true);
      document.removeEventListener("keydown", unlock, true);
    };
    unlock();
  }

  private clearOutputAudio(): void {
    if (this.playbackTimer) window.clearTimeout(this.playbackTimer);
    this.playbackTimer = undefined;
    for (const source of this.outputSources) {
      try { source.stop(); } catch { /* Source already ended. */ }
    }
    this.outputSources.clear();
    this.nextAudioTime = this.outputContext?.currentTime ?? 0;
  }

  private scheduleReadyAfterPlayback(): void {
    const context = this.outputContext;
    const remainingMs = context ? Math.max(0, (this.nextAudioTime - context.currentTime) * 1_000) : 0;
    if (this.playbackTimer) window.clearTimeout(this.playbackTimer);
    this.playbackTimer = window.setTimeout(() => {
      this.playbackTimer = undefined;
      this.handlers?.onEvent({ type: this.microphoneEnabled ? "listening" : "ready" });
    }, remainingMs + 30);
  }

  private stopOutputAudio(): void {
    this.clearOutputAudio();
    this.removeAudioUnlock?.();
    this.removeAudioUnlock = undefined;
    void this.outputContext?.close();
    this.outputContext = undefined;
    this.nextAudioTime = 0;
  }

  private send(message: unknown): void {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(message));
  }

  private report(error: unknown): void {
    this.handlers?.onEvent({ type: "error", error: toError(error) });
  }
}

function voiceSystemInstruction(voice: string): string {
  return [
    `You are the voice transport for Mia, an embedded product agent using the configured ${voice} voice.`,
    "You do not reason about the product and you never answer a user request yourself.",
    "For every complete user request or answer, immediately call submit_mia_turn with the user's exact words and do not speak first.",
    "When the tool returns spokenMessage, speak that exact text and nothing else.",
    "When the tool state is confirmation, ask only the returned spokenMessage. After the user clearly approves or declines, call respond_to_mia_confirmation.",
    "Never claim you cannot see, point, click, or act. The authoritative Mia agent and SDK perform those operations.",
    `Messages beginning ${RESULT_PREFIX} contain an authoritative Mia response. Speak only its spokenMessage value.`,
    "Keep the microphone interaction in English."
  ].join(" ");
}

async function parseFrame(data: unknown): Promise<Record<string, unknown> | undefined> {
  const text = typeof data === "string" ? data
    : data instanceof Blob ? await data.text()
      : data instanceof ArrayBuffer ? new TextDecoder().decode(data)
        : ArrayBuffer.isView(data) ? new TextDecoder().decode(data) : undefined;
  if (!text) return undefined;
  try { return object(JSON.parse(text)); } catch { return undefined; }
}

function providerErrorFrom(message: Record<string, unknown>): Error | undefined {
  if (!message.error) return undefined;
  const error = object(message.error);
  return new Error(string(error?.message) ?? string(message.error) ?? "Gemini Live returned an error.");
}

function object(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function array(value: unknown): unknown[] { return Array.isArray(value) ? value : []; }
function string(value: unknown): string | undefined { return typeof value === "string" ? value : undefined; }

function mergeTranscript(current: string, next: string): string {
  const left = current.trim();
  const right = next.trim();
  if (!left) return right;
  if (!right || left.endsWith(right)) return left;
  if (right.startsWith(left)) return right;
  return `${left} ${right}`;
}

function normalizeSpeech(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function waitForOpen(socket: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      socket.removeEventListener("open", open);
      socket.removeEventListener("error", error);
      socket.removeEventListener("close", close);
    };
    const open = () => { cleanup(); resolve(); };
    const error = () => { cleanup(); reject(new Error("Gemini Live connection failed.")); };
    const close = (event: CloseEvent) => { cleanup(); reject(closeError(event)); };
    socket.addEventListener("open", open);
    socket.addEventListener("error", error);
    socket.addEventListener("close", close);
  });
}

function closeError(event: CloseEvent): Error {
  return new Error(`Gemini Live connection closed${event.code ? ` (${event.code}${event.reason ? `: ${event.reason}` : ""})` : ""}.`);
}

function downsample(input: Float32Array, sourceRate: number, targetRate: number): Float32Array {
  if (sourceRate <= targetRate) return input;
  const ratio = sourceRate / targetRate;
  const output = new Float32Array(Math.floor(input.length / ratio));
  for (let index = 0; index < output.length; index += 1) output[index] = input[Math.floor(index * ratio)] ?? 0;
  return output;
}

function encodePcm16(samples: Float32Array): ArrayBuffer {
  const buffer = new ArrayBuffer(samples.length * 2);
  const view = new DataView(buffer);
  for (let index = 0; index < samples.length; index += 1) {
    const sample = Math.max(-1, Math.min(1, samples[index] ?? 0));
    view.setInt16(index * 2, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
  }
  return buffer;
}

function pcm16ToFloat32(buffer: ArrayBuffer): Float32Array {
  const view = new DataView(buffer);
  const output = new Float32Array(Math.floor(buffer.byteLength / 2));
  for (let index = 0; index < output.length; index += 1) output[index] = view.getInt16(index * 2, true) / 0x8000;
  return output;
}

function toBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let value = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) value += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  return btoa(value);
}

function fromBase64(value: string): ArrayBuffer {
  const decoded = atob(value);
  const bytes = new Uint8Array(decoded.length);
  for (let index = 0; index < decoded.length; index += 1) bytes[index] = decoded.charCodeAt(index);
  return bytes.buffer;
}

function audioRate(mimeType?: string): number | undefined {
  const match = mimeType?.match(/rate=(\d+)/);
  return match ? Number(match[1]) : undefined;
}

function wait(ms: number): Promise<void> { return new Promise((resolve) => window.setTimeout(resolve, ms)); }

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([promise, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(message)), timeoutMs); })]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function toError(value: unknown): Error { return value instanceof Error ? value : new Error(String(value)); }
