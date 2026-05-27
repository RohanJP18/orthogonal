import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  buildSystemPrompt,
  encodeSSE,
  parseSSEEvent,
  type SSEEvent,
} from "@/lib/llm/orchestrator";

describe("buildSystemPrompt", () => {
  it("includes the current date", () => {
    const prompt = buildSystemPrompt();
    expect(prompt).toContain(new Date().getFullYear().toString());
  });

  it("mentions Orthogonal tools", () => {
    const prompt = buildSystemPrompt();
    expect(prompt.toLowerCase()).toContain("orthogonal");
  });

  it("instructs when to use tools vs knowledge", () => {
    const prompt = buildSystemPrompt();
    expect(prompt.toLowerCase()).toMatch(/tool|function/);
  });

  it("includes optional summary context when provided", () => {
    const prompt = buildSystemPrompt("Prior summary: user asked about Acme Corp.");
    expect(prompt).toContain("Prior summary");
  });
});

describe("encodeSSE", () => {
  it("formats a delta event correctly", () => {
    const event: SSEEvent = { type: "delta", content: "Hello" };
    const encoded = encodeSSE(event);
    expect(encoded).toContain("data:");
    expect(encoded).toContain('"type":"delta"');
    expect(encoded).toContain('"content":"Hello"');
    expect(encoded.endsWith("\n\n")).toBe(true);
  });

  it("formats a done event correctly", () => {
    const event: SSEEvent = { type: "done" };
    const encoded = encodeSSE(event);
    expect(encoded).toContain('"type":"done"');
  });

  it("formats an error event correctly", () => {
    const event: SSEEvent = { type: "error", message: "Something went wrong" };
    const encoded = encodeSSE(event);
    expect(encoded).toContain('"type":"error"');
    expect(encoded).toContain('"message":"Something went wrong"');
  });
});

describe("parseSSEEvent", () => {
  it("parses a valid data line", () => {
    const line = 'data: {"type":"delta","content":"Hi"}';
    const parsed = parseSSEEvent(line);
    expect(parsed).toEqual({ type: "delta", content: "Hi" });
  });

  it("returns null for non-data lines", () => {
    expect(parseSSEEvent("")).toBeNull();
    expect(parseSSEEvent(": keep-alive")).toBeNull();
  });

  it("returns null for malformed JSON", () => {
    expect(parseSSEEvent("data: {bad json}")).toBeNull();
  });
});
