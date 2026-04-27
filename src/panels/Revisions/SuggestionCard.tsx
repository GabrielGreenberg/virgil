"use client";

import { useEffect } from "react";
import type { Suggestion } from "@/lib/types";
import { Button, themedCard, themedCardStyle } from "@/components/panel-primitives";
import { useCardTheme } from "@/hooks/usePanelTheme";

const STATUS_DOT_COLOR: Record<Suggestion["status"], string> = {
  pending: "bg-blue-400",
  accepted: "bg-emerald-500",
  rejected: "bg-red-400",
  skipped: "bg-edge-strong",
};

const STATUS_LABEL: Record<Suggestion["status"], string> = {
  pending: "Pending",
  accepted: "Accepted",
  rejected: "Rejected",
  skipped: "Skipped",
};

interface SuggestionCardProps {
  suggestion: Suggestion;
  selected: boolean;
  onSelect: (id: string | null) => void;
  onAct: (id: string, action: "accepted" | "rejected" | "skipped") => void;
  onUpdateField: (id: string, field: "revision" | "note", value: string) => void;
}

export function SuggestionCard({
  suggestion,
  selected,
  onSelect,
  onAct,
  onUpdateField,
}: SuggestionCardProps) {
  const theme = useCardTheme("revision");
  const isPending = suggestion.status === "pending";

  // Keyboard shortcuts active only when this card is selected and pending.
  useEffect(() => {
    if (!selected || !isPending) return;
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
  }, [selected, isPending, suggestion.id, onAct]);

  const dot = (
    <span
      className={`inline-block w-2 h-2 rounded-full shrink-0 ${STATUS_DOT_COLOR[suggestion.status]}`}
      title={STATUS_LABEL[suggestion.status]}
    />
  );

  return (
    <div
      data-suggestion-entry={suggestion.id}
      className={`${themedCard(theme, selected)} overflow-hidden cursor-pointer mb-2`}
      style={themedCardStyle(theme, selected)}
      onClick={(e) => {
        e.stopPropagation();
        onSelect(selected ? null : suggestion.id);
      }}
    >
      {!selected ? (
        <div className="px-3 py-2 flex items-center gap-2">
          {dot}
          <span className="flex-1 min-w-0 text-xs text-ink-body truncate">
            {suggestion.explanation || (
              <span className="italic text-ink-muted">No explanation</span>
            )}
          </span>
          <span className="text-[10px] text-ink-muted whitespace-nowrap">
            {STATUS_LABEL[suggestion.status]}
          </span>
        </div>
      ) : (
        <div className="p-3 space-y-3" onClick={(e) => e.stopPropagation()}>
          <div className="flex items-center gap-2">
            {dot}
            <span className="flex-1 text-[10px] text-[var(--muted)] uppercase tracking-wider font-medium">
              Suggestion
            </span>
            <span className="text-[10px] text-ink-muted">
              {STATUS_LABEL[suggestion.status]}
            </span>
          </div>

          <p className="text-xs text-ink-body leading-relaxed">
            {suggestion.explanation}
          </p>

          <div>
            <div className="text-[10px] text-[var(--muted)] uppercase tracking-wider font-medium mb-1">
              Original
            </div>
            <div className="bg-danger-soft border border-red-200 rounded px-2 py-1.5">
              <p className="text-red-700 text-xs leading-relaxed line-through decoration-red-300">
                {suggestion.original_text}
              </p>
            </div>
          </div>

          <div>
            <div className="text-[10px] text-[var(--muted)] uppercase tracking-wider font-medium mb-1">
              Suggested
            </div>
            <div className="bg-emerald-50 border border-emerald-200 rounded px-2 py-1.5">
              <p className="text-emerald-800 text-xs leading-relaxed">
                {suggestion.suggested_text}
              </p>
            </div>
          </div>

          <div>
            <div className="text-[10px] text-[var(--muted)] uppercase tracking-wider font-medium mb-1">
              Your revision{" "}
              <span className="text-[var(--muted-light)] normal-case">
                (optional)
              </span>
            </div>
            <textarea
              value={suggestion.revision}
              onChange={(e) =>
                onUpdateField(suggestion.id, "revision", e.target.value)
              }
              placeholder="Write your own version…"
              className="w-full bg-surface border border-[var(--border)] rounded px-2 py-1.5 text-xs text-ink-strong placeholder:text-ink-muted focus:outline-none focus:border-edge-strong resize-none min-h-[48px]"
              rows={2}
            />
          </div>

          <div>
            <div className="text-[10px] text-[var(--muted)] uppercase tracking-wider font-medium mb-1">
              Note{" "}
              <span className="text-[var(--muted-light)] normal-case">
                (optional)
              </span>
            </div>
            <textarea
              value={suggestion.note}
              onChange={(e) =>
                onUpdateField(suggestion.id, "note", e.target.value)
              }
              placeholder="Add a note…"
              className="w-full bg-surface border border-[var(--border)] rounded px-2 py-1.5 text-xs text-ink-strong placeholder:text-ink-muted focus:outline-none focus:border-edge-strong resize-none min-h-[36px]"
              rows={2}
            />
          </div>

          {isPending && (
            <div className="space-y-1">
              <div className="flex gap-1.5">
                <Button
                  variant="ghost"
                  size="sm"
                  className="flex-1"
                  onClick={(e) => {
                    e.stopPropagation();
                    onAct(suggestion.id, "skipped");
                  }}
                >
                  Skip
                </Button>
                <Button
                  variant="danger"
                  size="sm"
                  className="flex-1"
                  onClick={(e) => {
                    e.stopPropagation();
                    onAct(suggestion.id, "rejected");
                  }}
                >
                  Reject
                </Button>
                <Button
                  variant="warm"
                  size="sm"
                  className="flex-1"
                  onClick={(e) => {
                    e.stopPropagation();
                    onAct(suggestion.id, "accepted");
                  }}
                >
                  Accept
                </Button>
              </div>
              <p className="text-[10px] text-[var(--muted-light)] text-center">
                s = skip · n = reject · y / enter = accept
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
