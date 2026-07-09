import assert from "node:assert/strict";
import test from "node:test";
import type { FastifyRequest } from "fastify";
import type { AppConfig } from "../src/config/env.js";
import type { Repositories } from "../src/db/repositories.js";
import { RateLimitService } from "../src/services/security/rateLimitService.js";
import { AppError } from "../src/utils/errors.js";

const config = {
  RATE_LIMIT_WINDOW_MS: 60_000,
  RATE_LIMIT_MAX: 2,
  RUNTIME_RATE_LIMIT_MAX: 2,
  APP_RATE_LIMIT_MAX: 3,
  APP_VOICE_RATE_LIMIT_MAX: 1,
  CONSOLE_AUTH_RATE_LIMIT_MAX: 2,
  WORKFLOW_VIDEO_MAX_BYTES: 50 * 1024 * 1024,
  GEMINI_LIVE_TOKEN_RATE_LIMIT_MAX: 1
} as AppConfig;

test("rate limiter applies principal and app voice limits", () => {
  const limiter = new RateLimitService(config, rateLimitRepository());

  limiter.consume(request("/api/v1/runtime/resolve"));
  limiter.consume(request("/api/v1/runtime/resolve"));
  assertRateLimited(() => limiter.consume(request("/api/v1/runtime/resolve")));

  limiter.consume(runtimeRequest("/api/v1/gemini/live-token", "token-a"));
  assertRateLimited(() => limiter.consume(runtimeRequest("/api/v1/gemini/live-token", "token-b")));
});

test("rate limiter separates API key buckets", () => {
  const limiter = new RateLimitService(config, rateLimitRepository());

  limiter.consume(request("/api/v1/runtime/resolve", "key_a"));
  limiter.consume(request("/api/v1/runtime/resolve", "key_a"));
  limiter.consume(request("/api/v1/runtime/resolve", "key_b"));

  assertRateLimited(() => limiter.consume(request("/api/v1/runtime/resolve", "key_a")));
});

test("rate limiter applies strict console auth buckets per IP and subject", () => {
  const limiter = new RateLimitService(config, rateLimitRepository());

  limiter.consumeConsoleAuth(request("/api/v1/console/auth/login"), "login", "admin@example.com");
  limiter.consumeConsoleAuth(request("/api/v1/console/auth/login"), "login", "admin@example.com");

  assertRateLimited(() => limiter.consumeConsoleAuth(request("/api/v1/console/auth/login"), "login", "admin@example.com"));
  assertRateLimited(() => limiter.consumeConsoleAuth(request("/api/v1/console/auth/login", undefined, "192.0.2.10"), "login", "admin@example.com"));
});

function request(url: string, prefix?: string, ip = "127.0.0.1"): FastifyRequest {
  return {
    method: "POST",
    url,
    ip,
    apiKey: prefix ? { id: prefix, prefix } : undefined
  } as FastifyRequest;
}

function runtimeRequest(url: string, id: string): FastifyRequest {
  return {
    method: "POST",
    url,
    ip: "127.0.0.1",
    runtimeToken: { id, appId: "app-one" }
  } as FastifyRequest;
}

function rateLimitRepository(): Repositories {
  const buckets = new Map<string, { count: number; resetAt: number }>();
  return {
    consumeRateLimitBucket(key: string, limit: number, windowMs: number, now: number) {
      const current = buckets.get(key);
      if (!current || current.resetAt <= now) {
        buckets.set(key, { count: 1, resetAt: now + windowMs });
        return { allowed: true, retryAfterMs: windowMs, remaining: limit - 1 };
      }
      if (current.count >= limit) return { allowed: false, retryAfterMs: current.resetAt - now, remaining: 0 };
      current.count += 1;
      return { allowed: true, retryAfterMs: current.resetAt - now, remaining: limit - current.count };
    },
    deleteExpiredRateLimitBuckets() {}
  } as unknown as Repositories;
}

function assertRateLimited(fn: () => void): void {
  assert.throws(fn, (error) => error instanceof AppError && error.code === "RATE_LIMITED" && error.statusCode === 429);
}
