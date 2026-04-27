"use client";

import { useEffect, useRef, useState } from "react";

interface CutterHeaderProps {
  documentWords: number;
  cutWords: number;
  goal: number | null;
  onSetGoal: (goal: number | null) => void;
}

export function CutterHeader({
  documentWords,
  cutWords,
  goal,
  onSetGoal,
}: CutterHeaderProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  const commit = () => {
    const parsed = Number.parseInt(draft.trim(), 10);
    if (Number.isFinite(parsed) && parsed > 0) {
      onSetGoal(parsed);
    }
    setEditing(false);
    setDraft("");
  };

  const cancel = () => {
    setEditing(false);
    setDraft("");
  };

  const fillFraction =
    goal != null && goal > 0 ? Math.min(cutWords / goal, 1) : 0;
  const complete = goal != null && cutWords >= goal;

  return (
    <div className="px-3 pt-2 pb-2 border-b border-edge-subtle space-y-1.5">
      <div className="flex items-baseline gap-2">
        <span className="text-sm font-medium text-ink-strong tabular-nums leading-none">
          {documentWords.toLocaleString()}
        </span>
        <span className="text-[10px] text-[var(--muted)] uppercase tracking-wide">
          words
        </span>
        <div className="flex-1" />
        {goal == null && !editing && (
          <button
            type="button"
            onClick={() => {
              setDraft("");
              setEditing(true);
            }}
            className="text-[11px] text-[var(--muted)] hover:text-[var(--accent)] hover-on-light px-1.5 py-0.5 rounded transition-colors"
            title="Set a word-count cutting goal"
          >
            +Goal
          </button>
        )}
        {editing && (
          <div className="flex items-center gap-1">
            <input
              ref={inputRef}
              type="number"
              min={1}
              inputMode="numeric"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={commit}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  commit();
                } else if (e.key === "Escape") {
                  e.preventDefault();
                  cancel();
                }
              }}
              placeholder="Goal"
              className="w-20 bg-surface border border-[var(--border)] rounded px-1.5 py-0.5 text-xs text-ink-strong focus:outline-none focus:border-edge-strong tabular-nums"
            />
          </div>
        )}
      </div>

      {goal != null && (
        <div className="group">
          <div className="flex items-baseline gap-1.5 mb-1">
            <span className="text-[11px] text-ink-body tabular-nums">
              <span className="font-medium text-ink-strong">
                {cutWords.toLocaleString()}
              </span>{" "}
              of {goal.toLocaleString()} cut
            </span>
            <div className="flex-1" />
            {complete && (
              <span className="text-[10px] text-emerald-600 font-medium uppercase tracking-wide">
                Goal hit
              </span>
            )}
            <button
              type="button"
              onClick={() => onSetGoal(null)}
              className="opacity-0 group-hover:opacity-100 text-[10px] text-[var(--muted)] hover:text-red-500 px-1 transition-opacity"
              title="Clear goal"
              aria-label="Clear goal"
            >
              ✕
            </button>
          </div>
          <div className="h-1.5 rounded-full overflow-hidden bg-[var(--border-light)]">
            <div
              className={`h-full transition-all ${complete ? "bg-emerald-500" : "bg-[var(--accent)]"}`}
              style={{ width: `${Math.round(fillFraction * 100)}%` }}
            />
          </div>
        </div>
      )}
    </div>
  );
}
