import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

describe("env validation", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("passes with all required server env vars set", async () => {
    process.env.DATABASE_URL = "postgresql://test";
    process.env.OPENAI_API_KEY = "sk-test";
    process.env.ORTHOGONAL_API_KEY = "orth-test";
    process.env.CLERK_SECRET_KEY = "clerk-test";
    const { serverEnv } = await import("@/lib/env");
    expect(serverEnv.DATABASE_URL).toBe("postgresql://test");
    expect(serverEnv.OPENAI_API_KEY).toBe("sk-test");
  });

  it("throws when a required server var is missing", async () => {
    delete process.env.DATABASE_URL;
    await expect(import("@/lib/env")).rejects.toThrow();
  });
});
