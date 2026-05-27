/**
 * Requirement 1: Context window management
 *
 * "As you build and use your chat, you'll notice the context window fills up,
 * both from API responses and from conversation history. How does your app handle this?"
 *
 * Validates:
 *  - Token budget is enforced (history trimming)
 *  - Tool results are normalized to compact form before entering context
 *  - Summarization fires when conversation grows large
 *  - Budget percentages match the spec (15/35/35/15%)
 */

import { describe, it, expect } from "vitest";
import {
  trimHistory,
  estimateTokens,
  buildContextBudget,
  CONTEXT_BUDGETS,
  messagesToChatMessages,
} from "@/lib/llm/context-manager";
import { normalizeCompany, normalizeWebResults } from "@/lib/orthogonal/normalizer";
import { shouldSummarize } from "@/lib/queue/summarization";
import type { Message } from "@/lib/db/schema";

function makeMsg(role: string, content: string, id = crypto.randomUUID()): Message {
  return {
    id,
    conversationId: "conv-1",
    role,
    content,
    toolName: null,
    toolCallId: null,
    storageKey: null,
    orthogonalCostCents: 0,
    llmPromptTokens: 0,
    llmCompletionTokens: 0,
    createdAt: new Date(),
  };
}

// ─── Token budget percentages ────────────────────────────────────────────────

describe("Req1 — budget percentages match spec (15/35/35/15%)", () => {
  it("gpt-4.1 budget sums to 100%", () => {
    const b = buildContextBudget(1_047_576);
    const total = b.systemAndTools + b.recentHistory + b.orthogonalSnippets + b.semanticMemory;
    // Allow 4 tokens of rounding loss from Math.floor
    expect(total).toBeGreaterThan(1_047_576 * 0.99);
    expect(total).toBeLessThanOrEqual(1_047_576);
  });

  it("history budget is ~35% of total", () => {
    const b = buildContextBudget(100_000);
    expect(b.recentHistory).toBeGreaterThanOrEqual(34_000);
    expect(b.recentHistory).toBeLessThanOrEqual(36_000);
  });

  it("CONTEXT_BUDGETS contains gpt-4.1-mini", () => {
    // gpt-4.1-mini is our default model
    expect(CONTEXT_BUDGETS["gpt-4.1-mini"]).toBeDefined();
  });
});

// ─── History trimming ────────────────────────────────────────────────────────

describe("Req1 — history trimming stays within token budget", () => {
  it("returns all messages when they fit within budget", () => {
    const msgs = Array.from({ length: 5 }, (_, i) =>
      makeMsg("user", `Message ${i}`)
    );
    const result = trimHistory(msgs, 10_000);
    expect(result.length).toBe(5);
  });

  it("drops oldest messages when budget is exceeded", () => {
    // Each message ~25 chars ≈ 7 tokens; budget allows ~3
    const msgs = Array.from({ length: 10 }, (_, i) =>
      makeMsg("user", `This is message number ${i}`)
    );
    const result = trimHistory(msgs, 50); // very tight budget
    expect(result.length).toBeLessThan(10);
    // Most recent message is always included
    expect(result[result.length - 1].content).toBe("This is message number 9");
  });

  it("always keeps the last message even if it alone exceeds budget", { timeout: 15_000 }, () => {
    const msgs = [makeMsg("user", "A".repeat(10_000))];
    const result = trimHistory(msgs, 10); // budget too small
    expect(result.length).toBe(1);
  });

  it("returns empty array for empty input", () => {
    expect(trimHistory([], 10_000)).toEqual([]);
  });

  it("trimmed history total tokens stay within budget", () => {
    const msgs = Array.from({ length: 20 }, (_, i) =>
      makeMsg(i % 2 === 0 ? "user" : "assistant", `Word `.repeat(50))
    );
    const budget = 200;
    const result = trimHistory(msgs, budget);
    const totalTokens = result.reduce(
      (sum, m) => sum + estimateTokens(m.content ?? ""),
      0
    );
    // Last message may exceed budget alone — that's the only exception
    if (result.length > 1) {
      expect(totalTokens).toBeLessThanOrEqual(budget + estimateTokens(result[result.length - 1].content ?? ""));
    }
  });
});

