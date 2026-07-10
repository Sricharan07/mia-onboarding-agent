import { AppError } from "../utils/errors.js";

type Bucket = { count: number; resetAt: number };

export class V1RateLimiter {
  private readonly buckets = new Map<string, Bucket>();
  private requests = 0;

  constructor(private readonly windowMs: number) {}

  consume(key: string, limit: number): void {
    const now = Date.now();
    const current = this.buckets.get(key);
    const bucket = !current || current.resetAt <= now
      ? { count: 0, resetAt: now + this.windowMs }
      : current;
    bucket.count += 1;
    this.buckets.set(key, bucket);
    this.requests += 1;
    if (this.requests % 1_000 === 0) this.sweep(now);
    if (bucket.count > limit) {
      throw new AppError("RATE_LIMITED", "Too many requests. Try again shortly.", 429, {
        retryAfterMs: Math.max(1, bucket.resetAt - now)
      });
    }
  }

  private sweep(now: number): void {
    for (const [key, bucket] of this.buckets) {
      if (bucket.resetAt <= now) this.buckets.delete(key);
    }
  }
}
