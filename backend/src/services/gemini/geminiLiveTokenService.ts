import { GoogleGenAI, Modality } from "@google/genai";
import type { AppConfig } from "../../config/env.js";
import { requireConfig } from "../../config/env.js";

export const LIVE_API_WEBSOCKET_PATH = "/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContentConstrained";

export type GeminiLiveTokenInput = {
  appId: string;
  clientSessionId: string;
};

export type GeminiLiveTokenResponse = {
  token: string;
  model: string;
  expiresAt: string;
  websocketUrl: string;
};

export class GeminiLiveTokenService {
  constructor(private readonly config: AppConfig) {}

  async create(input: GeminiLiveTokenInput): Promise<GeminiLiveTokenResponse> {
    requireConfig(this.config, ["GEMINI_API_KEY"], "Gemini Live");

    const client = new GoogleGenAI({ apiKey: this.config.GEMINI_API_KEY });
    const expiresAt = new Date(Date.now() + this.config.GEMINI_TOKEN_TTL_SECONDS * 1000).toISOString();
    const newSessionExpiresAt = new Date(Date.now() + this.config.GEMINI_NEW_SESSION_TTL_SECONDS * 1000).toISOString();
    const token = await client.authTokens.create({
      config: {
        uses: 1,
        expireTime: expiresAt,
        newSessionExpireTime: newSessionExpiresAt,
        httpOptions: { apiVersion: "v1alpha" },
        liveConnectConstraints: {
          model: this.config.GEMINI_LIVE_MODEL,
          config: {
            responseModalities: [Modality.AUDIO]
          }
        }
      }
    });

    if (!token.name) {
      throw new Error("Gemini did not return an ephemeral token name.");
    }

    return {
      token: token.name,
      model: this.config.GEMINI_LIVE_MODEL,
      expiresAt,
      websocketUrl: buildGeminiLiveWebSocketUrl(this.config.GEMINI_BASE_URL)
    };
  }
}

export function buildGeminiLiveWebSocketUrl(baseUrl: string): string {
  return `${baseUrl.replace(/^http/, "ws").replace(/\/+$/, "")}${LIVE_API_WEBSOCKET_PATH}`;
}
