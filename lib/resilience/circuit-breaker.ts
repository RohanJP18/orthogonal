import CircuitBreaker from "opossum";

export class CircuitOpenError extends Error {
  constructor(name: string) {
    super(`Circuit breaker "${name}" is OPEN — failing fast`);
    this.name = "CircuitOpenError";
  }
}

const breakers = new Map<string, CircuitBreaker>();

// Web search (scrapegraphai) is slowest; other tools and LLM get shorter budgets
function timeoutFor(name: string): number {
  if (name === "tool:web_search") return 60_000;
  if (name.startsWith("tool:")) return 30_000;
  return 10_000;
}

function getBreaker(name: string): CircuitBreaker {
  if (!breakers.has(name)) {
    const breaker = new CircuitBreaker(async (fn: () => Promise<unknown>) => fn(), {
      name,
      timeout: timeoutFor(name),
      errorThresholdPercentage: 50,
      resetTimeout: 30_000,
      volumeThreshold: 10,
      rollingCountTimeout: 30_000,
    });
    breakers.set(name, breaker);
  }
  return breakers.get(name)!;
}

export async function withCircuitBreaker<T>(
  name: string,
  fn: () => Promise<T>
): Promise<T> {
  const breaker = getBreaker(name);
  // Check BEFORE firing — if already open, fail fast with a clear error
  if (breaker.opened) throw new CircuitOpenError(name);
  try {
    return await breaker.fire(fn) as T;
  } catch (err) {
    // Re-throw as CircuitOpenError only if the circuit transitioned to open
    if (breaker.opened) throw new CircuitOpenError(name);
    throw err;
  }
}

export function resetBreaker(name: string): void {
  breakers.delete(name);
}
