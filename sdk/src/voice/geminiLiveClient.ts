import type { BackendClient } from "../client/backendClient.js";
import type { GeminiLiveEvent, ResolveResponse, SDKRuntimeContext } from "../types/index.js";
import { MicLevelMeter } from "./micLevelMeter.js";

const CONNECT_TIMEOUT_MS = 15000;
const INPUT_AUDIO_RATE = 16000;
const OUTPUT_AUDIO_RATE = 24000;
const SCREEN_FRAME_INTERVAL_MS = 1000;
const MAX_SCREEN_WIDTH = 1280;
const DEFAULT_VOICE_NAME = "Kore";
const TRANSCRIPT_SETTLE_MS = 300;
const AUDIO_WORKLET_PROCESSOR_NAME = "mia-pcm-capture";

type GeminiLiveHandlers = {
  sessionId: string;
  context: SDKRuntimeContext;
  microphoneInitiallyEnabled?: boolean;
  voiceName?: string;
  getContext: () => SDKRuntimeContext;
  resolveRequest: (utterance: string) => Promise<ResolveResponse | undefined>;
  redactScreenFrame?: (canvas: HTMLCanvasElement, context: CanvasRenderingContext2D) => void;
  onEvent: (event: GeminiLiveEvent) => void;
  onInputLevel?: (level: number) => void;
  onStage?: (stage: string) => void;
  onScreenShareChange?: (active: boolean) => void;
};

type GeminiFunctionCall = {
  id?: string;
  name?: string;
  args?: Record<string, unknown>;
};

type GeminiMessage = Record<string, unknown>;

export class GeminiLiveClient {
  private socket?: WebSocket;
  private handlers?: GeminiLiveHandlers;
  private micStream?: MediaStream;
  private micContext?: AudioContext;
  private micSource?: MediaStreamAudioSourceNode;
  private micProcessor?: AudioWorkletNode;
  private micSink?: GainNode;
  private meter?: MicLevelMeter;
  private screenStream?: MediaStream;
  private screenVideo?: HTMLVideoElement;
  private screenCanvas?: HTMLCanvasElement;
  private screenInterval?: number;
  private screenFailureReported = false;
  private outputContext?: AudioContext;
  private readonly outputSources = new Set<AudioBufferSourceNode>();
  private removeOutputUnlock?: () => void;
  private nextAudioStartTime = 0;
  private setupResolve?: () => void;
  private setupReject?: (error: Error) => void;
  private connected = false;
  private microphoneEnabled = true;
  private stoppingMicrophone = false;
  private intentionalDisconnect = false;
  private reconnectPromise?: Promise<void>;
  private sessionHandle?: string;
  private lifecycleVersion = 0;
  private readonly cancelledFunctionCalls = new Set<string>();
  private inputTranscript = "";
  private outputTranscript = "";
  private inputTranscriptTimer?: number;
  private outputTranscriptTimer?: number;

  constructor(private readonly backendClient: BackendClient) {}

  isConnected(): boolean {
    return this.connected && this.socket?.readyState === WebSocket.OPEN;
  }

  async connect(input: GeminiLiveHandlers): Promise<void> {
    if (this.isConnected()) return;
    const lifecycleVersion = ++this.lifecycleVersion;
    this.intentionalDisconnect = false;
    this.sessionHandle = undefined;
    this.cancelledFunctionCalls.clear();
    this.handlers = input;
    this.microphoneEnabled = input.microphoneInitiallyEnabled ?? true;
    this.prepareOutputAudio();

    try {
      await this.openConnection(input, lifecycleVersion);
      input.onStage?.("Requesting microphone permission...");
      await this.startMicrophone(input);
      input.onStage?.("Listening");
      input.onEvent({ type: "listening", status: "listening" });
    } catch (error) {
      this.clearSetupHandlers();
      await this.disconnect();
      throw error;
    }
  }

