import OpenAI from "openai";
import { getToolByName, getOpenAIToolSchemas } from "@/lib/orthogonal/tools";
import { withCircuitBreaker } from "@/lib/resilience/circuit-breaker";
import type { Message } from "@/lib/db/schema";
import { trimHistory, messagesToChatMessages, CONTEXT_BUDGETS } from "./context-manager";
import { gatewayCreateStream, DEFAULT_MODEL } from "./gateway";

export type SSEEvent =
  | { type: "delta"; content: string }
  | { type: "tool_call"; toolName: string; toolCallId: string }
  | { type: "tool_result"; toolCallId: string; result: unknown; priceCents?: number; fromCache?: boolean; fetchedAt?: string }
  | { type: "done"; promptTokens?: number; completionTokens?: number; orthogonalCostCents?: number }
  | { type: "quota_warning"; percentUsed: number }
  | { type: "error"; message: string };

export function encodeSSE(event: SSEEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

export function parseSSEEvent(line: string): SSEEvent | null {
  if (!line.startsWith("data: ")) return null;
  try {
    return JSON.parse(line.slice(6)) as SSEEvent;
  } catch {
    return null;
  }
}

export function buildSystemPrompt(summaryContext?: string, semanticContext?: string): string {
  const today = new Date().toISOString().split("T")[0];
  let prompt = `You are an AI assistant powered by Orthogonal, an intelligent data platform. Today is ${today}.

You have access to real-time business intelligence tools via Orthogonal. Use these tools when:
- The user asks about a specific company, person, or organization
- The user needs current market data or news
- Enrichment or contact information is requested

When using tools (functions), always:
1. Explain briefly what you are looking up and why
2. Summarize the results concisely after receiving them
3. If a tool call fails, inform the user and suggest alternatives

When NOT to use tools:
- General knowledge questions that don't require live data
- Conversational or analytical questions about data already in the conversation

Always be helpful, concise, and transparent about your data sources.`;

  if (summaryContext) {
    prompt += `\n\n## Conversation Summary\n${summaryContext}`;
  }

  if (semanticContext) {
    prompt += `\n\n${semanticContext}`;
  }

  return prompt;
}

export interface OrchestratorOptions {
  history: Message[];
  userMessage: string;
  summaryContext?: string;
  semanticContext?: string;
  bypassCache?: boolean;
  onEvent: (event: SSEEvent) => void;
}

export async function runOrchestrator(opts: OrchestratorOptions): Promise<void> {
  const {
    history,
    userMessage,
    summaryContext,
    semanticContext,
    bypassCache = false,
    onEvent,
  } = opts;

  // Use the primary model's budget for context window management
  const budget = CONTEXT_BUDGETS[DEFAULT_MODEL] ?? CONTEXT_BUDGETS["gpt-4o"];
  const trimmed = trimHistory(history, budget.recentHistory);
  const historyMessages = messagesToChatMessages(trimmed);

  // Rebuild OpenAI message array from DB history.
  // Tool messages in the DB have no preceding assistant[tool_calls] row (that intermediate
  // message is never persisted). We synthesize it here so OpenAI's validation passes.
  const messages: OpenAI.ChatCompletionMessageParam[] = [
    { role: "system", content: buildSystemPrompt(summaryContext, semanticContext) },
  ];

  for (let i = 0; i < historyMessages.length; i++) {
    const m = historyMessages[i];

    if (m.role === "tool") {
      const prev = messages[messages.length - 1];
      const prevHasToolCalls = prev?.role === "assistant" && "tool_calls" in prev;

      if (!prevHasToolCalls) {
        // Collect all consecutive tool messages and emit ONE synthetic assistant[tool_calls]
        // covering all of them, then push all tool messages and advance i past the group.
        // Without this, a second iteration would create a second synthetic assistant for
        // remaining tool messages, leaving the first one with unanswered tool_call_ids.
        const group: typeof historyMessages = [];
        let j = i;
        while (j < historyMessages.length && historyMessages[j].role === "tool") {
          group.push(historyMessages[j]);
          j++;
        }
        messages.push({
          role: "assistant",
          content: null,
          tool_calls: group.map((t) => ({
            id: t.tool_call_id ?? `call_synthetic_${j}`,
            type: "function" as const,
            function: { name: t.name ?? "unknown", arguments: "{}" },
          })),
        });
        for (const toolMsg of group) {
          messages.push({
            role: "tool",
            tool_call_id: toolMsg.tool_call_id ?? "",
            content: toolMsg.content ?? "",
          });
        }
        i = j - 1; // advance past the group; the for-loop will do i++
      } else {
        messages.push({
          role: "tool",
          tool_call_id: m.tool_call_id ?? "",
          content: m.content ?? "",
        });
      }
    } else if (m.role === "assistant") {
      messages.push({ role: "assistant", content: m.content });
    } else {
      messages.push({ role: "user", content: m.content ?? "" });
    }
  }

  messages.push({ role: "user", content: userMessage });

  const tools = getOpenAIToolSchemas() as OpenAI.ChatCompletionTool[];

  let totalOrthogonalCostCents = 0;
  let continueLoop = true;

  while (continueLoop) {
    let stream: AsyncIterable<OpenAI.ChatCompletionChunk>;

    try {
      // Portkey gateway handles primary → fallback routing and observability
      stream = await gatewayCreateStream(messages, tools);
    } catch (err) {
      onEvent({
        type: "error",
        message: err instanceof Error ? err.message : "LLM error",
      });
      return;
    }

    let assistantContent = "";
    const toolCalls: Array<{ id: string; type: "function"; function: { name: string; arguments: string } }> = [];
    let promptTokens = 0;
    let completionTokens = 0;

    for await (const chunk of stream) {
      const choice = chunk.choices[0];
      if (!choice) continue;

      if (chunk.usage) {
        promptTokens = chunk.usage.prompt_tokens;
        completionTokens = chunk.usage.completion_tokens;
      }

      const delta = choice.delta;
      if (delta.content) {
        assistantContent += delta.content;
        onEvent({ type: "delta", content: delta.content });
      }

      if (delta.tool_calls) {
        for (const tc of delta.tool_calls) {
          const idx = tc.index;
          if (!toolCalls[idx]) {
            toolCalls[idx] = {
              id: tc.id ?? "",
              type: "function",
              function: { name: tc.function?.name ?? "", arguments: "" },
            };
          }
          if (tc.function?.arguments) {
            toolCalls[idx].function.arguments += tc.function.arguments;
          }
          if (tc.id) toolCalls[idx].id = tc.id;
          if (tc.function?.name) toolCalls[idx].function.name = tc.function.name;
        }
      }

      if (choice.finish_reason === "stop") {
        continueLoop = false;
        onEvent({ type: "done", promptTokens, completionTokens, orthogonalCostCents: totalOrthogonalCostCents });
      }
    }

    if (toolCalls.length > 0) {
      messages.push({
        role: "assistant",
        content: assistantContent || null,
        tool_calls: toolCalls,
      });

      for (const tc of toolCalls) {
        onEvent({ type: "tool_call", toolName: tc.function.name, toolCallId: tc.id });

        const tool = getToolByName(tc.function.name);
        let resultContent: string;

        if (!tool) {
          resultContent = JSON.stringify({ error: `Unknown tool: ${tc.function.name}` });
        } else {
          try {
            const params = JSON.parse(tc.function.arguments) as Record<string, unknown>;
            const response = await withCircuitBreaker(`tool:${tc.function.name}`, () =>
              tool.execute(params, { bypassCache })
            ) as { data: unknown; priceCents: number; fromCache?: boolean; fetchedAt?: string };
            totalOrthogonalCostCents += response.priceCents ?? 0;
            resultContent = JSON.stringify(response.data);
            onEvent({
              type: "tool_result",
              toolCallId: tc.id,
              result: response.data,
              priceCents: response.priceCents,
              fromCache: response.fromCache,
              fetchedAt: response.fetchedAt,
            });
          } catch (err) {
            const errMsg = err instanceof Error ? err.message : "Tool call failed";
            console.error(`[orchestrator] tool:${tc.function.name} failed:`, err);
            resultContent = JSON.stringify({ error: errMsg });
          }
        }

        messages.push({
          role: "tool",
          tool_call_id: tc.id,
          content: resultContent,
        });
      }
    } else {
      continueLoop = false;
    }
  }
}
