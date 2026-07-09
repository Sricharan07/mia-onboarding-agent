import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { AppConfig } from "../../config/env.js";
import type { AuthenticatedApiKey } from "./apiKeyService.js";
import type {
  Repositories,
  RuntimeAccessTokenRecord,
  RuntimeAccessTokenSecretRecord,
  RuntimeTokenCapability
} from "../../db/repositories.js";
import { AppError } from "../../utils/errors.js";

export const runtimeTokenCapabilities = [
  "runtime:resolve",
  "runtime:workflow",
  "logs:write",
  "voice:live",
  "voice:tts",
  "voice:livekit"
] as const satisfies readonly RuntimeTokenCapability[];

export type AuthenticatedRuntimeToken = RuntimeAccessTokenRecord;

export class RuntimeTokenService {
  constructor(
    private readonly config: AppConfig,
    private readonly repositories: Repositories
  ) {}

  create(input: {
    appId: string;
    userId: string;
    origin: string;
    capabilities?: RuntimeTokenCapability[];
    ttlSeconds?: number;
    maxUses?: number;
  }, issuer?: AuthenticatedApiKey): RuntimeAccessTokenRecord & { token: string } {
    this.repositories.getActiveApp(input.appId);
    const origin = normalizeOrigin(input.origin);
    if (issuer && !issuer.scopes.includes("admin") && !issuer.allowedOrigins.includes(origin)) {
      throw new AppError("RUNTIME_TOKEN_ORIGIN_FORBIDDEN", "The integration key cannot mint a token for this origin.", 403, {
        allowedOrigins: issuer.allowedOrigins
      });
    }

    const capabilities = [...new Set(input.capabilities ?? runtimeTokenCapabilities)];
    const ttlSeconds = Math.min(input.ttlSeconds ?? this.config.RUNTIME_TOKEN_TTL_SECONDS, this.config.RUNTIME_TOKEN_TTL_SECONDS);
    const maxUses = Math.min(input.maxUses ?? this.config.RUNTIME_TOKEN_MAX_USES, this.config.RUNTIME_TOKEN_MAX_USES);
    const prefix = randomBytes(5).toString("hex");
    const token = `mia_rt_${prefix}_${randomBytes(32).toString("base64url")}`;
    const record = this.repositories.createRuntimeAccessToken({
      prefix,
      tokenHash: hashToken(token),
      appId: input.appId,
      userId: input.userId,
      allowedOrigin: origin,
      capabilities,
      expiresAt: new Date(Date.now() + ttlSeconds * 1_000).toISOString(),
      maxUses
    });
    return { ...record, token };
  }

  authenticate(rawToken: string | undefined, headers: { origin?: unknown; referer?: unknown }): AuthenticatedRuntimeToken | undefined {
    if (!rawToken) return undefined;
    const prefix = parsePrefix(rawToken);
    if (!prefix) throw new AppError("INVALID_RUNTIME_TOKEN", "Runtime token is invalid.", 401);

    const record = this.repositories.getRuntimeAccessTokenSecretByPrefix(prefix);
    if (!record || !tokenHashesMatch(rawToken, record)) {
      throw new AppError("INVALID_RUNTIME_TOKEN", "Runtime token is invalid.", 401);
    }
    const now = new Date().toISOString();
    if (record.revokedAt) throw new AppError("RUNTIME_TOKEN_REVOKED", "Runtime token has been revoked.", 401);
    if (record.expiresAt <= now) throw new AppError("RUNTIME_TOKEN_EXPIRED", "Runtime token has expired.", 401);
    if (record.useCount >= record.maxUses) throw new AppError("RUNTIME_TOKEN_EXHAUSTED", "Runtime token usage limit has been reached.", 401);

    const requestOrigin = requestOriginFromHeaders(headers);
    if (!requestOrigin || requestOrigin !== record.allowedOrigin) {
      throw new AppError("RUNTIME_TOKEN_ORIGIN_FORBIDDEN", "Runtime token is not valid for this request origin.", 403);
    }
    return record;
  }

  consume(auth: AuthenticatedRuntimeToken): void {
    if (!this.repositories.consumeRuntimeAccessToken(auth.id, new Date().toISOString())) {
      throw new AppError("RUNTIME_TOKEN_UNAVAILABLE", "Runtime token is no longer available.", 401);
    }
  }

  requireCapability(auth: AuthenticatedRuntimeToken | undefined, capability: RuntimeTokenCapability): AuthenticatedRuntimeToken {
    if (!auth) throw new AppError("RUNTIME_TOKEN_REQUIRED", "A valid runtime token is required for this endpoint.", 401);
    if (!auth.capabilities.includes(capability)) {
      throw new AppError("RUNTIME_CAPABILITY_FORBIDDEN", "Runtime token does not allow this operation.", 403, { capability });
    }
    return auth;
  }

  requireAppAccess(auth: AuthenticatedRuntimeToken, appId: string): void {
    this.repositories.getActiveApp(appId);
    if (auth.appId !== appId) {
      throw new AppError("RUNTIME_TOKEN_APP_FORBIDDEN", "Runtime token is not valid for this app.", 403);
    }
  }

  revoke(id: string, issuer?: AuthenticatedApiKey): RuntimeAccessTokenRecord {
    const token = this.repositories.getRuntimeAccessToken(id);
    if (issuer && !issuer.scopes.includes("admin") && issuer.appId !== token.appId) {
      throw new AppError("RUNTIME_TOKEN_APP_FORBIDDEN", "Integration key cannot revoke a token for another app.", 403);
    }
    return this.repositories.revokeRuntimeAccessToken(id);
  }
}

export function extractRuntimeToken(headers: { authorization?: unknown }): string | undefined {
  const authorization = typeof headers.authorization === "string" ? headers.authorization : undefined;
  const token = authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
  return token?.startsWith("mia_rt_") ? token : undefined;
}

function parsePrefix(rawToken: string): string | undefined {
  return rawToken.match(/^mia_rt_([a-f0-9]{10})_[A-Za-z0-9_-]+$/)?.[1];
}

function hashToken(rawToken: string): string {
  return createHash("sha256").update(rawToken).digest("hex");
}

function tokenHashesMatch(rawToken: string, record: RuntimeAccessTokenSecretRecord): boolean {
  const actual = Buffer.from(hashToken(rawToken), "hex");
  const expected = Buffer.from(record.tokenHash, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function normalizeOrigin(value: string): string {
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("Unsupported protocol");
    return url.origin;
  } catch {
    throw new AppError("RUNTIME_TOKEN_ORIGIN_INVALID", "Runtime token origin must be a valid HTTP or HTTPS origin.", 400);
  }
}

function requestOriginFromHeaders(headers: { origin?: unknown; referer?: unknown }): string | undefined {
  const value = typeof headers.origin === "string"
    ? headers.origin
    : typeof headers.referer === "string"
      ? headers.referer
      : undefined;
  return value ? normalizeOrigin(value) : undefined;
}
