import { AccessToken, AgentDispatchClient, RoomConfiguration } from "livekit-server-sdk";
import type { AppConfig } from "../../config/env.js";
import { requireConfig } from "../../config/env.js";
import type { SDKRuntimeContext } from "../../schemas/domain.js";
import type { RuntimeService } from "../runtime/runtimeService.js";
import { AppError, NotFoundError } from "../../utils/errors.js";
import { createId } from "../../utils/id.js";

type VoiceSessionStatus = "connecting" | "listening" | "thinking" | "speaking" | "ended" | "error";

export type VoiceSessionEvent =
  | { type: "session_ready"; voiceSessionId: string; status: VoiceSessionStatus; roomName: string }
  | { type: "listening"; voiceSessionId: string; status: VoiceSessionStatus }
  | { type: "transcript_user"; voiceSessionId: string; text: string; isFinal: true }
  | { type: "thinking"; voiceSessionId: string; status: VoiceSessionStatus }
  | { type: "assistant_response"; voiceSessionId: string; message: string; result: unknown }
  | { type: "workflow_resolved"; voiceSessionId: string; result: unknown }
  | { type: "error"; voiceSessionId: string; message: string; code?: string }
  | { type: "ended"; voiceSessionId: string; status: VoiceSessionStatus };

type VoiceSession = {
  id: string;
  appId: string;
  clientSessionId: string;
  identity: string;
  roomName: string;
  context: Omit<SDKRuntimeContext, "appId" | "sessionId">;
  status: VoiceSessionStatus;
  events: VoiceSessionEvent[];
  subscribers: Set<(event: VoiceSessionEvent) => void>;
  stopped: boolean;
  lastUserTranscript?: string;
  inputCapture?: {
    prompt: string;
    startedAt: number;
  };
};

export class VoiceSessionService {
  private readonly sessions = new Map<string, VoiceSession>();

  constructor(
    private readonly config: AppConfig,
    private readonly runtime: RuntimeService
  ) {}

  async create(input: {
    appId: string;
    clientSessionId: string;
    identity: string;
    context: Omit<SDKRuntimeContext, "appId" | "sessionId">;
    userMetadata?: Record<string, unknown>;
  }): Promise<{ voiceSessionId: string; serverUrl: string; token: string; roomName: string; status: VoiceSessionStatus }> {
    requireConfig(this.config, ["LIVEKIT_URL", "LIVEKIT_API_KEY", "LIVEKIT_API_SECRET"], "LiveKit voice agent");

    const voiceSessionId = createId("voice_session");
    const roomName = `mia-${voiceSessionId}`;
    const metadata = JSON.stringify({
      appId: input.appId,
      clientSessionId: input.clientSessionId,
      voiceSessionId,
      userMetadata: input.userMetadata ?? {}
    });

    const token = await this.createParticipantToken({ identity: input.identity, roomName, metadata });

    const session: VoiceSession = {
      id: voiceSessionId,
      appId: input.appId,
      clientSessionId: input.clientSessionId,
      identity: input.identity,
      roomName,
      context: input.context,
      status: "listening",
      events: [],
      subscribers: new Set(),
      stopped: false
    };
    this.sessions.set(voiceSessionId, session);

    console.info(`[voice] created session=${voiceSessionId} room=${roomName} identity=${input.identity}`);
    await this.dispatchAgent(roomName, metadata);
    this.emit(session, { type: "session_ready", voiceSessionId, status: "listening", roomName });
    this.emit(session, { type: "listening", voiceSessionId, status: "listening" });

    return {
      voiceSessionId,
      serverUrl: this.config.LIVEKIT_URL!,
      token,
      roomName,
      status: "listening"
    };
  }

