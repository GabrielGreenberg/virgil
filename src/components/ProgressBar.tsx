"use client";

import type { Suggestion } from "@/lib/types";

interface ProgressBarProps {
  suggestions: Suggestion[];
  currentIndex: number;
  onJump: (index: number) => void;
}

export default function ProgressBar({
  suggestions,
  currentIndex,
  onJump,
}: ProgressBarProps) {
  if (suggestions.length === 0) return null;

  const completed = suggestions.filter((s) => s.status !== "pending").length;

  return (
    <div className="fixed top-0 left-0 right-0 z-50 bg-white/95 backdrop-blur-sm border-b border-[var(--border)] px-4 py-2">
      <div className="flex items-center gap-3 max-w-screen-2xl mx-auto">
        <span className="text-[var(--muted)] text-sm whitespace-nowrap">
          {completed === suggestions.length
            ? "Review complete"
            : `Suggestion ${Math.min(currentIndex + 1, suggestions.length)} of ${suggestions.length}`}
        </span>

        <div className="flex-1 flex gap-0.5 h-2 rounded-full overflow-hidden bg-[var(--border-light)]">
          {suggestions.map((s, i) => {
            let bg = "bg-stone-200"; // pending
            if (s.status === "accepted") bg = "bg-emerald-500";
            else if (s.status === "rejected") bg = "bg-red-400";
            else if (s.status === "skipped") bg = "bg-stone-400";
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

        <span className="text-[var(--muted-light)] text-xs">
          {completed}/{suggestions.length}
        </span>
      </div>
    </div>
  );
}
