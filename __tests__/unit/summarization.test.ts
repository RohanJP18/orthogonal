import { describe, it, expect, vi, beforeEach } from "vitest";
import { shouldSummarize, buildSummarizationPayload } from "@/lib/queue/summarization";

describe("shouldSummarize", () => {
  it("returns false when message count is below threshold", () => {
    expect(shouldSummarize(10, 0)).toBe(false);
  });

  it("returns true when message count exceeds threshold and no recent summary", () => {
    expect(shouldSummarize(30, 0)).toBe(true);
  });

  it("returns false when a recent summary exists within cooldown", () => {
    const recentSummaryAt = new Date(Date.now() - 5 * 60 * 1000); // 5 min ago
    expect(shouldSummarize(30, 0, recentSummaryAt)).toBe(false);
  });

  it("returns true when last summary is old enough", () => {
    const oldSummaryAt = new Date(Date.now() - 60 * 60 * 1000); // 1 hour ago
    expect(shouldSummarize(30, 0, oldSummaryAt)).toBe(true);
  });
});

describe("buildSummarizationPayload", () => {
  it("returns a payload with conversationId", () => {
    const payload = buildSummarizationPayload("conv-123");
    expect(payload.conversationId).toBe("conv-123");
  });

  it("includes a timestamp", () => {
    const payload = buildSummarizationPayload("conv-123");
    expect(payload.triggeredAt).toBeDefined();
    expect(new Date(payload.triggeredAt).getTime()).not.toBeNaN();
  });
});
