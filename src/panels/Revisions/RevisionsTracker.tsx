"use client";

import { useEffect, useRef, useState } from "react";
import type { RevisionsTracker } from "@/lib/types";

interface RevisionsTrackerStripProps {
  tracker: RevisionsTracker | null;
  acceptedCount: number;
  totalCount: number;
  onSetTarget: (target: number | null) => void;
}

const fmt = (n: number) => n.toLocaleString();

export function RevisionsTrackerStrip({
  tracker,
  acceptedCount,
  totalCount,
  onSetTarget,
}: RevisionsTrackerStripProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  const startEditing = () => {
    setDraft(tracker?.target != null ? String(tracker.target) : "");
    setEditing(true);
  };

  const commit = () => {
    const trimmed = draft.trim();
    if (trimmed === "") {
      onSetTarget(null);
    } else {
      const target = parseInt(trimmed, 10);
      if (Number.isFinite(target) && target >= 0) onSetTarget(target);
    }
    setEditing(false);
  };

  const cancel = () => {
    setEditing(false);
    setDraft("");
  };

  const target = tracker?.target ?? null;
  const summary = `${fmt(acceptedCount)} of ${fmt(totalCount)} accepted`;

  if (editing) {
    return (
      <div className="px-3 py-1.5 flex items-center gap-2 text-[11px] border-b border-edge-subtle">
        <span className="text-[var(--muted)]">{summary}</span>
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

  if (target == null) {
    return (
      <div className="px-3 py-1.5 flex items-center gap-2 text-[11px] border-b border-edge-subtle">
        <span className="text-[var(--muted)]">{summary}</span>
        <button
          type="button"
          onClick={startEditing}
          className="ml-auto text-[var(--muted)] hover:text-ink-strong cursor-pointer rounded px-1.5 py-0.5 hover-on-light"
          title="Set a target number of revisions to accept"
          data-helper="Set goal"
        >
          + goal
        </button>
      </div>
    );
  }

  const reached = acceptedCount >= target;
  const remaining = Math.max(0, target - acceptedCount);
  const progress = target === 0 ? 1 : Math.min(1, acceptedCount / target);
  const pct = Math.round(progress * 100);

  return (
    <div className="px-3 py-1.5 border-b border-edge-subtle">
      <div className="flex items-center gap-2 text-[11px] mb-1">
        <span className={reached ? "text-emerald-700" : "text-ink-body"}>
          {reached
            ? "goal reached"
            : `${fmt(remaining)} ${remaining === 1 ? "revision" : "revisions"} to go`}
        </span>
        <button
          type="button"
          onClick={startEditing}
          className="ml-auto text-[var(--muted-light)] hover:text-ink-strong cursor-pointer text-[10px] rounded px-1 py-0.5 hover-on-light"
          title="Edit goal"
          data-helper="Edit goal"
        >
          edit
        </button>
        <button
          type="button"
          onClick={() => onSetTarget(null)}
          className="text-[var(--muted-light)] hover:text-ink-strong cursor-pointer text-[10px] rounded px-1 py-0.5 hover-on-light"
          title="Clear goal"
          data-helper="Clear goal"
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
        {fmt(acceptedCount)} / {fmt(target)} · {fmt(totalCount)} total
      </div>
    </div>
  );
}
