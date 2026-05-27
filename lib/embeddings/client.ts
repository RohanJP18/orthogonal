import OpenAI from "openai";
import { redis } from "@/lib/cache/redis";
import { createHash } from "crypto";
import { getTracer } from "@/lib/telemetry/tracer";
import { SpanStatusCode } from "@opentelemetry/api";

const EMBEDDING_MODEL = "text-embedding-3-small";
const DIMENSIONS = 1536;
const CACHE_TTL = 24 * 60 * 60; // 24 hours

function cacheKey(text: string): string {
  const hash = createHash("sha256")
    .update(text.trim().toLowerCase().slice(0, 8000))
    .digest("hex")
    .slice(0, 24);
  return `emb:${hash}`;
}

// Returns null on timeout or failure — callers degrade to recency-only context (spec F5)
export async function embedText(
  text: string,
  timeoutMs = 150
): Promise<number[] | null> {
  return getTracer().startActiveSpan("embed.call", async (span) => {
    span.setAttributes({
      "embed.model": EMBEDDING_MODEL,
      "embed.dimensions": DIMENSIONS,
      "embed.timeout_ms": timeoutMs,
    });

    const key = cacheKey(text);

    try {
      const raw = await redis.get<unknown>(key);
      if (raw) {
        const arr = typeof raw === "string" ? JSON.parse(raw) : raw;
        if (Array.isArray(arr)) {
          span.setAttributes({ "embed.cache_hit": true });
          span.setStatus({ code: SpanStatusCode.OK });
          span.end();
          return arr as number[];
        }
      }
    } catch { /* cache miss is fine */ }

    span.setAttributes({ "embed.cache_hit": false });

    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const start = Date.now();

    try {
      const result = await Promise.race([
        client.embeddings.create({
          model: EMBEDDING_MODEL,
          input: text.slice(0, 8000),
          dimensions: DIMENSIONS,
        }),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("Embedding timeout")), timeoutMs)
        ),
      ]);

      const latencyMs = Date.now() - start;
      const vector = result.data[0].embedding;
      span.setAttributes({
        "embed.latency_ms": latencyMs,
        "embed.timed_out": false,
      });
      span.setStatus({ code: SpanStatusCode.OK });
      span.end();
      redis.set(key, JSON.stringify(vector), { ex: CACHE_TTL }).catch(() => {});
      return vector;
    } catch (err) {
      const latencyMs = Date.now() - start;
      const timedOut = (err as Error).message === "Embedding timeout";
      span.setAttributes({
        "embed.latency_ms": latencyMs,
        "embed.timed_out": timedOut,
      });
      // Degradation is expected — record but don't mark as error so it doesn't pollute error rate dashboards.
      span.setStatus({ code: SpanStatusCode.OK, message: timedOut ? "timed_out" : "api_error" });
      span.end();
      return null;
    }
  });
}
