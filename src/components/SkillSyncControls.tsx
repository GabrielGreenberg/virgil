"use client";

import { memo } from "react";
import type { SkillSyncError } from "@/hooks/useFiles";
import { barStatusVisible } from "@/lib/bar-status-policy";
import { BarStatusAction, BarStatusPill } from "./status/BarStatusPill";

interface Props {
  error: SkillSyncError | null;
  /** Retry the sync from the failure pill (also the target of the
   *  "Refresh skills" help-menu item, wired at the StatusCluster call site). */
  onResync: () => void;
  onDismissError: () => void;
}

function WarnIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M8 1.5 1 14h14L8 1.5Z" />
      <path d="M8 6.5v3.2" />
      <circle cx="8" cy="11.8" r="0.4" fill="currentColor" stroke="none" />
    </svg>
  );
}

/**
 * Bar surface for the per-paper skill-bundle sync: a loud, dismissible
 * FAILURE pill with Retry (+ "Grant & retry" on a revoked permission).
 *
 * Task 1131: only the failure is must-see (`bar-status-policy.ts`). A
 * successful sync no longer puts a "Skills updated" notice on the bar — the
 * version and the restart-your-cowork-session hint live on the Help menu's
 * "Refresh skills" row (StatusCluster), which also hosts the manual re-sync.
 *
 * Pure presentational — no editor subscription, so it adds zero
 * per-keystroke work (keystroke-sanctity, AGENTS.md).
 */
function SkillSyncControls({ error, onResync, onDismissError }: Props) {
  if (!barStatusVisible("skill-sync", { failed: error !== null }) || !error) {
    return null;
  }
  const label = error.permission ? "Skill sync needs permission" : "Skill sync failed";
  return (
    <BarStatusPill
      tone="danger"
      glyph={<WarnIcon />}
      label={label}
      ariaLabel={label}
      hint={error.message}
      data={{ "data-skill-sync": error.permission ? "permission" : "failed" }}
      actions={
        <>
          <BarStatusAction onClick={onResync} hint={error.message}>
            {error.permission ? "Grant & retry" : "Retry"}
          </BarStatusAction>
          <BarStatusAction
            onClick={onDismissError}
            hint="Dismiss"
            ariaLabel="Dismiss skill-sync error"
          >
            <svg
              width="12"
              height="12"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              aria-hidden
            >
              <path d="M4 4l8 8M12 4l-8 8" />
            </svg>
          </BarStatusAction>
        </>
      }
    />
  );
}

export default memo(SkillSyncControls);
