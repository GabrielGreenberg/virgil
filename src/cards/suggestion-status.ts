/**
 * "Is this suggestion RESOLVED?" — the ONE spelling (task 1151).
 *
 * A revision- or cutter-suggestion moves through `pending` → (`applied` |
 * `stale`) → `accepted` | `rejected`. The last two are TERMINAL: the user has
 * decided, the outcome is written to the paper, and the Task it answers (if
 * any) is finalized. Every other status is a stage on the way and still OPEN.
 *
 * Read by every surface that asks the question — the margin (a resolved
 * suggestion paints no marker, whichever family it belongs to), the morph gate
 * (`canMorphSuggestion`), and the proposal finalize/leave rules
 * (`proposal-finalize.ts`) — so the families cannot drift apart on it again
 * (the cutter margin source had no such check while revisions' had one).
 *
 * A dependency-free leaf on purpose: `src/lib`-side readers import it without
 * pulling the card registry.
 */

/** The terminal suggestion statuses. */
export const RESOLVED_SUGGESTION_STATUSES = ["accepted", "rejected"] as const;
export type ResolvedSuggestionStatus = (typeof RESOLVED_SUGGESTION_STATUSES)[number];

/** True iff `status` is a terminal suggestion status (`accepted`/`rejected`). */
export function isResolvedSuggestionStatus(
  status: string | undefined,
): status is ResolvedSuggestionStatus {
  return status === "accepted" || status === "rejected";
}

/** True iff `record` is a stored suggestion (`kind: "suggestion"`, either
 *  family) whose status is terminal. A comment is never "resolved" here — it
 *  has no status to hold an outcome. */
export function isResolvedSuggestion(record: object): boolean {
  const r = record as { kind?: unknown; status?: unknown };
  return r.kind === "suggestion" && typeof r.status === "string" && isResolvedSuggestionStatus(r.status);
}

/**
 * The suggestion status vocabulary — the ONE spelling of the union both stored
 * suggestion families (`RevisionSuggestionCard`, `CutterSuggestionCard`) carry
 * (task 1499). `pending` is the drafted, unapplied stage the auto-apply driver
 * looks for; `applied` is spliced into the paper as a blue, revertable range
 * awaiting Keep; `stale` means the paragraph drifted so the splice could not
 * land; `accepted` / `rejected` are terminal (see above).
 */
export const SUGGESTION_STATUSES = [
  "pending",
  "applied",
  "stale",
  ...RESOLVED_SUGGESTION_STATUSES,
] as const;
export type SuggestionStatus = (typeof SUGGESTION_STATUSES)[number];

/** The members of `T` that declare an `appliedChange`, with it present. */
export type AppliedPending<T> = T extends unknown
  ? "appliedChange" extends keyof T
    ? T & { appliedChange: NonNullable<T["appliedChange" & keyof T]> }
    : never
  : never;

/**
 * "Is this an APPLIED PENDING change?" — the ONE spelling (task 1499).
 *
 * A stored suggestion (either family) whose status is `applied` AND which
 * carries the `appliedChange` descriptor of its live splice. That is the exact
 * set that owns a blue `pending-ai-change` range: the pill and Keep-all /
 * Revert-all target it, the auto-apply driver serializes one per paragraph
 * against it, the reload pass re-stamps its marks, and the reapers keep its
 * anchors alive. Those readers once each re-spelled the conjunction; a census
 * (`applied-pending-predicate-census.test.ts`) now fails a new inline copy.
 *
 * Generic over the record so a caller keeps its own card type: a card union
 * narrows to its members that CAN carry the descriptor (a comment drops out),
 * with the descriptor narrowed to present.
 */
export function isAppliedPendingSuggestion<
  T extends { kind?: unknown; status?: unknown; appliedChange?: unknown },
>(record: T): record is AppliedPending<T> {
  return (
    record.kind === "suggestion" &&
    record.status === "applied" &&
    !!record.appliedChange
  );
}
