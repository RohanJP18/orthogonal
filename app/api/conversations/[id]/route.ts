import { NextResponse } from "next/server";
import { z } from "zod";
import { getOrCreateDbUser } from "@/lib/auth/get-user";
import {
  getConversation,
  updateConversationTitle,
  softDeleteConversation,
  getMessages,
  getMessagesBefore,
} from "@/lib/db/queries";

interface Params {
  params: Promise<{ id: string }>;
}

export async function GET(req: Request, { params }: Params) {
  const { id } = await params;
  const user = await getOrCreateDbUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const conv = await getConversation(id, user.id);
  if (!conv) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // F6: cursor-based pagination — ?before=<ISO-timestamp> loads older messages
  const url = new URL(req.url);
  const beforeParam = url.searchParams.get("before");

  let msgs;
  let hasMore = false;
  let nextCursor: string | null = null;
  const PAGE_SIZE = 50;

  if (beforeParam) {
    const before = new Date(beforeParam);
    if (isNaN(before.getTime())) {
      return NextResponse.json({ error: "Invalid 'before' cursor" }, { status: 400 });
    }
    const older = await getMessagesBefore(id, before, PAGE_SIZE);
    hasMore = older.length >= PAGE_SIZE;
    nextCursor = hasMore ? older[0].createdAt.toISOString() : null;
    msgs = older;
  } else {
    msgs = await getMessages(id, PAGE_SIZE);
    // If there are exactly PAGE_SIZE results there may be older messages
    hasMore = msgs.length >= PAGE_SIZE;
    nextCursor = hasMore ? msgs[0].createdAt.toISOString() : null;
  }

  return NextResponse.json({ ...conv, messages: msgs, hasMore, nextCursor });
}

const patchSchema = z.object({ title: z.string().min(1).max(500) });

export async function PATCH(req: Request, { params }: Params) {
  const { id } = await params;
  const user = await getOrCreateDbUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const conv = await updateConversationTitle(id, user.id, parsed.data.title);
  if (!conv) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(conv);
}

export async function DELETE(_req: Request, { params }: Params) {
  const { id } = await params;
  const user = await getOrCreateDbUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  await softDeleteConversation(id, user.id);
  return new NextResponse(null, { status: 204 });
}
