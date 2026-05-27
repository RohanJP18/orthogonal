import { auth, currentUser } from "@clerk/nextjs/server";
import { upsertUser, getUserByClerkId } from "@/lib/db/queries";

export async function getOrCreateDbUser() {
  const { userId: clerkId } = await auth();
  if (!clerkId) return null;

  // Try fast path first
  const existing = await getUserByClerkId(clerkId);
  if (existing) return existing;

  // First time — fetch Clerk user details and upsert
  const clerkUser = await currentUser();
  if (!clerkUser) return null;

  const email =
    clerkUser.emailAddresses[0]?.emailAddress ?? `${clerkId}@unknown.local`;

  return upsertUser({ clerkId, email });
}
