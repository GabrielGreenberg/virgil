"use client";

import { useEffect, useRef, useState } from "react";
import { Input } from "@/components/field-primitives";
import { iconHint } from "@/components/Hint";

/**
 * PanelGoalStrip — THE panel goal strip (task 2026-08-02-286).
 *
 * The thin band a card panel docks above its list to show "how far along am I
 * against a target": the Cutter's cut-goal and the Revisions tracker's
 * accepted-target. Both rendered the SAME three-state chrome from two
 * hand-maintained ~135-line files whose only genuine differences were
 * data-derived strings and one 0..1 number — the "two twins where one SSOT
 * should be" class this card family keeps producing.
 *
 * The three states, all owned here:
 *   1. EDITING  — summary + a numeric input (Enter commits, Escape cancels,
 *                 blur commits).
 *   2. NO GOAL  — summary + a `+ goal` button.
 *   3. PROGRESS — status label + `edit` / `✕` buttons, the progress track,
 *                 and a footer line.
 *
 * A caller supplies only what it alone can know: the strings, the clamped
 * fraction, and the two commit callbacks. It supplies NO chrome — that is the
 * whole point, and it is why `reached` is a caller-computed boolean rather
 * than a class name: the "goal reached" look is one decision, made here, in
 * `--positive` / `--positive-strong` (see STYLE_GUIDE "Positive"). Before
 * this, both twins spelled it `bg-emerald-500` / `text-emerald-700` — a
 * STYLE_GUIDE-banned raw palette literal with no token to swap to.
 *
 * ONE seam is deliberately left to the caller: what an EMPTY draft means.
 * `onCommit` receives `null` for an empty field, and the two panels answer it
 * differently today — Revisions clears its target, the Cutter ignores it
 * (clearing there discards the `initialWords` baseline that all cut-progress
 * is measured against, and ✕ is the affordance for that). That divergence is a
 * DATA semantic, not chrome; unifying it is a product call this extraction
 * deliberately does not make, so both panels keep their exact pre-286
 * behaviour.
 */
export interface PanelGoalStripProps {
  /** Left-hand summary shown in the editing + no-goal states. */
  summary: string;
  /** Whether a goal/target is set — picks the no-goal vs progress state. */
  hasGoal: boolean;
  /** Whether the goal is met (paints the positive fill + ink). */
  reached: boolean;
  /** Progress-state status line, e.g. "goal reached" / "420 words to cut". */
  statusLabel: string;
  /** Progress-state footer, e.g. "820 / 400" / "3 / 8 · 12 total". */
  footer: string;
  /** 0..1, already clamped by the caller. */
  progress: number;
  /** Seed for the edit field when the user opens it. */
  initialDraft: string;
  /** A committed target, or `null` when the field was left empty. */
  onCommit: (target: number | null) => void;
  /** The ✕ button. */
  onClear: () => void;
}

const WRAPPER = "px-3 py-1.5 border-b border-edge-subtle";
const INLINE_WRAPPER = `${WRAPPER} flex items-center gap-2 text-[11px]`;
const GHOST_BTN =
  "text-[var(--muted-light)] hover:text-ink-strong cursor-pointer text-[10px] rounded px-1 py-0.5 hover-on-light focus-ring";

export function PanelGoalStrip({
  summary,
  hasGoal,
  reached,
  statusLabel,
  footer,
  progress,
  initialDraft,
  onCommit,
  onClear,
}: PanelGoalStripProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  const startEditing = () => {
    setDraft(initialDraft);
    setEditing(true);
  };

  const commit = () => {
    const trimmed = draft.trim();
    if (trimmed === "") {
      onCommit(null);
    } else {
      const target = parseInt(trimmed, 10);
      if (Number.isFinite(target) && target >= 0) onCommit(target);
    }
    setEditing(false);
  };

  const cancel = () => {
    setEditing(false);
    setDraft("");
  };

  if (editing) {
    return (
      <div className={INLINE_WRAPPER}>
        <span className="text-[var(--muted)]">{summary}</span>
        <Input
          ref={inputRef}
          type="number"
          density="dense"
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
          ink="strong"
          className="ml-auto w-20 px-1.5 py-0.5 text-[11px]"
        />
      </div>
    );
  }

  if (!hasGoal) {
    return (
      <div className={INLINE_WRAPPER}>
        <span className="text-[var(--muted)]">{summary}</span>
        <button
          type="button"
          onClick={startEditing}
          className="ml-auto text-[var(--muted)] hover:text-ink-strong cursor-pointer rounded px-1.5 py-0.5 hover-on-light"
          data-hint="Set goal"
        >
          + goal
        </button>
      </div>
    );
  }

  const pct = Math.round(Math.min(1, Math.max(0, progress)) * 100);

  return (
    <div className={WRAPPER}>
      <div className="flex items-center gap-2 text-[11px] mb-1">
        <span
          className={reached ? "text-[var(--positive-strong)]" : "text-ink-body"}
        >
          {statusLabel}
        </span>
        <button
          type="button"
          onClick={startEditing}
          className={`ml-auto ${GHOST_BTN}`}
          data-hint="Edit goal"
        >
          edit
        </button>
        <button
          type="button"
          onClick={onClear}
          className={GHOST_BTN}
          {...iconHint({ label: "Clear goal" })}
        >
          ✕
        </button>
      </div>
      <div className="h-1.5 w-full rounded-full bg-edge-subtle overflow-hidden">
        <div
          className={`h-full ${reached ? "bg-[var(--positive)]" : "bg-[var(--accent)]"} transition-[width] duration-200`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="mt-1 text-[10px] text-[var(--muted-light)]">{footer}</div>
    </div>
  );
}
