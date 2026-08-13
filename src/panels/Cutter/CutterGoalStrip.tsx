"use client";

import type { CutterGoal } from "@/lib/types";
import { PanelGoalStrip } from "@/panels/_shared/PanelGoalStrip";

interface CutterStripProps {
  goal: CutterGoal | null;
  currentWords: number;
  /** Second arg is the current word count — used only to capture the baseline
   *  on FIRST set; when a goal already exists the hook preserves its baseline. */
  onSetGoal: (target: number, currentWords: number) => void;
  onClearGoal: () => void;
}

const fmt = (n: number) => n.toLocaleString();

/**
 * The Cutter's adapter over the shared `PanelGoalStrip` (task 286) — it owns
 * the cut-goal ARITHMETIC and the strings, and no chrome at all.
 *
 * Progress is measured against the baseline captured when the goal was set
 * (`goal.initialWords`), not against the target alone: the bar answers "how
 * much of the cut have I made", so it fills as words LEAVE the document.
 *
 * An empty draft is IGNORED here (the `onCommit(null)` seam): clearing a cut
 * goal discards `initialWords`, and that baseline is unrecoverable — ✕ is the
 * deliberate affordance for it. Revisions answers the same seam the other way.
 */
export function CutterGoalStrip({
  goal,
  currentWords,
  onSetGoal,
  onClearGoal,
}: CutterStripProps) {
  const totalToCut = goal ? Math.max(0, goal.initialWords - goal.target) : 0;
  const cutSoFar = goal ? Math.max(0, goal.initialWords - currentWords) : 0;
  const leftToCut = goal ? Math.max(0, currentWords - goal.target) : 0;
  const reached = !!goal && currentWords <= goal.target;

  return (
    <PanelGoalStrip
      summary={`${fmt(currentWords)} words`}
      hasGoal={!!goal}
      reached={reached}
      statusLabel={reached ? "goal reached" : `${fmt(leftToCut)} words to cut`}
      footer={goal ? `${fmt(currentWords)} / ${fmt(goal.target)}` : ""}
      progress={totalToCut === 0 ? 1 : Math.min(1, cutSoFar / totalToCut)}
      initialDraft={goal ? String(goal.target) : ""}
      onCommit={(target) => {
        if (target != null) onSetGoal(target, currentWords);
      }}
      onClear={onClearGoal}
    />
  );
}
