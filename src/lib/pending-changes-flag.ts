/**
 * `virgil:pending-changes` — the "pending AI changes" rollout flag.
 *
 * Gates the suggestion-apply behavior: an AI suggestion is spliced into the doc
 * as a blue, revertable range (status `applied`) awaiting an explicit "Keep",
 * instead of landing immediately as `accepted`.
 *
 * **Default ON** (graduated after the phased build landed and was verified);
 * the localStorage key is the OPT-OUT back to the legacy accept-immediately
 * path, which the suite still covers. Declared in `src/lib/feature-flags.ts`.
 *
 * ─── THE FLAG GATES PRODUCTION, NEVER RESOLUTION (task 716) ────────────────
 *
 * The reader used to be spelled `isPendingChangesOn()`, and a caller had to
 * decide for itself which of two different questions that name was answering:
 *
 *   1. "May a NEW pending change be PRODUCED?"  — a rollout question, the
 *      flag's actual subject. Apply, auto-apply, insert-below, and the choice
 *      between the flag-ON Apply verb and the legacy Reject/Accept pair.
 *   2. "May an ALREADY-PRODUCED pending change be RESOLVED?" — keep, revert,
 *      dismiss, preview, the blue mark's reload re-stamp, the margin pill, the
 *      bulk Keep-all/Dismiss-all.
 *
 * Fifteen sites asked (1)'s reader and reasoned as though it also answered (2),
 * each carrying the same comment: *"flag-OFF → no card ever reaches `applied`,
 * so this is dead."* That premise is false. The flag is a RUNTIME toggle; a
 * card's `status` is PERSISTED DOCUMENT STATE. `revisions.json` holds `applied`
 * / `stale` records written while the flag was on, and they outlive the flip —
 * along with a live blue `pending-ai-change` range in the user's `.tex`. Under
 * the old reading, opting out stranded every one of them: no Keep, no Revert,
 * no margin pill, no re-stamp on reload, and the handlers behind those verbs
 * no-opped even where a button survived. Opting out was a data hazard.
 *
 * So the reader is now named for question (1) ONLY — {@link canProducePendingChanges}
 * — and question (2) has no gate at all: resolution is always available (it
 * needs an editor, nothing more). A site that wants to know "may I resolve?"
 * can no longer spell it by accident, because the only name on offer says
 * PRODUCE.
 */
import { readFlag, setFlagOverride } from "@/lib/feature-flags";

/**
 * True when a NEW pending change may be produced — i.e. when an AI suggestion
 * should splice in as a blue revertable range rather than landing immediately
 * as `accepted`. Default ON.
 *
 * **Not** the question "may this applied change be kept / reverted / previewed
 * / repainted" — that one has no flag (see this module's header). Resolving an
 * already-produced pending change stays available after an opt-out, because the
 * records and the blue ranges in the document outlive the flip.
 */
export function canProducePendingChanges(): boolean {
  return readFlag("virgil:pending-changes");
}

/** Force the flag (tests, or an explicit toggle). `undefined` clears it. */
export function setPendingChangesFlag(value: boolean | undefined): void {
  setFlagOverride("virgil:pending-changes", value);
}
