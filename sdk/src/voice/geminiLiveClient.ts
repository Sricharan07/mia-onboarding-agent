import type { BackendClient } from "../client/backendClient.js";
import type { GeminiLiveEvent, ResolveResponse, SDKRuntimeContext } from "../types/index.js";
import { MicLevelMeter } from "./micLevelMeter.js";

const CONNECT_TIMEOUT_MS = 15000;
const INPUT_AUDIO_RATE = 16000;
const OUTPUT_AUDIO_RATE = 24000;
const SCREEN_FRAME_INTERVAL_MS = 1000;
const MAX_SCREEN_WIDTH = 1280;
const DEFAULT_VOICE_NAME = "Aoede";

type GeminiLiveHandlers = {
  sessionId: string;
  context: SDKRuntimeContext;
  enableScreenShare: boolean;
  microphoneInitiallyEnabled?: boolean;
  voiceName?: string;
  getContext: () => SDKRuntimeContext;
  redactScreenFrame?: (canvas: HTMLCanvasElement, context: CanvasRenderingContext2D) => void;
  onEvent: (event: GeminiLiveEvent) => void;
  onInputLevel?: (level: number) => void;
  onStage?: (stage: string) => void;
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
  private micProcessor?: ScriptProcessorNode;
  private meter?: MicLevelMeter;
  private screenStream?: MediaStream;
  private screenVideo?: HTMLVideoElement;
  private screenCanvas?: HTMLCanvasElement;
  private screenInterval?: number;
  private outputContext?: AudioContext;
  private nextAudioStartTime = 0;
  private setupResolve?: () => void;
  private setupReject?: (error: Error) => void;
  private connected = false;
  private microphoneEnabled = true;

  constructor(private readonly backendClient: BackendClient) {}

  isConnected(): boolean {
    return this.connected && this.socket?.readyState === WebSocket.OPEN;
  }

  async connect(input: GeminiLiveHandlers): Promise<void> {
    if (this.isConnected()) return;
    this.handlers = input;
    this.microphoneEnabled = input.microphoneInitiallyEnabled ?? true;
    if (input.enableScreenShare) {
      await this.startScreenShare(input);
    }
    input.onStage?.("Requesting Gemini Live token...");
    const token = await withTimeout(this.backendClient.createGeminiLiveToken({
      clientSessionId: input.sessionId
    }), CONNECT_TIMEOUT_MS, "Gemini Live token request timed out.");

    input.onStage?.("Opening Gemini Live connection...");
    const socket = new WebSocket(`${token.websocketUrl}?access_token=${encodeURIComponent(token.token)}`);
    socket.binaryType = "arraybuffer";
    this.socket = socket;
    socket.onmessage = (event) => void this.handleSocketMessage(event);
    socket.onerror = () => {
      const error = new Error("Gemini Live WebSocket connection failed.");
      this.setupReject?.(error);
      this.emitError(error);
    };
    socket.onclose = (event) => {
      this.connected = false;
      const closeError = webSocketCloseError(event);
      if (this.setupReject) {
        this.setupReject(closeError);
        this.emitError(closeError);
        return;
      }
      input.onEvent({ type: "ended", status: "ended" });
    };

    try {
      await withTimeout(waitForSocketOpen(socket), CONNECT_TIMEOUT_MS, "Gemini Live WebSocket connection timed out.");
      this.connected = true;
      this.sendSetup(token.model, input);
      await withTimeout(new Promise<void>((resolve, reject) => {
        this.setupResolve = resolve;
        this.setupReject = reject;
      }), CONNECT_TIMEOUT_MS, "Gemini Live setup timed out.");
      this.clearSetupHandlers();

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
    if (!enabled) {
      this.handlers?.onInputLevel?.(0);
      if (wasEnabled && this.isConnected()) {
        this.send({ realtimeInput: { audioStreamEnd: true } });
      }
    }
  }

  async disconnect(): Promise<void> {
    this.stopScreenShare();
    this.stopMicrophone();
    this.stopOutputAudio();
    this.connected = false;
    this.microphoneEnabled = true;
    const socket = this.socket;
    this.socket = undefined;
    if (socket && socket.readyState !== WebSocket.CLOSED && socket.readyState !== WebSocket.CLOSING) {
      socket.close();
    }
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
        tools: [{
          functionDeclarations: [{
            name: "resolve_mia_request",
            description: "Resolve Mia runtime requests against the host app. Use this for saved workflows, cancel/pause/resume, and every request that depends on the current product UI: where something is, pointing or highlighting, explaining a visible element, clicking, filling, selecting, or navigating. Do not answer those UI requests directly.",
            parameters: {
              type: "OBJECT",
              properties: {
                utterance: {
                  type: "STRING",
                  description: "The user's request, rewritten as a concise actionable instruction while preserving the user's intent."
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

    this.meter = new MicLevelMeter(track, (level) => input.onInputLevel?.(this.microphoneEnabled ? level : 0));
    this.meter.start();
    this.micContext = new AudioContext();
    if (this.micContext.state === "suspended") {
      await this.micContext.resume();
    }
    this.micSource = this.micContext.createMediaStreamSource(stream);
    this.micProcessor = this.micContext.createScriptProcessor(4096, 1, 1);
    this.micProcessor.onaudioprocess = (event) => {
      if (!this.isConnected() || !this.microphoneEnabled) return;
      const channel = event.inputBuffer.getChannelData(0);
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
    this.micSource.connect(this.micProcessor);
    this.micProcessor.connect(this.micContext.destination);
  }

  private stopMicrophone(): void {
    this.meter?.stop();
    this.meter = undefined;
    if (this.micProcessor) {
      this.micProcessor.disconnect();
      this.micProcessor.onaudioprocess = null;
    }
    this.micProcessor = undefined;
    this.micSource?.disconnect();
    this.micSource = undefined;
    void this.micContext?.close();
    this.micContext = undefined;
    this.micStream?.getTracks().forEach((track) => track.stop());
    this.micStream = undefined;
  }

  private async startScreenShare(input: GeminiLiveHandlers): Promise<void> {
    if (!navigator.mediaDevices?.getDisplayMedia) {
      input.onStage?.("Screen sharing is not available in this browser.");
      return;
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
      this.sendScreenFrame();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      input.onStage?.(`Screen sharing skipped: ${message}`);
    }
  }

  private stopScreenShare(): void {
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

    const goAway = readObject(message.goAway) ?? readObject(message.go_away);
    if (goAway) {
      this.handlers?.onStage?.("Gemini Live asked the session to reconnect soon.");
    }
  }

  private handleServerContent(serverContent: Record<string, unknown>): void {
    if (serverContent.interrupted) {
      this.stopOutputAudio();
    }

    const inputTranscription = readObject(serverContent.inputTranscription) ?? readObject(serverContent.input_transcription);
    const inputText = readString(inputTranscription?.text);
    if (inputText) {
      this.handlers?.onEvent({ type: "transcript_user", text: inputText, isFinal: true });
    }

    const outputTranscription = readObject(serverContent.outputTranscription) ?? readObject(serverContent.output_transcription);
    const outputText = readString(outputTranscription?.text);
    if (outputText) {
      this.handlers?.onEvent({ type: "transcript_assistant", text: outputText, isFinal: Boolean(serverContent.turnComplete ?? serverContent.turn_complete) });
    }

    const modelTurn = readObject(serverContent.modelTurn) ?? readObject(serverContent.model_turn);
    const parts = readArray(modelTurn?.parts);
    for (const part of parts) {
      const partObject = readObject(part);
      if (!partObject) continue;
      const text = readString(partObject.text);
      if (text) {
        this.handlers?.onEvent({ type: "transcript_assistant", text, isFinal: false });
      }
      const inlineData = readObject(partObject.inlineData) ?? readObject(partObject.inline_data);
      const mimeType = readString(inlineData?.mimeType ?? inlineData?.mime_type);
      const data = readString(inlineData?.data);
      if (data && (!mimeType || mimeType.startsWith("audio/"))) {
        this.playAudioChunk(data, mimeType);
      }
    }

    if (serverContent.turnComplete ?? serverContent.turn_complete) {
      this.handlers?.onEvent({ type: "listening", status: "listening" });
    }
  }

  private async handleFunctionCalls(functionCalls: GeminiFunctionCall[]): Promise<void> {
    const handlers = this.handlers;
    if (!handlers) return;
    handlers.onEvent({ type: "thinking", status: "thinking" });
    const responses = [];

    for (const functionCall of functionCalls) {
      const name = functionCall.name ?? "resolve_mia_request";
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
        const result = await this.backendClient.resolve({
          sessionId: handlers.sessionId,
          utterance,
          context: handlers.getContext()
        });
        handlers.onEvent({ type: "assistant_response", message: result.message, result });
        if (result.type === "workflow") {
          handlers.onEvent({ type: "workflow_resolved", result });
        }
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
      void context.resume().catch(() => undefined);
    }
    const buffer = context.createBuffer(1, pcm.length, rate);
    buffer.getChannelData(0).set(pcm);
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(context.destination);
    const startAt = Math.max(context.currentTime + 0.02, this.nextAudioStartTime);
    source.start(startAt);
    this.nextAudioStartTime = startAt + buffer.duration;
  }

  private stopOutputAudio(): void {
    this.nextAudioStartTime = 0;
    void this.outputContext?.close();
    this.outputContext = undefined;
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
    "You are Mia, an in-product onboarding and support guide embedded in a customer's web app. Mia is a she/her assistant with a clear, warm female voice.",
    "For any request about the current product UI, including where something is, pointing, highlighting, explaining a visible element, clicking, filling, selecting, navigating, or running a task, call resolve_mia_request instead of answering from memory.",
    "Only answer directly when the user is making small talk or asking a question that is clearly unrelated to the host app UI.",
    "Use live screen frames and page context when available, but never pretend you can see the screen if screen frames and page context are unavailable.",
    "When the user wants to perform a saved in-app task, navigate through a saved workflow, fill a form through a saved workflow, or cancel/pause/resume workflow execution, call resolve_mia_request.",
    "Do not say an action is complete until the tool response confirms it.",
    "Keep spoken responses short and clear.",
    `Current page: ${context.pageTitle ?? "Untitled"} at route ${context.currentRoute}.`
  ].join(" ");
}

function toolResponseForResult(result: ResolveResponse): Record<string, unknown> {
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
    };
    const handleOpen = () => {
      cleanup();
      resolve();
    };
    const handleError = () => {
      cleanup();
      reject(new Error("Gemini Live WebSocket connection failed."));
    };
    socket.addEventListener("open", handleOpen);
    socket.addEventListener("error", handleError);
  });
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
