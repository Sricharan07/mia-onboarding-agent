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

  async connect(input: {
    sessionId: string;
    identity: string;
    context: SDKRuntimeContext;
    onEvent: (event: VoiceSessionEvent) => void;
    onInputLevel?: (level: number) => void;
  }): Promise<Room> {
    let session: Awaited<ReturnType<BackendClient["createVoiceSession"]>> | undefined;
    let micTrack: LocalAudioTrack;
    try {
      micTrack = await createLocalAudioTrack({
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      });
    } catch (error) {
      throw new Error(error instanceof Error ? `Microphone permission was denied or unavailable: ${error.message}` : "Microphone permission was denied or unavailable.");
    }

    try {
      this.micTrack = micTrack;
      this.meter = new MicLevelMeter(micTrack.mediaStreamTrack, input.onInputLevel ?? (() => undefined));
      this.meter.start();
      session = await this.backendClient.createVoiceSession({
        clientSessionId: input.sessionId,
        identity: input.identity,
        context: input.context
      });
      this.voiceSessionId = session.voiceSessionId;
      const voiceSessionId = session.voiceSessionId;
      this.eventsAbort = new AbortController();
      void this.backendClient.streamVoiceEvents(voiceSessionId, input.onEvent, this.eventsAbort.signal).catch((error) => {
        if (!this.eventsAbort?.signal.aborted) {
          input.onEvent({ type: "error", voiceSessionId, message: error instanceof Error ? error.message : String(error) });
        }
      });
      this.room = new Room();
      await this.room.connect(session.serverUrl, session.token);
      await this.room.localParticipant.publishTrack(micTrack);
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
