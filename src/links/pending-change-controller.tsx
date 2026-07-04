"use client";

import { createContext, useContext } from "react";
import type { PendingChangeFamily } from "@/links/apply-suggestion";

/**
 * SSOT context for the client-side Keep / Revert of an *applied* pending AI
 * change, made available to any suggestion-card body — docked Revisions/Cutter
 * panel, omni, or float / margin-anchored card — WITHOUT threading per-surface
 * callbacks through each mount. Before this, only the docked host wired
 * `onKeep`/`onRevert`, so omni/float fell back to the legacy field-view (the
 * "Applied" green divergence). The card body now reads Keep/Revert from here,
 * so the single minimal applied card renders identically on every surface.
 *
 * EditorPane assembles the value from its already-stable `onKeep*Pending` /
 * `onRevert*Pending` `useCallback` closures (which route through the
 * `pending-change-actions` SSOT) and mounts the provider high in its provider
 * stack — high enough that context reaches float bodies too (they render
 * inline; React context flows through the float portals by tree position).
 *
 * KEYSTROKE SANCTITY: the provider `value` MUST be referentially stable across
 * keystrokes (memoize it over the stable closures), so consuming card bodies
 * never re-render on plain typing. Verify `window.__virgilBusStats().emitCount`
 * stays flat.
 */
export interface PendingChangeController {
  /** `isPendingChangesOn() && an editor is mounted` — the applied-card controls
   *  render only when this is true (defensive; the provider is normally present
   *  whenever the flag is on). */
  isOn: boolean;
  /** COMMIT — Check: finalize the SUGGESTED text (status→accepted, archived). */
  keep(family: PendingChangeFamily, id: string): void;
  /** COMMIT — Cross: DISMISS-PRESERVES — byte-restore the original + archive the
   *  card & its comment (status→rejected, archived). Never hard-deletes. */
  dismiss(family: PendingChangeFamily, id: string): void;
  /** NON-COMMITTING PREVIEW — flip the LIVE doc to the original (drops the blue
   *  mark). Leaves card status / `appliedChange` untouched. */
  previewOriginal(family: PendingChangeFamily, id: string): void;
  /** NON-COMMITTING PREVIEW — flip the LIVE doc back to the suggested view
   *  (re-stamps the blue mark). Leaves card status / `appliedChange` untouched. */
  previewSuggested(family: PendingChangeFamily, id: string): void;
}

const PendingChangeControllerContext =
  createContext<PendingChangeController | null>(null);

/** Read the pending-change Keep/Revert controller. Returns `null` if no
 *  provider is mounted (e.g. a card rendered in isolation in a test). */
export function usePendingChangeController(): PendingChangeController | null {
  return useContext(PendingChangeControllerContext);
}

export const PendingChangeControllerProvider =
  PendingChangeControllerContext.Provider;
