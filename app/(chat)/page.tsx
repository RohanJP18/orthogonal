"use client";

import { useRouter } from "next/navigation";
import RuixenMoonChat from "@/components/ui/ruixen-moon-chat";
import { useCreateConversation } from "@/lib/hooks/use-conversations";

export default function Home() {
  const router = useRouter();
  const createMutation = useCreateConversation();

  const handleHeroSubmit = async (message: string) => {
    const conv = await createMutation.mutateAsync();
    router.push(`/c/${conv.id}?message=${encodeURIComponent(message)}`);
  };

  return (
    <RuixenMoonChat
      onSubmit={handleHeroSubmit}
      isLoading={createMutation.isPending}
    />
  );
}