  async resolveUtterance(voiceSessionId: string, input: { utterance: string }): Promise<{ voiceSessionId: string; message: string; result: unknown }> {
    const session = this.get(voiceSessionId);
    if (session.stopped) throw new AppError("VOICE_SESSION_ENDED", "Voice session has already ended.", 409);

    const utterance = input.utterance.trim();
    if (!utterance) throw new AppError("EMPTY_UTTERANCE", "Voice utterance cannot be empty.", 400);

    if (session.inputCapture) {
      console.info(`[voice] captured workflow input session=${voiceSessionId} utterance=${JSON.stringify(utterance)}`);
      session.inputCapture = undefined;
      this.recordTranscriptForSession(session, utterance);
      const result = { type: "answer", message: "Got it." };
      this.emit(session, { type: "assistant_response", voiceSessionId: session.id, message: result.message, result });
      session.status = "listening";
      this.emit(session, { type: "listening", voiceSessionId: session.id, status: "listening" });
      return { voiceSessionId: session.id, message: result.message, result };
    }

    console.info(`[voice] resolving session=${voiceSessionId} utterance=${JSON.stringify(utterance)}`);
    session.status = "thinking";
    this.recordTranscriptForSession(session, utterance);
    this.emit(session, { type: "thinking", voiceSessionId: session.id, status: "thinking" });

    try {
      const result = await this.runtime.resolve({
        appId: session.appId,
        sessionId: session.clientSessionId,
        utterance,
        context: session.context,
        includeTts: false
      });
      const message = typeof result === "object" && result && "message" in result ? String(result.message) : "";
      const resultType = typeof result === "object" && result && "type" in result ? String(result.type) : "unknown";
      console.info(`[voice] resolved session=${voiceSessionId} type=${resultType} message=${JSON.stringify(message)}`);
      this.emit(session, { type: "assistant_response", voiceSessionId: session.id, message, result });
      if (typeof result === "object" && result && "type" in result && result.type === "workflow") {
        this.emit(session, { type: "workflow_resolved", voiceSessionId: session.id, result });
      }
      session.status = "listening";
      this.emit(session, { type: "listening", voiceSessionId: session.id, status: "listening" });
      return { voiceSessionId: session.id, message, result };
    } catch (error) {
      this.emitError(session, error);
      throw error;
    }
  }

  async recordTranscript(voiceSessionId: string, input: { text: string }): Promise<{ voiceSessionId: string; text: string }> {
    const session = this.get(voiceSessionId);
    if (session.stopped) throw new AppError("VOICE_SESSION_ENDED", "Voice session has already ended.", 409);
    const text = input.text.trim();
    if (!text) throw new AppError("EMPTY_TRANSCRIPT", "Voice transcript cannot be empty.", 400);
    this.recordTranscriptForSession(session, text);
    return { voiceSessionId: session.id, text };
  }

  beginInputCapture(voiceSessionId: string, input: { prompt: string }): { voiceSessionId: string; status: VoiceSessionStatus } {
    const session = this.get(voiceSessionId);
    if (session.stopped) throw new AppError("VOICE_SESSION_ENDED", "Voice session has already ended.", 409);
    session.inputCapture = {
      prompt: input.prompt,
      startedAt: Date.now()
    };
    session.status = "listening";
    this.emit(session, { type: "listening", voiceSessionId: session.id, status: "listening" });
    return { voiceSessionId: session.id, status: session.status };
  }

  endInputCapture(voiceSessionId: string): { voiceSessionId: string; status: VoiceSessionStatus } {
    const session = this.get(voiceSessionId);
    session.inputCapture = undefined;
    return { voiceSessionId: session.id, status: session.status };
  }

  subscribe(voiceSessionId: string, subscriber: (event: VoiceSessionEvent) => void): () => void {
    const session = this.get(voiceSessionId);
    for (const event of session.events) subscriber(event);
    session.subscribers.add(subscriber);
    return () => {
      session.subscribers.delete(subscriber);
    };
  }

  listDebug(): Array<{ id: string; roomName: string; identity: string; status: VoiceSessionStatus; eventCount: number; lastEvent?: VoiceSessionEvent }> {
    return [...this.sessions.values()].map((session) => ({
      id: session.id,
      roomName: session.roomName,
      identity: session.identity,
      status: session.status,
      eventCount: session.events.length,
      lastEvent: session.events.at(-1)
    }));
  }

