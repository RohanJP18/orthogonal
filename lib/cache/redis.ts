import { Redis } from "@upstash/redis";

// Lazy singleton — avoids crashing at module load when env vars aren't set yet
let _redis: Redis | null = null;

export function getRedis(): Redis | null {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;

  if (!_redis) {
    _redis = new Redis({ url, token });
  }
  return _redis;
}

// Typed wrapper so callers don't have to cast getRedis() everywhere.
// Each method falls back to a safe no-op when Redis is unconfigured.
export const redis = {
  // String ops
  get: <T>(key: string) =>
    getRedis()?.get<T>(key) ?? Promise.resolve(null),
  set: (key: string, value: string, opts?: { ex: number }) =>
    getRedis()?.set(key, value, opts) ?? Promise.resolve(null),

  // Sorted-set ops (used by rate limiter)
  zremrangebyscore: (key: string, min: number, max: number) =>
    getRedis()?.zremrangebyscore(key, min, max) ?? Promise.resolve(0),
  zcard: (key: string) =>
    getRedis()?.zcard(key) ?? Promise.resolve(0),
  zadd: (key: string, score: number, member: string) =>
    getRedis()?.zadd(key, { score, member }) ?? Promise.resolve(0),
  expire: (key: string, seconds: number) =>
    getRedis()?.expire(key, seconds) ?? Promise.resolve(0),
};
