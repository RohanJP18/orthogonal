"use client";

import { useParams, useRouter, useSearchParams } from "next/navigation";
import ConversationView from "@/components/chat/conversation-view";
import { useConversationMessages } from "@/lib/hooks/use-conversations";

function ConversationSkeleton() {
  return (
    <div className="flex flex-col h-full bg-white animate-pulse">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-3.5 border-b border-gray-100 shrink-0">
        <div className="h-4 w-40 bg-gray-100 rounded" />
        <div className="h-6 w-16 bg-gray-100 rounded-full" />
      </div>
      {/* Messages */}
      <div className="flex-1 max-w-3xl mx-auto w-full px-6 py-6 space-y-5">
        <div className="flex items-start gap-3">
          <div className="w-3.5 h-3.5 mt-1 rounded-full bg-gray-200 shrink-0" />
          <div className="space-y-2 flex-1">
            <div className="h-3.5 w-3/4 bg-gray-100 rounded" />
            <div className="h-3.5 w-1/2 bg-gray-100 rounded" />
          </div>
        </div>
        <div className="flex justify-end">
          <div className="h-9 w-44 bg-gray-100 rounded-2xl" />
        </div>
        <div className="flex items-start gap-3">
          <div className="w-3.5 h-3.5 mt-1 rounded-full bg-gray-200 shrink-0" />
          <div className="space-y-2 flex-1">
            <div className="h-3.5 w-2/3 bg-gray-100 rounded" />
            <div className="h-3.5 w-1/3 bg-gray-100 rounded" />
          </div>
        </div>
      </div>
      {/* Input */}
      <div className="px-6 pb-5 pt-3 shrink-0">
        <div className="max-w-3xl mx-auto h-14 bg-gray-50 border border-gray-100 rounded-2xl" />
      </div>
    </div>
  );
}

export default function ConversationPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const searchParams = useSearchParams();
  const pendingMessage = searchParams.get("message");

  const { data: convData, isLoading } = useConversationMessages(id);

  if (isLoading) {
    return <ConversationSkeleton />;
  }

  if (!convData) {
    return (
      <div className="flex items-center justify-center h-full text-gray-400 text-sm">
        Conversation not found.{" "}
        <button onClick={() => router.push("/")} className="underline ml-1">
          Go home
        </button>
      </div>
    );
  }

  return (
    <ConversationView
      key={id}
      conversation={convData}
      initialMessages={convData.messages ?? []}
      pendingMessage={pendingMessage}
      onPendingMessageSent={() => router.replace(`/c/${id}`)}
    />
  );
}
