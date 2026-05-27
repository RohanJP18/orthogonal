"use client";

import React from "react";
import { cx } from "class-variance-authority";
import { AnimatePresence, motion } from "framer-motion";
import { cn } from "@/lib/utils";
import { Loader2 } from "lucide-react";

// ─── Color Orb ────────────────────────────────────────────────────────────────

interface OrbProps {
  dimension?: string;
  className?: string;
  tones?: { base?: string; accent1?: string; accent2?: string; accent3?: string };
  spinDuration?: number;
}

const ColorOrb: React.FC<OrbProps> = ({
  dimension = "24px",
  className,
  tones,
  spinDuration = 20,
}) => {
  const palette = {
    base: "oklch(22.64% 0 0)",
    accent1: "oklch(45% 0.1 350)",
    accent2: "oklch(50% 0.08 200)",
    accent3: "oklch(48% 0.09 280)",
    ...tones,
  };

  const dim = parseInt(dimension.replace("px", ""), 10);
  const blur = Math.max(dim * 0.015, 4);
  const contrast = Math.max(dim * 0.008, 1.5);
  const dot = Math.max(dim * 0.008, 0.1);
  const shadow = Math.max(dim * 0.008, 2);
  const mask = dim < 100 ? "15%" : "25%";

  return (
    <div
      className={cn("color-orb", className)}
      style={
        {
          width: dimension,
          height: dimension,
          "--base": palette.base,
          "--accent1": palette.accent1,
          "--accent2": palette.accent2,
          "--accent3": palette.accent3,
          "--spin-duration": `${spinDuration}s`,
          "--blur": `${blur}px`,
          "--contrast": contrast,
          "--dot": `${dot}px`,
          "--shadow": `${shadow}px`,
          "--mask": mask,
        } as React.CSSProperties
      }
    >
      <style jsx>{`
        @property --angle {
          syntax: "<angle>";
          inherits: false;
          initial-value: 0deg;
        }
        .color-orb {
          display: grid;
          grid-template-areas: "stack";
          overflow: hidden;
          border-radius: 50%;
          position: relative;
          transform: scale(1.1);
        }
        .color-orb::before,
        .color-orb::after {
          content: "";
          display: block;
          grid-area: stack;
          width: 100%;
          height: 100%;
          border-radius: 50%;
          transform: translateZ(0);
        }
        .color-orb::before {
          background:
            conic-gradient(from calc(var(--angle)*2) at 25% 70%, var(--accent3), transparent 20% 80%, var(--accent3)),
            conic-gradient(from calc(var(--angle)*2) at 45% 75%, var(--accent2), transparent 30% 60%, var(--accent2)),
            conic-gradient(from calc(var(--angle)*-3) at 80% 20%, var(--accent1), transparent 40% 60%, var(--accent1)),
            conic-gradient(from calc(var(--angle)*2) at 15% 5%, var(--accent2), transparent 10% 90%, var(--accent2)),
            conic-gradient(from calc(var(--angle)*1) at 20% 80%, var(--accent1), transparent 10% 90%, var(--accent1)),
            conic-gradient(from calc(var(--angle)*-2) at 85% 10%, var(--accent3), transparent 20% 80%, var(--accent3));
          box-shadow: inset var(--base) 0 0 var(--shadow) calc(var(--shadow) * 0.2);
          filter: blur(var(--blur)) contrast(var(--contrast));
          animation: spin var(--spin-duration) linear infinite;
        }
        .color-orb::after {
          background-image: radial-gradient(circle at center, var(--base) var(--dot), transparent var(--dot));
          background-size: calc(var(--dot)*2) calc(var(--dot)*2);
          backdrop-filter: blur(calc(var(--blur)*2)) contrast(calc(var(--contrast)*2));
          mix-blend-mode: overlay;
          mask-image: radial-gradient(black var(--mask), transparent 75%);
        }
        @keyframes spin { to { --angle: 360deg; } }
        @media (prefers-reduced-motion: reduce) { .color-orb::before { animation: none; } }
      `}</style>
    </div>
  );
};

// ─── Context ──────────────────────────────────────────────────────────────────

interface ContextShape {
  showForm: boolean;
  triggerOpen: () => void;
  triggerClose: () => void;
}

const FormContext = React.createContext({} as ContextShape);
const useFormContext = () => React.useContext(FormContext);

// ─── Main export ─────────────────────────────────────────────────────────────

interface AIChatInputProps {
  onSubmit: (text: string) => void;
  isLoading?: boolean;
}

const FORM_WIDTH = 480;
const FORM_HEIGHT = 160;

