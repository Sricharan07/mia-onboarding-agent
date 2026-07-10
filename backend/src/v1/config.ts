import { config as loadDotenv } from "dotenv";
import { existsSync } from "node:fs";
import { basename, resolve } from "node:path";
import { z } from "zod";
import { ConfigError } from "../utils/errors.js";

const workspaceRoot = resolveWorkspaceRoot();
const rootEnvPath = resolve(workspaceRoot, ".env");
loadDotenv({ path: existsSync(rootEnvPath) ? rootEnvPath : undefined, quiet: true });

const booleanString = z.preprocess((value) => {
  if (typeof value !== "string") return value;
  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
}, z.boolean());

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  BACKEND_HOST: z.string().default("0.0.0.0"),
  BACKEND_PORT: z.coerce.number().int().positive().default(4000),
  TRUST_PROXY: booleanString.default(false),
  CORS_ORIGIN: z.string().default("*"),
  DATABASE_URL: z.string().default("postgres://mia:mia@127.0.0.1:5432/mia"),
  DATABASE_POOL_MAX: z.coerce.number().int().positive().max(100).default(20),
  LOCAL_UPLOAD_DIR: z.string().default("./data/uploads"),
  CONSOLE_DIST_DIR: z.string().default("./backend/console/dist"),
  MIA_SECRET_ENCRYPTION_KEY: z.string().optional(),
  SETUP_TOKEN: z.string().optional(),
  CONSOLE_SESSION_TTL_SECONDS: z.coerce.number().int().positive().default(28_800),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(300),
  RUNTIME_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(180),
  RUNTIME_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().max(3_600).default(900),
  RUNTIME_TOKEN_MAX_USES: z.coerce.number().int().positive().max(100_000).default(2_000),
  TRANSCRIPT_RETENTION_DAYS: z.coerce.number().int().positive().max(365).default(30),
  DATA_RETENTION_SWEEP_INTERVAL_MS: z.coerce.number().int().positive().default(3_600_000),
  MAX_UPLOAD_BYTES: z.coerce.number().int().positive().default(50 * 1024 * 1024),
  PROVIDER_REQUEST_TIMEOUT_MS: z.coerce.number().int().positive().max(10 * 60_000).default(90_000),
  PROVIDER_RETRY_ATTEMPTS: z.coerce.number().int().positive().max(5).default(3),
  SHUTDOWN_GRACE_PERIOD_MS: z.coerce.number().int().positive().max(120_000).default(30_000),
  GEMINI_API_KEY: z.string().optional(),
  GEMINI_BASE_URL: z.string().url().default("https://generativelanguage.googleapis.com"),
  GEMINI_PLANNER_MODEL: z.string().default("gemini-3.5-flash"),
  GEMINI_VISION_MODEL: z.string().default("gemini-3.5-flash"),
  GEMINI_EMBEDDING_MODEL: z.string().default("gemini-embedding-2"),
  GEMINI_EMBEDDING_DIMENSIONS: z.coerce.number().int().refine((value) => value === 768, "GEMINI_EMBEDDING_DIMENSIONS must be 768 for the v1 index.").default(768),
  GEMINI_LIVE_MODEL: z.string().default("gemini-3.1-flash-live-preview"),
  GEMINI_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().max(72_000).default(1_800),
  GEMINI_NEW_SESSION_TTL_SECONDS: z.coerce.number().int().positive().max(72_000).default(60),
  UI_SCAN_HEADLESS: booleanString.default(true),
  UI_SCAN_ALLOW_PRIVATE_NETWORKS: booleanString.default(false)
});

export type V1Config = z.infer<typeof schema>;

export function loadV1Config(environment: NodeJS.ProcessEnv = process.env): V1Config {
  const parsed = schema.safeParse(environment);
  if (!parsed.success) throw new ConfigError("Environment validation failed.", parsed.error.issues);
  const config = {
    ...parsed.data,
    LOCAL_UPLOAD_DIR: resolvePath(parsed.data.LOCAL_UPLOAD_DIR),
    CONSOLE_DIST_DIR: resolvePath(parsed.data.CONSOLE_DIST_DIR)
  };
  validateV1Config(config);
  return config;
}

export function validateV1Config(config: V1Config): void {
  let database: URL;
  try {
    database = new URL(config.DATABASE_URL);
  } catch {
    throw new ConfigError("DATABASE_URL must be a valid PostgreSQL connection URL.");
  }
  if (!["postgres:", "postgresql:"].includes(database.protocol)) {
    throw new ConfigError("DATABASE_URL must use the postgres or postgresql protocol.");
  }
  if (config.NODE_ENV !== "production") return;
  if (config.CORS_ORIGIN.trim() === "*") throw new ConfigError("CORS_ORIGIN must list explicit origins in production.");
  for (const origin of origins(config.CORS_ORIGIN)) validateProductionOrigin(origin);
  if (!config.MIA_SECRET_ENCRYPTION_KEY || config.MIA_SECRET_ENCRYPTION_KEY.length < 32) {
    throw new ConfigError("MIA_SECRET_ENCRYPTION_KEY must contain at least 32 characters in production.");
  }
  if (!config.SETUP_TOKEN || config.SETUP_TOKEN.length < 32) {
    throw new ConfigError("SETUP_TOKEN must contain at least 32 characters until first-run setup is complete.");
  }
}

export function corsOrigins(value: string): true | string[] {
  return value.trim() === "*" ? true : origins(value);
}

function origins(value: string): string[] {
  return value.split(",").map((origin) => origin.trim().replace(/\/$/, "")).filter(Boolean);
}

function validateProductionOrigin(raw: string): void {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new ConfigError(`CORS_ORIGIN contains an invalid origin: ${raw}`);
  }
  if (url.origin !== raw || url.pathname !== "/" || url.search || url.hash || url.username || url.password) {
    throw new ConfigError(`CORS_ORIGIN entries must be origins without paths or credentials: ${raw}`);
  }
  const localHttp = url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.protocol !== "https:" && !localHttp) throw new ConfigError(`CORS_ORIGIN must use HTTPS outside localhost: ${raw}`);
}

function resolvePath(value: string): string {
  return value.startsWith("/") ? value : resolve(workspaceRoot, value);
}

function resolveWorkspaceRoot(): string {
  return basename(process.cwd()) === "backend" ? resolve(process.cwd(), "..") : process.cwd();
}
