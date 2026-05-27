import { describe, it, expect } from "vitest";
import {
  normalizeCompany,
  normalizePerson,
  normalizeWebResults,
  type CompanyProfile,
  type PersonProfile,
  type WebResults,
} from "@/lib/orthogonal/normalizer";

describe("normalizeCompany", () => {
  const rawCompany = {
    name: "Stripe",
    domain: "stripe.com",
    industry: "Finance",
    employees: "5K-10K",
    description: "Stripe is a payment infrastructure company.",
    location: { country: { name: "Ireland" }, city: "Dublin" },
    financial: { total_funding: 9500000000, funding_stage: "secondary_market" },
    technologies: ["AWS", "Nginx"],
    socials: {
      linkedin_url: "https://linkedin.com/company/stripe",
      twitter_url: "https://twitter.com/stripe",
    },
    founded_year: 2010,
  };

  it("returns a CompanyProfile with required fields", () => {
    const profile: CompanyProfile = normalizeCompany(rawCompany);
    expect(profile.name).toBe("Stripe");
    expect(profile.domain).toBe("stripe.com");
    expect(profile.industry).toBe("Finance");
    expect(profile.employees).toBe("5K-10K");
  });

  it("formats funding as a readable string", () => {
    const profile = normalizeCompany(rawCompany);
    expect(profile.totalFunding).toBe("$9.5B");
  });

  it("includes top technologies up to 5", () => {
    const raw = { ...rawCompany, technologies: ["AWS", "Nginx", "React", "Node", "Postgres", "Redis"] };
    const profile = normalizeCompany(raw);
    expect(profile.topTech.length).toBeLessThanOrEqual(5);
  });

  it("handles missing optional fields gracefully", () => {
    const minimal = { name: "Acme", domain: "acme.com" };
    const profile = normalizeCompany(minimal);
    expect(profile.name).toBe("Acme");
    expect(profile.totalFunding).toBeNull();
    expect(profile.topTech).toEqual([]);
  });

  it("includes linkedin URL from socials", () => {
    const profile = normalizeCompany(rawCompany);
    expect(profile.linkedinUrl).toBe("https://linkedin.com/company/stripe");
  });
});

describe("normalizePerson", () => {
  const rawPerson = {
    full_name: "Patrick Collison",
    email: "patrick@stripe.com",
    linkedin_url: "https://linkedin.com/in/patrickcollison",
    title: "CEO",
    company: "Stripe",
    location: "San Francisco, CA",
    profiles: [{ network: "email", value: "patrick@stripe.com" }],
  };

  it("returns a PersonProfile with required fields", () => {
    const profile: PersonProfile = normalizePerson(rawPerson);
    expect(profile.name).toBe("Patrick Collison");
    expect(profile.title).toBe("CEO");
    expect(profile.company).toBe("Stripe");
  });

  it("extracts email from profiles if not at top level", () => {
    const raw = { ...rawPerson, email: undefined, profiles: [{ network: "email", value: "p@stripe.com" }] };
    const profile = normalizePerson(raw);
    expect(profile.email).toBe("p@stripe.com");
  });

  it("handles missing optional fields gracefully", () => {
    const minimal = { full_name: "Jane Doe" };
    const profile = normalizePerson(minimal);
    expect(profile.name).toBe("Jane Doe");
    expect(profile.email).toBeNull();
    expect(profile.linkedinUrl).toBeNull();
  });
});

describe("normalizeWebResults", () => {
  const rawResults = {
    results: [
      {
        url: "https://example.com/article",
        title: "Stripe raises $1B",
        content: "Stripe announced a new funding round totaling $1 billion.",
      },
      {
        url: "https://news.com/story",
        title: "Stripe expands to Asia",
        content: "Stripe is expanding its operations into new Asian markets.",
      },
    ],
  };

  it("returns a WebResults with array of results", () => {
    const normalized: WebResults = normalizeWebResults(rawResults);
    expect(normalized.results.length).toBe(2);
  });

  it("each result has url, title, and snippet", () => {
    const normalized = normalizeWebResults(rawResults);
    const first = normalized.results[0];
    expect(first.url).toBe("https://example.com/article");
    expect(first.title).toBe("Stripe raises $1B");
    expect(first.snippet).toBeDefined();
    expect(first.snippet.length).toBeGreaterThan(0);
  });

  it("truncates long content to a reasonable snippet length", () => {
    const longContent = "A".repeat(1000);
    const raw = { results: [{ url: "https://x.com", title: "Test", content: longContent }] };
    const normalized = normalizeWebResults(raw);
    expect(normalized.results[0].snippet.length).toBeLessThanOrEqual(300);
  });

  it("handles empty results gracefully", () => {
    const normalized = normalizeWebResults({ results: [] });
    expect(normalized.results).toEqual([]);
  });
});
