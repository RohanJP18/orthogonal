import { NextResponse } from "next/server";
import { z } from "zod";
import { getOrCreateDbUser } from "@/lib/auth/get-user";
import {
  getConversation,
  getMessages,
  createMessage,
  getLatestSummary,
  touchConversation,
  getConversationCostCents,
  storeEmbedding,
  semanticSearch,
} from "@/lib/db/queries";
import { runOrchestrator, encodeSSE } from "@/lib/llm/orchestrator";
import { shouldSummarize, enqueueSummarization } from "@/lib/queue/summarization";
import { checkRateLimit } from "@/lib/resilience/rate-limiter";
import { embedText } from "@/lib/embeddings/client";
import { buildSemanticContext } from "@/lib/llm/context-manager";

const chatSchema = z.object({
  conversationId: z.string().uuid(),
  content: z.string().min(1).max(32_000),
  bypassCache: z.boolean().optional().default(false),
});

const HARD_COST_LIMIT_CENTS = 5_000; // $50 default
const QUOTA_WARN_THRESHOLD = 0.8;

export async function POST(req: Request) {
  const user = await getOrCreateDbUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const parsed = chatSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { conversationId, content, bypassCache } = parsed.data;

  // NF4: per-user sliding-window rate limit
  const rateLimit = await checkRateLimit(user.id, "chat");
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: `Rate limit exceeded. Try again in ${rateLimit.retryAfterSeconds}s.` },
      { status: 429, headers: { "Retry-After": String(rateLimit.retryAfterSeconds) } }
    );
  }

  const conv = await getConversation(conversationId, user.id);
  if (!conv) return NextResponse.json({ error: "Conversation not found" }, { status: 404 });

  const limit = conv.hardCostCentsLimit ?? HARD_COST_LIMIT_CENTS;
  const spent = await getConversationCostCents(conversationId);
  if (spent >= limit) {
    return NextResponse.json(
      { error: "Conversation cost limit reached. Please start a new conversation." },
      { status: 429 }
    );
  }

  // Persist user message
  const userMsg = await createMessage({ conversationId, role: "user", content });

  // Parallel: history, summary, embedding — don't let embedding delay the response
  const [history, summary, queryEmbedding] = await Promise.all([
    getMessages(conversationId, 50),
    getLatestSummary(conversationId),
    embedText(content, 150),
  ]);

  // Store embedding fire-and-forget (non-blocking)
  if (queryEmbedding) {
    storeEmbedding({ messageId: userMsg.id, conversationId, embedding: queryEmbedding }).catch(() => {});
  }

  // Semantic context (fast if embedding succeeded, skipped if not)
  let semanticContext: string | undefined;
  if (queryEmbedding) {
    const chunks = await semanticSearch(conversationId, queryEmbedding, 5);
    semanticContext = buildSemanticContext(chunks) || undefined;
  }

  const stream = new ReadableStream({
    async start(controller) {
      const encode = (s: string) => new TextEncoder().encode(s);

      // NF9: warn at 80% of cost quota
      if (spent >= limit * QUOTA_WARN_THRESHOLD) {
        const percentUsed = Math.round((spent / limit) * 100);
        controller.enqueue(encode(encodeSSE({ type: "quota_warning", percentUsed })));
      }

      let assistantContent = "";
      let promptTokens = 0;
      let completionTokens = 0;
      let totalOrthogonalCost = 0;

      // Track tool calls for persistence: callId → toolName
      const toolCallNames = new Map<string, string>();
      const pendingToolResults: Array<{
        toolCallId: string;
        toolName: string;
        content: string;
        costCents: number;
      }> = [];

      let orchestratorError: string | null = null;
      try {
        await runOrchestrator({
          history: history.slice(0, -1), // exclude the just-added user message
          userMessage: content,
          summaryContext: summary?.summaryText,
          semanticContext,
          bypassCache,
          onEvent: (event) => {
            // Intercept 'done' — hold it until after DB writes so the client only
            // receives done once everything is persisted and reload-safe.
            if (event.type === "done") {
              promptTokens = event.promptTokens ?? 0;
              completionTokens = event.completionTokens ?? 0;
              return;
            }
            controller.enqueue(encode(encodeSSE(event)));

            if (event.type === "delta") {
              assistantContent += event.content;
            }
            if (event.type === "tool_call") {
              toolCallNames.set(event.toolCallId, event.toolName);
            }
            if (event.type === "tool_result") {
              const toolName = toolCallNames.get(event.toolCallId) ?? "";
              pendingToolResults.push({
                toolCallId: event.toolCallId,
                toolName,
                content: JSON.stringify(event.result),
                costCents: event.priceCents ?? 0,
              });
              totalOrthogonalCost += event.priceCents ?? 0;
            }
          },
        });
      } catch (err) {
        orchestratorError = err instanceof Error ? err.message : "Unknown error";
      }

      if (orchestratorError) {
        controller.enqueue(encode(encodeSSE({ type: "error", message: orchestratorError })));
        controller.close();
        return;
      }

      // Persist tool result messages and assistant reply BEFORE sending done.
      // This guarantees that a page reload immediately after done always shows the full turn.
      try {
        for (const tr of pendingToolResults) {
          await createMessage({
            conversationId,
            role: "tool",
            content: tr.content,
            toolName: tr.toolName,
            toolCallId: tr.toolCallId,
            orthogonalCostCents: tr.costCents,
          });
        }

        if (assistantContent) {
          await createMessage({
            conversationId,
            role: "assistant",
            content: assistantContent,
            llmPromptTokens: promptTokens,
            llmCompletionTokens: completionTokens,
            orthogonalCostCents: totalOrthogonalCost,
          });
        }

        await touchConversation(conversationId);
      } catch (err) {
        console.error("[chat] persistence error:", err);
        // Don't surface to client — the turn completed; persistence can be retried.
      }

      // done is sent after persistence — the client can now safely reload
      controller.enqueue(encode(encodeSSE({
        type: "done",
        promptTokens,
        completionTokens,
        orthogonalCostCents: totalOrthogonalCost,
      })));
      controller.close();

      // Async summarization — fire and forget after stream closes (spec F8, §3)
      getLatestSummary(conversationId).then((latestSummary) => {
        if (shouldSummarize(history.length + 1, 0, latestSummary?.createdAt ?? undefined)) {
          enqueueSummarization(conversationId).catch(() => {});
        }
      }).catch(() => {});
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
