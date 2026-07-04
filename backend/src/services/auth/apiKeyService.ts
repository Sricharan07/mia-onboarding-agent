import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { ApiKeyRecord, ApiKeyScope, Repositories } from "../../db/repositories.js";
import { AppError } from "../../utils/errors.js";

export const apiKeyScopes = ["apps:read", "ui-map:read", "workflows:read", "runtime:write", "logs:write", "logs:read", "admin"] as const;
export type AuthenticatedApiKey = ApiKeyRecord;

export class ApiKeyService {
  constructor(private readonly repositories: Repositories) {}

  create(input: { name: string; scopes: ApiKeyScope[]; appId?: string | null; allowedOrigins?: string[] }): ApiKeyRecord & { key: string } {
    const appId = input.appId?.trim() || null;
    const allowedOrigins = normalizeAllowedOrigins(input.allowedOrigins ?? []);
    if (!input.scopes.includes("admin")) {
      if (!appId) {
        throw new AppError("API_KEY_APP_REQUIRED", "Non-admin API keys must be bound to an app.", 400);
      }
      if (allowedOrigins.length === 0) {
        throw new AppError("API_KEY_ORIGIN_REQUIRED", "Non-admin API keys must include at least one allowed origin.", 400);
      }
      this.repositories.getApp(appId);
    }

    const prefix = randomBytes(5).toString("hex");
    const secret = randomBytes(24).toString("base64url");
    const key = `mia_${prefix}_${secret}`;
    const record = this.repositories.createApiKey({
      name: input.name,
      prefix,
      keyHash: hashKey(key),
      scopes: input.scopes,
      appId,
      allowedOrigins
    });
    return { ...record, key };
  }

  list(): ApiKeyRecord[] {
    return this.repositories.listApiKeys();
  }

  hasActiveKeys(): boolean {
    return this.list().some((key) => !key.revokedAt);
  }

  revoke(id: string): ApiKeyRecord {
    return this.repositories.revokeApiKey(id);
  }

  authenticate(rawKey: string | undefined): AuthenticatedApiKey | undefined {
    if (!rawKey) return undefined;
    const prefix = parsePrefix(rawKey);
    if (!prefix) {
      throw new AppError("INVALID_API_KEY", "API key is invalid.", 401);
    }

    const record = this.repositories.getApiKeySecretByPrefix(prefix);
    if (!record || record.revokedAt) {
      throw new AppError("INVALID_API_KEY", "API key is invalid or revoked.", 401);
    }

    const actual = Buffer.from(hashKey(rawKey), "hex");
    const expected = Buffer.from(record.keyHash, "hex");
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
      throw new AppError("INVALID_API_KEY", "API key is invalid.", 401);
    }

    this.repositories.markApiKeyUsed(record.id);
    return {
      id: record.id,
      name: record.name,
      prefix: record.prefix,
      scopes: record.scopes,
      appId: record.appId,
      allowedOrigins: record.allowedOrigins,
      createdAt: record.createdAt,
      lastUsedAt: record.lastUsedAt,
      revokedAt: record.revokedAt
    };
  }

  requireScope(auth: AuthenticatedApiKey | undefined, requiredScopes: ApiKeyScope[]): AuthenticatedApiKey {
    if (!auth) {
      throw new AppError("API_KEY_REQUIRED", "A valid API key is required for this endpoint.", 401);
    }
    if (auth.scopes.includes("admin") || requiredScopes.some((scope) => auth.scopes.includes(scope))) {
      return auth;
    }
    throw new AppError("API_KEY_FORBIDDEN", "API key does not have the required scope.", 403, { requiredScopes });
  }

  requireAppAccess(auth: AuthenticatedApiKey | undefined, appId: string | undefined, headers: { origin?: unknown; referer?: unknown }): void {
    if (!auth) {
      throw new AppError("API_KEY_REQUIRED", "A valid API key is required for this endpoint.", 401);
    }
    const key = auth;
    if (key.scopes.includes("admin")) return;
    if (!appId) {
      throw new AppError("API_KEY_APP_REQUIRED", "An appId is required for this API key.", 403);
    }
    if (!key.appId || key.appId !== appId) {
      throw new AppError("API_KEY_APP_FORBIDDEN", "API key is not allowed to access this app.", 403);
    }

    const requestOrigin = requestOriginFromHeaders(headers);
    if (!requestOrigin || !key.allowedOrigins.includes(requestOrigin)) {
      throw new AppError("API_KEY_ORIGIN_FORBIDDEN", "Request origin is not allowed for this API key.", 403, {
        allowedOrigins: key.allowedOrigins
      });
    }
  }
}

export function extractApiKey(headers: { authorization?: unknown; "x-api-key"?: unknown }): string | undefined {
  const xApiKey = typeof headers["x-api-key"] === "string" ? headers["x-api-key"] : undefined;
  if (xApiKey) return xApiKey;

  const authorization = typeof headers.authorization === "string" ? headers.authorization : undefined;
  const match = authorization?.match(/^Bearer\s+(.+)$/i);
  return match?.[1];
}

function parsePrefix(rawKey: string): string | undefined {
  const match = rawKey.match(/^mia_([a-f0-9]{10})_[A-Za-z0-9_-]+$/);
  return match?.[1];
}

function hashKey(rawKey: string): string {
  return createHash("sha256").update(rawKey).digest("hex");
}

function normalizeAllowedOrigins(origins: string[]): string[] {
  return [...new Set(origins.map(normalizeOrigin).filter((origin): origin is string => Boolean(origin)))];
}

function normalizeOrigin(value: string): string | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  try {
    return new URL(trimmed).origin;
  } catch {
    throw new AppError("API_KEY_ORIGIN_INVALID", `Invalid allowed origin: ${value}`, 400);
  }
}

function requestOriginFromHeaders(headers: { origin?: unknown; referer?: unknown }): string | undefined {
  const origin = typeof headers.origin === "string" ? headers.origin : undefined;
  if (origin) return normalizeOrigin(origin);
  const referer = typeof headers.referer === "string" ? headers.referer : undefined;
  return referer ? normalizeOrigin(referer) : undefined;
}
