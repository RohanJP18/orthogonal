import { db } from "./client";
import { users, conversations, messages, summaries, failedJobs } from "./schema";
import { eq, and, isNull, desc, asc, lt, sql } from "drizzle-orm";
import type { NewConversation, NewMessage, NewUser } from "./schema";

// --- Users ---

export async function upsertUser(data: NewUser) {
  const [user] = await db
    .insert(users)
    .values(data)
    .onConflictDoUpdate({
      target: users.clerkId,
      set: { email: data.email, updatedAt: new Date() },
    })
    .returning();
  return user;
}

export async function getUserByClerkId(clerkId: string) {
  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.clerkId, clerkId));
  return user ?? null;
}

// --- Conversations ---

export async function getConversations(userId: string) {
  return db
    .select()
    .from(conversations)
    .where(and(eq(conversations.userId, userId), isNull(conversations.deletedAt)))
    .orderBy(desc(conversations.updatedAt));
}

export async function getConversation(id: string, userId: string) {
  const [conv] = await db
    .select()
    .from(conversations)
    .where(
      and(eq(conversations.id, id), eq(conversations.userId, userId), isNull(conversations.deletedAt))
    );
  return conv ?? null;
}

export async function createConversation(data: NewConversation) {
  const [conv] = await db.insert(conversations).values(data).returning();
  return conv;
}

export async function updateConversationTitle(id: string, userId: string, title: string) {
  const [conv] = await db
    .update(conversations)
    .set({ title, updatedAt: new Date() })
    .where(and(eq(conversations.id, id), eq(conversations.userId, userId)))
    .returning();
  return conv ?? null;
}

export async function softDeleteConversation(id: string, userId: string) {
  await db
    .update(conversations)
    .set({ deletedAt: new Date() })
    .where(and(eq(conversations.id, id), eq(conversations.userId, userId)));
}

export async function touchConversation(id: string) {
  await db
    .update(conversations)
    .set({ updatedAt: new Date() })
    .where(eq(conversations.id, id));
}

// --- Messages ---

export async function getMessages(conversationId: string, limit = 50) {
  return db
    .select()
    .from(messages)
    .where(eq(messages.conversationId, conversationId))
    .orderBy(asc(messages.createdAt))
    .limit(limit);
}

export async function createMessage(data: NewMessage) {
  const [msg] = await db.insert(messages).values(data).returning();
  return msg;
}

// --- Summaries ---

export async function getLatestSummary(conversationId: string) {
  const [summary] = await db
    .select()
    .from(summaries)
    .where(eq(summaries.conversationId, conversationId))
    .orderBy(desc(summaries.createdAt))
    .limit(1);
  return summary ?? null;
}

export async function createSummary(data: {
  conversationId: string;
  summaryText: string;
  model: string;
}) {
  const [summary] = await db.insert(summaries).values(data).returning();
  return summary;
}

// --- F6: Cursor-based pagination for messages ---

export async function getMessagesBefore(
  conversationId: string,
  before: Date,
  limit = 30
) {
  return db
    .select()
    .from(messages)
    .where(and(eq(messages.conversationId, conversationId), lt(messages.createdAt, before)))
    .orderBy(desc(messages.createdAt))
    .limit(limit)
    .then((rows) => rows.reverse()); // return oldest-first
}

// --- F8: Dead-letter queue ---

export async function writeFailedJob(data: {
  conversationId: string;
  attempt: number;
  errorMessage: string;
}) {
  const [job] = await db.insert(failedJobs).values(data).returning();
  return job;
}

// --- F5: Semantic memory (pgvector) ---

export async function storeEmbedding(data: {
  messageId: string;
  conversationId: string;
  embedding: number[];
}): Promise<void> {
  try {
    const vectorLiteral = `[${data.embedding.join(",")}]`;
    await db.execute(sql`
      INSERT INTO message_embeddings (id, message_id, conversation_id, embedding, created_at)
      VALUES (gen_random_uuid(), ${data.messageId}, ${data.conversationId}, ${vectorLiteral}::vector, now())
      ON CONFLICT DO NOTHING
    `);
  } catch {
    // Non-fatal — if pgvector extension isn't enabled, degrade gracefully
  }
}

export interface SemanticChunk {
  messageId: string;
  content: string;
  similarity: number;
}

export async function semanticSearch(
  conversationId: string,
  queryEmbedding: number[],
  limit = 5
): Promise<SemanticChunk[]> {
  try {
    const vectorLiteral = `[${queryEmbedding.join(",")}]`;
    const rows = await db.execute(sql`
      SET LOCAL hnsw.ef_search = 40;
      SELECT me.message_id AS "messageId",
             m.content,
             1 - (me.embedding <=> ${vectorLiteral}::vector) AS similarity
      FROM message_embeddings me
      JOIN messages m ON m.id = me.message_id
      WHERE me.conversation_id = ${conversationId}
        AND m.role IN ('user', 'assistant')
      ORDER BY me.embedding <=> ${vectorLiteral}::vector
      LIMIT ${limit}
    `);
    return rows as unknown as SemanticChunk[];
  } catch {
    return []; // graceful degradation
  }
}

// --- Cost tracking ---

export async function getConversationCostCents(conversationId: string): Promise<number> {
  const msgs = await db
    .select({ orthogonalCostCents: messages.orthogonalCostCents })
    .from(messages)
    .where(eq(messages.conversationId, conversationId));
  return msgs.reduce((sum, m) => sum + (m.orthogonalCostCents ?? 0), 0);
}
