import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { ApiKeyRecord, ApiKeyScope, Repositories } from "../../db/repositories.js";
import { AppError } from "../../utils/errors.js";

export const apiKeyScopes = ["apps:read", "ui-map:read", "workflows:read", "runtime:write", "logs:write", "logs:read", "admin"] as const;
export type AuthenticatedApiKey = ApiKeyRecord;

export class ApiKeyService {
  constructor(private readonly repositories: Repositories) {}

  create(input: { name: string; scopes: ApiKeyScope[] }): ApiKeyRecord & { key: string } {
    const prefix = randomBytes(5).toString("hex");
    const secret = randomBytes(24).toString("base64url");
    const key = `mia_${prefix}_${secret}`;
    const record = this.repositories.createApiKey({
      name: input.name,
      prefix,
      keyHash: hashKey(key),
      scopes: input.scopes
    });
    return { ...record, key };
  }

  list(): ApiKeyRecord[] {
    return this.repositories.listApiKeys();
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
