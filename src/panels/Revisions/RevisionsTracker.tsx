"use client";

import type { RevisionsTracker } from "@/lib/types";
import { PanelGoalStrip } from "@/panels/_shared/PanelGoalStrip";

interface RevisionsTrackerStripProps {
  tracker: RevisionsTracker | null;
  acceptedCount: number;
  totalCount: number;
  onSetTarget: (target: number | null) => void;
}

const fmt = (n: number) => n.toLocaleString();

/**
 * The Revisions adapter over the shared `PanelGoalStrip` (task 286) — it owns
 * the accepted-count arithmetic and the strings, and no chrome at all.
 *
 * Unlike the Cutter's cut goal there is no baseline to preserve (progress is
 * `accepted / target`, both live counts), so an empty draft CLEARS the target
 * — the `onCommit(null)` seam answered the other way. See PanelGoalStrip's
 * header for why that divergence stays with the adapters.
 */
export function RevisionsTrackerStrip({
  tracker,
  acceptedCount,
  totalCount,
  onSetTarget,
}: RevisionsTrackerStripProps) {
  const target = tracker?.target ?? null;
  const reached = target != null && acceptedCount >= target;
  const remaining = target == null ? 0 : Math.max(0, target - acceptedCount);

  return (
    <PanelGoalStrip
      summary={`${fmt(acceptedCount)} of ${fmt(totalCount)} accepted`}
      hasGoal={target != null}
      reached={reached}
      statusLabel={
        reached
          ? "goal reached"
          : `${fmt(remaining)} ${remaining === 1 ? "revision" : "revisions"} to go`
      }
      footer={
        target == null
          ? ""
          : `${fmt(acceptedCount)} / ${fmt(target)} · ${fmt(totalCount)} total`
      }
      progress={target == null || target === 0 ? 1 : Math.min(1, acceptedCount / target)}
      initialDraft={target != null ? String(target) : ""}
      onCommit={onSetTarget}
      onClear={() => onSetTarget(null)}
    />
  );
}
