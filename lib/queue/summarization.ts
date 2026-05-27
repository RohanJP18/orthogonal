import { Client as QStashClient } from "@upstash/qstash";

// Trigger summarization when a conversation exceeds this many messages
const SUMMARIZE_THRESHOLD = 20;
// Don't re-summarize within this window (ms)
const SUMMARIZE_COOLDOWN_MS = 30 * 60 * 1000; // 30 minutes

// F8: retry configuration
export const MAX_RETRIES = 5;
const MAX_BACKOFF_SECONDS = 3600; // 1 hour cap

/** Exponential backoff: 0, 2^1, 2^2, ... seconds, jittered, capped at 1 hour. */
export function calcBackoffSeconds(attempt: number): number {
  if (attempt === 0) return 0;
  const base = Math.pow(2, attempt);
  const jitter = Math.random() * base * 0.1; // 10% jitter
  return Math.min(base + jitter, MAX_BACKOFF_SECONDS);
}

export function shouldSummarize(
  messageCount: number,
  _summaryCount: number,
  lastSummaryAt?: Date
): boolean {
  if (messageCount < SUMMARIZE_THRESHOLD) return false;
  if (!lastSummaryAt) return true;
  return Date.now() - lastSummaryAt.getTime() > SUMMARIZE_COOLDOWN_MS;
}

export interface SummarizationPayload {
  conversationId: string;
  triggeredAt: string;
  attempt: number;
}

export function buildSummarizationPayload(
  conversationId: string,
  attempt = 0
): SummarizationPayload {
  return {
    conversationId,
    triggeredAt: new Date().toISOString(),
    attempt,
  };
}

export async function enqueueSummarization(
  conversationId: string,
  attempt = 0,
  delaySeconds = 0
): Promise<void> {
  const token = process.env.QSTASH_TOKEN;
  if (!token) return;

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  const client = new QStashClient({ token });

  await client.publishJSON({
    url: `${appUrl}/api/summarize`,
    body: buildSummarizationPayload(conversationId, attempt),
    retries: 0, // we control retries manually for backoff
    ...(delaySeconds > 0 ? { delay: delaySeconds } : {}),
  });
}
