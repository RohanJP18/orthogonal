export interface CompanyProfile {
  name: string;
  domain: string | null;
  industry: string | null;
  employees: string | null;
  description: string | null;
  location: string | null;
  totalFunding: string | null;
  fundingStage: string | null;
  foundedYear: number | null;
  topTech: string[];
  linkedinUrl: string | null;
  twitterUrl: string | null;
}

export interface PersonProfile {
  name: string;
  title: string | null;
  company: string | null;
  email: string | null;
  phone: string | null;
  linkedinUrl: string | null;
  location: string | null;
}

export interface WebResult {
  url: string;
  title: string;
  snippet: string;
}

export interface WebResults {
  results: WebResult[];
}

export interface PersonSearchResult {
  name: string;
  title: string | null;
  company: string | null;
  companyDomain: string | null;
  email: string | null;
  linkedinUrl: string | null;
  location: string | null;
  seniority: string | null;
}

export interface PeopleSearchResults {
  people: PersonSearchResult[];
  total: number;
}

function formatFunding(cents: number | null | undefined): string | null {
  if (cents == null || cents <= 0) return null;
  if (cents >= 1_000_000_000) return `$${(cents / 1_000_000_000).toFixed(1)}B`;
  if (cents >= 1_000_000) return `$${(cents / 1_000_000).toFixed(0)}M`;
  return `$${(cents / 1_000).toFixed(0)}K`;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function normalizeCompany(raw: Record<string, any>): CompanyProfile {
  const loc = raw.location;
  const locationStr = loc
    ? [loc.city, loc.state?.name ?? loc.state, loc.country?.name ?? loc.country]
        .filter(Boolean)
        .join(", ") || null
    : null;

  return {
    name: raw.name ?? "Unknown",
    domain: raw.domain ?? null,
    industry: raw.industry ?? null,
    employees: raw.employees ?? null,
    description: raw.description ?? null,
    location: locationStr,
    totalFunding: formatFunding(raw.financial?.total_funding),
    fundingStage: raw.financial?.funding_stage ?? null,
    foundedYear: raw.founded_year ?? null,
    topTech: Array.isArray(raw.technologies) ? raw.technologies.slice(0, 5) : [],
    linkedinUrl: raw.socials?.linkedin_url ?? null,
    twitterUrl: raw.socials?.twitter_url ?? null,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function normalizePerson(raw: Record<string, any>): PersonProfile {
  // Handle Hunter.io response shape: { data: { first_name, last_name, email, position, ... } }
  const d = raw.data && typeof raw.data === "object" ? raw.data : raw;

  const emailFromProfiles = Array.isArray(d.profiles)
    ? d.profiles.find((p: { network: string; value: string }) => p.network === "email")?.value ?? null
    : null;

  const fullName =
    d.full_name ??
    d.name ??
    ([d.first_name, d.last_name].filter(Boolean).join(" ") || null) ??
    "Unknown";

  return {
    name: fullName,
    title: d.position ?? d.title ?? null,
    company: d.company ?? null,
    email: d.email ?? emailFromProfiles ?? null,
    phone: d.phone_number ?? d.phone ?? null,
    linkedinUrl: d.linkedin_url ?? null,
    location: d.location ?? null,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function normalizePeopleSearch(raw: Record<string, any>): PeopleSearchResults {
  // company-enrich /people/search response: { items: [...], totalItems, totalPages }
  const items = Array.isArray(raw.items) ? raw.items : [];
  const total = raw.totalItems ?? items.length;

  return {
    total,
    people: items.map((p: Record<string, unknown>) => {
      const socials = p.socials as Record<string, unknown> | null | undefined;
      const location = p.location as Record<string, unknown> | null | undefined;
      return {
        name: (p.name as string) ?? ([p.first_name, p.last_name].filter(Boolean).join(" ") || "Unknown"),
        title: (p.position as string) ?? null,
        company: null, // not in top-level; caller knows the company they searched for
        companyDomain: null,
        email: null, // not returned by people search; use enrich_person for email
        linkedinUrl: (socials?.linkedin_url as string) ?? null,
        location: (location?.address as string) ?? null,
        seniority: (p.seniority as string) ?? null,
      } satisfies PersonSearchResult;
    }),
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function normalizeWebResults(raw: Record<string, any>): WebResults {
  const items = Array.isArray(raw.results) ? raw.results : [];
  return {
    results: items.map((r: { url?: string; title?: string; content?: string }) => ({
      url: r.url ?? "",
      title: r.title ?? "",
      snippet: (r.content ?? "").slice(0, 300),
    })),
  };
}
