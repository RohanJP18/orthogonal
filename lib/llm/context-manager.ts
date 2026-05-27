import type { Message } from "@/lib/db/schema";
import { encodingForModel } from "js-tiktoken";

// Cache encoders — initializing tiktoken is expensive, reuse across calls
const encoderCache = new Map<string, ReturnType<typeof encodingForModel>>();

function getEncoder(model: string) {
  if (encoderCache.has(model)) return encoderCache.get(model)!;
  try {
    const enc = encodingForModel(model as Parameters<typeof encodingForModel>[0]);
    encoderCache.set(model, enc);
    return enc;
  } catch {
    // Unknown model — use gpt-4o (cl100k_base) as default
    const enc = encodingForModel("gpt-4o");
    encoderCache.set(model, enc);
    return enc;
  }
}

export function estimateTokens(text: string, model = "gpt-4o"): number {
  if (!text) return 0;
  try {
    return getEncoder(model).encode(text).length;
  } catch {
    return Math.ceil(text.length / 4); // fallback if tiktoken fails
  }
}

export interface ContextBudget {
  systemAndTools: number;
  recentHistory: number;
  orthogonalSnippets: number;
  semanticMemory: number;
}

// Spec §1 F5: 15% system+tools, 35% history, 35% Orthogonal, 15% semantic
export function buildContextBudget(maxContext: number): ContextBudget {
  return {
    systemAndTools: Math.floor(maxContext * 0.15),
    recentHistory: Math.floor(maxContext * 0.35),
    orthogonalSnippets: Math.floor(maxContext * 0.35),
    semanticMemory: Math.floor(maxContext * 0.15),
  };
}

export const CONTEXT_BUDGETS: Record<string, ContextBudget> = {
  "gpt-4.1": buildContextBudget(1_047_576),
  "gpt-4.1-mini": buildContextBudget(1_047_576),
  "gpt-4o": buildContextBudget(128_000),
  "gpt-4o-mini": buildContextBudget(128_000),
  "gpt-3.5-turbo": buildContextBudget(16_385),
};

/**
 * Walk history newest-to-oldest, include messages until historyBudget (tokens) is filled.
 * Always keeps at least the last message.
 */
export function trimHistory(messages: Message[], historyBudget: number): Message[] {
  if (messages.length === 0) return [];

  const result: Message[] = [];
  let used = 0;

  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    const tokens = estimateTokens(msg.content ?? "");

    if (result.length === 0 || used + tokens <= historyBudget) {
      result.unshift(msg);
      used += tokens;
    } else {
      break;
    }
  }

  return result;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_call_id?: string;
  name?: string;
}

// Spec F5: build the semantic memory section from pgvector search results
export function buildSemanticContext(
  chunks: Array<{ content: string | null; similarity: number }>
): string {
  const relevant = chunks.filter((c) => (c.similarity ?? 0) > 0.75 && c.content);
  if (relevant.length === 0) return "";
  const lines = relevant
    .map((c) => `- ${(c.content ?? "").slice(0, 200)}`)
    .join("\n");
  return `## Semantically Relevant Prior Context\n${lines}`;
}

export function messagesToChatMessages(messages: Message[]): ChatMessage[] {
  return messages.map((m) => {
    const msg: ChatMessage = {
      role: m.role as ChatMessage["role"],
      content: m.content,
    };
    if (m.toolCallId) msg.tool_call_id = m.toolCallId;
    if (m.toolName) msg.name = m.toolName;
    return msg;
  });
}
