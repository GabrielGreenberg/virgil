"use client";

import { createContext, useContext } from "react";
import type { PendingChangeFamily } from "@/links/apply-suggestion";

/**
 * SSOT context for EVERY verb a suggestion card can aim at the document, made
 * available to any suggestion-card body — docked Revisions/Cutter panel, omni,
 * or float / margin-anchored card — WITHOUT threading per-surface callbacks
 * through each mount. Before this, only the docked host wired `onKeep`/
 * `onRevert`, so omni/float fell back to the legacy field-view (the "Applied"
 * green divergence). The card body now reads Keep/Revert from here, so the
 * single minimal applied card renders identically on every surface.
 *
 * TASK 684 — the same inversion for the PENDING card's landing verbs. `onApply`
 * stayed a per-mount PROP while the flag authorising it (`virgil:pending-changes`,
 * `default: true`) is GLOBAL, so one pending card did three different things on
 * three surfaces: docked spliced the prose, omni wrote a bare `accepted` status,
 * a float wrote a bare `accepted` status and nothing anywhere acted on it — and
 * `accepted` is a status the flag-ON card has no rendering for, so the card went
 * blank while the prose stayed un-applied. A capability that is global may not be
 * gated on a prop each host must remember to pass: `apply` / `accept` / `reject`
 * now live here beside keep/dismiss/preview/insertBelow, the card bodies read
 * them from context ONLY (the props are GONE from the card contract, so a new
 * mount site cannot silently degrade the card), and the legacy flag-OFF
 * Accept/Reject pair is the same status + AI-request sequence the docked host
 * used to own, moved — not reimplemented — so flag-OFF behaviour is unchanged.
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
  /** PENDING → APPLIED (flag-ON primary) — splice `suggested_text` over the
   *  card's Mode-A anchor in the live doc and record the pending change
   *  (status→applied, or →stale when the anchor no longer matches). The same
   *  shared `applySuggestion` the auto-apply driver uses. */
  apply(family: PendingChangeFamily, id: string): void;
  /** PENDING → ACCEPTED (legacy, flag-OFF only) — status→accepted plus the
   *  out-of-band AI request that asks an editor skill to perform the splice.
   *  Unreachable with the flag ON: the flag-ON pending card offers `apply`
   *  instead, which is how `accepted` stops being a status the card cannot
   *  render. */
  accept(family: PendingChangeFamily, id: string): void;
  /** → REJECTED — a bare status write. The partner of {@link accept} on the
   *  flag-OFF pending card, and the `stale` card's Dismiss under the flag
   *  (a drifted anchor can no longer be applied, so rejecting is all that is
   *  left). No doc mutation either way. */
  reject(family: PendingChangeFamily, id: string): void;
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
  /** THIRD LANDING VERB — Insert below: drop the suggestion's `suggested_text`
   *  as a NEW paragraph directly below the anchor (non-destructive — the original
   *  is untouched), then retire the card (accepted + archived). The escape hatch
   *  behind the retired 4-field AI fallback. No-ops for an empty `suggested_text`
   *  (a delete/empty cut). */
  insertBelow(family: PendingChangeFamily, id: string): void;
}

const PendingChangeControllerContext =
  createContext<PendingChangeController | null>(null);

/** Read the pending-change controller. Returns `null` if no
 *  provider is mounted (e.g. a card rendered in isolation in a test). */
export function usePendingChangeController(): PendingChangeController | null {
  return useContext(PendingChangeControllerContext);
}

export const PendingChangeControllerProvider =
  PendingChangeControllerContext.Provider;
