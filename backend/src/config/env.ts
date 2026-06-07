import { config as loadDotenv } from "dotenv";
import { existsSync } from "node:fs";
import { basename, resolve } from "node:path";
import { z } from "zod";
import { ConfigError } from "../utils/errors.js";

const workspaceRoot = resolveWorkspaceRoot();
const rootEnvPath = resolve(workspaceRoot, ".env");
loadDotenv({ path: existsSync(rootEnvPath) ? rootEnvPath : undefined });

const booleanStringSchema = z.preprocess((value) => {
  if (typeof value !== "string") return value;
  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
}, z.boolean());

const envSchema = z.object({
  NODE_ENV: z.string().default("development"),
  BACKEND_HOST: z.string().default("0.0.0.0"),
  BACKEND_PORT: z.coerce.number().int().positive().default(4000),
  DATABASE_URL: z.string().default("file:./data/sqlite/local.db"),
  LOCAL_UPLOAD_DIR: z.string().default("./data/uploads"),
  LOCAL_TTS_DIR: z.string().default("./data/tts"),
  QWEN_API_KEY: z.string().optional(),
  QWEN_BASE_URL: z.string().optional(),
  QWEN_TEXT_ENDPOINT: z.string().default("/chat/completions"),
  QWEN_VIDEO_ENDPOINT: z.string().default("/chat/completions"),
  QWEN_MODEL: z.string().optional(),
  QWEN_VISION_MODEL: z.string().optional(),
  QWEN_VOICE_MODEL: z.string().optional(),
  QWEN_TTS_BASE_URL: z.string().optional(),
  QWEN_TTS_ENDPOINT: z.string().default("/services/aigc/multimodal-generation/generation"),
  MOSS_PROJECT_ID: z.string().optional(),
  MOSS_PROJECT_KEY: z.string().optional(),
  MOSS_INDEX_NAME: z.string().default("mia-onboarding"),
  LIVEKIT_URL: z.string().optional(),
  LIVEKIT_API_KEY: z.string().optional(),
  LIVEKIT_API_SECRET: z.string().optional(),
  STT_API_KEY: z.string().optional(),
  STT_BASE_URL: z.string().optional(),
  STT_ENDPOINT: z.string().default("/chat/completions"),
  STT_MODEL: z.string().optional(),
  RUNTIME_LLM_MODEL: z.string().optional(),
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
    LOCAL_TTS_DIR: resolveMaybeRelative(config.LOCAL_TTS_DIR)
  };
}

function resolveMaybeRelative(value: string): string {
  if (value.startsWith("/")) return value;
  return resolve(workspaceRoot, value);
}

function resolveWorkspaceRoot(): string {
  return basename(process.cwd()) === "backend" ? resolve(process.cwd(), "..") : process.cwd();
}
