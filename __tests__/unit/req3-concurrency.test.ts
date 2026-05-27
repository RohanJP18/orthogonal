/**
 * Requirement 3: Concurrent users hitting the same APIs
 *
 * "How would you handle multiple users hitting the same APIs concurrently?"
 *
 * Validates:
 *  - Redis cache deduplicates repeated Orthogonal calls (same query → 0 cost on hit)
 *  - Cache keys are stable and order-independent (concurrent requests get same key)
 *  - Cache miss → API called once; cache hit → API NOT called again
 *  - Cache hit returns priceCents: 0 (no double-billing)
 *  - Redis failure is non-blocking (concurrent users unaffected by cache outage)
 *  - Different queries produce different keys (no cross-contamination)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/cache/redis", () => ({
  redis: {
    get: vi.fn(),
    set: vi.fn().mockResolvedValue("OK"),
  },
}));

import { redis } from "@/lib/cache/redis";
import {
  getCacheKey,
  withOrthogonalCache,
} from "@/lib/cache/orthogonal-cache";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockRedis = redis as any;

describe("Req3 — cache key stability (concurrent requests)", () => {
  it("same query always produces the same cache key", () => {
    const k1 = getCacheKey("company-enrich", "/companies/enrich", { domain: "stripe.com" });
    const k2 = getCacheKey("company-enrich", "/companies/enrich", { domain: "stripe.com" });
    expect(k1).toBe(k2);
  });

  it("key is order-independent — concurrent requests with same params share cache", () => {
    const k1 = getCacheKey("company-enrich", "/companies/enrich", { domain: "stripe.com", name: "Stripe" });
    const k2 = getCacheKey("company-enrich", "/companies/enrich", { name: "Stripe", domain: "stripe.com" });
    expect(k1).toBe(k2);
  });

  it("different domains produce different keys — no cross-contamination", () => {
    const k1 = getCacheKey("company-enrich", "/companies/enrich", { domain: "stripe.com" });
    const k2 = getCacheKey("company-enrich", "/companies/enrich", { domain: "openai.com" });
    expect(k1).not.toBe(k2);
  });

  it("different APIs produce different keys", () => {
    const k1 = getCacheKey("company-enrich", "/companies/enrich", { domain: "stripe.com" });
    const k2 = getCacheKey("scrapegraphai", "/api/search", { domain: "stripe.com" });
    expect(k1).not.toBe(k2);
  });
});

describe("Req3 — cache miss: API is called once", () => {
  beforeEach(() => vi.clearAllMocks());

  it("calls fn() on cache miss", async () => {
    mockRedis.get.mockResolvedValue(null); // cache miss
    const fn = vi.fn().mockResolvedValue({ data: { name: "Stripe" }, priceCents: 1.225, requestId: "r1" });

    await withOrthogonalCache("key-miss", 300, fn);

    expect(fn).toHaveBeenCalledOnce();
  });

  it("stores result in cache after fetching", async () => {
    mockRedis.get.mockResolvedValue(null);
    mockRedis.set.mockResolvedValue("OK");
    const fn = vi.fn().mockResolvedValue({ data: { name: "Stripe" }, priceCents: 1.225, requestId: "r1" });

    await withOrthogonalCache("key-store", 300, fn);

    expect(mockRedis.set).toHaveBeenCalledOnce();
    const [, storedValue] = mockRedis.set.mock.calls[0];
    const parsed = JSON.parse(storedValue);
    expect(parsed.data).toEqual({ name: "Stripe" });
    expect(parsed.fetchedAt).toBeDefined();
  });

  it("returns fromCache: false and actual priceCents on miss", async () => {
    mockRedis.get.mockResolvedValue(null);
    const fn = vi.fn().mockResolvedValue({ data: { name: "Stripe" }, priceCents: 1.225, requestId: "r1" });

    const result = await withOrthogonalCache("key-miss-price", 300, fn);

    expect(result.priceCents).toBe(1.225);
    expect(result.fromCache).toBe(false);
  });
});

describe("Req3 — cache hit: second concurrent/repeated request costs nothing", () => {
  beforeEach(() => vi.clearAllMocks());

  it("does NOT call fn() on cache hit", async () => {
    const cached = JSON.stringify({ data: { name: "Stripe" }, fetchedAt: "2026-05-25T00:00:00Z" });
    mockRedis.get.mockResolvedValue(cached);
    const fn = vi.fn();

    await withOrthogonalCache("key-hit", 300, fn);

    expect(fn).not.toHaveBeenCalled(); // Orthogonal API was NOT called
  });

  it("returns priceCents: 0 on cache hit (no double-billing)", async () => {
    const cached = JSON.stringify({ data: { name: "Stripe" }, fetchedAt: "2026-05-25T00:00:00Z" });
    mockRedis.get.mockResolvedValue(cached);

    const result = await withOrthogonalCache("key-zero-cost", 300, vi.fn());

    expect(result.priceCents).toBe(0);
  });

  it("returns fromCache: true on hit", async () => {
    const cached = JSON.stringify({ data: { name: "Stripe" }, fetchedAt: "2026-05-25T00:00:00Z" });
    mockRedis.get.mockResolvedValue(cached);

    const result = await withOrthogonalCache("key-from-cache", 300, vi.fn());

    expect(result.fromCache).toBe(true);
    expect(result.fetchedAt).toBe("2026-05-25T00:00:00Z");
  });

  it("returns correct data from cache", async () => {
    const cachedData = { name: "OpenAI", domain: "openai.com" };
    const cached = JSON.stringify({ data: cachedData, fetchedAt: "2026-05-25T00:00:00Z" });
    mockRedis.get.mockResolvedValue(cached);

    const result = await withOrthogonalCache("key-data", 300, vi.fn());

    expect(result.data).toEqual(cachedData);
  });
});

describe("Req3 — Redis failure is non-blocking (cache outage doesn't break users)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("proceeds to call fn() when Redis.get throws", async () => {
    mockRedis.get.mockRejectedValue(new Error("Redis connection refused"));
    const fn = vi.fn().mockResolvedValue({ data: { name: "Stripe" }, priceCents: 1.225, requestId: "r1" });

    const result = await withOrthogonalCache("key-redis-down", 300, fn);

    // Still got the data — cache failure is transparent
    expect(fn).toHaveBeenCalledOnce();
    expect((result.data as { name: string }).name).toBe("Stripe");
  });

  it("returns data even when cache write fails", async () => {
    mockRedis.get.mockResolvedValue(null);
    mockRedis.set.mockRejectedValue(new Error("Redis write failed"));
    const fn = vi.fn().mockResolvedValue({ data: { results: [] }, priceCents: 3, requestId: "r2" });

    // Should not throw despite write failure
    const result = await withOrthogonalCache("key-write-fail", 300, fn);
    expect(result.priceCents).toBe(3);
  });

  it("malformed cache data is treated as a miss", async () => {
    mockRedis.get.mockResolvedValue("{bad json{{");
    const fn = vi.fn().mockResolvedValue({ data: {}, priceCents: 0, requestId: "r3" });

    await withOrthogonalCache("key-malformed", 300, fn);
    expect(fn).toHaveBeenCalledOnce(); // fetched fresh
  });
});