  private async openConnection(input: GeminiLiveHandlers, lifecycleVersion: number): Promise<void> {
    input.onStage?.("Requesting Gemini Live token...");
    const token = await withTimeout(this.backendClient.createGeminiLiveToken({
      clientSessionId: input.sessionId
    }), CONNECT_TIMEOUT_MS, "Gemini Live token request timed out.");
    this.assertActiveLifecycle(lifecycleVersion);

    input.onStage?.("Opening Gemini Live connection...");
    const socket = new WebSocket(`${token.websocketUrl}?access_token=${encodeURIComponent(token.token)}`);
    socket.binaryType = "arraybuffer";
    this.socket = socket;
    socket.onmessage = (event) => void this.handleSocketMessage(event);
    socket.onerror = () => {
      this.setupReject?.(new Error("Gemini Live WebSocket connection failed."));
    };
    socket.onclose = (event) => this.handleSocketClose(socket, event);

    await withTimeout(waitForSocketOpen(socket), CONNECT_TIMEOUT_MS, "Gemini Live WebSocket connection timed out.");
    this.assertActiveLifecycle(lifecycleVersion);
    this.connected = true;
    const setupPromise = new Promise<void>((resolve, reject) => {
      this.setupResolve = resolve;
      this.setupReject = reject;
    });
    this.sendSetup(token.model, { ...input, context: input.getContext() });
    try {
      await withTimeout(setupPromise, CONNECT_TIMEOUT_MS, "Gemini Live setup timed out.");
    } finally {
      this.clearSetupHandlers();
    }
  }

  private handleSocketClose(socket: WebSocket, event: CloseEvent): void {
    if (this.socket !== socket) return;
    this.socket = undefined;
    this.connected = false;
    const closeError = webSocketCloseError(event);
    if (this.setupReject) {
      this.setupReject(closeError);
      return;
    }
    if (!this.intentionalDisconnect) this.requestReconnect(closeError);
  }

  private requestReconnect(cause: Error): void {
    if (this.intentionalDisconnect || this.reconnectPromise || !this.handlers) return;
    const input = this.handlers;
    const lifecycleVersion = this.lifecycleVersion;
    input.onStage?.("Reconnecting Mia voice...");
    this.reconnectPromise = (async () => {
      let lastError = cause;
      for (let attempt = 1; attempt <= 3; attempt += 1) {
        if (this.intentionalDisconnect || lifecycleVersion !== this.lifecycleVersion) return;
        if (attempt > 1) await delay(400 * attempt);
        try {
          await this.openConnection(input, lifecycleVersion);
          input.onStage?.("Voice reconnected");
          input.onEvent({ type: "listening", status: "listening" });
          return;
        } catch (error) {
          lastError = error instanceof Error ? error : new Error(String(error));
          const socket = this.socket;
          this.socket = undefined;
          this.connected = false;
          if (socket && socket.readyState !== WebSocket.CLOSED && socket.readyState !== WebSocket.CLOSING) socket.close();
        }
      }
      if (this.intentionalDisconnect || lifecycleVersion !== this.lifecycleVersion) return;
      this.stopScreenShare();
      this.stopMicrophone();
      this.stopOutputAudio();
      this.clearTranscriptBuffers();
      this.emitError(new Error(`Mia voice could not reconnect. ${lastError.message}`));
      input.onEvent({ type: "ended", status: "ended", reason: "connection_lost" });
    })().finally(() => {
      this.reconnectPromise = undefined;
    });
  }

  private assertActiveLifecycle(lifecycleVersion: number): void {
    if (this.intentionalDisconnect || lifecycleVersion !== this.lifecycleVersion) {
      throw new Error("Mia voice connection was stopped.");
    }
  }

  sendText(text: string): void {
    const trimmed = text.trim();
    if (!trimmed) return;
    if (!this.isConnected()) {
      throw new Error("Gemini Live is not connected.");
    }
    this.handlers?.onEvent({ type: "thinking", status: "thinking" });
    this.send({
      realtimeInput: {
        text: trimmed
      }
    });
  }

  setMicrophoneEnabled(enabled: boolean): void {
    const wasEnabled = this.microphoneEnabled;
    this.microphoneEnabled = enabled;
    this.micStream?.getAudioTracks().forEach((track) => {
      track.enabled = enabled;
    });
    if (!enabled) {
      this.handlers?.onInputLevel?.(0);
      if (wasEnabled && this.isConnected()) {
        this.send({ realtimeInput: { audioStreamEnd: true } });
      }
    }
  }

