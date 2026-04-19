"use client";

import { useEffect } from "react";
import type { Suggestion } from "@/lib/types";

interface SuggestionPanelProps {
  suggestion: Suggestion | null;
  isComplete: boolean;
  onAct: (id: string, action: "accepted" | "rejected" | "skipped") => void;
  onUpdateField: (id: string, field: "revision" | "note", value: string) => void;
  onClose: () => void;
  visible: boolean;
}

export default function SuggestionPanel({
  suggestion,
  isComplete,
  onAct,
  onUpdateField,
  onClose,
  visible,
}: SuggestionPanelProps) {
  // Keyboard shortcuts
  useEffect(() => {
    if (!visible || !suggestion || isComplete) return;

    const handleKey = (e: KeyboardEvent) => {
      if (
        e.target instanceof HTMLTextAreaElement ||
        e.target instanceof HTMLInputElement
      )
        return;

      if (e.key === "Enter" || e.key === "y") {
        e.preventDefault();
        onAct(suggestion.id, "accepted");
      } else if (e.key === "Backspace" || e.key === "n") {
        e.preventDefault();
        onAct(suggestion.id, "rejected");
      } else if (e.key === "Tab" || e.key === "s") {
        e.preventDefault();
        onAct(suggestion.id, "skipped");
      }
    };

    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [visible, suggestion, isComplete, onAct]);

  if (!visible) return null;

  if (isComplete) {
    return (
      <div className="w-96 border-l border-[var(--border)] bg-[var(--background)] p-6 flex flex-col items-center justify-center text-center shrink-0">
        <div className="text-3xl mb-4 text-emerald-600">&#10003;</div>
        <h3 className="text-ink-strong text-lg font-medium mb-2">
          Review Complete
        </h3>
        <p className="text-[var(--muted)] text-sm mb-6">
          You&apos;ve worked through all suggestions.
        </p>
        <button
          onClick={onClose}
          className="px-4 py-2 rounded bg-surface-muted-strong text-ink-body hover:bg-edge-subtle text-sm transition-colors"
        >
          Close Panel
        </button>
      </div>
    );
  }

  if (!suggestion) {
    return (
      <div className="w-96 border-l border-[var(--border)] bg-[var(--background)] p-6 flex items-center justify-center shrink-0">
        <p className="text-[var(--muted)] text-sm">No suggestions to show.</p>
      </div>
    );
  }

  return (
    <div className="w-96 border-l border-[var(--border)] bg-[var(--background)] flex flex-col shrink-0 overflow-hidden">
      <div className="flex-1 overflow-y-auto p-5 space-y-5">
        {/* Explanation */}
        <div>
          <label className="block text-[var(--muted)] text-xs uppercase tracking-wider mb-2 font-medium">
            Suggestion
          </label>
          <p className="text-ink-body text-sm leading-relaxed">
            {suggestion.explanation}
          </p>
        </div>

        {/* Original text */}
        <div>
          <label className="block text-[var(--muted)] text-xs uppercase tracking-wider mb-2 font-medium">
            Original
          </label>
          <div className="bg-danger-soft border border-red-200 rounded px-3 py-2">
            <p className="text-red-700 text-sm leading-relaxed line-through decoration-red-300">
              {suggestion.original_text}
            </p>
          </div>
        </div>

        {/* Suggested text */}
        <div>
          <label className="block text-[var(--muted)] text-xs uppercase tracking-wider mb-2 font-medium">
            Suggested
          </label>
          <div className="bg-emerald-50 border border-emerald-200 rounded px-3 py-2">
            <p className="text-emerald-800 text-sm leading-relaxed">
              {suggestion.suggested_text}
            </p>
          </div>
        </div>

        {/* User revision */}
        <div>
          <label className="block text-[var(--muted)] text-xs uppercase tracking-wider mb-2 font-medium">
            Your Revision{" "}
            <span className="text-[var(--muted-light)] normal-case">(optional)</span>
          </label>
          <textarea
            value={suggestion.revision}
            onChange={(e) =>
              onUpdateField(suggestion.id, "revision", e.target.value)
            }
            placeholder="Write your own version..."
            className="w-full bg-surface border border-[var(--border)] rounded px-3 py-2 text-ink-strong text-sm placeholder:text-ink-muted focus:outline-none focus:border-edge-strong resize-none min-h-[60px]"
            rows={3}
          />
        </div>

        {/* User note */}
        <div>
          <label className="block text-[var(--muted)] text-xs uppercase tracking-wider mb-2 font-medium">
            Note{" "}
            <span className="text-[var(--muted-light)] normal-case">(optional)</span>
          </label>
          <textarea
            value={suggestion.note}
            onChange={(e) =>
              onUpdateField(suggestion.id, "note", e.target.value)
            }
            placeholder="Add a note..."
            className="w-full bg-surface border border-[var(--border)] rounded px-3 py-2 text-ink-strong text-sm placeholder:text-ink-muted focus:outline-none focus:border-edge-strong resize-none min-h-[40px]"
            rows={2}
          />
        </div>
      </div>

      {/* Action buttons */}
      <div className="border-t border-[var(--border)] p-4 space-y-2">
        <div className="flex gap-2">
          <button
            onClick={() => onAct(suggestion.id, "skipped")}
            className="flex-1 px-3 py-2 rounded bg-surface-muted-strong text-ink-body hover:bg-edge-subtle text-sm font-medium transition-colors"
          >
            Skip
          </button>
          <button
            onClick={() => onAct(suggestion.id, "rejected")}
            className="flex-1 px-3 py-2 rounded bg-danger-soft text-red-700 hover:bg-red-100 text-sm font-medium transition-colors border border-red-200"
          >
            Reject
          </button>
          <button
            onClick={() => onAct(suggestion.id, "accepted")}
            className="flex-1 px-3 py-2 rounded bg-emerald-600 text-white hover:bg-emerald-700 text-sm font-medium transition-colors"
          >
            Accept
          </button>
        </div>
        <p className="text-[var(--muted-light)] text-[10px] text-center">
          s = skip &middot; n = reject &middot; y / enter = accept
        </p>
      </div>
    </div>
  );
}
