import type { Message } from "@/lib/db/schema";

export interface CursorPage {
  messages: Message[];
  nextCursor: Date | null;
  hasMore: boolean;
}

/**
 * Given a page of messages (oldest-first) and the requested page size,
 * derive cursor metadata for infinite-scroll pagination.
 */
export function buildCursorPage(messages: Message[], pageSize: number): CursorPage {
  if (messages.length === 0) {
    return { messages, nextCursor: null, hasMore: false };
  }
  const hasMore = messages.length >= pageSize;
  // Always expose the oldest message timestamp as the cursor so callers can
  // paginate backward; hasMore signals whether to actually fetch another page.
  const nextCursor = messages[0].createdAt;
  return { messages, nextCursor, hasMore };
}

/**
 * Prepend an older page of messages before the existing ones, deduplicating by id.
 * Preserves chronological (oldest-first) order.
 */
export function mergePaginatedMessages(
  existing: Message[],
  older: Message[]
): Message[] {
  const seen = new Set(existing.map((m) => m.id));
  const deduped = older.filter((m) => !seen.has(m.id));
  const merged = [...deduped, ...existing];
  return merged.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
}
