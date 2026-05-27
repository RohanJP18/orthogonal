"use client";

import React, { useState, useRef, useEffect } from "react";
import {
  Loader2,
  AlertCircle,
  RefreshCw,
  X,
  RefreshCcw,
  TriangleAlert,
  Wrench,
} from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { cn } from "@/lib/utils";
import type { Conversation, Message } from "@/lib/db/schema";
import { parseSSEEvent } from "@/lib/llm/orchestrator";
import type { CompanyProfile, PersonProfile, WebResults, PeopleSearchResults } from "@/lib/orthogonal/normalizer";
import { CompanyCard, PersonCard, WebResultsCard, PeopleSearchCard } from "@/components/chat/tool-result-cards";
import { AIChatInput } from "@/components/ui/ai-input";

interface ConversationViewProps {
  conversation: Conversation;
  initialMessages: Message[];
  pendingMessage?: string | null;
  onPendingMessageSent?: () => void;
  onNewMessage?: (msg: Message) => void;
}

interface ToolResultMeta {
  fromCache?: boolean;
  fetchedAt?: string;
  toolCallId: string;
}

function CrescentMark({ size = 14 }: { size?: number }) {
  // Use clipPath (not mask) to avoid DOM id collisions when many are rendered
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="50" cy="50" r="44" fill="black" />
      <circle cx="68" cy="38" r="34" fill="white" />
    </svg>
  );
}

