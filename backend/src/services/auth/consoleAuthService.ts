import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import type { AppConfig } from "../../config/env.js";
import type { ConsoleSessionRecord, ConsoleUserRecord, Repositories } from "../../db/repositories.js";
import { AppError, NotFoundError } from "../../utils/errors.js";

const scrypt = promisify(scryptCallback);
const PASSWORD_KEY_LENGTH = 64;
const PASSWORD_MIN_LENGTH = 12;
const SESSION_PREFIX = "mia_console";

export type AuthenticatedConsoleSession = {
  id: string;
  userId: string;
  email: string;
  name: string;
  role: "admin";
  createdAt: string;
  updatedAt: string;
  lastLoginAt: string | null;
  disabledAt: string | null;
  expiresAt: string;
};

export type ConsoleAuthUser = Omit<ConsoleUserRecord, "passwordHash">;

export class ConsoleAuthService {
  constructor(
    private readonly config: AppConfig,
    private readonly repositories: Repositories
  ) {}

  status(rawToken?: string): { setupRequired: boolean; authenticated: boolean; user?: ConsoleAuthUser } {
    const setupRequired = this.repositories.countConsoleUsers() === 0;
    if (!rawToken) return { setupRequired, authenticated: false };
    const session = this.authenticate(rawToken);
    if (!session) return { setupRequired, authenticated: false };
    return { setupRequired, authenticated: true, user: authenticatedUser(session) };
  }

  async setup(input: { email: string; name: string; password: string; bootstrapToken?: string }): Promise<LoginResult> {
    if (this.repositories.countConsoleUsers() > 0) {
      throw new AppError("CONSOLE_ALREADY_CONFIGURED", "Console setup has already been completed.", 409);
    }
    this.requireBootstrapToken(input.bootstrapToken);
    const user = this.repositories.createConsoleUser({
      email: normalizeEmail(input.email),
      name: input.name.trim(),
      role: "admin",
      passwordHash: await hashPassword(input.password)
    });
    this.repositories.markConsoleUserLogin(user.id);
    return this.createSession(this.repositories.getConsoleUserById(user.id));
  }

  async login(input: { email: string; password: string }): Promise<LoginResult> {
    const user = this.repositories.getConsoleUserByEmail(normalizeEmail(input.email));
    if (!user || user.disabledAt) {
      throw new AppError("CONSOLE_LOGIN_INVALID", "Email or password is incorrect.", 401);
    }
    if (!await verifyPassword(input.password, user.passwordHash)) {
      throw new AppError("CONSOLE_LOGIN_INVALID", "Email or password is incorrect.", 401);
    }
    this.repositories.markConsoleUserLogin(user.id);
    return this.createSession(this.repositories.getConsoleUserById(user.id));
  }

  authenticate(rawToken: string | undefined): AuthenticatedConsoleSession | undefined {
    if (!rawToken) return undefined;
    const parsed = parseSessionToken(rawToken);
    if (!parsed) {
      throw new AppError("CONSOLE_SESSION_INVALID", "Console session is invalid.", 401);
    }

    let session: ConsoleSessionRecord;
    try {
      session = this.repositories.getConsoleSession(parsed.sessionId);
    } catch (error) {
      if (error instanceof NotFoundError) {
        throw new AppError("CONSOLE_SESSION_INVALID", "Console session is invalid.", 401);
      }
      throw error;
    }
    if (session.revokedAt || session.user.disabledAt || new Date(session.expiresAt).getTime() <= Date.now()) {
      throw new AppError("CONSOLE_SESSION_INVALID", "Console session expired or was revoked.", 401);
    }

    const actual = Buffer.from(hashToken(rawToken), "hex");
    const expected = Buffer.from(session.tokenHash, "hex");
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
      throw new AppError("CONSOLE_SESSION_INVALID", "Console session is invalid.", 401);
    }

