import type { FastifyRequest } from "fastify";
import type { AppConfig } from "../../config/env.js";
import { AppError } from "../../utils/errors.js";

type Bucket = {
  count: number;
  resetAt: number;
};

export class RateLimitService {
  private readonly buckets = new Map<string, Bucket>();

  constructor(private readonly config: AppConfig) {}

  consume(request: FastifyRequest): void {
    if (request.method === "OPTIONS") return;

    const now = Date.now();
    const limit = request.url.startsWith("/api/v1/gemini/live-token")
      ? this.config.GEMINI_LIVE_TOKEN_RATE_LIMIT_MAX
      : this.config.RATE_LIMIT_MAX;
    const key = `${request.apiKey?.prefix ?? request.ip}:${request.method}:${routeKey(request.url)}`;
    const bucket = this.buckets.get(key);

    if (!bucket || bucket.resetAt <= now) {
      this.buckets.set(key, { count: 1, resetAt: now + this.config.RATE_LIMIT_WINDOW_MS });
      this.sweep(now);
      return;
    }

    bucket.count += 1;
    if (bucket.count > limit) {
      throw new AppError("RATE_LIMITED", "Too many requests. Try again later.", 429, {
        retryAfterMs: Math.max(0, bucket.resetAt - now)
      });
    }
  }

  private sweep(now: number): void {
    if (this.buckets.size < 10_000) return;
    for (const [key, bucket] of this.buckets) {
      if (bucket.resetAt <= now) this.buckets.delete(key);
    }
  }
}

function routeKey(url: string): string {
  return url.split("?", 1)[0] ?? url;
}