export default function ConversationView({
  conversation,
  initialMessages,
  pendingMessage,
  onPendingMessageSent,
  onNewMessage,
}: ConversationViewProps) {
  const qc = useQueryClient();
  const [messages, setMessages] = useState<Message[]>(initialMessages);
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingContent, setStreamingContent] = useState("");
  const [activeToolName, setActiveToolName] = useState<string | null>(null);
  const [lastToolResult, setLastToolResult] = useState<ToolResultMeta | null>(null);
  const [streamError, setStreamError] = useState<string | null>(null);
  const [pendingRetry, setPendingRetry] = useState<string | null>(null);
  const [quotaWarning, setQuotaWarning] = useState<number | null>(null);
  const [bypassCache, setBypassCache] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const sentPendingRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  const pendingToolMsgsRef = useRef<Message[]>([]);
  const toolCallNamesRef = useRef<Map<string, string>>(new Map());

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamingContent]);

  useEffect(() => {
    if (pendingMessage && !sentPendingRef.current) {
      sentPendingRef.current = true;
      sendMessage(pendingMessage).then(() => onPendingMessageSent?.());
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingMessage]);

  const cancelStream = () => {
    abortRef.current?.abort();
    setIsStreaming(false);
    setStreamingContent("");
    setActiveToolName(null);
    setLastToolResult(null);
    setStreamError(null);
    setPendingRetry(null);
    pendingToolMsgsRef.current = [];
    toolCallNamesRef.current.clear();
  };

  const sendMessage = async (text: string) => {
    if (!text || isStreaming) return;

    abortRef.current?.abort();
    const abort = new AbortController();
    abortRef.current = abort;

    setIsStreaming(true);
    setStreamingContent("");
    setActiveToolName(null);
    setLastToolResult(null);
    setStreamError(null);
    setPendingRetry(null);
    pendingToolMsgsRef.current = [];
    toolCallNamesRef.current.clear();

    const timeoutId = setTimeout(() => abort.abort(), 60_000);

    const tempUserMsg: Message = {
      id: crypto.randomUUID(),
      conversationId: conversation.id,
      role: "user",
      content: text,
      toolName: null,
      toolCallId: null,
      orthogonalCostCents: 0,
      llmPromptTokens: 0,
      llmCompletionTokens: 0,
      storageKey: null,
      createdAt: new Date(),
    };
    setMessages((prev) => [...prev, tempUserMsg]);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversationId: conversation.id, content: text, bypassCache }),
        signal: abort.signal,
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error ?? "Request failed");
      }

      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let fullContent = "";
      let buffer = "";
      let sseComplete = false;

      while (!sseComplete) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          const event = parseSSEEvent(line);
          if (!event) continue;

          if (event.type === "quota_warning") {
            setQuotaWarning(event.percentUsed);
          } else if (event.type === "delta") {
            fullContent += event.content;
            setStreamingContent(fullContent);
          } else if (event.type === "tool_call") {
            toolCallNamesRef.current.set(event.toolCallId, event.toolName);
            setActiveToolName(event.toolName);
            setLastToolResult(null);
          } else if (event.type === "tool_result") {
            const toolName = toolCallNamesRef.current.get(event.toolCallId) ?? "";
            pendingToolMsgsRef.current.push({
              id: crypto.randomUUID(),
              conversationId: conversation.id,
              role: "tool",
              content: JSON.stringify(event.result),
              toolName,
              toolCallId: event.toolCallId,
              orthogonalCostCents: event.priceCents ?? 0,
              llmPromptTokens: 0,
              llmCompletionTokens: 0,
              storageKey: null,
              createdAt: new Date(),
            });
            setActiveToolName(null);
            setLastToolResult({
              fromCache: event.fromCache,
              fetchedAt: event.fetchedAt,
              toolCallId: event.toolCallId,
            });
          } else if (event.type === "done") {
            const assistantMsg: Message = {
              id: crypto.randomUUID(),
              conversationId: conversation.id,
              role: "assistant",
              content: fullContent,
              toolName: null,
              toolCallId: null,
              orthogonalCostCents: event.orthogonalCostCents ?? 0,
              llmPromptTokens: event.promptTokens ?? 0,
              llmCompletionTokens: event.completionTokens ?? 0,
              storageKey: null,
              createdAt: new Date(),
            };
            const toolMsgs = pendingToolMsgsRef.current;
            pendingToolMsgsRef.current = [];
            setMessages((prev) => {
              const updated = [...prev, ...toolMsgs, assistantMsg];
              qc.setQueryData(
                ["conversation", conversation.id],
                (old: Record<string, unknown> | undefined) => ({
                  ...(old ?? {}),
                  messages: updated,
                })
              );
              return updated;
            });
            setStreamingContent("");
            setLastToolResult(null);
            onNewMessage?.(assistantMsg);
            sseComplete = true;
            break;
          } else if (event.type === "error") {
            throw new Error(event.message);
          }
        }
      }
    } catch (err) {
      clearTimeout(timeoutId);
      const isTimeout = err instanceof Error && err.name === "AbortError";
      const errText = isTimeout
        ? "Request timed out after 60 seconds."
        : `Error: ${err instanceof Error ? err.message : "Something went wrong"}`;
      setStreamError(errText);
      setPendingRetry(text);
      setStreamingContent("");
    } finally {
      clearTimeout(timeoutId);
      setIsStreaming(false);
      setActiveToolName(null);
    }
  };

  return (
    <div className="flex flex-col h-full bg-white">
      {/* Header */}
      <header className="flex items-center justify-between px-6 py-3.5 border-b border-gray-100 shrink-0">
        <h1 className="text-sm font-medium text-black truncate max-w-md">{conversation.title}</h1>
        <button
          onClick={() => setBypassCache((v) => !v)}
          title={bypassCache ? "Fresh data (cache bypassed)" : "Cached data — click for fresh"}
          className={cn(
            "flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium border transition",
            bypassCache
              ? "bg-black text-white border-black"
              : "text-gray-400 border-gray-200 hover:border-gray-300 hover:text-gray-600"
          )}
        >
          <RefreshCcw className="w-2.5 h-2.5" />
          {bypassCache ? "Fresh" : "Cached"}
        </button>
      </header>

      {/* Quota warning */}
      {quotaWarning !== null && (
        <div className="flex items-center gap-2 px-6 py-2 bg-amber-50 border-b border-amber-100 text-xs text-amber-600 shrink-0">
          <TriangleAlert className="w-3.5 h-3.5 shrink-0" />
          <span className="flex-1">
            You&apos;ve used <strong>{quotaWarning}%</strong> of this conversation&apos;s context budget.
          </span>
          <button onClick={() => setQuotaWarning(null)} className="p-0.5 rounded hover:bg-amber-100">
            <X className="w-3 h-3" />
          </button>
        </div>
      )}

      {/* Messages */}
      <main className="flex-1 overflow-y-auto">
        <div className="max-w-3xl mx-auto px-6 py-6 space-y-5">
          {messages.length === 0 && !streamingContent && (
            <p className="text-center text-gray-300 text-sm mt-20">
              Ask anything — company profiles, contacts, market research.
            </p>
          )}

          {messages.map((msg) => (
            <MessageRow key={msg.id} message={msg} />
          ))}

          {/* Active tool indicator */}
          {activeToolName && (
            <div className="flex items-center gap-2 text-xs text-gray-400">
              <Wrench className="w-3.5 h-3.5 animate-pulse" />
              <span>
                Calling{" "}
                <span className="font-mono bg-gray-50 border border-gray-100 px-1.5 py-0.5 rounded text-[11px]">
                  {activeToolName}
                </span>
                …
              </span>
            </div>
          )}

          {/* Data freshness label */}
          {lastToolResult && !activeToolName && isStreaming && (
            <div className="flex items-center gap-1.5 text-[11px] text-gray-400">
              {lastToolResult.fromCache && lastToolResult.fetchedAt ? (
                <span>Cached · {new Date(lastToolResult.fetchedAt).toLocaleTimeString()}</span>
              ) : (
                <span>Live data retrieved</span>
              )}
            </div>
          )}

          {/* Streaming response */}
          {streamingContent && (
            <div className="flex items-start gap-3">
              <div className="mt-1 shrink-0">
                <CrescentMark size={14} />
              </div>
              <p className="text-gray-800 text-sm leading-relaxed whitespace-pre-wrap">
                {streamingContent}
                <span className="inline-block w-0.5 h-3.5 bg-gray-400 animate-pulse ml-0.5 align-middle" />
              </p>
            </div>
          )}

          {/* Thinking indicator */}
          {isStreaming && !streamingContent && !activeToolName && (
            <div className="flex items-center gap-2 text-xs text-gray-400">
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              <span>Thinking…</span>
            </div>
          )}

          <div ref={bottomRef} />
        </div>
      </main>

      {/* Error bar */}
      {streamError && (
        <div className="px-6 py-2 shrink-0">
          <div className="max-w-3xl mx-auto flex items-center gap-2 px-3 py-2.5 rounded-xl bg-red-50 border border-red-100 text-xs text-red-600">
            <AlertCircle className="w-3.5 h-3.5 shrink-0" />
            <span className="flex-1">{streamError}</span>
            {pendingRetry && (
              <button
                onClick={() => { setStreamError(null); sendMessage(pendingRetry); }}
                className="flex items-center gap-1 px-2 py-1 rounded-lg bg-red-100 hover:bg-red-200 transition font-medium shrink-0"
              >
                <RefreshCw className="w-3 h-3" /> Retry
              </button>
            )}
            <button onClick={cancelStream} className="p-0.5 rounded hover:bg-red-100 shrink-0">
              <X className="w-3 h-3" />
            </button>
          </div>
        </div>
      )}

      {/* Input */}
      <footer className="pb-5 pt-3 shrink-0 flex justify-center">
        <AIChatInput onSubmit={sendMessage} isLoading={isStreaming} />
      </footer>
    </div>
  );
}

