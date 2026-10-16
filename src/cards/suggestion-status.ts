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
