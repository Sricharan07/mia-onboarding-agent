import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import type { V1Config } from "./config.js";
import type {
  AdminSessionRecord,
  AdminUserRecord,
  IntegrationKeyRecord,
  RuntimeTokenRecord,
  V1Repositories
} from "./db/repositories.js";
import { AppError } from "../utils/errors.js";
import { createId } from "../utils/id.js";

const scrypt = promisify(scryptCallback);
const PASSWORD_KEY_LENGTH = 64;
const PASSWORD_MIN_LENGTH = 12;
const ADMIN_TOKEN_PREFIX = "mia_admin";
const INTEGRATION_KEY_PREFIX = "mia_key";
const RUNTIME_TOKEN_PREFIX = "mia_rt";

export const runtimeCapabilities = ["agent:run", "events:write", "voice:live"] as const;
export type RuntimeCapability = typeof runtimeCapabilities[number];

export type AuthenticatedAdmin = {
  sessionId: string;
  expiresAt: string;
  user: SafeAdminUser;
};

export type AuthenticatedRuntime = Omit<RuntimeTokenRecord, "tokenHash">;
export type SafeAdminUser = Omit<AdminUserRecord, "passwordHash">;
export type SafeIntegrationKey = Omit<IntegrationKeyRecord, "keyHash">;

export class V1AuthService {
  constructor(
    private readonly config: V1Config,
    private readonly repositories: V1Repositories
  ) {}

  async status(rawAdminToken?: string): Promise<{
    setupRequired: boolean;
    authenticated: boolean;
    user?: SafeAdminUser;
    product?: Awaited<ReturnType<V1Repositories["product"]["get"]>>;
  }> {
    const setupRequired = !await this.repositories.product.isSetup();
    if (setupRequired) return { setupRequired, authenticated: false };
    if (!rawAdminToken) return { setupRequired: false, authenticated: false };
    try {
      const authenticated = await this.authenticateAdmin(rawAdminToken);
      return {
        setupRequired: false,
        authenticated: true,
        user: authenticated.user,
        product: await this.repositories.product.get()
      };
    } catch {
      return { setupRequired: false, authenticated: false };
    }
  }

  async setup(input: {
    setupToken: string;
    productName: string;
    origin: string;
    adminEmail: string;
    adminName: string;
    password: string;
  }): Promise<{ token: string; expiresAt: string; user: SafeAdminUser; product: Awaited<ReturnType<V1Repositories["product"]["get"]>> }> {
    this.requireSetupToken(input.setupToken);
    assertPassword(input.password);
    const productOrigin = normalizeOrigin(input.origin);
    const created = await this.repositories.product.setup({
      product: {
        name: input.productName.trim(),
        origin: productOrigin,
        documentationOrigins: [],
        redactedSelectors: [],
        transcriptMode: "full",
        transcriptRetentionDays: this.config.TRANSCRIPT_RETENTION_DAYS
      },
      admin: {
        id: createId("admin"),
        email: normalizeEmail(input.adminEmail),
        name: input.adminName.trim(),
        passwordHash: await hashPassword(input.password)
      }
    });
    const session = await this.createAdminSession(created.admin);
    return { ...session, product: created.product };
  }

  async login(email: string, password: string): Promise<{ token: string; expiresAt: string; user: SafeAdminUser }> {
    const admin = await this.repositories.auth.getAdmin();
    if (!admin || normalizeEmail(email) !== admin.email || !await verifyPassword(password, admin.passwordHash)) {
      throw new AppError("LOGIN_INVALID", "Email or password is incorrect.", 401);
    }
    await this.repositories.auth.markAdminLogin();
    return this.createAdminSession({ ...admin, lastLoginAt: new Date().toISOString() });
  }

  async authenticateAdmin(rawToken: string): Promise<AuthenticatedAdmin> {
    const parsed = parseAdminToken(rawToken);
    if (!parsed) throw new AppError("ADMIN_SESSION_INVALID", "Administrator session is invalid.", 401);
    const [session, admin] = await Promise.all([
      this.repositories.auth.getAdminSession(parsed.sessionId),
      this.repositories.auth.getAdmin()
    ]);
    if (!session || !admin || session.revokedAt || new Date(session.expiresAt).getTime() <= Date.now()) {
      throw new AppError("ADMIN_SESSION_INVALID", "Administrator session expired or was revoked.", 401);
    }
    if (!secureHashMatch(rawToken, session.tokenHash)) throw new AppError("ADMIN_SESSION_INVALID", "Administrator session is invalid.", 401);
    await this.repositories.auth.markAdminSessionUsed(session.id);
    return { sessionId: session.id, expiresAt: session.expiresAt, user: safeAdmin(admin) };
  }

  async logout(rawToken?: string): Promise<void> {
    const parsed = rawToken ? parseAdminToken(rawToken) : undefined;
    if (parsed) await this.repositories.auth.revokeAdminSession(parsed.sessionId);
  }

