import { createLocalAudioTrack, Room, type LocalAudioTrack } from "livekit-client";
import type { BackendClient } from "../client/backendClient.js";
import type { SDKRuntimeContext, VoiceSessionEvent } from "../types/index.js";
import { MicLevelMeter } from "./micLevelMeter.js";

export class LiveKitVoiceClient {
  private room?: Room;
  private micTrack?: LocalAudioTrack;
  private voiceSessionId?: string;
  private eventsAbort?: AbortController;
  private meter?: MicLevelMeter;

  constructor(private readonly backendClient: BackendClient) {}

  getVoiceSessionId(): string | undefined {
    return this.voiceSessionId;
  }

  async connect(input: {
    sessionId: string;
    identity: string;
    context: SDKRuntimeContext;
    onEvent: (event: VoiceSessionEvent) => void;
    onInputLevel?: (level: number) => void;
    onStage?: (stage: string) => void;
  }): Promise<Room> {
    let session: Awaited<ReturnType<BackendClient["createVoiceSession"]>> | undefined;
    let micTrack: LocalAudioTrack;
    try {
      input.onStage?.("Requesting microphone permission...");
      micTrack = await withTimeout(createLocalAudioTrack({
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      }), 10000, "Microphone permission timed out. Check browser site permissions.");
    } catch (error) {
      throw new Error(error instanceof Error ? `Microphone permission was denied or unavailable: ${error.message}` : "Microphone permission was denied or unavailable.");
    }

    try {
      this.micTrack = micTrack;
      this.meter = new MicLevelMeter(micTrack.mediaStreamTrack, input.onInputLevel ?? (() => undefined));
      this.meter.start();
      input.onStage?.("Creating LiveKit voice session...");
      session = await withTimeout(this.backendClient.createVoiceSession({
        clientSessionId: input.sessionId,
        identity: input.identity,
        context: input.context
      }), 10000, "Backend voice session timed out.");
      this.voiceSessionId = session.voiceSessionId;
      const voiceSessionId = session.voiceSessionId;
      input.onStage?.("Opening voice event stream...");
      this.eventsAbort = new AbortController();
      void this.backendClient.streamVoiceEvents(voiceSessionId, input.onEvent, this.eventsAbort.signal).catch((error) => {
        if (!this.eventsAbort?.signal.aborted) {
          input.onEvent({ type: "error", voiceSessionId, message: error instanceof Error ? error.message : String(error) });
        }
      });
      this.room = new Room();
      input.onStage?.("Connecting to LiveKit...");
      await withTimeout(this.room.connect(session.serverUrl, session.token), 10000, `LiveKit connection timed out for ${session.serverUrl}.`);
      input.onStage?.("Publishing microphone audio...");
      await withTimeout(this.room.localParticipant.publishTrack(micTrack), 10000, "Publishing microphone audio timed out.");
      input.onStage?.("Listening");
      return this.room;
    } catch (error) {
      this.eventsAbort?.abort();
      this.eventsAbort = undefined;
      this.meter?.stop();
      this.meter = undefined;
      micTrack.stop();
      this.micTrack = undefined;
      await this.room?.disconnect();
      this.room = undefined;
      if (session) await this.backendClient.endVoiceSession(session.voiceSessionId).catch(() => undefined);
      this.voiceSessionId = undefined;
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    this.eventsAbort?.abort();
    this.eventsAbort = undefined;
    this.meter?.stop();
    this.meter = undefined;
    this.micTrack?.stop();
    this.micTrack = undefined;
    await this.room?.disconnect();
    this.room = undefined;
    if (this.voiceSessionId) {
      await this.backendClient.endVoiceSession(this.voiceSessionId).catch(() => undefined);
      this.voiceSessionId = undefined;
    }
  }
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
