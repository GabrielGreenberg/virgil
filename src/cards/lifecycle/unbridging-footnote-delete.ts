"use client";

/**
 * `makeUnbridgingFootnoteDelete` — the footnote twin of `makeUnbridgingDelete`.
 *
 * WHY A SEPARATE HELPER (footnote is NOT routed through `makeUnbridgingDelete`).
 * A footnote is an inline ATOM, so two things differ from the six sidecar-backed
 * flag-bearing kinds that ride `makeUnbridgingDelete` / `runCardLifecycleEvent`:
 *
 *   1. No D6 card-deleted signal. The footnote's cardStore prune is already
 *      owned by the W2b bus reconciler off the splice's structural diff;
 *      publishing a D6 signal here would be a redundant double-prune. So the
 *      executor path (which emits that signal) is the wrong door for footnote.
 *   2. The removal mechanism VARIES per entry point — the editor-handle splice
 *      (`innerRef.deleteFootnote`, the panel/margin/float + pristine click-away
 *      discard paths) vs the sidecar ref delete (`footnotesHook.deleteFootnote`,
 *      the atom-range delete walker + the unanchored-footnote trash). Each site
 *      supplies its own `remove`.
 *
 * What does NOT vary is the task-219 obligation: a flag-bearing footnote's
 * hard-delete must discharge its linked `ai-requests.json` row FIRST (terminate
 * mode). A deleted footnote can never toggle its flag again, so the bridge's
 * "self-heals on the next toggle" escape hatch never fires — an un-discharged
 * row is stranded `pending` forever, inflating the inbox count and re-serving a
 * gone footnote on every `/editor/review` drain.
 *
 * Before task 252 this obligation was hand-threaded at each footnote delete
 * site, and the pristine click-away discard site (`EditorPane` footnote
 * `registerDiscard`) was missed — deleting an empty-but-flagged footnote raw.
 * This factory states the invariant ONCE; every footnote hard-delete entry point
 * routes through it, so a future entry point can't silently reintroduce the
 * strand.
 *
 * TERMINATE, NOT DROP. The bridge runs in `"terminate"` mode (like archive, task
 * 093): the footnote is *gone*, so the linked row closes regardless of current
 * openness — including an answered-L3 proposal (`in-progress` + `resultId`) a
 * `value=false` toggle would preserve (task 043). Terminate is idempotent: it
 * writes nothing when no linked non-terminal row exists, so routing an UNflagged
 * footnote's delete through this helper mints no spurious terminal row.
 *
 * AND IT ASKS THE SAME SSOT THE EXECUTOR DOES (task 313). This door is the one
 * that skips `runCardLifecycleEvent` (see above), so it is exactly the door that
 * would drift if the mode were "wired by the caller" — which is how the sibling
 * morph leg came to inherit `"toggle"` and strand answered-L3 rows. It therefore
 * derives the mode from `unbridgeModeFor("delete")` rather than spelling a
 * literal: skipping the executor's OTHER obligations is a deliberate choice
 * about signals, not a licence to re-answer this one.
 *
 * AND A DELIBERATE DELETE NEVER COMES BACK AS AN ORPHAN (task 1116). Flag-OFF,
 * the footnote detector turns every vanished non-empty footnote into a deferred
 * `virgil-footnote-orphaned`, and the orphan bridge resurrects it as a card
 * unless the suppress latch holds the id. That latch used to be armed at the
 * CALL SITE — the panel trash did, the atom-range walker's lifecycle delete
 * (drag-handle Delete / range Archive) did not, so a passage's footnotes were
 * deleted from footnotes.json and reappeared as orphans. Like the unbridge, it
 * is a property of "deliberately delete a footnote", not of any one site, so
 * the door arms it (`suppressOrphan`) FIRST, for every entry point — before the
 * splice for the editor-handle sites, synchronously after the landed tr for the
 * range walker; both precede the detector's `setTimeout(…, 0)`.
 *
 * FIRE-AND-FORGET ORDERING. `unbridge` is dispatched (not awaited) and `remove`
 * runs synchronously right after — matching every pre-252 site, where the bridge
 * write (async sidecar I/O) and the removal are independent.
 *
 * KEYSTROKE SANCTITY. Runs only on an explicit user delete (trash / margin
 * marker Delete / pristine click-away discard / unanchored trash), never per
 * transaction.
 */

import { unbridgeModeFor } from "./run-event";
import type { AiRequestSyncMode } from "@/lib/ai-request-bridge";

export interface UnbridgingFootnoteDeleteDeps {
  /** Close the linked `ai-requests.json` row. A pure FORWARDER onto the bridge:
   *  the `mode` is supplied here from `unbridgeModeFor("delete")` and must be
   *  passed straight through, never re-picked (task 313). A no-op when the
   *  footnote carries no linked non-terminal row. */
  unbridge: (
    kind: "footnote",
    id: string,
    mode: AiRequestSyncMode,
  ) => void | Promise<void>;
  /** Arm the orphan-suppress latch for this id (`armFootnoteOrphanSuppress`,
   *  scoped to the pane's doc) — a deliberate delete must not be resurrected
   *  as an orphan card (task 1116). A no-op flag-ON. */
  suppressOrphan: (id: string) => void;
}

/**
 * Build the footnote unbridging-delete door. The returned fn takes the footnote
 * id and the site-specific `remove` (editor-handle splice or sidecar ref
 * delete); it arms the orphan-suppress latch, discharges the linked row, then
 * removes.
 */
export function makeUnbridgingFootnoteDelete(
  deps: UnbridgingFootnoteDeleteDeps,
): (id: string, remove: (id: string) => void) => void {
  return (id, remove) => {
    deps.suppressOrphan(id);
    void deps.unbridge("footnote", id, unbridgeModeFor("delete"));
    remove(id);
  };
}
