"use client";

import type { Suggestion } from "@/lib/types";

interface RevisionsHeaderBarProps {
  suggestions: Suggestion[];
  currentIndex: number;
  onJump: (index: number) => void;
}

/** In-panel suggestion-review progress bar. Mounted in the Revisions
 *  panel header (between PanelHeader and the card list). Hidden when
 *  there are no suggestions in the document — comments-only documents
 *  show no bar. */
export function RevisionsHeaderBar({
  suggestions,
  currentIndex,
  onJump,
}: RevisionsHeaderBarProps) {
  if (suggestions.length === 0) return null;

  const completed = suggestions.filter((s) => s.status !== "pending").length;
  const isComplete = completed === suggestions.length;

  return (
    <div className="px-3 pt-2 pb-2 border-b border-edge-subtle">
      <div className="flex items-center gap-2">
        <span className="text-[11px] text-[var(--muted)] whitespace-nowrap">
          {isComplete
            ? "Review complete"
            : `Suggestion ${Math.min(currentIndex + 1, suggestions.length)} of ${suggestions.length}`}
        </span>

        <div className="flex-1 flex gap-0.5 h-1.5 rounded-full overflow-hidden bg-[var(--border-light)]">
          {suggestions.map((s, i) => {
            let bg = "bg-edge-subtle"; // pending
            if (s.status === "accepted") bg = "bg-emerald-500";
            else if (s.status === "rejected") bg = "bg-red-400";
            else if (s.status === "skipped") bg = "bg-edge-strong";
            else if (i === currentIndex) bg = "bg-blue-500 animate-pulse";

            return (
              <button
                key={s.id}
                onClick={() => onJump(i)}
                className={`flex-1 ${bg} transition-colors hover:opacity-80 rounded-sm`}
                title={`Suggestion ${i + 1}: ${s.status}`}
              />
            );
          })}
        </div>

        <span className="text-[10px] text-[var(--muted-light)] tabular-nums">
          {completed}/{suggestions.length}
        </span>
      </div>
    </div>
  );
}
