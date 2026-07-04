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
  BOOTSTRAP_ADMIN_TOKEN: z.string().optional(),
  CONSOLE_SESSION_TTL_SECONDS: z.coerce.number().int().positive().default(60 * 60 * 8),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(300),
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
  UI_SCAN_AUTH_MODE: z.enum(["none", "login_form"]).default("none"),
  UI_SCAN_LOGIN_URL: z.string().optional(),
  UI_SCAN_USERNAME: z.string().optional(),
  UI_SCAN_PASSWORD: z.string().optional(),
  UI_SCAN_USERNAME_SELECTOR: z.string().optional(),
  UI_SCAN_PASSWORD_SELECTOR: z.string().optional(),
  UI_SCAN_SUBMIT_SELECTOR: z.string().optional(),
  UI_SCAN_SUCCESS_URL_PATTERN: z.string().optional(),
  UI_SCAN_POST_LOGIN_WAIT_MS: z.coerce.number().int().nonnegative().default(1000),
  UI_SCAN_HEADLESS: booleanStringSchema.default(true)
});

export type AppConfig = z.infer<typeof envSchema>;

export function loadConfig(): AppConfig {
  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    throw new ConfigError("Environment validation failed.", result.error.issues);
  }

  return normalizePaths(result.data);
}

export function requireConfig(config: AppConfig, keys: Array<keyof AppConfig>, provider: string): void {
  const missing = keys.filter((key) => !config[key]);

  if (missing.length > 0) {
    throw new ConfigError(`${provider} is not configured. Missing: ${missing.join(", ")}.`);
  }
}

function normalizePaths(config: AppConfig): AppConfig {
  return {
    ...config,
    DATABASE_URL: config.DATABASE_URL.startsWith("file:")
      ? `file:${resolveMaybeRelative(config.DATABASE_URL.slice("file:".length))}`
      : resolveMaybeRelative(config.DATABASE_URL),
    LOCAL_UPLOAD_DIR: resolveMaybeRelative(config.LOCAL_UPLOAD_DIR),
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
