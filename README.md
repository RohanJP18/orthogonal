# Orthogonal AI Chat Interface

A production-grade AI chat interface where users can have natural conversations and get real data back — company profiles, contact info, people search, web results — all powered by Orthogonal's unified API platform.

---

## Quick Start

```bash
cp .env.example .env.local   # fill in keys (Clerk, Supabase, OpenAI, Portkey, Orthogonal, Upstash)
npm install
npx drizzle-kit push         # apply schema to Postgres
npm run dev                  # http://localhost:3000
```

```bash
npm test                     # run all unit tests (Vitest)
```

---

## Spec Coverage

### F1 — User Authentication & Identity
Clerk middleware verifies session tokens on every request and injects `user_id` into context. All messages, tool calls, and cost tracking are scoped to that `user_id`. Implementation: `lib/auth/get-user.ts`, `middleware.ts`.

### F2 — Multi-Conversation Support
Full CRUD sidebar with create, rename, soft-delete. TanStack Query handles caching and optimistic updates. Schema: `users → conversations → messages + summaries + message_embeddings + failed_jobs`. REST endpoints at `/api/conversations` and `/api/conversations/[id]`. Implementation: `lib/hooks/use-conversations.ts`, `components/chat/sidebar.tsx`.

### F3 — AI Chat with Streaming Responses (SSE)
Client POSTs to `/api/chat`; the route returns a `ReadableStream` (`Content-Type: text/event-stream`). The orchestrator streams token deltas, tool call events, and a final `done` event back to the browser. SSE is chosen over WebSockets for stateless scalability and HTTP/2 compatibility. Implementation: `app/api/chat/route.ts`, `lib/llm/orchestrator.ts`.

SSE event protocol:
```
{ type: "delta";       content: string }
{ type: "tool_call";   toolName: string; toolCallId: string }
{ type: "tool_result"; toolCallId: string; result: unknown; priceCents?: number; fromCache?: boolean }
{ type: "done";        promptTokens?: number; completionTokens?: number; orthogonalCostCents?: number }
{ type: "error";       message: string }
{ type: "quota_warning"; percentUsed: number }
```

### F4 — Orthogonal Tool Integration
All tools call `runOrthogonal({ api, path, query?, body? })` → `POST https://api.orthogonal.com/v1/run`. Each tool is wrapped in a per-tool circuit breaker and Redis cache. Tool definitions live in `lib/orthogonal/tools.ts`; adding a new tool requires only adding a `buildTool({...})` entry there.

| Tool | Orthogonal API | Endpoint | What it returns |
|---|---|---|---|
| `get_company` | `company-enrich` | `/companies/enrich` | Firmographics, funding, headcount, tech stack, socials |
| `enrich_person` | `hunter` | `/v2/email-finder` | Email, title, phone, LinkedIn for a named person |
| `search_people` | `company-enrich` | `/people/search` | List of people at a company filtered by title/department |
| `web_search` | `scrapegraphai` | `/api/search` | Live web search results |
| `scrape_page` | `notte` | `/scrape` | Full markdown content of a URL |

The LLM decides which tool to call and with what parameters based on the conversation. Results are normalized into typed view models (`CompanyProfile`, `PersonProfile`, `PeopleSearchResults`, `WebResults`) and rendered as rich cards in the UI.

### F5 — Context Window Management (Token + Semantic)
Per-model token budget split: **15%** system + tools, **35%** recent history, **35%** Orthogonal snippets, **15%** semantic memory. History is trimmed newest-to-oldest using exact `js-tiktoken` counts. The current user message is embedded with `text-embedding-3-small` (1536D) via a `Promise.race` with a 150ms timeout; results are retrieved from pgvector (HNSW, cosine distance, similarity > 0.75). On embedding failure or timeout, the turn completes with recency-only context — no user-visible degradation. Implementation: `lib/llm/context-manager.ts`.

### F6 — Conversation Persistence & Resume
Every user message, tool result, and assistant reply is persisted to Postgres before the SSE `done` event is sent — guaranteeing reload-safety. The sidebar loads only metadata on startup. Opening a conversation fetches the newest 50 messages; older messages load on scroll via cursor pagination (`?before=<ISO-timestamp>`). The backend always rebuilds full context from stored messages + the latest summary row. Implementation: `lib/db/queries.ts`, `app/api/conversations/[id]/route.ts`.

### F7 — Tool Result Visualization & Caching
Orthogonal responses are cached in Redis keyed by `(api, path, params)`. TTLs: company enrichment 15 min, contacts 10 min, web search 5 min. Each entry stores `fetchedAt` so the UI can show a "Cached · HH:MM:SS" label. A **Cached / Fresh** toggle in the chat header lets users bypass cache. Tool results render as typed React cards (`CompanyCard`, `PersonCard`, `PeopleSearchCard`, `WebResultsCard`). Implementation: `lib/cache/orthogonal-cache.ts`, `components/chat/tool-result-cards.tsx`.

