import type { AppConfig } from "../../config/env.js";
import type { Repositories } from "../../db/repositories.js";

export type ProviderReadiness = {
  configured: boolean;
  reachable: boolean | null;
  status: "ok" | "missing_config" | "unverified" | "error";
  message: string;
};

export type SystemReadiness = {
  database: ProviderReadiness;
  providers: {
    qwen: ProviderReadiness;
    moss: ProviderReadiness;
    mossVoiceAgent: ProviderReadiness;
  };
};

export class ReadinessService {
  constructor(
    private readonly config: AppConfig,
    private readonly repositories: Repositories
  ) {}

  async check(): Promise<SystemReadiness> {
    return {
      database: this.database(),
      providers: {
        qwen: await this.qwen(),
        moss: this.configOnly("Moss", ["MOSS_PROJECT_ID", "MOSS_PROJECT_KEY", "MOSS_INDEX_NAME"]),
        mossVoiceAgent: this.configOnly("Moss Voice Agent", ["MOSS_PROJECT_ID", "MOSS_PROJECT_KEY", "MOSS_VOICE_AGENT_ID"])
      }
    };
  }

  private database(): ProviderReadiness {
    try {
      this.repositories.listApps();
      return { configured: true, reachable: true, status: "ok", message: "SQLite database is reachable." };
    } catch (error) {
      return { configured: true, reachable: false, status: "error", message: error instanceof Error ? error.message : "SQLite database check failed." };
    }
  }

  private async qwen(): Promise<ProviderReadiness> {
    const missing = this.missing(["QWEN_API_KEY", "QWEN_BASE_URL"]);
    if (missing.length > 0) return missingConfig("Qwen", missing);

    try {
      const response = await fetch(`${this.config.QWEN_BASE_URL!.replace(/\/+$/, "")}/models`, {
        headers: { authorization: `Bearer ${this.config.QWEN_API_KEY}` }
      });
      if (!response.ok) {
        return { configured: true, reachable: false, status: "error", message: `Qwen model list returned HTTP ${response.status}.` };
      }
      return { configured: true, reachable: true, status: "ok", message: "Qwen model endpoint is reachable." };
    } catch (error) {
      return { configured: true, reachable: false, status: "error", message: error instanceof Error ? error.message : "Qwen readiness check failed." };
    }
  }

  private configOnly(provider: string, keys: Array<keyof AppConfig>): ProviderReadiness {
    const missing = this.missing(keys);
    if (missing.length > 0) return missingConfig(provider, missing);
    return { configured: true, reachable: null, status: "unverified", message: `${provider} is configured. No-credit live operation was not run.` };
  }

  private missing(keys: Array<keyof AppConfig>): string[] {
    return keys.filter((key) => !this.config[key]).map(String);
  }
}

function missingConfig(provider: string, missing: string[]): ProviderReadiness {
  return {
    configured: false,
    reachable: false,
    status: "missing_config",
    message: `${provider} missing: ${missing.join(", ")}.`
  };
}
