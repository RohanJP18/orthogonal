import { NextResponse } from "next/server";
import { verifySignatureAppRouter } from "@upstash/qstash/nextjs";
import OpenAI from "openai";
import { getMessages, createSummary } from "@/lib/db/queries";
import {
  type SummarizationPayload,
  MAX_RETRIES,
  calcBackoffSeconds,
  enqueueSummarization,
} from "@/lib/queue/summarization";
import { writeFailedJob } from "@/lib/db/queries";

async function handler(req: Request) {
  const payload = (await req.json()) as SummarizationPayload;
  const { conversationId, attempt = 0 } = payload;

  try {
    const messages = await getMessages(conversationId, 100);
    if (messages.length < 10) {
      return NextResponse.json({ skipped: true, reason: "not enough messages" });
    }

    const transcript = messages
      .filter((m) => m.role === "user" || m.role === "assistant")
      .map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content ?? ""}`)
      .join("\n");

    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    const completion = await client.chat.completions.create({
      model: "gpt-4.1-mini",
      messages: [
        {
          role: "system",
          content:
            "You are a conversation summarizer. Produce a concise bullet-point summary (max 200 words) of the key topics, facts, and entities discussed. Focus on what would be most useful as context for future turns.",
        },
        {
          role: "user",
          content: `Summarize this conversation:\n\n${transcript}`,
        },
      ],
      max_tokens: 400,
    });

    const summaryText = completion.choices[0]?.message?.content ?? "";

    await createSummary({ conversationId, summaryText, model: "gpt-4.1-mini" });

    return NextResponse.json({ ok: true });
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);

    if (attempt < MAX_RETRIES) {
      // Re-enqueue with exponential backoff
      const delay = Math.round(calcBackoffSeconds(attempt + 1));
      await enqueueSummarization(conversationId, attempt + 1, delay);
      return NextResponse.json({ retrying: true, attempt: attempt + 1, delaySeconds: delay });
    }

    // Dead-letter queue: persist failed job for manual inspection
    await writeFailedJob({ conversationId, attempt, errorMessage });
    return NextResponse.json({ failed: true, reason: "max retries exceeded" }, { status: 200 });
  }
}

// Defer verifySignatureAppRouter to request time — calling it at module evaluation
// reads QSTASH_CURRENT_SIGNING_KEY immediately, which isn't set during Vercel's
// build-time page-data collection and causes a hard build failure.
export async function POST(req: Request) {
  if (process.env.NODE_ENV === "production") {
    const wrapped = verifySignatureAppRouter(handler);
    return wrapped(req);
  }
  return handler(req);
}
