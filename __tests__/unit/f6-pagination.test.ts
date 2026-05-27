/**
 * F6: Conversation History — Cursor-based Pagination
 *
 * "The messages panel supports infinite scroll: the 30 most recent messages
 * load immediately; older pages load on demand as the user scrolls up."
 */

import { describe, it, expect } from "vitest";
import { buildCursorPage, mergePaginatedMessages } from "@/lib/pagination/messages";
import type { Message } from "@/lib/db/schema";

function makeMsg(id: string, content: string, createdAt: Date): Message {
  return {
    id,
    conversationId: "conv-1",
    role: "user",
    content,
    toolName: null,
    toolCallId: null,
    storageKey: null,
    orthogonalCostCents: 0,
    llmPromptTokens: 0,
    llmCompletionTokens: 0,
    createdAt,
  };
}

// ─── buildCursorPage ──────────────────────────────────────────────────────────

describe("F6 — buildCursorPage extracts pagination metadata", () => {
  it("returns hasMore=false when fewer items than page size returned", () => {
    const msgs = [makeMsg("a", "hello", new Date())];
    const page = buildCursorPage(msgs, 30);
    expect(page.hasMore).toBe(false);
  });

  it("returns hasMore=true when items equal page size", () => {
    const msgs = Array.from({ length: 30 }, (_, i) =>
      makeMsg(`id-${i}`, `msg ${i}`, new Date(2024, 0, i + 1))
    );
    const page = buildCursorPage(msgs, 30);
    expect(page.hasMore).toBe(true);
  });

  it("cursor points to oldest message's createdAt", () => {
    const old = new Date(2024, 0, 1);
    const recent = new Date(2024, 0, 10);
    const msgs = [
      makeMsg("old", "old", old),
      makeMsg("new", "new", recent),
    ];
    // messages come back oldest-first (as returned by getMessagesBefore)
    const page = buildCursorPage(msgs, 30);
    expect(page.nextCursor?.getTime()).toBe(old.getTime());
  });

  it("nextCursor is null when there are no messages", () => {
    const page = buildCursorPage([], 30);
    expect(page.nextCursor).toBeNull();
    expect(page.hasMore).toBe(false);
  });
});

// ─── mergePaginatedMessages ───────────────────────────────────────────────────

describe("F6 — mergePaginatedMessages prepends older pages correctly", () => {
  it("prepends older messages before existing ones", () => {
    const existing = [makeMsg("c", "newest", new Date(2024, 0, 3))];
    const older = [
      makeMsg("a", "oldest", new Date(2024, 0, 1)),
      makeMsg("b", "middle", new Date(2024, 0, 2)),
    ];
    const merged = mergePaginatedMessages(existing, older);
    expect(merged[0].id).toBe("a");
    expect(merged[1].id).toBe("b");
    expect(merged[2].id).toBe("c");
  });

  it("deduplicates messages that appear in both arrays", () => {
    const shared = makeMsg("shared", "dup", new Date(2024, 0, 2));
    const existing = [shared, makeMsg("new", "new", new Date(2024, 0, 3))];
    const older = [makeMsg("old", "old", new Date(2024, 0, 1)), shared];
    const merged = mergePaginatedMessages(existing, older);
    expect(merged.filter((m) => m.id === "shared").length).toBe(1);
  });

  it("preserves chronological order", () => {
    const existing = [makeMsg("d", "d", new Date(2024, 0, 4))];
    const older = [
      makeMsg("b", "b", new Date(2024, 0, 2)),
      makeMsg("c", "c", new Date(2024, 0, 3)),
    ];
    const merged = mergePaginatedMessages(existing, older);
    const times = merged.map((m) => m.createdAt.getTime());
    expect(times).toEqual([...times].sort((a, b) => a - b));
  });
});