function MessageRow({ message }: { message: Message }) {
  const isUser = message.role === "user";
  const isTool = message.role === "tool";

  if (isTool) {
    let parsed: unknown = null;
    try { parsed = JSON.parse(message.content ?? ""); } catch { /* raw fallback */ }

    if (parsed && message.toolName === "get_company") return <CompanyCard data={parsed as CompanyProfile} />;
    if (parsed && message.toolName === "enrich_person") return <PersonCard data={parsed as PersonProfile} />;
    if (parsed && message.toolName === "web_search") return <WebResultsCard data={parsed as WebResults} />;
    if (parsed && message.toolName === "search_people") return <PeopleSearchCard data={parsed as PeopleSearchResults} />;

    return (
      <div className="flex items-start gap-2 text-xs text-gray-400 bg-gray-50 border border-gray-100 rounded-lg px-3 py-2">
        <Wrench className="w-3.5 h-3.5 mt-0.5 shrink-0" />
        <span className="font-mono break-all">{message.content}</span>
      </div>
    );
  }

  if (isUser) {
    return (
      <div className="flex justify-end">
        <div className="max-w-[72%] bg-black text-white px-4 py-2.5 rounded-2xl rounded-br-sm text-sm whitespace-pre-wrap leading-relaxed">
          {message.content}
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-start gap-3">
      <div className="mt-1 shrink-0">
        <CrescentMark size={14} />
      </div>
      <p className="text-gray-800 text-sm leading-relaxed whitespace-pre-wrap">{message.content}</p>
    </div>
  );
}