  async disconnect(): Promise<void> {
    this.intentionalDisconnect = true;
    this.lifecycleVersion += 1;
    this.stopScreenShare();
    this.stopMicrophone();
    this.stopOutputAudio();
    this.clearTranscriptBuffers();
    this.connected = false;
    this.microphoneEnabled = true;
    this.sessionHandle = undefined;
    this.cancelledFunctionCalls.clear();
    this.setupReject?.(new Error("Mia voice connection was stopped."));
    this.clearSetupHandlers();
    const socket = this.socket;
    this.socket = undefined;
    if (socket && socket.readyState !== WebSocket.CLOSED && socket.readyState !== WebSocket.CLOSING) {
      socket.close();
    }
    this.handlers = undefined;
  }

  isScreenSharing(): boolean {
    return Boolean(this.screenStream?.active);
  }

  async startScreenShare(): Promise<void> {
    const input = this.handlers;
    if (!input) throw new Error("Start voice before sharing the screen with Mia.");
    if (!this.isConnected()) throw new Error("Mia voice must be connected before screen sharing starts.");
    if (this.isScreenSharing()) return;
    this.screenFailureReported = false;
    await this.captureScreen(input);
  }

  stopScreenShare(): void {
    if (this.screenInterval) window.clearInterval(this.screenInterval);
    this.screenInterval = undefined;
    this.screenStream?.getTracks().forEach((track) => track.stop());
    this.screenStream = undefined;
    if (this.screenVideo) {
      this.screenVideo.pause();
      this.screenVideo.srcObject = null;
    }
    this.screenVideo = undefined;
    this.screenCanvas = undefined;
    this.handlers?.onScreenShareChange?.(false);
  }

