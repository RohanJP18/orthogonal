import { buildTool, runOrthogonal, type OpenAITool, type OrthogonalResponse } from "./client";
import { normalizeCompany, normalizePerson, normalizeWebResults, normalizePeopleSearch } from "./normalizer";
import { getCacheKey, withOrthogonalCache, TTL } from "@/lib/cache/orthogonal-cache";

// F4: get_company — uses Orthogonal's company-enrich API (confirmed working)
const getCompany = buildTool({
  name: "get_company",
  description:
    "Enrich a company profile. Returns firmographic data, funding info, headcount, tech stack, and social links. Use when the user asks about a company. IMPORTANT: always provide 'domain' when you can infer it (e.g. stripe.com, plaid.com, openai.com). The API returns 400 if only 'name' is given and no domain is provided.",
  parameters: {
    type: "object",
    properties: {
      domain: {
        type: "string",
        description: "Company domain — REQUIRED whenever you can infer it (e.g. stripe.com, plaid.com). Strongly preferred over name alone.",
      },
      name: {
        type: "string",
        description: "Company name — only use if you genuinely cannot infer the domain.",
      },
    },
    required: [],
  },
  execute: async (params, opts): Promise<OrthogonalResponse<unknown>> => {
    const key = getCacheKey("company-enrich", "/companies/enrich", params as Record<string, unknown>);
    return withOrthogonalCache(key, TTL.company, async () => {
      const res = await runOrthogonal({
        api: "company-enrich",
        path: "/companies/enrich",
        query: params as Record<string, string>,
      });
      return { ...res, data: normalizeCompany(res.data as Record<string, unknown>) };
    }, opts?.bypassCache);
  },
});

// F4: enrich_person — uses Orthogonal's hunter API (email-finder by name+domain)
// Note: contactout /people/enrich is not a valid Orthogonal endpoint; hunter /v2/email-finder is.
const enrichPerson = buildTool({
  name: "enrich_person",
  description:
    "Find contact details for a person by name and company domain. Returns email address, job title, LinkedIn URL, and phone. Use when the user wants to find someone's contact info or email at a company.",
  parameters: {
    type: "object",
    properties: {
      first_name: {
        type: "string",
        description: "Person's first name",
      },
      last_name: {
        type: "string",
        description: "Person's last name",
      },
      domain: {
        type: "string",
        description: "Company domain where the person works (e.g. stripe.com)",
      },
    },
    required: ["domain"],
  },
  execute: async (params, opts): Promise<OrthogonalResponse<unknown>> => {
    const key = getCacheKey("hunter", "/v2/email-finder", params as Record<string, unknown>);
    return withOrthogonalCache(key, TTL.person, async () => {
      const res = await runOrthogonal({
        api: "hunter",
        path: "/v2/email-finder",
        query: Object.assign(
          { domain: params.domain as string },
          params.first_name ? { first_name: params.first_name as string } : {},
          params.last_name ? { last_name: params.last_name as string } : {}
        ),
      });
      return { ...res, data: normalizePerson(res.data as Record<string, unknown>) };
    }, opts?.bypassCache);
  },
});

// F4: web_search — uses Orthogonal's scrapegraphai API for search results
const webSearch = buildTool({
  name: "web_search",
  description:
    "Search the web for recent news, articles, or information about any topic. Use when the user needs fresh, current data that isn't available through company or contact enrichment.",
  parameters: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "Search query — be specific for best results",
      },
      numResults: {
        type: "number",
        description: "Number of results to return (default 3, max 10)",
      },
    },
    required: ["query"],
  },
  execute: async (params, opts): Promise<OrthogonalResponse<unknown>> => {
    const key = getCacheKey("scrapegraphai", "/api/search", { query: params.query });
    return withOrthogonalCache(key, TTL.web, async () => {
      const res = await runOrthogonal({
        api: "scrapegraphai",
        path: "/api/search",
        body: {
          query: params.query as string,
          numResults: (params.numResults as number) ?? 3,
        },
      });
      return { ...res, data: normalizeWebResults(res.data as Record<string, unknown>) };
    }, opts?.bypassCache);
  },
});

// F4: scrape_page — uses Orthogonal's notte API to scrape a specific URL to markdown
const scrapePage = buildTool({
  name: "scrape_page",
  description:
    "Scrape and extract the content of a specific webpage as clean markdown. Use when the user provides a URL to read, or when you need to get full content from a specific page (e.g. a company's about page, a LinkedIn profile, a news article).",
  parameters: {
    type: "object",
    properties: {
      url: {
        type: "string",
        description: "Full URL of the page to scrape (must start with https://)",
      },
    },
    required: ["url"],
  },
  execute: async (params, opts): Promise<OrthogonalResponse<unknown>> => {
    const key = getCacheKey("notte", "/scrape", { url: params.url });
    return withOrthogonalCache(key, TTL.web, async () => {
      const res = await runOrthogonal({
        api: "notte",
        path: "/scrape",
        body: { url: params.url as string },
      });
      // notte returns { markdown: string } — wrap as WebResults for consistent rendering
      const markdown = (res.data as Record<string, unknown>)?.markdown as string ?? "";
      return {
        ...res,
        data: {
          results: [{
            url: params.url as string,
            title: "Scraped page",
            snippet: markdown.slice(0, 1000),
          }],
        },
      };
    }, opts?.bypassCache);
  },
});

// search_people — uses company-enrich /people/search (same API as get_company)
const searchPeople = buildTool({
  name: "search_people",
  description:
    "Search for people by company, job title, department, or seniority. Returns a list of matching professionals with name, title, LinkedIn URL, and location. Use when the user wants to find multiple people at a company or search by role. Prefer passing 'domains' when you know the company domain (e.g. notion.so); use 'query' for company name when you don't.",
  parameters: {
    type: "object",
    properties: {
      domains: {
        type: "string",
        description: "Comma-separated company domains to search within (e.g. 'notion.so,notion.com'). Preferred over query when known.",
      },
      query: {
        type: "string",
        description: "Company name search query — use when you don't know the exact domain (e.g. 'Notion')",
      },
      positionQuery: {
        type: "string",
        description: "Comma-separated job title keywords to filter by (e.g. 'engineer,software engineer' or 'Head of Sales')",
      },
      pageSize: {
        type: "number",
        description: "Number of results to return (default 10, max 25)",
      },
    },
    required: [],
  },
  execute: async (params, opts): Promise<OrthogonalResponse<unknown>> => {
    const pageSize = Math.min((params.pageSize as number) ?? 10, 25);
    const body: Record<string, unknown> = { page: 1, pageSize };
    if (params.domains) body.domains = (params.domains as string).split(",").map((d) => d.trim());
    if (params.query) body.query = params.query;
    if (params.positionQuery) body.positionQuery = (params.positionQuery as string).split(",").map((t) => t.trim());

    const key = getCacheKey("company-enrich", "/people/search", body as Record<string, unknown>);
    return withOrthogonalCache(key, TTL.person, async () => {
      const res = await runOrthogonal({
        api: "company-enrich",
        path: "/people/search",
        body,
      });
      return { ...res, data: normalizePeopleSearch(res.data as Record<string, unknown>) };
    }, opts?.bypassCache);
  },
});

export const TOOLS: OpenAITool[] = [getCompany, enrichPerson, webSearch, scrapePage, searchPeople];

export function getToolByName(name: string): OpenAITool | undefined {
  return TOOLS.find((t) => t.function.name === name);
}

export function getOpenAIToolSchemas() {
  return TOOLS.map(({ execute: _execute, ...rest }) => rest);
}
