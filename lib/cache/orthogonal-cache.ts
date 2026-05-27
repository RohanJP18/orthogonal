import { redis } from "./redis";
import type { OrthogonalResponse } from "@/lib/orthogonal/client";

export interface CacheEntry {
  data: unknown;
  fetchedAt: string;
}

// Spec F7: TTLs — hot endpoints 5-15 min, less volatile up to 1 hour
export const TTL = {
  company: 15 * 60,   // 15 minutes
  person: 10 * 60,    // 10 minutes
  web: 5 * 60,        // 5 minutes — news changes fast
} as const;

export function getCacheKey(
  api: string,
  path: string,
  params?: Record<string, unknown>
): string {
  const sortedParams = params
    ? Object.keys(params)
        .sort()
        .map((k) => `${k}=${String(params[k])}`)
        .join("&")
    : "";
  return `orth:${api}:${path}:${sortedParams}`;
}

export async function getCached(key: string): Promise<CacheEntry | null> {
  try {
    const raw = await redis.get<string>(key);
    if (!raw) return null;
    const parsed = JSON.parse(typeof raw === "string" ? raw : JSON.stringify(raw));
    if (!parsed?.data || !parsed?.fetchedAt) return null;
    return parsed as CacheEntry;
  } catch {
    return null;
  }
}

export async function setCached(
  key: string,
  data: unknown,
  ttlSeconds: number
): Promise<void> {
  const entry: CacheEntry = { data, fetchedAt: new Date().toISOString() };
  await redis.set(key, JSON.stringify(entry), { ex: ttlSeconds } as { ex: number });
}

// Wraps an Orthogonal call with Redis caching.
// On cache hit, returns cached data with priceCents=0 (already paid).
export async function withOrthogonalCache<T>(
  key: string,
  ttlSeconds: number,
  fn: () => Promise<OrthogonalResponse<T>>,
  bypassCache = false,
): Promise<OrthogonalResponse<T> & { fetchedAt?: string; fromCache?: boolean }> {
  if (!bypassCache) {
    const cached = await getCached(key);
    if (cached) {
      console.log(`[cache] HIT key=${key}`);
      return {
        data: cached.data as T,
        priceCents: 0,
        requestId: "cached",
        fetchedAt: cached.fetchedAt,
        fromCache: true,
      };
    }
  }

  console.log(`[cache] MISS key=${key} bypass=${bypassCache}`);
  const result = await fn();
  await setCached(key, result.data, ttlSeconds).catch(() => {});
  return { ...result, fromCache: false };
}
