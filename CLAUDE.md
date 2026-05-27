# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## ⚠️ Next.js Version Warning

This project runs **Next.js 16.2.6** (Turbopack). APIs, file conventions, and routing behavior differ from Next.js 13/14. Before writing any route handler, layout, or middleware, read the relevant guide in `node_modules/next/dist/docs/`. In particular:
- Route handlers use `export async function GET/POST(req: Request)` — no `NextApiRequest/NextApiResponse`
- `params` in route handlers are a **Promise**: `const { id } = await params`
- Dynamic route params in client components come from `useParams()`, not props

## Commands

```bash
npm run dev          # start dev server (Turbopack, port 3000)
npm run build        # production build
npm test             # run all unit tests (vitest, single run)
npm run test:watch   # vitest in watch mode
npm run test:coverage

# Run a single test file
npx vitest run __tests__/unit/circuit-breaker.test.ts

# DB migrations (reads DIRECT_DATABASE_URL from .env.local)
npx drizzle-kit generate   # generate migration from schema changes
npx drizzle-kit push       # push schema directly (dev only)
npx drizzle-kit studio     # open Drizzle Studio GUI
```

## Architecture

### Request lifecycle

```
Browser → /api/chat (POST)
  → Clerk auth (getOrCreateDbUser)
  → Redis rate limiter (checkRateLimit)
  → Hard cost-limit check (getConversationCostCents)
  → persist user message (createMessage)
  → load history + latest summary (getMessages, getLatestSummary)
  → ReadableStream (SSE) {
      runOrchestrator → trimHistory → OpenAI stream
        ↳ tool_call loop → withCircuitBreaker → withOrthogonalCache → runOrthogonal
      persist assistant reply
      touchConversation
      enqueueSummarization (fire-and-forget via QStash)
    }
  → Response (text/event-stream)
```

### Key modules

| Path | Responsibility |
|---|---|
| `lib/llm/orchestrator.ts` | SSE encoding, OpenAI streaming, tool-call loop, fallback model |
| `lib/llm/context-manager.ts` | Token budget (15/35/35/15%), `trimHistory`, `messagesToChatMessages` |
| `lib/orthogonal/client.ts` | `runOrthogonal` — single fetch wrapper, `OrthogonalError` |
| `lib/orthogonal/tools.ts` | Tool definitions (`get_company`, `enrich_person`, `web_search`). Add new tools here. |
| `lib/orthogonal/normalizer.ts` | Strips noise from Orthogonal payloads before they enter context |
| `lib/resilience/circuit-breaker.ts` | Opossum v9 wrapper — **no fallback registered**, manual `breaker.opened` check |
| `lib/resilience/rate-limiter.ts` | Redis sliding-window, fails open on Redis outage |
| `lib/cache/orthogonal-cache.ts` | Redis cache for Orthogonal responses; `priceCents=0` on hit |
| `lib/queue/summarization.ts` | QStash enqueue + backoff math; handler lives in `app/api/summarize/route.ts` |
| `lib/db/queries.ts` | All DB access. `getMessagesBefore` for cursor pagination. |
| `lib/db/schema.ts` | Drizzle schema: `users`, `conversations`, `messages`, `summaries`, `failedJobs` |
| `lib/hooks/use-conversations.ts` | TanStack Query hooks for sidebar + conversation data |

### Routing (App Router)

```
app/
  layout.tsx                  # Root: ClerkProvider, QueryClientProvider
  (chat)/                     # Route group — no URL segment, shared sidebar layout
    layout.tsx                # Sidebar + <main> wrapper; reads useParams for selectedId
    page.tsx                  # Hero/empty state at /
    c/[id]/
      page.tsx                # Conversation view at /c/:id
  api/
    chat/route.ts             # SSE streaming endpoint
    conversations/route.ts    # GET list, POST create
    conversations/[id]/route.ts  # GET (with ?before= cursor), PATCH title, DELETE
    summarize/route.ts        # QStash callback (verified in prod, open in dev)
    health/route.ts
  sign-in/ sign-up/           # Clerk hosted pages
```

The `(chat)` route group means **both `/` and `/c/:id` share a single layout instance** — the sidebar never unmounts during navigation. This is intentional; removing the group would cause layout flashes when switching conversations.

### SSE event protocol

All events from `/api/chat` are `data: <JSON>\n\n`. Parsed by `parseSSEEvent` in `orchestrator.ts`:

```ts
{ type: "delta";       content: string }
{ type: "tool_call";   toolName: string; toolCallId: string }
{ type: "tool_result"; toolCallId: string; result: unknown; priceCents?: number }
{ type: "done";        promptTokens?: number; completionTokens?: number; orthogonalCostCents?: number }
{ type: "error";       message: string }
```

### Circuit breaker (Opossum v9 gotcha)

In Opossum v9, registering `.fallback()` causes it to fire on **any** failure, not just open-circuit. We intentionally do **not** register a fallback. Instead `withCircuitBreaker` checks `breaker.opened` before and after firing to decide whether to throw `CircuitOpenError` vs. re-throw the original error.

### Context window budget

`buildContextBudget(maxTokens)` in `context-manager.ts` splits as: 15% system+tools, 35% recent history, 35% Orthogonal snippets, 15% semantic memory. Only the history bucket is actively enforced via `trimHistory`; the snippet/semantic buckets are reserved for future pgvector integration.

### Testing

All tests are unit tests in `__tests__/unit/`. No real DB or Redis connections — DB is mocked via `vi.mock("@/lib/db/client")`. The four `req*.test.ts` files directly validate the four take-home requirements (context window, persistence, concurrency, resilience). Run a focused subset with `npx vitest run __tests__/unit/req4-resilience.test.ts`.
