import type { FastifyRequest } from "fastify";
import type { AppConfig } from "../../config/env.js";
import type { Repositories } from "../../db/repositories.js";
import { AppError } from "../../utils/errors.js";

export class RateLimitService {
  private consumedSinceSweep = 0;

  constructor(
    private readonly config: AppConfig,
    private readonly repositories: Repositories
  ) {}

  consume(request: FastifyRequest): void {
    if (request.method === "OPTIONS") return;

    const route = routeKey(request.url);
    const principal = request.runtimeToken
      ? `runtime:${request.runtimeToken.id}:${request.ip}`
      : request.consoleSession
        ? `console:${request.consoleSession.userId}:${request.ip}`
        : request.apiKey
          ? `api:${request.apiKey.id}:${request.ip}`
          : `ip:${request.ip}`;
    const principalLimit = request.runtimeToken ? this.config.RUNTIME_RATE_LIMIT_MAX : this.config.RATE_LIMIT_MAX;
    this.consumeBucket(`${principal}:${request.method}:${route}`, principalLimit);

    if (request.runtimeToken) {
      const isVoice = route.startsWith("/api/v1/gemini/") || route.startsWith("/api/v1/tts") || route.startsWith("/api/v1/livekit/");
      this.consumeBucket(
        `app:${request.runtimeToken.appId}:${isVoice ? "voice" : "runtime"}`,
        isVoice ? this.config.APP_VOICE_RATE_LIMIT_MAX : this.config.APP_RATE_LIMIT_MAX
      );
    }
  }

  consumeConsoleAuth(request: FastifyRequest, action: "login" | "setup", subject?: string): void {
    const ipKey = `console-auth:${action}:ip:${request.ip}`;
    this.consumeBucket(ipKey, this.config.CONSOLE_AUTH_RATE_LIMIT_MAX);
    const normalizedSubject = subject?.trim().toLowerCase();
    if (normalizedSubject) {
      this.consumeBucket(`console-auth:${action}:subject:${normalizedSubject}`, this.config.CONSOLE_AUTH_RATE_LIMIT_MAX);
    }
  }

  private consumeBucket(key: string, limit: number): void {
    const now = Date.now();
    const result = this.repositories.consumeRateLimitBucket(key, limit, this.config.RATE_LIMIT_WINDOW_MS, now);
    this.consumedSinceSweep += 1;
    if (this.consumedSinceSweep >= 1_000) {
      this.repositories.deleteExpiredRateLimitBuckets(now);
      this.consumedSinceSweep = 0;
    }
    if (!result.allowed) {
      throw new AppError("RATE_LIMITED", "Too many requests. Try again later.", 429, {
        retryAfterMs: result.retryAfterMs,
        remaining: result.remaining,
        limit
      });
    }
  }
}

function routeKey(url: string): string {
  return url.split("?", 1)[0] ?? url;
}
