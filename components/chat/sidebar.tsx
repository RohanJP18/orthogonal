"use client";

import { useState } from "react";
import { Plus, Trash2, Pencil, Check, X, ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  useConversations,
  useCreateConversation,
  useRenameConversation,
  useDeleteConversation,
} from "@/lib/hooks/use-conversations";
import type { Conversation } from "@/lib/db/schema";

interface SidebarProps {
  selectedId: string | null;
  onSelect: (conv: Conversation) => void;
}

function CrescentMark({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="50" cy="50" r="44" fill="black" />
      <circle cx="68" cy="38" r="34" fill="white" />
    </svg>
  );
}

export default function Sidebar({ selectedId, onSelect }: SidebarProps) {
  const { data: conversations = [], isLoading } = useConversations();
  const createMutation = useCreateConversation();
  const renameMutation = useRenameConversation();
  const deleteMutation = useDeleteConversation();

  const [collapsed, setCollapsed] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");

  const handleCreate = async () => {
    const conv = await createMutation.mutateAsync();
    onSelect(conv);
  };

  const startEdit = (conv: Conversation, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingId(conv.id);
    setEditTitle(conv.title);
  };

  const commitEdit = async (id: string) => {
    if (editTitle.trim()) {
      await renameMutation.mutateAsync({ id, title: editTitle.trim() });
    }
    setEditingId(null);
  };

  const handleDelete = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    await deleteMutation.mutateAsync(id);
    if (selectedId === id) onSelect({ id: "" } as Conversation);
  };

  const today = new Date();
  const todayStr = today.toDateString();
  const yesterdayStr = new Date(today.getTime() - 86400000).toDateString();

  const grouped = conversations.reduce<{ today: Conversation[]; yesterday: Conversation[]; older: Conversation[] }>(
    (acc, conv) => {
      const d = new Date(conv.updatedAt).toDateString();
      if (d === todayStr) acc.today.push(conv);
      else if (d === yesterdayStr) acc.yesterday.push(conv);
      else acc.older.push(conv);
      return acc;
    },
    { today: [], yesterday: [], older: [] }
  );

  return (
    <aside
      className={cn(
        "shrink-0 bg-white border-r border-gray-100 flex flex-col h-full transition-all duration-200 ease-in-out overflow-hidden",
        collapsed ? "w-12" : "w-60"
      )}
    >
      {collapsed ? (
        /* Collapsed: icon strip */
        <div className="flex flex-col items-center py-4 gap-3">
          {/* Expand toggle */}
          <button
            onClick={() => setCollapsed(false)}
            className="w-8 h-8 flex items-center justify-center rounded-lg text-gray-400 hover:text-black hover:bg-gray-100 transition"
            title="Expand sidebar"
          >
            <ChevronRight className="w-4 h-4" />
          </button>

          <div className="w-6 h-px bg-gray-100" />

          {/* New chat */}
          <button
            onClick={handleCreate}
            disabled={createMutation.isPending}
            className="w-8 h-8 flex items-center justify-center rounded-lg text-gray-400 hover:text-black hover:bg-gray-100 transition"
            title="New conversation"
          >
            <Plus className="w-4 h-4" />
          </button>

          {/* Selected indicator dot */}
          {selectedId && (
            <div className="w-1.5 h-1.5 rounded-full bg-black mt-1" title="Conversation active" />
          )}
        </div>
      ) : (
        /* Expanded: full sidebar */
        <>
          <div className="px-4 pt-5 pb-4">
            <div className="flex items-center justify-between mb-5">
              <div className="flex items-center gap-2.5">
                <CrescentMark size={20} />
                <span className="text-black font-semibold text-sm tracking-tight">Orthogonal</span>
              </div>
              {/* Collapse toggle */}
              <button
                onClick={() => setCollapsed(true)}
                className="w-6 h-6 flex items-center justify-center rounded-md text-gray-300 hover:text-black hover:bg-gray-100 transition"
                title="Collapse sidebar"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
              </button>
            </div>

            <button
              onClick={handleCreate}
              disabled={createMutation.isPending}
              className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-gray-600 hover:text-black hover:bg-gray-100 transition group"
            >
              <Plus className="w-4 h-4 text-gray-400 group-hover:text-black transition" />
              New conversation
            </button>
          </div>

          <div className="h-px bg-gray-100 mx-4" />

          <nav className="flex-1 overflow-y-auto py-3 px-2">
            {isLoading && (
              <div className="px-3 py-2 space-y-2">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="h-8 rounded-lg bg-gray-100 animate-pulse" />
                ))}
              </div>
            )}

            {!isLoading && conversations.length === 0 && (
              <p className="text-gray-400 text-xs px-3 py-4 text-center">No conversations yet.</p>
            )}

            {!isLoading && grouped.today.length > 0 && (
              <ConvGroup label="Today" convs={grouped.today} {...{ selectedId, editingId, editTitle, setEditTitle, startEdit, commitEdit, setEditingId, handleDelete, onSelect }} />
            )}
            {!isLoading && grouped.yesterday.length > 0 && (
              <ConvGroup label="Yesterday" convs={grouped.yesterday} {...{ selectedId, editingId, editTitle, setEditTitle, startEdit, commitEdit, setEditingId, handleDelete, onSelect }} />
            )}
            {!isLoading && grouped.older.length > 0 && (
              <ConvGroup label="Earlier" convs={grouped.older} {...{ selectedId, editingId, editTitle, setEditTitle, startEdit, commitEdit, setEditingId, handleDelete, onSelect }} />
            )}
          </nav>
        </>
      )}
    </aside>
  );
}

