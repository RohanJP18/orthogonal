/**
 * NF4: Per-user Redis sliding-window rate limiting
 *
 * "How would you handle multiple users hitting the same APIs concurrently?"
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/cache/redis", () => ({
  redis: {
    zremrangebyscore: vi.fn(),
    zcard: vi.fn(),
    zadd: vi.fn(),
    expire: vi.fn(),
  },
}));

import { redis } from "@/lib/cache/redis";
import { checkRateLimit, RATE_LIMITS } from "@/lib/resilience/rate-limiter";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockRedis = redis as any;

describe("checkRateLimit — sliding window", () => {
  beforeEach(() => vi.clearAllMocks());

  it("allows request when under the limit", async () => {
    mockRedis.zremrangebyscore.mockResolvedValue(0);
    mockRedis.zcard.mockResolvedValue(3); // 3 requests in window, limit is 20
    mockRedis.zadd.mockResolvedValue(1);
    mockRedis.expire.mockResolvedValue(1);

    const result = await checkRateLimit("user-123", "chat");
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBeGreaterThan(0);
  });

  it("blocks request when at the limit", async () => {
    mockRedis.zremrangebyscore.mockResolvedValue(0);
    mockRedis.zcard.mockResolvedValue(20); // at the limit
    mockRedis.zadd.mockResolvedValue(1);
    mockRedis.expire.mockResolvedValue(1);

    const result = await checkRateLimit("user-123", "chat");
    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
  });

  it("includes retryAfterSeconds when blocked", async () => {
    mockRedis.zremrangebyscore.mockResolvedValue(0);
    mockRedis.zcard.mockResolvedValue(20);
    mockRedis.zadd.mockResolvedValue(1);
    mockRedis.expire.mockResolvedValue(1);

    const result = await checkRateLimit("user-123", "chat");
    expect(result.retryAfterSeconds).toBeDefined();
    expect(result.retryAfterSeconds).toBeGreaterThan(0);
  });

  it("different users have independent limits", async () => {
    mockRedis.zremrangebyscore.mockResolvedValue(0);
    mockRedis.zcard.mockResolvedValue(5);
    mockRedis.zadd.mockResolvedValue(1);
    mockRedis.expire.mockResolvedValue(1);

    const r1 = await checkRateLimit("user-aaa", "chat");
    const r2 = await checkRateLimit("user-bbb", "chat");
    expect(r1.allowed).toBe(true);
    expect(r2.allowed).toBe(true);

    // Verify different Redis keys were used
    const keys = mockRedis.zremrangebyscore.mock.calls.map((c: string[]) => c[0]);
    expect(keys[0]).not.toBe(keys[1]);
  });

  it("RATE_LIMITS defines limits for chat route", () => {
    expect(RATE_LIMITS.chat).toBeDefined();
    expect(RATE_LIMITS.chat.maxRequests).toBeGreaterThan(0);
    expect(RATE_LIMITS.chat.windowSeconds).toBeGreaterThan(0);
  });

  it("falls through (allows) when Redis is unavailable", async () => {
    mockRedis.zremrangebyscore.mockRejectedValue(new Error("Redis down"));

    const result = await checkRateLimit("user-123", "chat");
    expect(result.allowed).toBe(true); // fail open — don't block users when cache is down
  });
});
