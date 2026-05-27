import { describe, it, expect } from "vitest";
import {
  users,
  conversations,
  messages,
  summaries,
} from "@/lib/db/schema";

describe("DB schema shape", () => {
  it("users table has expected columns", () => {
    const cols = Object.keys(users);
    expect(cols).toContain("id");
    expect(cols).toContain("clerkId");
    expect(cols).toContain("email");
    expect(cols).toContain("createdAt");
  });

  it("conversations table has expected columns", () => {
    const cols = Object.keys(conversations);
    expect(cols).toContain("id");
    expect(cols).toContain("userId");
    expect(cols).toContain("title");
    expect(cols).toContain("hardCostCentsLimit");
    expect(cols).toContain("deletedAt");
  });

  it("messages table has expected columns", () => {
    const cols = Object.keys(messages);
    expect(cols).toContain("id");
    expect(cols).toContain("conversationId");
    expect(cols).toContain("role");
    expect(cols).toContain("content");
    expect(cols).toContain("orthogonalCostCents");
    expect(cols).toContain("llmPromptTokens");
    expect(cols).toContain("llmCompletionTokens");
  });

  it("summaries table has expected columns", () => {
    const cols = Object.keys(summaries);
    expect(cols).toContain("id");
    expect(cols).toContain("conversationId");
    expect(cols).toContain("summaryText");
    expect(cols).toContain("model");
  });
});
