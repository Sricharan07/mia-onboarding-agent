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
    gemini: ProviderReadiness;
    semanticSearch: ProviderReadiness;
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
        gemini: this.configOnly("Gemini", ["GEMINI_API_KEY", "GEMINI_TEXT_MODEL", "GEMINI_VISION_MODEL", "GEMINI_LIVE_MODEL"]),
        semanticSearch: this.configOnly("Semantic search", ["OPENAI_API_KEY", "OPENAI_BASE_URL", "OPENAI_EMBEDDING_MODEL", "SEMANTIC_INDEX_DIR"])
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
