import { describe, it, expect, vi, beforeEach } from "vitest";
import { getCacheKey, getCached, setCached } from "@/lib/cache/orthogonal-cache";

// Mock the Redis client module
vi.mock("@/lib/cache/redis", () => ({
  redis: {
    get: vi.fn(),
    set: vi.fn(),
  },
}));

import { redis } from "@/lib/cache/redis";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockRedis = redis as any as { get: ReturnType<typeof vi.fn>; set: ReturnType<typeof vi.fn> };

describe("getCacheKey", () => {
  it("produces a stable key from api, path, and params", () => {
    const k1 = getCacheKey("company-enrich", "/companies/enrich", { domain: "stripe.com" });
    const k2 = getCacheKey("company-enrich", "/companies/enrich", { domain: "stripe.com" });
    expect(k1).toBe(k2);
  });

  it("produces different keys for different params", () => {
    const k1 = getCacheKey("company-enrich", "/companies/enrich", { domain: "stripe.com" });
    const k2 = getCacheKey("company-enrich", "/companies/enrich", { domain: "openai.com" });
    expect(k1).not.toBe(k2);
  });

  it("produces different keys for different APIs", () => {
    const k1 = getCacheKey("company-enrich", "/companies/enrich", { domain: "stripe.com" });
    const k2 = getCacheKey("scrapegraphai", "/api/search", { domain: "stripe.com" });
    expect(k1).not.toBe(k2);
  });

  it("is order-independent for params", () => {
    const k1 = getCacheKey("api", "/path", { b: "2", a: "1" });
    const k2 = getCacheKey("api", "/path", { a: "1", b: "2" });
    expect(k1).toBe(k2);
  });
});

describe("getCached", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns null when no cache entry exists", async () => {
    mockRedis.get.mockResolvedValueOnce(null);
    const result = await getCached("key");
    expect(result).toBeNull();
  });

  it("returns parsed data and fetchedAt when cache hit", async () => {
    const stored = { data: { name: "Stripe" }, fetchedAt: "2026-05-25T00:00:00.000Z" };
    mockRedis.get.mockResolvedValueOnce(JSON.stringify(stored));
    const result = await getCached("key");
    expect(result?.data).toEqual({ name: "Stripe" });
    expect(result?.fetchedAt).toBe("2026-05-25T00:00:00.000Z");
  });

  it("returns null on malformed cache data", async () => {
    mockRedis.get.mockResolvedValueOnce("not-json{{{");
    const result = await getCached("key");
    expect(result).toBeNull();
  });
});

describe("setCached", () => {
  beforeEach(() => vi.clearAllMocks());

  it("stores data with fetchedAt and a TTL", async () => {
    mockRedis.set.mockResolvedValueOnce("OK");
    await setCached("key", { name: "Stripe" }, 300);

    expect(mockRedis.set).toHaveBeenCalledOnce();
    const [cacheKey, value, options] = mockRedis.set.mock.calls[0];
    expect(cacheKey).toBe("key");
    const parsed = JSON.parse(value);
    expect(parsed.data).toEqual({ name: "Stripe" });
    expect(parsed.fetchedAt).toBeDefined();
    expect(options).toMatchObject({ ex: 300 });
  });
});
