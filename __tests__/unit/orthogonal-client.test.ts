import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  runOrthogonal,
  buildTool,
  OrthogonalError,
} from "@/lib/orthogonal/client";

const mockFetch = vi.fn();
global.fetch = mockFetch;

const ORTHOGONAL_RUN_URL = "https://api.orthogonal.com/v1/run";

describe("runOrthogonal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.ORTHOGONAL_API_KEY = "test-key";
  });

  it("POSTs to /v1/run with correct api and path", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true, priceCents: 1.225, data: { name: "Stripe" }, requestId: "req_1" }),
    });

    await runOrthogonal({ api: "company-enrich", path: "/companies/enrich", query: { domain: "stripe.com" } });

    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe(ORTHOGONAL_RUN_URL);
    expect(opts.method).toBe("POST");
    const body = JSON.parse(opts.body);
    expect(body.api).toBe("company-enrich");
    expect(body.path).toBe("/companies/enrich");
    expect(body.query).toEqual({ domain: "stripe.com" });
  });

  it("includes body param for body-based APIs", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true, priceCents: 3, data: { results: [] }, requestId: "req_2" }),
    });

    await runOrthogonal({ api: "scrapegraphai", path: "/api/search", body: { query: "Stripe news" } });

    const [, opts] = mockFetch.mock.calls[0];
    const body = JSON.parse(opts.body);
    expect(body.body).toEqual({ query: "Stripe news" });
    expect(body.query).toBeUndefined();
  });

  it("returns data and priceCents from successful response", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true, priceCents: 1.225, data: { name: "Acme" }, requestId: "req_3" }),
    });

    const result = await runOrthogonal({ api: "company-enrich", path: "/companies/enrich", query: { domain: "acme.com" } });

    expect(result.data).toEqual({ name: "Acme" });
    expect(result.priceCents).toBe(1.225);
    expect(result.requestId).toBe("req_3");
  });

  it("throws OrthogonalError when success=false", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: false, error: "INSUFFICIENT_CREDITS", data: null, requestId: "req_4" }),
    });

    await expect(
      runOrthogonal({ api: "company-enrich", path: "/companies/enrich", query: { domain: "acme.com" } })
    ).rejects.toBeInstanceOf(OrthogonalError);
  });

  it("throws OrthogonalError on HTTP error response", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 401,
      json: async () => ({ error: "UNAUTHORIZED" }),
    });

    await expect(
      runOrthogonal({ api: "company-enrich", path: "/companies/enrich" })
    ).rejects.toBeInstanceOf(OrthogonalError);
  });

  it("throws OrthogonalError on network failure", async () => {
    mockFetch.mockRejectedValueOnce(new Error("network error"));

    await expect(
      runOrthogonal({ api: "company-enrich", path: "/companies/enrich" })
    ).rejects.toBeInstanceOf(OrthogonalError);
  });

  it("throws OrthogonalError when API key is missing", async () => {
    delete process.env.ORTHOGONAL_API_KEY;

    await expect(
      runOrthogonal({ api: "company-enrich", path: "/companies/enrich" })
    ).rejects.toBeInstanceOf(OrthogonalError);
  });

  it("sends Authorization header with Bearer token", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true, priceCents: 0, data: {}, requestId: "req_5" }),
    });

    await runOrthogonal({ api: "company-enrich", path: "/companies/enrich" });

    const [, opts] = mockFetch.mock.calls[0];
    expect(opts.headers["Authorization"]).toBe("Bearer test-key");
  });
});

describe("buildTool", () => {
  it("creates an OpenAI-compatible tool definition", () => {
    const tool = buildTool({
      name: "get_company",
      description: "Enrich a company by domain",
      parameters: {
        type: "object",
        properties: {
          domain: { type: "string", description: "Company domain" },
        },
        required: ["domain"],
      },
      execute: async () => ({ data: {}, priceCents: 0, requestId: "r" }),
    });

    expect(tool.type).toBe("function");
    expect(tool.function.name).toBe("get_company");
    expect(tool.function.parameters.required).toContain("domain");
    expect(typeof tool.execute).toBe("function");
  });

  it("strips execute from the function schema", () => {
    const tool = buildTool({
      name: "test_tool",
      description: "A test tool",
      parameters: { type: "object", properties: {}, required: [] },
      execute: async () => ({ data: null, priceCents: 0, requestId: "r" }),
    });

    const schema = { type: tool.type, function: tool.function };
    expect(schema).not.toHaveProperty("execute");
  });
});
