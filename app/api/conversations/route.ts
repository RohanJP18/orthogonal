import { NextResponse } from "next/server";
import { getOrCreateDbUser } from "@/lib/auth/get-user";
import {
  getConversations,
  createConversation,
} from "@/lib/db/queries";

export async function GET() {
  const user = await getOrCreateDbUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const convs = await getConversations(user.id);
  return NextResponse.json(convs);
}

export async function POST() {
  const user = await getOrCreateDbUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const conv = await createConversation({ userId: user.id });
  return NextResponse.json(conv, { status: 201 });
}
