/**
 * **The mount gate** — task 357, hole 3.
 *
 * Virgil's other two preservation gates measure the parse OUTPUT: a JSON model
 * is round-tripped back to `.tex` and word-counted against what the file held
 * ([tex-preservation.ts](tex-preservation.ts) on the load writeback,
 * [write-preservation.ts](write-preservation.ts) on every automatic write).
 * Both are correct about the model and say nothing about the DOCUMENT, because
 * a model that has been measured is not yet a document — the editor is the last
 * word on what it can hold.
 *
 * > **A model that a gate has measured is not yet a document.** Every door that
 * > hands a model to the main editor asks whether the editor KEPT it, and a
 * > shortfall is published to the same refusal channel a lossy write is.
 *
 * ## What the gap actually is
 *
 * `enableContentCheck` is off (TipTap's default, and the one Virgil takes), so
 * for JSON content `createNodeFromContent` catches a `schema.nodeFromJSON`
 * throw, `console.warn`s, and returns **an empty document**. A model naming one
 * node type or one mark this build's schema does not have therefore opens the
 * paper BLANK over an intact file — word-complete by both other gates, since
 * `serializeToLatex` is perfectly happy to emit `.tex` from JSON the schema
 * cannot hold.
 *
 * The blank is then only one gesture from disk: the write gate steps aside on
 * the first REAL user edit, so a single keystroke into the blank document opens
 * the automatic writes that overwrite the file with nothing.
 *
 * ## Reachability, stated rather than implied
 *
 * `parseLatex` builds for this schema, so today's parser cannot normally emit a
 * type the editor lacks — this is defence in depth for the cases where the two
 * genuinely diverge: a `.tex`/`virgil.json` written by a NEWER Virgil carrying
 * a node kind this build has not got, and any future parser change that emits a
 * type before its extension is registered. Both are silent, both are total, and
 * the guard costs O(1) on the happy path.
 *
 * ## The posture is the one hole 4 decided
 *
 * A refusal here publishes to [preservation-notice.ts](preservation-notice.ts),
 * which suspends the automatic-write step-aside and raises the banner. The
 * editor stays editable and the file on disk stays intact — a blank editor is
 * exactly the case where the user most needs to be told that what they see is
 * not their paper, and exactly the case where no write may carry it.
 */
import type { Node as PMNode, Schema } from "@tiptap/pm/model";
import { checkKeptEverything, type MountVerdict } from "@/lib/tiptap/schema-mount";
import { recordPreservationRefusal } from "@/lib/preservation-notice";
import { getRetainedCounts } from "@/lib/write-preservation";

export type { MountVerdict };

/**
 * Measure a mount and, on a shortfall, publish it. Returns the verdict so a
 * caller can also refuse locally (the code pane keeps its last-good model).
 *
 * `docId` may be null — the Library Reader and the pop-out surfaces mount main
 * -schema content with no document behind them. There is nothing to gate there
 * (nothing of theirs reaches disk), so the verdict is returned and no notice is
 * raised: a banner naming a document the user is not editing would be a report
 * about a hazard that does not exist.
 */
export function reportDocMount(
  schema: Schema,
  mounted: PMNode,
  given: unknown,
  docId: string | null,
): MountVerdict {
  const verdict = checkKeptEverything(schema, mounted, given);
  if (verdict.ok || !docId) return verdict;
  // The mount gate has no slack to report: the editor kept NOTHING, so the loss
  // is the whole body as the file had it. `before` comes from the write gate's
  // retained baseline — the same numbers, so the banner cannot quote one figure
  // for a refused write and a different one for a refused mount. With no
  // baseline (a doc this process never read through `readDocBundle`) the count
  // is unknown rather than zero, and the badge says so from `source` alone.
  const before = getRetainedCounts(docId)?.body ?? 0;
  recordPreservationRefusal(docId, {
    source: "mount",
    region: "body",
    before,
    after: 0,
    lost: before,
    allowed: 0,
    reason: verdict.reason,
  });
  console.error(
    `[virgil] REFUSED to trust the mounted document for "${docId}": the editor ` +
      `could not hold the parsed model and opened blank (${verdict.reason}). ` +
      `The .tex on disk is UNCHANGED and Virgil will not write to it. ` +
      `Virgil's mount preservation gate (task 357 hole 3).`,
  );
  return verdict;
}
