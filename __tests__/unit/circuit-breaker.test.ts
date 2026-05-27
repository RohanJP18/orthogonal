import { describe, it, expect, vi } from "vitest";
import { withCircuitBreaker, CircuitOpenError } from "@/lib/resilience/circuit-breaker";

describe("withCircuitBreaker", () => {
  it("passes through successful calls", async () => {
    const fn = vi.fn().mockResolvedValue("ok");
    const result = await withCircuitBreaker("test", fn);
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledOnce();
  });

  it("opens the circuit after repeated failures and throws CircuitOpenError", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("fail"));
    // Fill the failure window (10 calls by default)
    const results = await Promise.allSettled(
      Array.from({ length: 10 }, () => withCircuitBreaker("test-open", fn))
    );
    const failures = results.filter((r) => r.status === "rejected");
    expect(failures.length).toBeGreaterThan(0);

    // Next call should fail fast with CircuitOpenError
    fn.mockRejectedValue(new Error("still failing"));
    await expect(withCircuitBreaker("test-open", fn)).rejects.toBeInstanceOf(
      CircuitOpenError
    );
  });

  it("does not share state between different named breakers", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("fail"));
    await Promise.allSettled(
      Array.from({ length: 10 }, () => withCircuitBreaker("breaker-a", fn))
    );

    const fn2 = vi.fn().mockResolvedValue("ok");
    const result = await withCircuitBreaker("breaker-b", fn2);
    expect(result).toBe("ok");
  });
});
