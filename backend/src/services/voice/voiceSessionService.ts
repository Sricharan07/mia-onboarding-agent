import { MossVoiceServer } from "@moss-tools/voice-server";
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
};

export class VoiceSessionService {
  private readonly sessions = new Map<string, VoiceSession>();
  private mossVoiceServer?: Promise<MossVoiceServer>;

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
    requireConfig(this.config, ["MOSS_PROJECT_ID", "MOSS_PROJECT_KEY", "MOSS_VOICE_AGENT_ID"], "Moss voice agent");

    const server = await this.getMossVoiceServer();
    const voiceSessionId = createId("voice_session");
    const roomName = `mia-${voiceSessionId}`;
    const metadata = JSON.stringify({
      appId: input.appId,
      clientSessionId: input.clientSessionId,
      voiceSessionId,
      userMetadata: input.userMetadata ?? {}
    });

    const token = await server.createParticipantToken(
      { identity: input.identity, name: input.identity, metadata },
      roomName,
      server.getAgentName()
    );

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

    this.emit(session, { type: "session_ready", voiceSessionId, status: "listening", roomName });
    this.emit(session, { type: "listening", voiceSessionId, status: "listening" });

    return {
      voiceSessionId,
      serverUrl: server.getServerUrl(),
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

    session.status = "thinking";
    this.emit(session, { type: "transcript_user", voiceSessionId: session.id, text: utterance, isFinal: true });
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

  subscribe(voiceSessionId: string, subscriber: (event: VoiceSessionEvent) => void): () => void {
    const session = this.get(voiceSessionId);
    for (const event of session.events) subscriber(event);
    session.subscribers.add(subscriber);
    return () => {
      session.subscribers.delete(subscriber);
    };
  }

  async end(voiceSessionId: string): Promise<{ voiceSessionId: string; status: VoiceSessionStatus }> {
    const session = this.get(voiceSessionId);
    this.closeSession(session, "ended");
    return { voiceSessionId, status: "ended" };
  }

  async closeAll(): Promise<void> {
    for (const session of this.sessions.values()) this.closeSession(session, "ended");
  }

  private getMossVoiceServer(): Promise<MossVoiceServer> {
    if (!this.mossVoiceServer) {
      this.mossVoiceServer = MossVoiceServer.create({
        projectId: this.config.MOSS_PROJECT_ID!,
        projectKey: this.config.MOSS_PROJECT_KEY!,
        voiceAgentId: this.config.MOSS_VOICE_AGENT_ID!
      }).catch((error) => {
        this.mossVoiceServer = undefined;
        throw error;
      });
    }
    return this.mossVoiceServer;
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
    this.emit(session, {
      type: "error",
      voiceSessionId: session.id,
      code: appError?.code,
      message: error instanceof Error ? error.message : String(error)
    });
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
