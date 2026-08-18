/**
 * **The serializer's refusal, published** — task 357, the last write-side hole.
 *
 * `serializeNode`'s `default:` arm used to emit a node's CHILDREN and drop its
 * WRAPPER, and `serializeInline`'s trailing `return ""` dropped an unknown
 * inline node whole. Both produced well-formed LaTeX that was simply shorter
 * than the user's document — the failure this cluster exists to end. Since
 * task 357 the serializer THROWS instead
 * ([`UnserializableNodeError`](latex-serializer.ts)).
 *
 * A throw is refused by default, which is why it was chosen over a sentinel;
 * but a throw a bundle writer let escape would be a DIFFERENT inert refusal —
 * `save()` catches it, logs, and leaves the doc dirty, so the user watches an
 * autosave that never lands and is told nothing. So the two bundle writers in
 * each backend catch it here and publish to the SAME channel a lossy write
 * publishes to: the banner rises, the automatic-write step-aside is suspended,
 * and the first refusal arms the forensic snapshot of the still-intact bundle.
 *
 * > **One refusal channel for every preservation failure.** Load, write, mount,
 * > and now serialize — four gates, one fact about the document, one surface
 * > that tells the user.
 *
 * ## Why this refusal offers no "Save anyway"
 *
 * The other three refusals have a version to save: a shorter document the user
 * may knowingly accept. This one does not — the serializer cannot produce bytes
 * at all, so there is nothing acknowledgment could permit. The badge branches on
 * `source` and withholds the row rather than offering a button that would refuse
 * again one gesture later (`PreservationNoticeBadge`).
 */
import { UnserializableNodeError } from "@/lib/latex-serializer";
import { recordPreservationRefusal } from "@/lib/preservation-notice";
import { getRetainedCounts } from "@/lib/write-preservation";

/**
 * Publish a serializer refusal for `docId`. Returns `null` when `err` is NOT an
 * `UnserializableNodeError` — the caller must rethrow, because swallowing an
 * unrelated failure here would turn a real bug into a silently skipped save,
 * which is the shape of the defect this module exists to close.
 *
 * `armed` is true only for the FIRST refusal since this document was loaded;
 * the caller takes its unconditional forensic snapshot on that edge (the
 * autosave retries every 1500 ms while the notice stands).
 */
export function reportSerializeRefusal(
  err: unknown,
  docId: string,
): { armed: boolean } | null {
  if (!(err instanceof UnserializableNodeError)) return null;
  // No measurement to report: serialization produced no bytes, so there is no
  // "after" to count. `before` comes from the write gate's retained baseline —
  // the same numbers the other gates quote, so the banner can never report one
  // figure for a refused write and a different one for a refused serialize.
  // With no baseline (a doc this process never read through `readDocBundle`)
  // the count is unknown rather than zero, and the badge says so from `source`.
  const before = getRetainedCounts(docId)?.body ?? 0;
  const { armed } = recordPreservationRefusal(docId, {
    source: "serialize",
    region: "body",
    before,
    after: 0,
    lost: before,
    allowed: 0,
    reason: `Unknown node type: ${err.nodeType}`,
  });
  console.error(
    `[virgil] REFUSED to write "${docId}": the document model holds a node ` +
      `this build's serializer cannot express (${err.nodeType}), and emitting ` +
      `the rest would silently drop it. The .tex on disk is UNCHANGED. ` +
      `Virgil's serializer preservation gate (task 357).`,
  );
  return { armed };
}
