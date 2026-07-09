import { config as loadDotenv } from "dotenv";
import { existsSync } from "node:fs";
import { basename, resolve } from "node:path";
import { z } from "zod";
import { ConfigError } from "../utils/errors.js";

const workspaceRoot = resolveWorkspaceRoot();
const rootEnvPath = resolve(workspaceRoot, ".env");
loadDotenv({ path: existsSync(rootEnvPath) ? rootEnvPath : undefined, quiet: true });

const booleanStringSchema = z.preprocess((value) => {
  if (typeof value !== "string") return value;
  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
}, z.boolean());

const envSchema = z.object({
  NODE_ENV: z.string().default("development"),
  BACKEND_HOST: z.string().default("0.0.0.0"),
  BACKEND_PORT: z.coerce.number().int().positive().default(4000),
  TRUST_PROXY: booleanStringSchema.default(false),
  CORS_ORIGIN: z.string().default("*"),
  DATABASE_URL: z.string().default("file:./data/sqlite/local.db"),
  LOCAL_UPLOAD_DIR: z.string().default("./data/uploads"),
  LOCAL_TTS_DIR: z.string().default("./data/tts"),
  CONSOLE_DIST_DIR: z.string().default("./backend/console/dist"),
  MIA_SECRET_ENCRYPTION_KEY: z.string().optional(),
  BOOTSTRAP_ADMIN_TOKEN: z.string().optional(),
  CONSOLE_SESSION_TTL_SECONDS: z.coerce.number().int().positive().default(60 * 60 * 8),
  CONSOLE_AUTH_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(8),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(300),
  RUNTIME_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().max(60 * 60).default(15 * 60),
  RUNTIME_TOKEN_MAX_USES: z.coerce.number().int().positive().max(100_000).default(2_000),
  RUNTIME_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(180),
  APP_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(1_200),
  APP_VOICE_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(120),
  DATA_RETENTION_SWEEP_INTERVAL_MS: z.coerce.number().int().positive().default(60 * 60 * 1_000),
  WORKFLOW_VIDEO_MAX_BYTES: z.coerce.number().int().positive().default(50 * 1024 * 1024),
  PROVIDER_REQUEST_TIMEOUT_MS: z.coerce.number().int().positive().max(10 * 60 * 1_000).optional(),
  PROVIDER_RETRY_ATTEMPTS: z.coerce.number().int().positive().max(5).optional(),
  PROVIDER_RESPONSE_MAX_BYTES: z.coerce.number().int().positive().max(100 * 1024 * 1024).optional(),
  SHUTDOWN_GRACE_PERIOD_MS: z.coerce.number().int().positive().max(2 * 60 * 1_000).optional(),
  GEMINI_LIVE_TOKEN_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(30),
  GEMINI_API_KEY: z.string().optional(),
  GEMINI_BASE_URL: z.string().default("https://generativelanguage.googleapis.com"),
  GEMINI_TEXT_MODEL: z.string().default("gemini-2.5-flash"),
  GEMINI_VISION_MODEL: z.string().default("gemini-2.5-flash"),
  GEMINI_LIVE_MODEL: z.string().default("gemini-3.1-flash-live-preview"),
  GEMINI_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().max(60 * 60 * 20).default(30 * 60),
  GEMINI_NEW_SESSION_TTL_SECONDS: z.coerce.number().int().positive().max(60 * 60 * 20).default(60),
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_BASE_URL: z.string().default("https://api.openai.com/v1"),
  OPENAI_EMBEDDING_MODEL: z.string().default("text-embedding-3-small"),
  OPENAI_EMBEDDING_DIMENSIONS: z.coerce.number().int().positive().default(1536),
  SEMANTIC_INDEX_DIR: z.string().default("./data/lancedb"),
  QWEN_API_KEY: z.string().optional(),
  QWEN_TTS_BASE_URL: z.string().optional(),
  QWEN_TTS_ENDPOINT: z.string().default("/services/aigc/multimodal-generation/generation"),
  QWEN_VOICE_MODEL: z.string().optional(),
  QWEN_TTS_AUDIO_ORIGINS: z.string().optional(),
  LIVEKIT_URL: z.string().optional(),
  LIVEKIT_API_KEY: z.string().optional(),
  LIVEKIT_API_SECRET: z.string().optional(),
  UI_SCAN_AUTH_MODE: z.enum(["none", "login_form"]).default("none"),
  UI_SCAN_LOGIN_URL: z.string().optional(),
  UI_SCAN_USERNAME: z.string().optional(),
  UI_SCAN_PASSWORD: z.string().optional(),
  UI_SCAN_USERNAME_SELECTOR: z.string().optional(),
  UI_SCAN_PASSWORD_SELECTOR: z.string().optional(),
  UI_SCAN_SUBMIT_SELECTOR: z.string().optional(),
  UI_SCAN_SUCCESS_URL_PATTERN: z.string().optional(),
  UI_SCAN_POST_LOGIN_WAIT_MS: z.coerce.number().int().nonnegative().default(1000),
  UI_SCAN_HEADLESS: booleanStringSchema.default(true),
  UI_SCAN_ALLOW_PRIVATE_NETWORKS: booleanStringSchema.default(false),
  UI_SCAN_ALLOWED_RESOURCE_ORIGINS: z.string().optional()
});

