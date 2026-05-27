import {
  pgTable,
  uuid,
  text,
  timestamp,
  integer,
  varchar,
  index,
  vector,
} from "drizzle-orm/pg-core";

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  clerkId: varchar("clerk_id", { length: 255 }).notNull().unique(),
  email: varchar("email", { length: 255 }).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const conversations = pgTable(
  "conversations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    title: varchar("title", { length: 500 }).notNull().default("New Chat"),
    hardCostCentsLimit: integer("hard_cost_cents_limit"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
    deletedAt: timestamp("deleted_at"),
  },
  (t) => [index("conversations_user_id_idx").on(t.userId)]
);

export const messages = pgTable(
  "messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id),
    role: varchar("role", { length: 50 }).notNull(), // user | assistant | tool
    content: text("content"),
    toolName: varchar("tool_name", { length: 255 }),
    toolCallId: varchar("tool_call_id", { length: 255 }),
    orthogonalCostCents: integer("orthogonal_cost_cents").default(0),
    llmPromptTokens: integer("llm_prompt_tokens").default(0),
    llmCompletionTokens: integer("llm_completion_tokens").default(0),
    storageKey: varchar("storage_key", { length: 1024 }), // R2 reference for large payloads
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    index("messages_conversation_id_idx").on(t.conversationId),
    index("messages_created_at_idx").on(t.createdAt),
  ]
);

export const summaries = pgTable(
  "summaries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id),
    summaryText: text("summary_text").notNull(),
    model: varchar("model", { length: 100 }).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [index("summaries_conversation_id_idx").on(t.conversationId)]
);

// F5: Semantic memory — stores per-message embeddings for pgvector similarity search
export const messageEmbeddings = pgTable(
  "message_embeddings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    messageId: uuid("message_id")
      .notNull()
      .references(() => messages.id, { onDelete: "cascade" }),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    embedding: vector("embedding", { dimensions: 1536 }).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [index("message_embeddings_conversation_id_idx").on(t.conversationId)]
);

// F8: Dead-letter queue for summarization jobs that exhausted all retries
export const failedJobs = pgTable("failed_jobs", {
  id: uuid("id").primaryKey().defaultRandom(),
  conversationId: uuid("conversation_id").notNull(),
  attempt: integer("attempt").notNull(),
  errorMessage: text("error_message").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Conversation = typeof conversations.$inferSelect;
export type NewConversation = typeof conversations.$inferInsert;
export type Message = typeof messages.$inferSelect;
export type NewMessage = typeof messages.$inferInsert;
export type Summary = typeof summaries.$inferSelect;
export type NewSummary = typeof summaries.$inferInsert;
export type FailedJob = typeof failedJobs.$inferSelect;
export type NewFailedJob = typeof failedJobs.$inferInsert;
export type MessageEmbedding = typeof messageEmbeddings.$inferSelect;