export function AIChatInput({ onSubmit, isLoading = false }: AIChatInputProps) {
  const wrapperRef = React.useRef<HTMLDivElement>(null);
  const textareaRef = React.useRef<HTMLTextAreaElement | null>(null);
  const [showForm, setShowForm] = React.useState(false);

  const triggerClose = React.useCallback(() => {
    setShowForm(false);
    textareaRef.current?.blur();
  }, []);

  const triggerOpen = React.useCallback(() => {
    if (isLoading) return;
    setShowForm(true);
    setTimeout(() => textareaRef.current?.focus());
  }, [isLoading]);

  React.useEffect(() => {
    function onOutsideClick(e: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node) && showForm) {
        triggerClose();
      }
    }
    document.addEventListener("mousedown", onOutsideClick);
    return () => document.removeEventListener("mousedown", onOutsideClick);
  }, [showForm, triggerClose]);

  function handleSuccess(text: string) {
    onSubmit(text);
    triggerClose();
  }

  const ctx = React.useMemo(
    () => ({ showForm, triggerOpen, triggerClose }),
    [showForm, triggerOpen, triggerClose]
  );

  return (
    <div className="flex items-end justify-center" style={{ width: FORM_WIDTH, height: FORM_HEIGHT }}>
      <motion.div
        ref={wrapperRef}
        className={cx("bg-white relative z-10 flex flex-col items-center overflow-hidden border border-gray-200")}
        initial={false}
        animate={{
          width: showForm ? FORM_WIDTH : "auto",
          height: showForm ? FORM_HEIGHT : 40,
          borderRadius: showForm ? 16 : 22,
          boxShadow: showForm
            ? "0 4px 24px rgba(0,0,0,0.08)"
            : "0 1px 4px rgba(0,0,0,0.06)",
        }}
        transition={{
          type: "spring",
          stiffness: 550,
          damping: 45,
          mass: 0.7,
          delay: showForm ? 0 : 0.06,
        }}
      >
        <FormContext.Provider value={ctx}>
          <DockBar isLoading={isLoading} />
          <InputForm ref={textareaRef} onSuccess={handleSuccess} isLoading={isLoading} />
        </FormContext.Provider>
      </motion.div>
    </div>
  );
}

// ─── Dock bar (collapsed state) ───────────────────────────────────────────────

function DockBar({ isLoading }: { isLoading: boolean }) {
  const { showForm, triggerOpen } = useFormContext();

  return (
    <footer className="mt-auto flex h-[40px] items-center justify-center whitespace-nowrap select-none shrink-0">
      <div className="flex items-center justify-center gap-2 px-3">
        <AnimatePresence mode="wait">
          {showForm ? (
            <motion.div key="blank" initial={{ opacity: 0 }} animate={{ opacity: 0 }} exit={{ opacity: 0 }} className="h-5 w-5" />
          ) : (
            <motion.div key="orb" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }}>
              <ColorOrb dimension="20px" />
            </motion.div>
          )}
        </AnimatePresence>

        <button
          type="button"
          onClick={triggerOpen}
          disabled={isLoading}
          className="flex h-fit items-center gap-1.5 rounded-full px-2 py-0.5 text-sm text-gray-500 hover:text-black transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {isLoading ? (
            <>
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              <span>Responding…</span>
            </>
          ) : (
            <span>Ask a follow-up…</span>
          )}
        </button>
      </div>
    </footer>
  );
}

// ─── Expanded form ────────────────────────────────────────────────────────────

function InputForm({
  ref,
  onSuccess,
  isLoading,
}: {
  ref: React.Ref<HTMLTextAreaElement>;
  onSuccess: (text: string) => void;
  isLoading: boolean;
}) {
  const { triggerClose, showForm } = useFormContext();
  const [value, setValue] = React.useState("");

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const text = value.trim();
    if (!text || isLoading) return;
    setValue("");
    onSuccess(text);
  }

  function handleKeys(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Escape") triggerClose();
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      const text = value.trim();
      if (text && !isLoading) {
        setValue("");
        onSuccess(text);
      }
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="absolute bottom-0"
      style={{ width: FORM_WIDTH, height: FORM_HEIGHT, pointerEvents: showForm ? "all" : "none" }}
    >
      <AnimatePresence>
        {showForm && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ type: "spring", stiffness: 550, damping: 45, mass: 0.7 }}
            className="flex h-full flex-col p-1"
          >
            {/* Header row */}
            <div className="flex items-center justify-between py-1 px-1">
              <div className="ml-9 flex items-center gap-1.5 select-none">
                <span className="text-xs text-gray-400 font-medium">Orthogonal AI</span>
              </div>
              <button
                type="submit"
                disabled={!value.trim() || isLoading}
                className="flex items-center gap-1 text-gray-400 hover:text-black transition-colors disabled:opacity-30 disabled:cursor-not-allowed pr-1"
              >
                <KeyHint>⌘</KeyHint>
                <KeyHint className="w-fit">Enter</KeyHint>
              </button>
            </div>

            {/* Textarea */}
            <textarea
              ref={ref}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder="Ask me anything…"
              className="h-full w-full resize-none scroll-py-2 rounded-xl p-3 text-sm text-black placeholder:text-gray-400 outline-none bg-gray-50 focus:bg-white transition-colors"
              onKeyDown={handleKeys}
              spellCheck={false}
              disabled={isLoading}
            />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Orb in corner when open */}
      <AnimatePresence>
        {showForm && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="absolute top-2.5 left-3 pointer-events-none"
          >
            <ColorOrb dimension="20px" />
          </motion.div>
        )}
      </AnimatePresence>
    </form>
  );
}

// ─── Key hint badge ───────────────────────────────────────────────────────────

function KeyHint({ children, className }: { children: string; className?: string }) {
  return (
    <kbd
      className={cx(
        "flex h-5 w-6 items-center justify-center rounded border border-gray-200 px-1 font-sans text-[10px] text-gray-400",
        className
      )}
    >
      {children}
    </kbd>
  );
}