  async end(voiceSessionId: string): Promise<{ voiceSessionId: string; status: VoiceSessionStatus }> {
    const session = this.get(voiceSessionId);
    this.closeSession(session, "ended");
    return { voiceSessionId, status: "ended" };
  }

  async closeAll(): Promise<void> {
    for (const session of this.sessions.values()) this.closeSession(session, "ended");
  }

  private async createParticipantToken(input: { identity: string; roomName: string; metadata: string }): Promise<string> {
    const token = new AccessToken(this.config.LIVEKIT_API_KEY!, this.config.LIVEKIT_API_SECRET!, {
      identity: input.identity,
      name: input.identity,
      metadata: input.metadata,
      ttl: "15m"
    });
    token.addGrant({
      room: input.roomName,
      roomJoin: true,
      canPublish: true,
      canPublishData: true,
      canSubscribe: true
    });
    token.roomConfig = new RoomConfiguration({
      agents: [{ agentName: this.config.LIVEKIT_AGENT_NAME, metadata: input.metadata }]
    });
    return token.toJwt();
  }

  private async dispatchAgent(roomName: string, metadata: string): Promise<void> {
    const dispatchClient = new AgentDispatchClient(
      liveKitHttpUrl(this.config.LIVEKIT_URL!),
      this.config.LIVEKIT_API_KEY!,
      this.config.LIVEKIT_API_SECRET!,
      { requestTimeout: 5000 }
    );
    try {
      const dispatch = await dispatchClient.createDispatch(roomName, this.config.LIVEKIT_AGENT_NAME, { metadata });
      console.info(`[voice] dispatched agent=${this.config.LIVEKIT_AGENT_NAME} room=${roomName} dispatch=${dispatch.id}`);
    } catch (error) {
      console.error(`[voice] failed to dispatch agent=${this.config.LIVEKIT_AGENT_NAME} room=${roomName}`, error);
      throw new AppError(
        "LIVEKIT_AGENT_DISPATCH_FAILED",
        `LiveKit agent dispatch failed. Confirm ./voice-agent/run-local.sh is running with LIVEKIT_AGENT_NAME=${this.config.LIVEKIT_AGENT_NAME}.`,
        502,
        error instanceof Error ? { message: error.message } : error
      );
    }
  }

  private get(voiceSessionId: string): VoiceSession {
    const session = this.sessions.get(voiceSessionId);
    if (!session) throw new NotFoundError(`Voice session not found: ${voiceSessionId}`);
    return session;
  }

  private emit(session: VoiceSession, event: VoiceSessionEvent): void {
    session.events.push(event);
    if (session.events.length > 100) session.events.shift();
    for (const subscriber of session.subscribers) subscriber(event);
  }

  private emitError(session: VoiceSession, error: unknown): void {
    session.status = "error";
    const appError = error instanceof AppError ? error : undefined;
    console.error(`[voice] error session=${session.id}`, error);
    this.emit(session, {
      type: "error",
      voiceSessionId: session.id,
      code: appError?.code,
      message: error instanceof Error ? error.message : String(error)
    });
  }

  private recordTranscriptForSession(session: VoiceSession, text: string): void {
    if (session.lastUserTranscript === text) return;
    session.lastUserTranscript = text;
    this.emit(session, { type: "transcript_user", voiceSessionId: session.id, text, isFinal: true });
  }

  private closeSession(session: VoiceSession, status: VoiceSessionStatus): void {
    if (session.stopped) return;
    session.stopped = true;
    session.status = status;
    this.emit(session, { type: "ended", voiceSessionId: session.id, status });
    windowSetTimeout(() => this.sessions.delete(session.id), 30000);
  }
}

function windowSetTimeout(fn: () => void, ms: number): void {
  setTimeout(fn, ms).unref?.();
}

function liveKitHttpUrl(url: string): string {
  if (url.startsWith("ws://")) return `http://${url.slice("ws://".length)}`;
  if (url.startsWith("wss://")) return `https://${url.slice("wss://".length)}`;
  return url;
}
