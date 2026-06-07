"use client";

import { useEffect, useRef, useState } from "react";
import type { CutterGoal } from "@/lib/types";

interface CutterGoalStripProps {
  goal: CutterGoal | null;
  currentWords: number;
  onSetGoal: (target: number, initialWords: number) => void;
  onClearGoal: () => void;
}

const fmt = (n: number) => n.toLocaleString();

export function CutterGoalStrip({
  goal,
  currentWords,
  onSetGoal,
  onClearGoal,
}: CutterGoalStripProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  const startEditing = () => {
    setDraft(goal ? String(goal.target) : "");
    setEditing(true);
  };

  const commit = () => {
    const target = parseInt(draft.trim(), 10);
    if (Number.isFinite(target) && target >= 0) {
      onSetGoal(target, currentWords);
    }
    setEditing(false);
  };

  const cancel = () => {
    setEditing(false);
    setDraft("");
  };

  if (editing) {
    return (
      <div className="px-3 py-1.5 flex items-center gap-2 text-[11px] border-b border-edge-subtle">
        <span className="text-[var(--muted)]">{fmt(currentWords)} words</span>
        <input
          ref={inputRef}
          type="number"
          min={0}
          inputMode="numeric"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commit();
            } else if (e.key === "Escape") {
              e.preventDefault();
              cancel();
            }
          }}
          onBlur={commit}
          placeholder="goal"
          className="ml-auto w-20 bg-surface border border-[var(--border)] rounded px-1.5 py-0.5 text-[11px] text-ink-strong focus:outline-none focus:border-edge-strong"
        />
      </div>
    );
  }

  if (!goal) {
    return (
      <div className="px-3 py-1.5 flex items-center gap-2 text-[11px] border-b border-edge-subtle">
        <span className="text-[var(--muted)]">{fmt(currentWords)} words</span>
        <button
          type="button"
          onClick={startEditing}
          className="ml-auto text-[var(--muted)] hover:text-ink-strong cursor-pointer rounded px-1.5 py-0.5 hover-on-light"
          title="Set a target word count"
          data-hint="Set goal"
        >
          + goal
        </button>
      </div>
    );
  }

  const totalToCut = Math.max(0, goal.initialWords - goal.target);
  const cutSoFar = Math.max(0, goal.initialWords - currentWords);
  const leftToCut = Math.max(0, currentWords - goal.target);
  const reached = currentWords <= goal.target;
  const progress = totalToCut === 0 ? 1 : Math.min(1, cutSoFar / totalToCut);
  const pct = Math.round(progress * 100);

  return (
    <div className="px-3 py-1.5 border-b border-edge-subtle">
      <div className="flex items-center gap-2 text-[11px] mb-1">
        <span className={reached ? "text-emerald-700" : "text-ink-body"}>
          {reached ? "goal reached" : `${fmt(leftToCut)} words to cut`}
        </span>
        <button
          type="button"
          onClick={startEditing}
          className="ml-auto text-[var(--muted-light)] hover:text-ink-strong cursor-pointer text-[10px] rounded px-1 py-0.5 hover-on-light"
          title="Edit goal"
          data-hint="Edit goal"
        >
          edit
        </button>
        <button
          type="button"
          onClick={onClearGoal}
          className="text-[var(--muted-light)] hover:text-ink-strong cursor-pointer text-[10px] rounded px-1 py-0.5 hover-on-light"
          title="Clear goal"
          data-hint="Clear goal"
          aria-label="Clear goal"
        >
          ✕
        </button>
      </div>
      <div className="h-1.5 w-full rounded-full bg-edge-subtle overflow-hidden">
        <div
          className={`h-full ${reached ? "bg-emerald-500" : "bg-[var(--accent)]"} transition-[width] duration-200`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="mt-1 text-[10px] text-[var(--muted-light)]">
        {fmt(currentWords)} / {fmt(goal.target)}
      </div>
    </div>
  );
}