  private sendSetup(model: string, input: GeminiLiveHandlers): void {
    this.send({
      setup: {
        model: model.startsWith("models/") ? model : `models/${model}`,
        generationConfig: {
          responseModalities: ["AUDIO"],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: {
                voiceName: input.voiceName ?? DEFAULT_VOICE_NAME
              }
            }
          },
          thinkingConfig: { thinkingLevel: "MINIMAL" }
        },
        systemInstruction: {
          role: "system",
          parts: [{ text: buildSystemInstruction(input.context) }]
        },
        inputAudioTranscription: {},
        outputAudioTranscription: {},
        sessionResumption: this.sessionHandle ? { handle: this.sessionHandle } : {},
        contextWindowCompression: { slidingWindow: {} },
        tools: [{
          functionDeclarations: [{
            name: "resolve_mia_request",
            description: "Resolve Mia runtime requests against the host app. Use this for saved workflows, cancel/pause/resume, and every request that depends on the current product UI: where something is, pointing or highlighting, explaining a visible element, clicking, filling, selecting, or navigating. Do not answer those UI requests directly.",
            parameters: {
              type: "OBJECT",
              properties: {
                utterance: {
                  type: "STRING",
                  description: "The user's exact request, preserving question versus action wording. Do not rewrite a location question such as 'where do I click' into a click command."
                }
              },
              required: ["utterance"]
            }
          }]
        }]
      }
    });
  }

  private async startMicrophone(input: GeminiLiveHandlers): Promise<void> {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error("Microphone capture is not available in this browser.");
    }

    const stream = await withTimeout(navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      }
    }), CONNECT_TIMEOUT_MS, "Microphone permission timed out. Check browser site permissions.");

    this.micStream = stream;
    const [track] = stream.getAudioTracks();
    if (!track) {
      stream.getTracks().forEach((streamTrack) => streamTrack.stop());
      throw new Error("No microphone audio track was available.");
    }
    track.enabled = this.microphoneEnabled;
    track.addEventListener("ended", () => {
      if (this.intentionalDisconnect || this.stoppingMicrophone) return;
      this.microphoneEnabled = false;
      input.onInputLevel?.(0);
      this.emitError(new Error("Microphone capture stopped. Check browser site permissions before trying voice again."));
      void this.disconnect().then(() => {
        input.onEvent({ type: "ended", status: "ended", reason: "connection_lost" });
      });
    }, { once: true });

    this.meter = new MicLevelMeter(track, (level) => input.onInputLevel?.(this.microphoneEnabled ? level : 0));
    this.meter.start();
    this.micContext = new AudioContext();
    if (this.micContext.state === "suspended") {
      await this.micContext.resume();
    }
    if (!this.micContext.audioWorklet) {
      throw new Error("AudioWorklet microphone capture is not available in this browser.");
    }
    const workletUrl = new URL("./micCaptureProcessor.js", import.meta.url);
    await this.micContext.audioWorklet.addModule(workletUrl.toString());
    this.micSource = this.micContext.createMediaStreamSource(stream);
    this.micProcessor = new AudioWorkletNode(this.micContext, AUDIO_WORKLET_PROCESSOR_NAME, {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [1]
    });
    this.micProcessor.port.onmessage = (event: MessageEvent<ArrayBuffer>) => {
      if (!this.isConnected() || !this.microphoneEnabled) return;
      const channel = new Float32Array(event.data);
      const pcm = encodePcm16(downsample(channel, this.micContext?.sampleRate ?? INPUT_AUDIO_RATE, INPUT_AUDIO_RATE));
      if (pcm.byteLength === 0) return;
      this.send({
        realtimeInput: {
          audio: {
            data: base64FromArrayBuffer(pcm),
            mimeType: `audio/pcm;rate=${INPUT_AUDIO_RATE}`
          }
        }
      });
    };
    this.micSink = this.micContext.createGain();
    this.micSink.gain.value = 0;
    this.micSource.connect(this.micProcessor);
    this.micProcessor.connect(this.micSink);
    this.micSink.connect(this.micContext.destination);
  }

  private stopMicrophone(): void {
    this.stoppingMicrophone = true;
    this.meter?.stop();
    this.meter = undefined;
    if (this.micProcessor) {
      this.micProcessor.disconnect();
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

  private async captureScreen(input: GeminiLiveHandlers): Promise<void> {
    if (!navigator.mediaDevices?.getDisplayMedia) {
      throw new Error("Screen sharing is not available in this browser.");
    }

    try {
      input.onStage?.("Requesting screen sharing permission...");
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: false
      });
      this.screenStream = stream;
      this.screenVideo = document.createElement("video");
      this.screenVideo.muted = true;
      this.screenVideo.playsInline = true;
      this.screenVideo.srcObject = stream;
      await this.screenVideo.play();
      this.screenCanvas = document.createElement("canvas");
      this.screenInterval = window.setInterval(() => this.sendScreenFrame(), SCREEN_FRAME_INTERVAL_MS);
      stream.getVideoTracks()[0]?.addEventListener("ended", () => this.stopScreenShare(), { once: true });
      input.onScreenShareChange?.(true);
      this.sendScreenFrame();
    } catch (error) {
      this.stopScreenShare();
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Screen sharing was not started: ${message}`);
    }
  }

  private sendScreenFrame(): void {
    if (!this.isConnected() || !this.screenVideo || !this.screenCanvas || this.screenVideo.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return;
    const sourceWidth = this.screenVideo.videoWidth;
    const sourceHeight = this.screenVideo.videoHeight;
    if (!sourceWidth || !sourceHeight) return;
    const width = Math.min(MAX_SCREEN_WIDTH, sourceWidth);
    const height = Math.round((sourceHeight / sourceWidth) * width);
    this.screenCanvas.width = width;
    this.screenCanvas.height = height;
    const context = this.screenCanvas.getContext("2d");
    if (!context) return;
    try {
      context.drawImage(this.screenVideo, 0, 0, width, height);
      this.handlers?.redactScreenFrame?.(this.screenCanvas, context);
      const dataUrl = this.screenCanvas.toDataURL("image/jpeg", 0.68);
      const base64 = dataUrl.split(",", 2)[1];
      if (!base64) return;
      this.send({
        realtimeInput: {
          video: {
            data: base64,
            mimeType: "image/jpeg"
          }
        }
      });
    } catch (error) {
      this.stopScreenShare();
      if (this.screenFailureReported) return;
      this.screenFailureReported = true;
      this.emitError(new Error(`Screen sharing stopped: ${error instanceof Error ? error.message : String(error)}`));
    }
  }

  private async handleSocketMessage(event: MessageEvent): Promise<void> {
    const message = await parseMessage(event.data);
    if (!message) return;

    const providerError = readProviderError(message);
    if (providerError) {
      this.setupReject?.(providerError);
      this.emitError(providerError);
      return;
    }

    if (message.setupComplete ?? message.setup_complete) {
      this.setupResolve?.();
      this.handlers?.onEvent({ type: "session_ready", status: "listening" });
    }

    const serverContent = readObject(message.serverContent) ?? readObject(message.server_content);
    if (serverContent) {
      this.handleServerContent(serverContent);
    }

    const toolCall = readObject(message.toolCall) ?? readObject(message.tool_call);
    const functionCalls = readArray(toolCall?.functionCalls ?? toolCall?.function_calls)
      .map(readObject)
      .filter((functionCall): functionCall is GeminiFunctionCall => Boolean(functionCall));
    if (functionCalls.length > 0) {
      await this.handleFunctionCalls(functionCalls);
    }

    const toolCancellation = readObject(message.toolCallCancellation) ?? readObject(message.tool_call_cancellation);
    const cancelledIds = readArray(toolCancellation?.ids).filter((id): id is string => typeof id === "string");
    if (cancelledIds.length > 0) {
      cancelledIds.forEach((id) => this.cancelledFunctionCalls.add(id));
      this.handlers?.onEvent({ type: "tool_cancelled" });
    }

    const resumptionUpdate = readObject(message.sessionResumptionUpdate) ?? readObject(message.session_resumption_update);
    if (resumptionUpdate && (resumptionUpdate.resumable === true || resumptionUpdate.resumable === undefined)) {
      const handle = readString(resumptionUpdate.newHandle ?? resumptionUpdate.new_handle);
      if (handle) this.sessionHandle = handle;
    }

    const goAway = readObject(message.goAway) ?? readObject(message.go_away);
    if (goAway) {
      const reconnectReason = new Error("Gemini Live requested a connection refresh.");
      if (this.setupReject) {
        this.setupReject(reconnectReason);
        return;
      }
      this.handlers?.onStage?.("Refreshing Mia voice connection...");
      const socket = this.socket;
      this.socket = undefined;
      this.connected = false;
      if (socket && socket.readyState !== WebSocket.CLOSED && socket.readyState !== WebSocket.CLOSING) socket.close();
      this.requestReconnect(reconnectReason);
    }
  }

  private handleServerContent(serverContent: Record<string, unknown>): void {
    if (serverContent.interrupted) {
      this.clearOutputAudio();
      this.outputTranscript = "";
      if (this.outputTranscriptTimer) window.clearTimeout(this.outputTranscriptTimer);
      this.outputTranscriptTimer = undefined;
    }

    const inputTranscription = readObject(serverContent.inputTranscription) ?? readObject(serverContent.input_transcription);
    const inputText = readString(inputTranscription?.text);
    if (inputText) {
      this.bufferInputTranscript(inputText);
    }

    const outputTranscription = readObject(serverContent.outputTranscription) ?? readObject(serverContent.output_transcription);
    const outputText = readString(outputTranscription?.text);
    if (outputText) {
      this.bufferOutputTranscript(outputText);
    }

    const modelTurn = readObject(serverContent.modelTurn) ?? readObject(serverContent.model_turn);
    const parts = readArray(modelTurn?.parts);
    for (const part of parts) {
      const partObject = readObject(part);
      if (!partObject) continue;
      const inlineData = readObject(partObject.inlineData) ?? readObject(partObject.inline_data);
      const mimeType = readString(inlineData?.mimeType ?? inlineData?.mime_type);
      const data = readString(inlineData?.data);
      if (data && (!mimeType || mimeType.startsWith("audio/"))) {
        this.playAudioChunk(data, mimeType);
      }
    }

    if (serverContent.turnComplete ?? serverContent.turn_complete) {
      this.flushOutputTranscript();
      this.handlers?.onEvent({ type: "listening", status: "listening" });
    }
  }

  private bufferInputTranscript(text: string): void {
    this.inputTranscript = mergeTranscript(this.inputTranscript, text);
    if (this.inputTranscriptTimer) window.clearTimeout(this.inputTranscriptTimer);
    this.inputTranscriptTimer = window.setTimeout(() => {
      const transcript = this.inputTranscript.trim();
      this.inputTranscript = "";
      this.inputTranscriptTimer = undefined;
      if (transcript) this.handlers?.onEvent({ type: "transcript_user", text: transcript, isFinal: true });
    }, TRANSCRIPT_SETTLE_MS);
  }

  private bufferOutputTranscript(text: string): void {
    this.outputTranscript = mergeTranscript(this.outputTranscript, text);
    this.handlers?.onEvent({ type: "transcript_assistant", text: this.outputTranscript, isFinal: false });
    if (this.outputTranscriptTimer) window.clearTimeout(this.outputTranscriptTimer);
    this.outputTranscriptTimer = window.setTimeout(() => this.flushOutputTranscript(), TRANSCRIPT_SETTLE_MS);
  }

  private flushOutputTranscript(): void {
    if (this.outputTranscriptTimer) window.clearTimeout(this.outputTranscriptTimer);
    this.outputTranscriptTimer = undefined;
    const transcript = this.outputTranscript.trim();
    this.outputTranscript = "";
    if (transcript) this.handlers?.onEvent({ type: "transcript_assistant", text: transcript, isFinal: true });
  }

  private clearTranscriptBuffers(): void {
    if (this.inputTranscriptTimer) window.clearTimeout(this.inputTranscriptTimer);
    if (this.outputTranscriptTimer) window.clearTimeout(this.outputTranscriptTimer);
    this.inputTranscriptTimer = undefined;
    this.outputTranscriptTimer = undefined;
    this.inputTranscript = "";
    this.outputTranscript = "";
  }

  private async handleFunctionCalls(functionCalls: GeminiFunctionCall[]): Promise<void> {
    const handlers = this.handlers;
    if (!handlers) return;
    handlers.onEvent({ type: "thinking", status: "thinking" });
    const responses = [];

    for (const functionCall of functionCalls) {
      const name = functionCall.name ?? "resolve_mia_request";
      if (functionCall.id && this.cancelledFunctionCalls.delete(functionCall.id)) continue;
      if (name !== "resolve_mia_request") {
        responses.push({
          id: functionCall.id,
          name,
          response: { error: `Unsupported function: ${name}` }
        });
        continue;
      }

      const utterance = readString(functionCall.args?.utterance)?.trim();
      if (!utterance) {
        responses.push({
          id: functionCall.id,
          name,
          response: { error: "Missing utterance." }
        });
        continue;
      }

      try {
        const result = await handlers.resolveRequest(utterance);
        if (functionCall.id && this.cancelledFunctionCalls.delete(functionCall.id)) continue;
        if (!result) {
          responses.push({
            id: functionCall.id,
            name,
            response: {
              resultType: "workflow_input",
              status: "captured",
              message: "The active workflow captured this answer. Do not repeat or reinterpret it."
            }
          });
          continue;
        }
        handlers.onEvent({ type: "assistant_response", message: result.message, result });
        responses.push({
          id: functionCall.id,
          name,
          response: toolResponseForResult(result)
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        responses.push({
          id: functionCall.id,
          name,
          response: { error: message }
        });
        this.emitError(new Error(message));
      }
    }

    if (responses.length > 0) {
      this.send({
        toolResponse: {
          functionResponses: responses
        }
      });
    }
  }

  private playAudioChunk(base64: string, mimeType?: string): void {
    const rate = readAudioRate(mimeType) ?? OUTPUT_AUDIO_RATE;
    const pcm = pcm16ToFloat32(arrayBufferFromBase64(base64));
    if (pcm.length === 0) return;
    const context = this.outputContext ?? new AudioContext({ sampleRate: rate });
    this.outputContext = context;
    if (context.state === "suspended") {
      this.prepareOutputAudio();
    }
    const buffer = context.createBuffer(1, pcm.length, rate);
    buffer.getChannelData(0).set(pcm);
    const source = context.createBufferSource();
    this.outputSources.add(source);
    source.onended = () => this.outputSources.delete(source);
    source.buffer = buffer;
    source.connect(context.destination);
    const startAt = Math.max(context.currentTime + 0.02, this.nextAudioStartTime);
    source.start(startAt);
    this.nextAudioStartTime = startAt + buffer.duration;
  }

  private stopOutputAudio(): void {
    this.clearOutputAudio();
    this.removeOutputUnlock?.();
    this.removeOutputUnlock = undefined;
    this.nextAudioStartTime = 0;
    void this.outputContext?.close();
    this.outputContext = undefined;
  }

  private clearOutputAudio(): void {
    for (const source of this.outputSources) {
      try {
        source.stop();
      } catch {
        // The source may already have ended between the set iteration and stop call.
      }
    }
    this.outputSources.clear();
    this.nextAudioStartTime = this.outputContext?.currentTime ?? 0;
  }

  private prepareOutputAudio(): void {
    const context = this.outputContext ?? new AudioContext({ sampleRate: OUTPUT_AUDIO_RATE });
    this.outputContext = context;
    if (context.state !== "suspended") {
      this.removeOutputUnlock?.();
      this.removeOutputUnlock = undefined;
      return;
    }
    if (this.removeOutputUnlock) return;
    const unlock = () => {
      void context.resume().then(() => {
        if (context.state !== "suspended") {
          this.removeOutputUnlock?.();
          this.removeOutputUnlock = undefined;
        }
      }).catch(() => undefined);
    };
    document.addEventListener("pointerdown", unlock, { capture: true });
    document.addEventListener("keydown", unlock, { capture: true });
    this.removeOutputUnlock = () => {
      document.removeEventListener("pointerdown", unlock, { capture: true });
      document.removeEventListener("keydown", unlock, { capture: true });
    };
    unlock();
  }

  private send(message: unknown): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return;
    this.socket.send(JSON.stringify(message));
  }

  private emitError(error: Error): void {
    this.handlers?.onEvent({ type: "error", message: error.message });
  }

  private clearSetupHandlers(): void {
    this.setupResolve = undefined;
    this.setupReject = undefined;
  }
}

function buildSystemInstruction(context: SDKRuntimeContext): string {
  return [
    "You are Mia, an in-product onboarding and support guide embedded in a customer's web app. Use she/her pronouns for Mia and speak in a clear, warm, concise style.",
    "For any request about the current product UI, including where something is, pointing, highlighting, explaining a visible element, clicking, filling, selecting, navigating, or running a task, call resolve_mia_request instead of answering from memory.",
    "Only answer directly when the user is making small talk or asking a question that is clearly unrelated to the host app UI.",
    "Use live screen frames and page context when available, but never pretend you can see the screen if screen frames and page context are unavailable.",
    "When the user wants to perform a saved in-app task, navigate through a saved workflow, fill a form through a saved workflow, or cancel/pause/resume workflow execution, call resolve_mia_request.",
    "Treat action status awaiting_user_confirmation as pending, not complete. Never say an action is complete unless its status is completed. Tell the user when confirmation or manual input is still required.",
    "Keep spoken responses short and clear.",
    `Current page: ${context.pageTitle ?? "Untitled"} at route ${context.currentRoute}.`
  ].join(" ");
}

function toolResponseForResult(result: ResolveResponse): Record<string, unknown> {
  if (result.type === "workflow") {
    return {
      resultType: result.type,
      status: "guidance_started",
      message: result.message,
      workflowId: result.workflow.workflowId,
      workflowName: result.workflow.name
    };
  }
  if (result.type === "control") {
    return {
      resultType: result.type,
      status: "completed",
      action: result.action,
      message: result.message
    };
  }
  if (result.type === "element_action") {
    return {
      resultType: result.type,
      status: "awaiting_user_confirmation",
      action: result.action,
      message: result.message,
      executionPolicy: result.executionPolicy,
      target: {
        label: result.target.label,
        text: result.target.text,
        elementId: result.target.elementId,
        selector: result.target.selector
      }
    };
  }
  return {
    resultType: result.type,
    status: result.type === "no_match" ? "not_executed" : "answered",
    message: result.message,
    target: "target" in result && result.target ? {
      label: result.target.label,
      text: result.target.text,
      elementId: result.target.elementId,
      selector: result.target.selector
    } : undefined
  };
}

async function parseMessage(data: unknown): Promise<GeminiMessage | undefined> {
  const text = await frameText(data);
  if (!text) return undefined;
  try {
    const parsed = JSON.parse(text);
    return readObject(parsed) ?? undefined;
  } catch {
    return undefined;
  }
}

async function frameText(data: unknown): Promise<string | undefined> {
  if (typeof data === "string") return data;
  if (data instanceof Blob) return data.text();
  if (data instanceof ArrayBuffer) return new TextDecoder().decode(data);
  if (ArrayBuffer.isView(data)) return new TextDecoder().decode(data);
  return undefined;
}

function readProviderError(message: GeminiMessage): Error | undefined {
  const raw = message.error;
  if (!raw) return undefined;
  if (typeof raw === "string") return new Error(`Gemini Live error: ${raw}`);
  const error = readObject(raw);
  if (!error) return new Error("Gemini Live returned an unknown error.");
  const code = readString(error.code) ?? readString(error.status);
  const messageText = readString(error.message) ?? JSON.stringify(error);
  return new Error(code ? `Gemini Live error (${code}): ${messageText}` : `Gemini Live error: ${messageText}`);
}

function readObject(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function readArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function readAudioRate(mimeType?: string): number | undefined {
  if (!mimeType) return undefined;
  const match = /rate=(\d+)/.exec(mimeType);
  return match ? Number(match[1]) : undefined;
}

function waitForSocketOpen(socket: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      socket.removeEventListener("open", handleOpen);
      socket.removeEventListener("error", handleError);
      socket.removeEventListener("close", handleClose);
    };
    const handleOpen = () => {
      cleanup();
      resolve();
    };
    const handleError = () => {
      cleanup();
      reject(new Error("Gemini Live WebSocket connection failed."));
    };
    const handleClose = (event: CloseEvent) => {
      cleanup();
      reject(webSocketCloseError(event));
    };
    socket.addEventListener("open", handleOpen);
    socket.addEventListener("error", handleError);
    socket.addEventListener("close", handleClose);
  });
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function mergeTranscript(current: string, next: string): string {
  const left = current.trim();
  const right = next.trim();
  if (!left) return right;
  if (!right || left.endsWith(right)) return left;
  if (right.startsWith(left)) return right;
  return `${left} ${right}`;
}

function webSocketCloseError(event: CloseEvent): Error {
  const details = [
    event.code ? `code=${event.code}` : undefined,
    event.reason ? `reason=${event.reason}` : undefined
  ].filter(Boolean).join("; ");
  return new Error(details ? `Gemini Live WebSocket closed before setup completed (${details}).` : "Gemini Live WebSocket closed before setup completed.");
}

function downsample(input: Float32Array, sourceRate: number, targetRate: number): Float32Array {
  if (sourceRate === targetRate) return input;
  if (sourceRate < targetRate) return input;
  const ratio = sourceRate / targetRate;
  const length = Math.floor(input.length / ratio);
  const output = new Float32Array(length);
  for (let i = 0; i < length; i += 1) {
    output[i] = input[Math.floor(i * ratio)] ?? 0;
  }
  return output;
}

function encodePcm16(samples: Float32Array): ArrayBuffer {
  const buffer = new ArrayBuffer(samples.length * 2);
  const view = new DataView(buffer);
  for (let i = 0; i < samples.length; i += 1) {
    const sample = Math.max(-1, Math.min(1, samples[i] ?? 0));
    view.setInt16(i * 2, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
  }
  return buffer;
}

function pcm16ToFloat32(buffer: ArrayBuffer): Float32Array {
  const view = new DataView(buffer);
  const output = new Float32Array(Math.floor(buffer.byteLength / 2));
  for (let i = 0; i < output.length; i += 1) {
    output[i] = view.getInt16(i * 2, true) / 0x8000;
  }
  return output;
}

function base64FromArrayBuffer(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

function arrayBufferFromBase64(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

async function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const timer = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => reject(new Error(message)), ms);
  });
  try {
    return await Promise.race([promise, timer]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}
