/**
 * Phase 3 — pure collectors for the "applied pending AI change" set.
 *
 * Both the omni BULK index (Keep-all / Dismiss-all) and the floating PILL need
 * to identify which suggestion cards are currently in the `status:"applied"`
 * (spliced-but-not-yet-kept) pending state. The membership rule is a single
 * predicate — `status === "applied"` AND an `appliedChange` descriptor is
 * present — so it lives here once rather than being re-spelled at each surface
 * (the parallel-list drift the rest of this subsystem already avoids).
 *
 * These are PURE over the card arrays the `useRevisions` / `useCutter` hooks
 * already expose; they read no flag and touch no editor. The flag + editor
 * guards stay at the call sites (EditorPane), exactly as `pending-change-actions`
 * documents. No `editor.on(...)`, no doc walk — O(cards), called only off a
 * structural rebuild (the omni `items` memo) or a click handler, never per
 * keystroke.
 */

import type { RevisionCard, CutterCard } from "@/lib/types";

/** The fields the applied-pending predicate reads. `status` / `appliedChange`
 *  are optional so the COMMENT half of each polymorphic union (which carries
 *  neither) is accepted and simply fails the predicate — no per-kind narrowing
 *  at the call site. The suggestion half (`RevisionSuggestionCard` /
 *  `CutterSuggestionCard`) carries both; `appliedChange`'s presence (with
 *  `status:"applied"`) is the membership signal. */
export interface AppliedPendingCard {
  id: string;
  kind: string;
  status?: string;
  author?: "human" | "ai";
  appliedChange?: { anchorId: string };
}

/** True iff `card` is an applied, spliced-but-not-yet-kept suggestion — the
 *  exact set the pill targets and Keep-all / Revert-all iterate. A card without
 *  an `appliedChange` (a comment, or an already-kept / dismissed / never-applied
 *  suggestion) is excluded, so the bulk + pill actions never reach the
 *  `pending-change-actions` no-op path. Accepts the broad card union (comment +
 *  suggestion) so callers pass a card array straight through. */
export function isAppliedPending(
  card: RevisionCard | CutterCard | AppliedPendingCard,
): boolean {
  const c = card as AppliedPendingCard;
  return c.kind === "suggestion" && c.status === "applied" && !!c.appliedChange;
}

/** Collect the applied-pending suggestion ids from one card array (revision OR
 *  cutter). Order-stable (source order). Used by the omni bulk action to drive
 *  each id through `keepSuggestion` / `dismissSuggestion`. */
export function collectAppliedPendingIds(
  cards: ReadonlyArray<RevisionCard | CutterCard>,
): string[] {
  const out: string[] = [];
  for (const c of cards) {
    if (isAppliedPending(c as AppliedPendingCard)) out.push(c.id);
  }
  return out;
}
