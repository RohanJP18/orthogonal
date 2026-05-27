import { NextResponse } from "next/server";
import { getOrCreateDbUser } from "@/lib/auth/get-user";
import {
  getConversations,
  createConversation,
} from "@/lib/db/queries";

export async function GET() {
  try {
    const user = await getOrCreateDbUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const convs = await getConversations(user.id);
    return NextResponse.json(convs);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[GET /api/conversations]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST() {
  try {
    const user = await getOrCreateDbUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const conv = await createConversation({ userId: user.id });
    return NextResponse.json(conv, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[POST /api/conversations]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
