import assert from "node:assert/strict";
import test from "node:test";
import type { FastifyRequest } from "fastify";
import type { AppConfig } from "../src/config/env.js";
import { RateLimitService } from "../src/services/security/rateLimitService.js";
import { AppError } from "../src/utils/errors.js";

const config = {
  RATE_LIMIT_WINDOW_MS: 60_000,
  RATE_LIMIT_MAX: 2,
  CONSOLE_AUTH_RATE_LIMIT_MAX: 2,
  WORKFLOW_VIDEO_MAX_BYTES: 50 * 1024 * 1024,
  GEMINI_LIVE_TOKEN_RATE_LIMIT_MAX: 1
} as AppConfig;

test("rate limiter applies normal and Gemini-token limits per route", () => {
  const limiter = new RateLimitService(config);

  limiter.consume(request("/api/v1/runtime/resolve"));
  limiter.consume(request("/api/v1/runtime/resolve"));
  assertRateLimited(() => limiter.consume(request("/api/v1/runtime/resolve")));

  limiter.consume(request("/api/v1/gemini/live-token"));
  assertRateLimited(() => limiter.consume(request("/api/v1/gemini/live-token")));
});

test("rate limiter separates API key buckets", () => {
  const limiter = new RateLimitService(config);

  limiter.consume(request("/api/v1/runtime/resolve", "key_a"));
  limiter.consume(request("/api/v1/runtime/resolve", "key_a"));
  limiter.consume(request("/api/v1/runtime/resolve", "key_b"));

  assertRateLimited(() => limiter.consume(request("/api/v1/runtime/resolve", "key_a")));
});

test("rate limiter applies strict console auth buckets per IP and subject", () => {
  const limiter = new RateLimitService(config);

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
    apiKey: prefix ? { prefix } : undefined
  } as FastifyRequest;
}

function assertRateLimited(fn: () => void): void {
  assert.throws(fn, (error) => error instanceof AppError && error.code === "RATE_LIMITED" && error.statusCode === 429);
}
