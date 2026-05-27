import { redis } from "@/lib/cache/redis";
import { getTracer } from "@/lib/telemetry/tracer";
import { SpanStatusCode } from "@opentelemetry/api";

export interface RateLimitConfig {
  maxRequests: number;
  windowSeconds: number;
}

// Spec NF4: per-user, per-route sliding-window rate limits
export const RATE_LIMITS: Record<string, RateLimitConfig> = {
  chat: { maxRequests: 20, windowSeconds: 60 },
  conversations: { maxRequests: 60, windowSeconds: 60 },
};

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds?: number;
}

export async function checkRateLimit(
  userId: string,
  route: string
): Promise<RateLimitResult> {
  return getTracer().startActiveSpan("redis.rate_limit", async (span) => {
    const config = RATE_LIMITS[route] ?? { maxRequests: 30, windowSeconds: 60 };
    span.setAttributes({
      "rate_limit.route": route,
      "rate_limit.max_requests": config.maxRequests,
      "rate_limit.window_seconds": config.windowSeconds,
      // user_id intentionally omitted from span attributes — PII.
      // Use the trace's baggage or a hashed value if correlation is needed.
    });

    const key = `rl:${route}:${userId}`;
    const now = Date.now();
    const windowStart = now - config.windowSeconds * 1000;

    try {
      await redis.zremrangebyscore(key, 0, windowStart);
      const count = await redis.zcard(key);

      if (count >= config.maxRequests) {
        span.setAttributes({
          "rate_limit.allowed": false,
          "rate_limit.remaining": 0,
          "rate_limit.redis_available": true,
        });
        span.setStatus({ code: SpanStatusCode.OK });
        span.end();
        return {
          allowed: false,
          remaining: 0,
          retryAfterSeconds: config.windowSeconds,
        };
      }

      await redis.zadd(key, now, `${now}-${Math.random()}`);
      await redis.expire(key, config.windowSeconds);

      span.setAttributes({
        "rate_limit.allowed": true,
        "rate_limit.remaining": config.maxRequests - count - 1,
        "rate_limit.redis_available": true,
      });
      span.setStatus({ code: SpanStatusCode.OK });
      span.end();
      return {
        allowed: true,
        remaining: config.maxRequests - count - 1,
      };
    } catch {
      // Spec NF3: fail open — don't block users when Redis is unavailable
      span.setAttributes({
        "rate_limit.allowed": true,
        "rate_limit.remaining": config.maxRequests,
        "rate_limit.redis_available": false,
      });
      span.setStatus({ code: SpanStatusCode.OK, message: "redis_unavailable_fail_open" });
      span.end();
      return { allowed: true, remaining: config.maxRequests };
    }
  });
}
