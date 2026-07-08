import { AccessToken } from "livekit-server-sdk";
import type { AppConfig } from "../config/env.js";
import { requireConfig } from "../config/env.js";
import type { VoiceTransportAdapter } from "./interfaces.js";

export class LiveKitVoiceTransportAdapter implements VoiceTransportAdapter {
  constructor(private readonly config: AppConfig) {}

  async createSession(input: { appId: string; sessionId: string; identity: string }): Promise<{ token: string; url: string }> {
    requireConfig(this.config, ["LIVEKIT_URL", "LIVEKIT_API_KEY", "LIVEKIT_API_SECRET"], "LiveKit");
    const roomName = `${input.appId}_${input.sessionId}`;
    const token = new AccessToken(this.config.LIVEKIT_API_KEY!, this.config.LIVEKIT_API_SECRET!, {
      identity: input.identity
    });
    token.addGrant({
      room: roomName,
      roomJoin: true,
      canPublish: true,
      canSubscribe: true
    });
    return { token: await token.toJwt(), url: this.config.LIVEKIT_URL! };
  }
}
