import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock Redis before any imports so Upstash doesn't call fetch internally
vi.mock("@/lib/cache/redis", () => ({
  redis: { get: vi.fn().mockResolvedValue(null), set: vi.fn().mockResolvedValue("OK") },
}));

import { TOOLS, getToolByName, getOpenAIToolSchemas } from "@/lib/orthogonal/tools";

const mockFetch = vi.fn();
global.fetch = mockFetch;

describe("tool registry", () => {
  it("has at least 3 tools", () => {
    expect(TOOLS.length).toBeGreaterThanOrEqual(3);
  });

  it("all tools have type=function", () => {
    for (const t of TOOLS) {
      expect(t.type).toBe("function");
    }
  });

  it("has get_company tool", () => {
    const tool = getToolByName("get_company");
    expect(tool).toBeDefined();
    expect(tool?.function.name).toBe("get_company");
  });

  it("has enrich_person tool", () => {
    const tool = getToolByName("enrich_person");
    expect(tool).toBeDefined();
    expect(tool?.function.name).toBe("enrich_person");
  });

  it("has web_search tool", () => {
    const tool = getToolByName("web_search");
    expect(tool).toBeDefined();
    expect(tool?.function.name).toBe("web_search");
  });

  it("getToolByName returns undefined for unknown tool", () => {
    expect(getToolByName("nonexistent_tool")).toBeUndefined();
  });

  it("each tool has required parameters defined", () => {
    for (const t of TOOLS) {
      expect(t.function.parameters.type).toBe("object");
      expect(t.function.parameters.properties).toBeDefined();
    }
  });
});

describe("getOpenAIToolSchemas", () => {
  it("returns schemas without execute function", () => {
    const schemas = getOpenAIToolSchemas();
    for (const schema of schemas) {
      expect(schema).not.toHaveProperty("execute");
    }
  });

  it("returns the correct number of schemas", () => {
    const schemas = getOpenAIToolSchemas();
    expect(schemas.length).toBe(TOOLS.length);
  });
});

describe("tool execute functions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.ORTHOGONAL_API_KEY = "test-key";
  });

  it("get_company calls company-enrich API with domain", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true, priceCents: 1.225, data: { name: "Acme" }, requestId: "r1" }),
    });

    const tool = getToolByName("get_company")!;
    const result = await tool.execute({ domain: "acme.com" });

    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe("https://api.orthogonal.com/v1/run");
    const body = JSON.parse(opts.body);
    expect(body.api).toBe("company-enrich");
    expect(body.query?.domain).toBe("acme.com");
    expect((result as { priceCents: number }).priceCents).toBe(1.225);
  });

  it("web_search calls scrapegraphai API with query in body", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true, priceCents: 3, data: { results: [] }, requestId: "r2" }),
    });

    const tool = getToolByName("web_search")!;
    await tool.execute({ query: "OpenAI news" });

    const [, opts] = mockFetch.mock.calls[0];
    const reqBody = JSON.parse(opts.body);
    expect(reqBody.api).toBe("scrapegraphai");
    expect(reqBody.body?.query).toBe("OpenAI news");
  });

  it("enrich_person calls contactout API with array company_domain", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true, priceCents: 55, data: { profiles: [] }, requestId: "r3" }),
    });

    const tool = getToolByName("enrich_person")!;
    await tool.execute({ full_name: "Patrick Collison", company_domain: "stripe.com" });

    const [, opts] = mockFetch.mock.calls[0];
    const reqBody = JSON.parse(opts.body);
    expect(reqBody.api).toBe("contactout");
    expect(Array.isArray(reqBody.body?.company_domain)).toBe(true);
  });
});
