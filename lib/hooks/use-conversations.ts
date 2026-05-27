"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { Conversation } from "@/lib/db/schema";

async function fetchConversations(): Promise<Conversation[]> {
  const res = await fetch("/api/conversations");
  if (!res.ok) throw new Error("Failed to fetch conversations");
  return res.json();
}

async function createConversation(): Promise<Conversation> {
  const res = await fetch("/api/conversations", { method: "POST" });
  if (!res.ok) throw new Error("Failed to create conversation");
  return res.json();
}

async function renameConversation(id: string, title: string): Promise<Conversation> {
  const res = await fetch(`/api/conversations/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title }),
  });
  if (!res.ok) throw new Error("Failed to rename conversation");
  return res.json();
}

async function deleteConversation(id: string): Promise<void> {
  await fetch(`/api/conversations/${id}`, { method: "DELETE" });
}

export function useConversations() {
  return useQuery({
    queryKey: ["conversations"],
    queryFn: fetchConversations,
  });
}

export function useCreateConversation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: createConversation,
    onSuccess: (newConv) => {
      qc.setQueryData<Conversation[]>(["conversations"], (old) =>
        old ? [newConv, ...old] : [newConv]
      );
      // Pre-seed the conversation cache so navigating to it is instant (no loading flash)
      qc.setQueryData(["conversation", newConv.id], {
        ...newConv,
        messages: [],
        hasMore: false,
        nextCursor: null,
      });
    },
  });
}

export function useRenameConversation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, title }: { id: string; title: string }) =>
      renameConversation(id, title),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["conversations"] }),
  });
}

export function useDeleteConversation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: deleteConversation,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["conversations"] }),
  });
}

export function useConversationMessages(id: string) {
  return useQuery({
    queryKey: ["conversation", id],
    queryFn: async () => {
      const res = await fetch(`/api/conversations/${id}`);
      if (!res.ok) throw new Error("Failed to load conversation");
      return res.json();
    },
    enabled: !!id,
    // Conversation data is kept current manually (cache updated after each turn),
    // so 5 min staleTime prevents pointless background refetches during a session.
    staleTime: 5 * 60 * 1000,
  });
}