export type AppConfig = z.infer<typeof envSchema>;

export function loadConfig(): AppConfig {
  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    throw new ConfigError("Environment validation failed.", result.error.issues);
  }

  const config = normalizePaths(result.data);
  validateRuntimeConfig(config);
  return config;
}

export function requireConfig(config: AppConfig, keys: Array<keyof AppConfig>, provider: string): void {
  const missing = keys.filter((key) => !config[key]);

  if (missing.length > 0) {
    throw new ConfigError(`${provider} is not configured. Missing: ${missing.join(", ")}.`);
  }
}

export function validateRuntimeConfig(config: AppConfig): void {
  if (config.NODE_ENV !== "production") return;
  if (config.CORS_ORIGIN.trim() === "*") throw new ConfigError("CORS_ORIGIN must be an explicit origin list in production.");
  validateProductionOrigins(config.CORS_ORIGIN);
  if (!config.MIA_SECRET_ENCRYPTION_KEY || config.MIA_SECRET_ENCRYPTION_KEY.length < 32) {
    throw new ConfigError("MIA_SECRET_ENCRYPTION_KEY must contain at least 32 characters in production.");
  }
  if (config.BOOTSTRAP_ADMIN_TOKEN && config.BOOTSTRAP_ADMIN_TOKEN.length < 32) {
    throw new ConfigError("BOOTSTRAP_ADMIN_TOKEN must contain at least 32 characters when set in production.");
  }
}

function validateProductionOrigins(value: string): void {
  const origins = value.split(",").map((origin) => origin.trim()).filter(Boolean);
  if (origins.length === 0) throw new ConfigError("CORS_ORIGIN must include at least one origin in production.");
  for (const rawOrigin of origins) {
    let url: URL;
    try {
      url = new URL(rawOrigin);
    } catch {
      throw new ConfigError(`CORS_ORIGIN contains an invalid origin: ${rawOrigin}`);
    }
    if (url.username || url.password || url.pathname !== "/" || url.search || url.hash || url.origin !== rawOrigin.replace(/\/$/, "")) {
      throw new ConfigError(`CORS_ORIGIN entries must be origins without paths or credentials: ${rawOrigin}`);
    }
    const localHttp = url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    if (url.protocol !== "https:" && !localHttp) {
      throw new ConfigError(`CORS_ORIGIN must use HTTPS outside localhost: ${rawOrigin}`);
    }
  }
}

function normalizePaths(config: AppConfig): AppConfig {
  return {
    ...config,
    DATABASE_URL: config.DATABASE_URL.startsWith("file:")
      ? `file:${resolveMaybeRelative(config.DATABASE_URL.slice("file:".length))}`
      : resolveMaybeRelative(config.DATABASE_URL),
    LOCAL_UPLOAD_DIR: resolveMaybeRelative(config.LOCAL_UPLOAD_DIR),
    LOCAL_TTS_DIR: resolveMaybeRelative(config.LOCAL_TTS_DIR),
    CONSOLE_DIST_DIR: resolveMaybeRelative(config.CONSOLE_DIST_DIR),
    SEMANTIC_INDEX_DIR: resolveMaybeRelative(config.SEMANTIC_INDEX_DIR)
  };
}

function resolveMaybeRelative(value: string): string {
  if (value.startsWith("/")) return value;
  return resolve(workspaceRoot, value);
}

function resolveWorkspaceRoot(): string {
  return basename(process.cwd()) === "backend" ? resolve(process.cwd(), "..") : process.cwd();
}
