"use client";

import { useState, useRef, useCallback } from "react";
import { ArrowUp, Building2, Users, Globe, BarChart3, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { BackgroundPaths } from "@/components/ui/background-paths";

interface RuixenMoonChatProps {
  onSubmit: (message: string) => void;
  isLoading?: boolean;
}

export default function RuixenMoonChat({ onSubmit, isLoading = false }: RuixenMoonChatProps) {
  const [message, setMessage] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const adjustHeight = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, []);

  const handleSubmit = () => {
    const t = message.trim();
    if (!t || isLoading) return;
    onSubmit(t);
    setMessage("");
    if (textareaRef.current) textareaRef.current.style.height = "auto";
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const canSend = message.trim().length > 0 && !isLoading;

  const quickActions = [
    { icon: Building2, label: "Company intel" },
    { icon: Users, label: "Find contacts" },
    { icon: Globe, label: "Web search" },
    { icon: BarChart3, label: "Market data" },
  ];

  return (
    <BackgroundPaths>
      <div className="flex flex-col items-center justify-center h-full w-full px-6">
        {/* Headline */}
        <div className="text-center mb-10 space-y-2.5">
          <h1 className="text-[2.25rem] font-semibold tracking-tight text-black leading-tight">
            Orthogonal AI
          </h1>
          <p className="text-gray-400 text-[0.95rem]">
            Business intelligence at the speed of conversation.
          </p>
        </div>

        {/* Input card */}
        <div className="w-full max-w-[640px]">
          <div
            className={cn(
              "flex flex-col rounded-2xl border border-gray-200 bg-white/90 backdrop-blur-sm",
              "transition-all duration-150",
              "focus-within:border-gray-300 focus-within:shadow-[0_2px_16px_rgba(0,0,0,0.06)]"
            )}
          >
            <textarea
              ref={textareaRef}
              value={message}
              onChange={(e) => {
                setMessage(e.target.value);
                adjustHeight();
              }}
              onKeyDown={handleKeyDown}
              placeholder="Ask about a company, find contacts, or search the web…"
              rows={1}
              style={{ overflow: "hidden" }}
              className="w-full px-5 pt-4 pb-2 resize-none bg-transparent text-black text-sm placeholder:text-gray-400 focus:outline-none min-h-[52px] leading-relaxed"
            />

            <div className="flex items-center justify-between px-3 pb-3 pt-1 gap-2">
              {/* Quick action chips */}
              <div className="flex flex-wrap gap-1.5">
                {quickActions.map(({ icon: Icon, label }) => (
                  <button
                    key={label}
                    onClick={() => {
                      setMessage(label + ": ");
                      textareaRef.current?.focus();
                      adjustHeight();
                    }}
                    className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium text-gray-500 hover:text-black hover:bg-gray-100 transition border border-transparent hover:border-gray-200"
                  >
                    <Icon className="w-3 h-3" />
                    {label}
                  </button>
                ))}
              </div>

              {/* Send button */}
              <button
                onClick={handleSubmit}
                disabled={!canSend}
                className={cn(
                  "w-8 h-8 rounded-full flex items-center justify-center transition-all shrink-0",
                  canSend
                    ? "bg-black text-white hover:bg-gray-800 shadow-sm"
                    : "bg-gray-100 text-gray-300 cursor-not-allowed"
                )}
              >
                {isLoading ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <ArrowUp className="w-3.5 h-3.5" />
                )}
              </button>
            </div>
          </div>

          <p className="text-center text-[11px] text-gray-300 mt-4">
            Powered by Orthogonal · Enter to send · Shift+Enter for new line
          </p>
        </div>
      </div>
    </BackgroundPaths>
  );
}
