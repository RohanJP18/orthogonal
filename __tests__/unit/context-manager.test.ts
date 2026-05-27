import { describe, it, expect } from "vitest";
import {
  estimateTokens,
  trimHistory,
  buildContextBudget,
  CONTEXT_BUDGETS,
} from "@/lib/llm/context-manager";

describe("estimateTokens", () => {
  it("returns a positive number for non-empty string", () => {
    expect(estimateTokens("hello world")).toBeGreaterThan(0);
  });

  it("returns 0 for empty string", () => {
    expect(estimateTokens("")).toBe(0);
  });

  it("scales roughly with text length", () => {
    const short = estimateTokens("hello");
    const long = estimateTokens("hello world this is a longer string with more tokens");
    expect(long).toBeGreaterThan(short);
  });
});

describe("buildContextBudget", () => {
  it("budgets add up to <= maxContext", () => {
    const budget = buildContextBudget(128_000);
    const total =
      budget.systemAndTools +
      budget.recentHistory +
      budget.orthogonalSnippets +
      budget.semanticMemory;
    expect(total).toBeLessThanOrEqual(128_000);
  });

  it("respects the percentages from the spec", () => {
    const budget = buildContextBudget(100_000);
    expect(budget.systemAndTools).toBe(15_000);
    expect(budget.recentHistory).toBe(35_000);
    expect(budget.orthogonalSnippets).toBe(35_000);
    expect(budget.semanticMemory).toBe(15_000);
  });
});

describe("trimHistory", () => {
  const makeMsg = (content: string, role = "user") => ({
    role,
    content,
    id: Math.random().toString(),
    conversationId: "c1",
    toolName: null,
    toolCallId: null,
    orthogonalCostCents: 0,
    llmPromptTokens: 0,
    llmCompletionTokens: 0,
    storageKey: null,
    createdAt: new Date(),
  });

  it("returns all messages when they fit in budget", () => {
    const msgs = [makeMsg("hi"), makeMsg("hello")];
    const trimmed = trimHistory(msgs, 10_000);
    expect(trimmed).toHaveLength(2);
  });

  it("trims oldest messages first when over budget", () => {
    const msgs = [
      makeMsg("This is the oldest message"),
      makeMsg("This is the newest message"),
    ];
    // Budget of 3 — too small to add a second message after the first (tiktoken exact counts)
    const trimmed = trimHistory(msgs, 3);
    expect(trimmed).toHaveLength(1);
    expect(trimmed[0].content).toBe("This is the newest message");
  });

  it("always keeps at least the last message", () => {
    const msgs = [makeMsg("a"), makeMsg("b"), makeMsg("c")];
    const trimmed = trimHistory(msgs, 0);
    expect(trimmed).toHaveLength(1);
    expect(trimmed[0].content).toBe("c");
  });
});

describe("CONTEXT_BUDGETS", () => {
  it("exports standard model budgets", () => {
    expect(CONTEXT_BUDGETS["gpt-4.1"]).toBeDefined();
    expect(CONTEXT_BUDGETS["gpt-4o-mini"]).toBeDefined();
  });
});