// ─── Tool result normalization (compact context) ─────────────────────────────

describe("Req1 — tool results normalized to compact form before entering context", () => {
  it("normalizeWebResults output is much smaller than raw scrapegraphai response", () => {
    // Simulate the kind of huge response scrapegraphai actually returns
    const rawResponse = {
      id: "abc",
      results: Array.from({ length: 3 }, (_, i) => ({
        url: `https://example.com/article-${i}`,
        title: `Article ${i}`,
        content: "A".repeat(5000), // 5KB per result = 15KB total
      })),
    };
    const normalized = normalizeWebResults(rawResponse);
    const normalizedJson = JSON.stringify(normalized);
    const rawJson = JSON.stringify(rawResponse);

    expect(normalizedJson.length).toBeLessThan(rawJson.length * 0.1); // >90% reduction
    expect(normalized.results.length).toBe(3);
    expect(normalized.results[0].snippet.length).toBeLessThanOrEqual(300);
  });

  it("normalizeCompany drops noise fields and keeps key business data", () => {
    const rawCompany = {
      name: "Stripe",
      domain: "stripe.com",
      industry: "Finance",
      employees: "5K-10K",
      description: "Payment infrastructure",
      naics_codes: ["522320", "522330"], // noise — not in view model
      page_rank: 7.511, // noise
      seo_description: "A".repeat(2000), // noise
      keywords: Array.from({ length: 50 }, (_, i) => `keyword-${i}`), // noise
      technologies: ["AWS", "Nginx", "React", "Node", "Redis", "Kafka", "Spark"],
      financial: { total_funding: 9_500_000_000 },
      socials: { linkedin_url: "https://linkedin.com/company/stripe" },
      location: { country: { name: "Ireland" }, city: "Dublin" },
    };
    const profile = normalizeCompany(rawCompany);
    const profileJson = JSON.stringify(profile);
    const rawJson = JSON.stringify(rawCompany);

    expect(profileJson.length).toBeLessThan(rawJson.length);
    expect(profile.topTech.length).toBeLessThanOrEqual(5); // capped
    expect(profile.totalFunding).toBe("$9.5B"); // human-readable
    // seo_description and keywords should NOT be in the output
    expect(profileJson).not.toContain("seo_description");
    expect(profileJson).not.toContain("page_rank");
  });
});

// ─── Summarization threshold ─────────────────────────────────────────────────

describe("Req1 — summarization compresses long conversations", () => {
  it("does not trigger below threshold (< 20 messages)", () => {
    expect(shouldSummarize(19, 0)).toBe(false);
    expect(shouldSummarize(0, 0)).toBe(false);
  });

  it("triggers when conversation exceeds 20 messages and no recent summary", () => {
    expect(shouldSummarize(20, 0)).toBe(true);
    expect(shouldSummarize(50, 0)).toBe(true);
  });

  it("skips re-summarization within 30-minute cooldown", () => {
    const recentSummaryAt = new Date(Date.now() - 10 * 60 * 1000); // 10 min ago
    expect(shouldSummarize(50, 0, recentSummaryAt)).toBe(false);
  });

  it("re-summarizes after cooldown expires", () => {
    const oldSummaryAt = new Date(Date.now() - 31 * 60 * 1000); // 31 min ago
    expect(shouldSummarize(50, 0, oldSummaryAt)).toBe(true);
  });
});

// ─── messagesToChatMessages ───────────────────────────────────────────────────

describe("Req1 — history messages convert to valid OpenAI format", () => {
  it("converts user and assistant messages correctly", () => {
    const msgs = [
      makeMsg("user", "Hello"),
      makeMsg("assistant", "Hi there"),
    ];
    const chat = messagesToChatMessages(msgs);
    expect(chat[0]).toMatchObject({ role: "user", content: "Hello" });
    expect(chat[1]).toMatchObject({ role: "assistant", content: "Hi there" });
  });

  it("preserves tool_call_id for tool messages", () => {
    const msg = { ...makeMsg("tool", "result"), toolCallId: "tc_123" };
    const chat = messagesToChatMessages([msg]);
    expect(chat[0].tool_call_id).toBe("tc_123");
  });
});