    this.repositories.markConsoleSessionUsed(session.id);
    return toAuthenticatedSession(session);
  }

  logout(rawToken: string | undefined): void {
    const parsed = rawToken ? parseSessionToken(rawToken) : undefined;
    if (parsed) this.repositories.revokeConsoleSession(parsed.sessionId);
  }

  private createSession(user: ConsoleUserRecord): LoginResult {
    const sessionHandle = cryptoSafeId();
    const sessionId = `console_session_${sessionHandle}`;
    const secret = randomBytes(32).toString("base64url");
    const token = `${SESSION_PREFIX}_${sessionHandle}_${secret}`;
    const expiresAt = new Date(Date.now() + this.config.CONSOLE_SESSION_TTL_SECONDS * 1000).toISOString();
    const session = this.repositories.createConsoleSession({
      id: sessionId,
      userId: user.id,
      tokenHash: hashToken(token),
      expiresAt
    });
    return {
      token,
      expiresAt,
      user: sessionUser(session)
    };
  }

  private requireBootstrapToken(actual: string | undefined): void {
    const expected = this.config.BOOTSTRAP_ADMIN_TOKEN;
    if (!expected) {
      throw new AppError("BOOTSTRAP_TOKEN_REQUIRED", "Set BOOTSTRAP_ADMIN_TOKEN before creating the first console user.", 401);
    }
    if (!actual || !secureEqual(actual, expected)) {
      throw new AppError("BOOTSTRAP_TOKEN_INVALID", "A valid bootstrap token is required to create the first console user.", 401);
    }
  }
}

type LoginResult = {
  token: string;
  expiresAt: string;
  user: ConsoleAuthUser;
};

function toAuthenticatedSession(session: ConsoleSessionRecord): AuthenticatedConsoleSession {
  return {
    id: session.id,
    userId: session.user.id,
    email: session.user.email,
    name: session.user.name,
    role: session.user.role,
    createdAt: session.user.createdAt,
    updatedAt: session.user.updatedAt,
    lastLoginAt: session.user.lastLoginAt,
    disabledAt: session.user.disabledAt,
    expiresAt: session.expiresAt
  };
}

function authenticatedUser(session: AuthenticatedConsoleSession): ConsoleAuthUser {
  return {
    id: session.userId,
    email: session.email,
    name: session.name,
    role: session.role,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    lastLoginAt: session.lastLoginAt,
    disabledAt: session.disabledAt
  };
}

function sessionUser(session: ConsoleSessionRecord): ConsoleAuthUser {
  return {
    ...session.user,
    lastLoginAt: session.user.lastLoginAt,
    disabledAt: session.user.disabledAt
  };
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
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
  if (password.length < PASSWORD_MIN_LENGTH) {
    throw new AppError("CONSOLE_PASSWORD_TOO_SHORT", `Password must be at least ${PASSWORD_MIN_LENGTH} characters.`, 400);
  }
}

function parseSessionToken(rawToken: string): { sessionId: string } | undefined {
  const match = rawToken.match(/^mia_console_([a-f0-9]{32})_[A-Za-z0-9_-]+$/);
  return match ? { sessionId: `console_session_${match[1]}` } : undefined;
}

export function extractConsoleSessionToken(headers: { authorization?: unknown }): string | undefined {
  const authorization = typeof headers.authorization === "string" ? headers.authorization : undefined;
  const token = authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
  return token && isConsoleSessionToken(token) ? token : undefined;
}

export function isConsoleSessionToken(rawToken: string | undefined): rawToken is string {
  return Boolean(rawToken?.startsWith(`${SESSION_PREFIX}_`));
}

function cryptoSafeId(): string {
  return randomBytes(16).toString("hex");
}

function hashToken(rawToken: string): string {
  return createHash("sha256").update(rawToken).digest("hex");
}

function secureEqual(actual: string, expected: string): boolean {
  const actualBuffer = Buffer.from(actual);
  const expectedBuffer = Buffer.from(expected);
  return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer);
}