  async changePassword(currentPassword: string, nextPassword: string, currentSessionId: string): Promise<SafeAdminUser> {
    assertPassword(nextPassword);
    const admin = await this.repositories.auth.getAdmin();
    if (!admin || !await verifyPassword(currentPassword, admin.passwordHash)) {
      throw new AppError("PASSWORD_INVALID", "Current password is incorrect.", 401);
    }
    return safeAdmin(await this.repositories.auth.updatePasswordAndRevokeOtherSessions(
      await hashPassword(nextPassword),
      currentSessionId
    ));
  }

  async createIntegrationKey(name: string): Promise<SafeIntegrationKey & { key: string }> {
    const product = await this.repositories.product.get();
    const prefix = randomBytes(5).toString("hex");
    const key = `${INTEGRATION_KEY_PREFIX}_${prefix}_${randomBytes(32).toString("base64url")}`;
    const record = await this.repositories.auth.createIntegrationKey({
      id: createId("integration_key"),
      name: name.trim(),
      prefix,
      keyHash: hashSecret(key),
      allowedOrigin: product.origin
    });
    return { ...safeIntegrationKey(record), key };
  }

  async listIntegrationKeys(): Promise<SafeIntegrationKey[]> {
    return (await this.repositories.auth.listIntegrationKeys()).map(safeIntegrationKey);
  }

  async authenticateIntegrationKey(rawKey: string): Promise<IntegrationKeyRecord> {
    const prefix = rawKey.match(/^mia_key_([a-f0-9]{10})_[A-Za-z0-9_-]+$/)?.[1];
    if (!prefix) throw new AppError("INTEGRATION_KEY_INVALID", "Integration key is invalid.", 401);
    const record = await this.repositories.auth.getIntegrationKeyByPrefix(prefix);
    if (!record || record.revokedAt || !secureHashMatch(rawKey, record.keyHash)) {
      throw new AppError("INTEGRATION_KEY_INVALID", "Integration key is invalid or revoked.", 401);
    }
    await this.repositories.auth.markIntegrationKeyUsed(record.id);
    return record;
  }

  async mintRuntimeToken(input: {
    userId: string;
    origin: string;
    capabilities?: RuntimeCapability[];
  }, integrationKey: IntegrationKeyRecord): Promise<Omit<RuntimeTokenRecord, "tokenHash"> & { token: string }> {
    const origin = normalizeOrigin(input.origin);
    if (origin !== integrationKey.allowedOrigin) {
      throw new AppError("RUNTIME_ORIGIN_FORBIDDEN", "The integration key cannot mint a token for this origin.", 403);
    }
    const capabilities = [...new Set(input.capabilities ?? runtimeCapabilities)];
    for (const capability of capabilities) {
      if (!runtimeCapabilities.includes(capability)) throw new AppError("RUNTIME_CAPABILITY_INVALID", `Unsupported runtime capability: ${capability}`, 400);
    }
    const prefix = randomBytes(5).toString("hex");
    const token = `${RUNTIME_TOKEN_PREFIX}_${prefix}_${randomBytes(32).toString("base64url")}`;
    const record = await this.repositories.auth.createRuntimeToken({
      id: createId("runtime_token"),
      prefix,
      tokenHash: hashSecret(token),
      userId: input.userId,
      allowedOrigin: origin,
      capabilities,
      expiresAt: new Date(Date.now() + this.config.RUNTIME_TOKEN_TTL_SECONDS * 1_000).toISOString(),
      maxUses: this.config.RUNTIME_TOKEN_MAX_USES
    });
    return { ...withoutTokenHash(record), token };
  }

  async authenticateRuntime(rawToken: string, requestOrigin: string | undefined, capability: RuntimeCapability): Promise<AuthenticatedRuntime> {
    const prefix = rawToken.match(/^mia_rt_([a-f0-9]{10})_[A-Za-z0-9_-]+$/)?.[1];
    if (!prefix) throw new AppError("RUNTIME_TOKEN_INVALID", "Runtime token is invalid.", 401);
    const record = await this.repositories.auth.getRuntimeTokenByPrefix(prefix);
    if (!record || record.revokedAt || !secureHashMatch(rawToken, record.tokenHash)) {
      throw new AppError("RUNTIME_TOKEN_INVALID", "Runtime token is invalid or revoked.", 401);
    }
    if (new Date(record.expiresAt).getTime() <= Date.now()) throw new AppError("RUNTIME_TOKEN_EXPIRED", "Runtime token has expired.", 401);
    const origin = requestOrigin ? normalizeOrigin(requestOrigin) : undefined;
    if (!origin || origin !== record.allowedOrigin) throw new AppError("RUNTIME_ORIGIN_FORBIDDEN", "Runtime token is not valid for this origin.", 403);
    if (!record.capabilities.includes(capability)) throw new AppError("RUNTIME_CAPABILITY_FORBIDDEN", "Runtime token does not allow this operation.", 403);
    if (!await this.repositories.auth.consumeRuntimeToken(record.id)) throw new AppError("RUNTIME_TOKEN_EXHAUSTED", "Runtime token is no longer available.", 401);
    return withoutTokenHash({ ...record, useCount: record.useCount + 1, lastUsedAt: new Date().toISOString() });
  }