interface ConvGroupProps {
  label: string;
  convs: Conversation[];
  selectedId: string | null;
  editingId: string | null;
  editTitle: string;
  setEditTitle: (v: string) => void;
  startEdit: (conv: Conversation, e: React.MouseEvent) => void;
  commitEdit: (id: string) => void;
  setEditingId: (id: string | null) => void;
  handleDelete: (id: string, e: React.MouseEvent) => void;
  onSelect: (conv: Conversation) => void;
}

function ConvGroup({ label, convs, selectedId, editingId, editTitle, setEditTitle, startEdit, commitEdit, setEditingId, handleDelete, onSelect }: ConvGroupProps) {
  return (
    <div className="mb-3">
      <p className="px-3 py-1 text-[10px] font-medium text-gray-400 uppercase tracking-wider">{label}</p>
      {convs.map((conv) => (
        <div
          key={conv.id}
          onClick={() => onSelect(conv)}
          className={cn(
            "group flex items-center gap-2 px-3 py-2 rounded-lg cursor-pointer transition-colors mx-0.5",
            selectedId === conv.id
              ? "bg-gray-100 text-black"
              : "text-gray-600 hover:bg-gray-50 hover:text-black"
          )}
        >
          {editingId === conv.id ? (
            <div className="flex-1 flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
              <input
                autoFocus
                value={editTitle}
                onChange={(e) => setEditTitle(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") commitEdit(conv.id);
                  if (e.key === "Escape") setEditingId(null);
                }}
                className="flex-1 bg-white border border-gray-200 text-black text-xs px-2 py-1 rounded-md outline-none min-w-0 focus:border-gray-400"
              />
              <button onClick={() => commitEdit(conv.id)} className="text-black hover:text-gray-600 shrink-0">
                <Check className="w-3 h-3" />
              </button>
              <button onClick={() => setEditingId(null)} className="text-gray-400 hover:text-black shrink-0">
                <X className="w-3 h-3" />
              </button>
            </div>
          ) : (
            <>
              <span className="flex-1 text-xs truncate">{conv.title}</span>
              <div className="hidden group-hover:flex items-center gap-0.5 shrink-0">
                <button
                  onClick={(e) => startEdit(conv, e)}
                  className="p-1 rounded text-gray-400 hover:text-black hover:bg-gray-200 transition"
                >
                  <Pencil className="w-3 h-3" />
                </button>
                <button
                  onClick={(e) => handleDelete(conv.id, e)}
                  className="p-1 rounded text-gray-400 hover:text-red-500 hover:bg-red-50 transition"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
            </>
          )}
        </div>
      ))}
    </div>
  );
}