### F8 — Error Handling, Fallbacks & Summarization
Each Orthogonal tool and the LLM gateway are wrapped in Opossum circuit breakers. On failure, the orchestrator passes a structured `{ error }` JSON to the LLM, which explains the outage and falls back to web search. Async summarization runs via QStash with exponential backoff (up to 5 retries) and a `failed_jobs` dead-letter table. Summarization failure never blocks the main chat path. Implementation: `lib/resilience/circuit-breaker.ts`, `lib/queue/summarization.ts`.

### F9 — Concurrent Request Handling & UX
The client enforces a single in-flight SSE stream per conversation — the send button is disabled while streaming. A 60-second `AbortController` timeout fires if the stream stalls. On error or timeout, a toast shows **Retry** (replays the message) and **Cancel** buttons. The server is fully stateless; any Vercel instance can serve any request. Redis rate limiting (`ZREMRANGEBYSCORE` sliding-window) prevents per-user abuse and fails open on Redis outage. Implementation: `lib/resilience/rate-limiter.ts`, `components/chat/conversation-view.tsx`.

### F10 — Observability
OpenTelemetry spans for `orthogonal.run`, `embed.call`, `redis.rate_limit`, and `llm.call` — all including latency, status, and domain-specific attributes (e.g. `orthogonal.price_cents`, `orthogonal.request_id`). Span data exports via OTLP. Implementation: `lib/telemetry/tracer.ts`, `instrumentation.ts`.

---

## Architecture

```
Browser ──SSE stream──► /api/chat (Next.js Route Handler)
                              │
               ┌──────────────┼──────────────────┐
               ▼              ▼                   ▼
          Rate Limiter   Chat Orchestrator    Summarization
          (Redis)        (Portkey gateway)    (QStash job)
                              │
               ┌──────────────┼──────────────────┐
               ▼              ▼                   ▼
          Postgres         Orthogonal          Redis
          (messages,       (circuit-           (cache +
          embeddings)      broken tools)       rate limits)
```

**LLM Gateway** — Portkey routes `gpt-4.1-mini` (primary) → `gpt-4o-mini` (fallback). Swapping models or providers is a single config change in `lib/llm/gateway.ts`.

**Database schema:**
```
users(id, clerk_id, email)
conversations(id, user_id, title, hard_cost_cents_limit, deleted_at)
messages(id, conversation_id, role, content, tool_name, tool_call_id,
         orthogonal_cost_cents, llm_prompt_tokens, llm_completion_tokens, storage_key)
summaries(id, conversation_id, summary_text, model)
message_embeddings(id, message_id, conversation_id, embedding vector(1536))
failed_jobs(id, conversation_id, attempt, error_message)
```

---

## Non-Functional Requirements

| Req | Implementation |
|---|---|
| NF1 Performance | Embedding + pgvector budget < 150ms; calls parallelized with LLM prep; SSE streams first token immediately |
| NF2 Scalability | Stateless Vercel routes; Neon/Supabase connection pooler; horizontal scaling via more instances |
| NF3 Fault Tolerance | Opossum circuit breakers on all external deps; fails fast when open; semantic retrieval skipped on embedding failure |
| NF4 Rate Limiting | Redis sliding-window per `(route, user_id)`; fails open on Redis outage |
| NF5 Security | Clerk auth on every request; all DB queries filtered by `user_id`; secrets in platform secret manager; `.env.local` gitignored |
| NF6 Observability | OpenTelemetry spans for every external call with latency + cost attributes |
| NF7 Maintainability | Tools in one file; adding a new Orthogonal API = one `buildTool({})` entry; swapping LLM = one gateway config change |
| NF8 UX | Streaming tokens, loading states, cancel/retry toast, Cached/Fresh toggle, collapsible sidebar |
| NF9 Cost Controls | `orthogonal_cost_cents` + token columns per message; 80% quota warning banner; hard limit blocks tool calls |

---

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 16 (App Router, Turbopack) |
| Auth | Clerk |
| Database | Postgres via Drizzle ORM (Neon/Supabase) + pgvector (HNSW) |
| Cache / Queue | Redis + QStash (Upstash) |
| LLM Gateway | Portkey (`gpt-4.1-mini` → `gpt-4o-mini` fallback) |
| Orthogonal APIs | `company-enrich`, `hunter`, `scrapegraphai`, `notte` |
| Embeddings | OpenAI `text-embedding-3-small` (1536D) |
| Resilience | Opossum circuit breakers |
| Observability | OpenTelemetry + OTLP exporter |
| Token counting | js-tiktoken (exact, model-aware) |
| Testing | Vitest |

---

## What I'd Do With More Time

- **`db_query` spans** — OTLP is wired up; adding a Drizzle query logger would complete full distributed tracing
- **R2 object storage** — `storage_key` column exists in schema; large Orthogonal payloads are currently stored inline in Postgres
- **HNSW tuning** — `m=16, ef_construction=64, ef_search=40` are solid defaults; would tune at 1M+ embeddings
- **Embedding dimension reduction** — `text-embedding-3-small` supports 512D natively; worth testing at scale before committing to 1536D
