"use client";

import { useParams, useRouter } from "next/navigation";
import Sidebar from "@/components/chat/sidebar";

export default function ChatLayout({ children }: { children: React.ReactNode }) {
  const params = useParams<{ id?: string }>();
  const router = useRouter();

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar
        selectedId={params.id ?? null}
        onSelect={(conv) => router.push(conv.id ? `/c/${conv.id}` : "/")}
      />
      <main className="flex-1 overflow-hidden">{children}</main>
    </div>
  );
}
