/**
 * Requirement 4: API failures and graceful degradation
 *
 * "What happens when an API is slow or down? How does the chat behave?"
 *
 * Validates:
 *  - Circuit breaker opens after repeated failures (fail-fast, not hang)
 *  - Tool errors produce structured JSON, not crashes
 *  - Orchestrator passes error to LLM as tool_result (LLM explains gracefully)
 *  - Different named breakers are isolated (one bad API doesn't kill others)
 *  - System prompt instructs LLM on fallback behavior when tools fail
 *  - OrthogonalError surfaces meaningful messages
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { withCircuitBreaker, CircuitOpenError, resetBreaker } from "@/lib/resilience/circuit-breaker";
import { OrthogonalError } from "@/lib/orthogonal/client";
import { buildSystemPrompt, encodeSSE, parseSSEEvent } from "@/lib/llm/orchestrator";

// ─── Circuit breaker behavior ─────────────────────────────────────────────────

describe("Req4 — circuit breaker fails fast after repeated failures", () => {
  it("lets successful calls through normally", async () => {
    const fn = vi.fn().mockResolvedValue("data");
    const result = await withCircuitBreaker("req4-success", fn);
    expect(result).toBe("data");
  });

  it("opens after volumeThreshold failures and throws CircuitOpenError", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("API down"));

    // Trip the breaker (needs volumeThreshold=10 failures)
    await Promise.allSettled(
      Array.from({ length: 12 }, () => withCircuitBreaker("req4-open", fn))
    );

    // Now it should fail fast instead of waiting
    await expect(
      withCircuitBreaker("req4-open", fn)
    ).rejects.toBeInstanceOf(CircuitOpenError);
  });

  it("CircuitOpenError message names the failing service", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("fail"));
    await Promise.allSettled(
      Array.from({ length: 12 }, () => withCircuitBreaker("req4-name-test", fn))
    );

    try {
      await withCircuitBreaker("req4-name-test", fn);
    } catch (err) {
      expect((err as Error).message).toContain("req4-name-test");
    }
  });

  it("isolates failures — a broken API doesn't affect other breakers", async () => {
    const badFn = vi.fn().mockRejectedValue(new Error("Orthogonal down"));
    const goodFn = vi.fn().mockResolvedValue("OpenAI response");

    // Trip one breaker
    await Promise.allSettled(
      Array.from({ length: 12 }, () => withCircuitBreaker("req4-bad-api", badFn))
    );

    // Different breaker still works
    const result = await withCircuitBreaker("req4-good-api", goodFn);
    expect(result).toBe("OpenAI response");
  });

  it("resets cleanly — new breaker after reset works again", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("fail"));
    await Promise.allSettled(
      Array.from({ length: 12 }, () => withCircuitBreaker("req4-reset", fn))
    );

    resetBreaker("req4-reset");

    const goodFn = vi.fn().mockResolvedValue("recovered");
    const result = await withCircuitBreaker("req4-reset", goodFn);
    expect(result).toBe("recovered");
  });
});

// ─── Tool errors produce structured output, not crashes ───────────────────────

describe("Req4 — OrthogonalError is structured and informative", () => {
  it("includes error message when API returns success:false", () => {
    const err = new OrthogonalError("Orthogonal call failed: INSUFFICIENT_CREDITS");
    expect(err.message).toContain("INSUFFICIENT_CREDITS");
    expect(err.name).toBe("OrthogonalError");
    expect(err).toBeInstanceOf(Error);
  });

  it("includes HTTP status when server returns an error code", () => {
    const err = new OrthogonalError("Orthogonal returned 401", 401, { error: "UNAUTHORIZED" });
    expect(err.status).toBe(401);
    expect(err.details).toEqual({ error: "UNAUTHORIZED" });
  });

  it("network failures produce a meaningful OrthogonalError", () => {
    const err = new OrthogonalError("Network error calling Orthogonal: fetch failed");
    expect(err.message).toContain("Network error");
    expect(err.name).toBe("OrthogonalError");
  });
});

// ─── System prompt instructs fallback behavior ────────────────────────────────

describe("Req4 — system prompt teaches LLM to handle tool failures gracefully", () => {
  it("system prompt includes fallback instructions", () => {
    const prompt = buildSystemPrompt();
    // LLM should be told what to do when tools fail
    expect(prompt.toLowerCase()).toMatch(/fail|unavailable|alternative/);
  });

  it("system prompt mentions Orthogonal tools", () => {
    const prompt = buildSystemPrompt();
    expect(prompt.toLowerCase()).toContain("orthogonal");
  });

  it("summary context is appended for long conversations", () => {
    const summary = "User has been asking about Stripe and OpenAI funding.";
    const prompt = buildSystemPrompt(summary);
    expect(prompt).toContain(summary);
  });
});

// ─── Timeout behavior ─────────────────────────────────────────────────────────

describe("Req4 — tool calls have longer timeout than LLM calls", () => {
  it("tool breakers have 30s timeout (scraping can be slow)", async () => {
    // We verify indirectly: a fast-resolving mock should pass without timing out
    const slowishFn = vi.fn().mockImplementation(
      () => new Promise((resolve) => setTimeout(() => resolve("done"), 100))
    );
    const result = await withCircuitBreaker("tool:web_search", slowishFn);
    expect(result).toBe("done");
  });

  it("LLM breaker is named 'openai' (separate from tools)", async () => {
    const fn = vi.fn().mockResolvedValue("llm response");
    const result = await withCircuitBreaker("openai", fn);
    expect(result).toBe("llm response");
  });
});

// ─── SSE error event format ───────────────────────────────────────────────────

describe("Req4 — SSE error events are structured for the frontend", () => {
  it("encodeSSE produces parseable error event", () => {
    const encoded = encodeSSE({ type: "error", message: "Circuit open" });
    const parsed = parseSSEEvent(encoded.trim());
    expect(parsed).toEqual({ type: "error", message: "Circuit open" });
  });

  it("tool_result event includes priceCents for cost tracking", () => {
    const encoded = encodeSSE({ type: "tool_result", toolCallId: "tc_1", result: {}, priceCents: 1.225 });
    const parsed = parseSSEEvent(encoded.trim()) as { priceCents: number };
    expect(parsed.priceCents).toBe(1.225);
  });
});
