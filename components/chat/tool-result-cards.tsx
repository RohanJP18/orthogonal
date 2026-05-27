"use client";

import { Building2, User, Users, Globe, ExternalLink, Banknote, MapPin, Calendar } from "lucide-react";
import type { CompanyProfile, PersonProfile, WebResults, PeopleSearchResults } from "@/lib/orthogonal/normalizer";

export function CompanyCard({ data }: { data: CompanyProfile }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-gray-50 p-4 space-y-3 text-sm">
      <div className="flex items-center gap-2">
        <Building2 className="w-4 h-4 text-gray-400 shrink-0" />
        <span className="font-semibold text-black">{data.name}</span>
        {data.domain && (
          <span className="text-xs text-gray-400">{data.domain}</span>
        )}
      </div>

      {data.description && (
        <p className="text-gray-600 leading-relaxed text-sm">{data.description}</p>
      )}

      <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs text-gray-500">
        {data.industry && <span>Industry: <strong className="text-gray-800">{data.industry}</strong></span>}
        {data.employees && <span>Employees: <strong className="text-gray-800">{data.employees}</strong></span>}
        {data.fundingStage && <span>Stage: <strong className="text-gray-800">{data.fundingStage}</strong></span>}
        {data.totalFunding && (
          <span className="flex items-center gap-1">
            <Banknote className="w-3 h-3" />
            <strong className="text-gray-800">{data.totalFunding}</strong>
          </span>
        )}
        {data.foundedYear && (
          <span className="flex items-center gap-1">
            <Calendar className="w-3 h-3" />
            <strong className="text-gray-800">{data.foundedYear}</strong>
          </span>
        )}
        {data.location && (
          <span className="flex items-center gap-1 col-span-2">
            <MapPin className="w-3 h-3" />
            <strong className="text-gray-800">{data.location}</strong>
          </span>
        )}
      </div>

      {data.topTech.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {data.topTech.map((t) => (
            <span
              key={t}
              className="px-2 py-0.5 bg-white border border-gray-200 rounded-full text-xs text-gray-600"
            >
              {t}
            </span>
          ))}
        </div>
      )}

      {data.linkedinUrl && (
        <a
          href={data.linkedinUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-xs text-blue-600 hover:underline"
        >
          <ExternalLink className="w-3 h-3" /> LinkedIn
        </a>
      )}
    </div>
  );
}

export function PersonCard({ data }: { data: PersonProfile }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-gray-50 p-4 space-y-3 text-sm">
      <div className="flex items-center gap-2">
        <User className="w-4 h-4 text-gray-400 shrink-0" />
        <span className="font-semibold text-black">{data.name}</span>
      </div>

      <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs text-gray-500">
        {data.title && <span>Title: <strong className="text-gray-800">{data.title}</strong></span>}
        {data.company && <span>Company: <strong className="text-gray-800">{data.company}</strong></span>}
        {data.email && <span>Email: <strong className="text-gray-800">{data.email}</strong></span>}
        {data.phone && <span>Phone: <strong className="text-gray-800">{data.phone}</strong></span>}
        {data.location && (
          <span className="flex items-center gap-1 col-span-2">
            <MapPin className="w-3 h-3" />
            <strong className="text-gray-800">{data.location}</strong>
          </span>
        )}
      </div>

      {data.linkedinUrl && (
        <a
          href={data.linkedinUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-xs text-blue-600 hover:underline"
        >
          <ExternalLink className="w-3 h-3" /> LinkedIn
        </a>
      )}
    </div>
  );
}

export function PeopleSearchCard({ data }: { data: PeopleSearchResults }) {
  if (!data.people?.length) return null;
  return (
    <div className="rounded-xl border border-gray-200 bg-gray-50 p-4 space-y-3 text-sm">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-xs font-medium text-gray-400 uppercase tracking-wide">
          <Users className="w-3.5 h-3.5" />
          <span>People</span>
        </div>
        {data.total > data.people.length && (
          <span className="text-xs text-gray-400">{data.people.length} of {data.total.toLocaleString()}</span>
        )}
      </div>
      <div className="divide-y divide-gray-100">
        {data.people.map((p, i) => (
          <div key={i} className="py-2.5 first:pt-0 last:pb-0 flex items-start justify-between gap-3">
            <div className="space-y-0.5 min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="font-medium text-black text-xs">{p.name}</span>
                {p.seniority && (
                  <span className="px-1.5 py-0.5 bg-white border border-gray-200 rounded-full text-[10px] text-gray-500 capitalize">
                    {p.seniority}
                  </span>
                )}
              </div>
              {p.title && <p className="text-xs text-gray-500 truncate">{p.title}</p>}
              {p.company && (
                <p className="text-xs text-gray-400 truncate">
                  {p.company}{p.companyDomain ? ` · ${p.companyDomain}` : ""}
                </p>
              )}
              {p.location && (
                <p className="text-xs text-gray-400 flex items-center gap-1">
                  <MapPin className="w-2.5 h-2.5 shrink-0" />{p.location}
                </p>
              )}
              {p.email && <p className="text-xs text-gray-600">{p.email}</p>}
            </div>
            {p.linkedinUrl && (
              <a
                href={p.linkedinUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="shrink-0 text-blue-600 hover:text-blue-700"
                title="LinkedIn"
              >
                <ExternalLink className="w-3.5 h-3.5" />
              </a>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

export function WebResultsCard({ data }: { data: WebResults }) {
  if (!data.results?.length) return null;
  return (
    <div className="rounded-xl border border-gray-200 bg-gray-50 p-4 space-y-3 text-sm">
      <div className="flex items-center gap-2 text-xs font-medium text-gray-400 uppercase tracking-wide">
        <Globe className="w-3.5 h-3.5" />
        <span>Web Results</span>
      </div>
      <div className="space-y-3">
        {data.results.map((r, i) => (
          <div key={i} className="space-y-1">
            <a
              href={r.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-sm font-medium text-blue-600 hover:underline"
            >
              <ExternalLink className="w-3 h-3 shrink-0" />
              {r.title || r.url}
            </a>
            {r.snippet && (
              <p className="text-xs text-gray-500 leading-relaxed">{r.snippet}</p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