  private async createAdminSession(admin: AdminUserRecord): Promise<{ token: string; expiresAt: string; user: SafeAdminUser }> {
    const handle = randomBytes(16).toString("hex");
    const sessionId = `admin_session_${handle}`;
    const token = `${ADMIN_TOKEN_PREFIX}_${handle}_${randomBytes(32).toString("base64url")}`;
    const expiresAt = new Date(Date.now() + this.config.CONSOLE_SESSION_TTL_SECONDS * 1_000).toISOString();
    await this.repositories.auth.createAdminSession({ id: sessionId, tokenHash: hashSecret(token), expiresAt });
    return { token, expiresAt, user: safeAdmin(admin) };
  }

  private requireSetupToken(actual: string): void {
    const expected = this.config.SETUP_TOKEN;
    if (!expected) throw new AppError("SETUP_TOKEN_NOT_CONFIGURED", "Set SETUP_TOKEN before first-run setup.", 503);
    if (!securePlainMatch(actual, expected)) throw new AppError("SETUP_TOKEN_INVALID", "Setup token is invalid.", 401);
  }
}

export function bearerToken(authorization: unknown): string | undefined {
  return typeof authorization === "string" ? authorization.match(/^Bearer\s+(.+)$/i)?.[1] : undefined;
}

export function integrationKeyHeader(value: unknown): string | undefined {
  return typeof value === "string" && value.startsWith("mia_key_") ? value : undefined;
}

export function requestOrigin(headers: { origin?: unknown; referer?: unknown }): string | undefined {
  if (typeof headers.origin === "string") return headers.origin;
  if (typeof headers.referer === "string") {
    try {
      return new URL(headers.referer).origin;
    } catch {
      return undefined;
    }
  }
  return undefined;
}

function parseAdminToken(rawToken: string): { sessionId: string } | undefined {
  const handle = rawToken.match(/^mia_admin_([a-f0-9]{32})_[A-Za-z0-9_-]+$/)?.[1];
  return handle ? { sessionId: `admin_session_${handle}` } : undefined;
}

function normalizeOrigin(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new AppError("ORIGIN_INVALID", "Origin must be a valid HTTP or HTTPS origin.", 400);
  }
  if (!["http:", "https:"].includes(url.protocol) || url.origin !== value.replace(/\/$/, "")) {
    throw new AppError("ORIGIN_INVALID", "Origin must not include a path, query, fragment, or credentials.", 400);
  }
  return url.origin;
}

function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

function safeAdmin(user: AdminUserRecord): SafeAdminUser {
  const { passwordHash: _passwordHash, ...safe } = user;
  return safe;
}

function safeIntegrationKey(key: IntegrationKeyRecord): SafeIntegrationKey {
  const { keyHash: _keyHash, ...safe } = key;
  return safe;
}

function withoutTokenHash(token: RuntimeTokenRecord): AuthenticatedRuntime {
  const { tokenHash: _tokenHash, ...safe } = token;
  return safe;
}

async function hashPassword(password: string): Promise<string> {
  assertPassword(password);
  const salt = randomBytes(16).toString("base64url");
  const key = await scrypt(password, salt, PASSWORD_KEY_LENGTH) as Buffer;
  return `scrypt$v1$${salt}$${key.toString("base64url")}`;
}

async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  const [algorithm, version, salt, expectedHash] = encoded.split("$");
  if (algorithm !== "scrypt" || version !== "v1" || !salt || !expectedHash) return false;
  const actual = await scrypt(password, salt, PASSWORD_KEY_LENGTH) as Buffer;
  const expected = Buffer.from(expectedHash, "base64url");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function assertPassword(password: string): void {
  if (password.length < PASSWORD_MIN_LENGTH) throw new AppError("PASSWORD_TOO_SHORT", `Password must contain at least ${PASSWORD_MIN_LENGTH} characters.`, 400);
}

function hashSecret(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function secureHashMatch(value: string, expectedHash: string): boolean {
  const actual = Buffer.from(hashSecret(value), "hex");
  const expected = Buffer.from(expectedHash, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function securePlainMatch(actual: string, expected: string): boolean {
  const actualHash = Buffer.from(hashSecret(actual), "hex");
  const expectedHash = Buffer.from(hashSecret(expected), "hex");
  return timingSafeEqual(actualHash, expectedHash);
}
