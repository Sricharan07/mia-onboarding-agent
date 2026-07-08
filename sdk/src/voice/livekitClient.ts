import { Room } from "livekit-client";
import type { BackendClient } from "../client/backendClient.js";

export class LiveKitVoiceClient {
  private room?: Room;

  constructor(private readonly backendClient: BackendClient) {}

  async connect(input: { sessionId: string; identity: string }): Promise<Room> {
    const session = await this.backendClient.getLiveKitToken(input);
    this.room = new Room();
    await this.room.connect(session.url, session.token);
    return this.room;
  }

  async disconnect(): Promise<void> {
    await this.room?.disconnect();
    this.room = undefined;
  }
}
