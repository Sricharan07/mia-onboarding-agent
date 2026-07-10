import type { V1Config } from "./config.js";
import type { SecretRepository } from "./db/repositories.js";
import { decryptSecret, encryptSecret } from "./crypto.js";
import { AppError } from "../utils/errors.js";

const GEMINI_API_KEY = "gemini_api_key";

export class V1SecretService {
  constructor(
    private readonly config: V1Config,
    private readonly repository: SecretRepository
  ) {}

  async geminiStatus(): Promise<{ configured: boolean; source?: "environment" | "database" }> {
    if (this.config.GEMINI_API_KEY) return { configured: true, source: "environment" };
    return await this.repository.has(GEMINI_API_KEY)
      ? { configured: true, source: "database" }
      : { configured: false };
  }

  async getGeminiApiKey(): Promise<string | undefined> {
    if (this.config.GEMINI_API_KEY) return this.config.GEMINI_API_KEY;
    const encrypted = await this.repository.get(GEMINI_API_KEY);
    return encrypted ? decryptSecret(encrypted, this.config.MIA_SECRET_ENCRYPTION_KEY) : undefined;
  }

  async setGeminiApiKey(apiKey: string): Promise<void> {
    const value = apiKey.trim();
    if (value.length < 20 || /\s/.test(value)) throw new AppError("GEMINI_API_KEY_INVALID", "Gemini API key is invalid.", 400);
    await this.repository.set(GEMINI_API_KEY, encryptSecret(value, this.config.MIA_SECRET_ENCRYPTION_KEY));
  }

  async clearGeminiApiKey(): Promise<void> {
    if (this.config.GEMINI_API_KEY) {
      throw new AppError("GEMINI_API_KEY_FROM_ENV", "Remove GEMINI_API_KEY from the environment to clear it.", 409);
    }
    await this.repository.delete(GEMINI_API_KEY);
  }
}
