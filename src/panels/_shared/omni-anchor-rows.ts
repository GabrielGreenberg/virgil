/**
 * The omni surface's reader of the card-anchor authority (task 369).
 *
 * Every paragraph-anchored omni builder (note / highlight / todo / archive /
 * revision / cutter / report) used to run the SAME six lines by hand: pull
 * `getLinkedTextObjectIds`, branch on `pids.length === 0`, resolve each pid
 * with a bare `findParagraphPos` live-uuid walk, append an `@N` suffix when
 * there is more than one, and classify with `resolveAnchorState(pos, null)`.
 * Seven copies of one rule — and every one of them was a SECOND answer to a
 * question the margin already answered through the four-rung anchor-recovery
 * SSOT, so a card the margin RECOVERED (mark or snapshot rung) was binned into
 * the omni orphan strip while its marker sat happily beside the recovered
 * paragraph.
 *
 * This function is the one reader: it takes the resolved rows
 * (`CardAnchorResolver`, built ONCE per pass by the host) and turns them into
 * the omni row descriptors. The `@N` suffix is indexed over the RESOLVED rows,
 * which is exactly the list the margin's `anchorIndexFor` indexes over — so a
 * marker click pins the row the marker belongs to, including for a recovered
 * anchor, by construction.
 */

import type { CardWithLinks } from "@/links/links";
import type { OmniItem } from "@/panels/_shared/types";
import type { CardAnchorResolver } from "@/links/card-anchor-rows";
import { resolveAnchorState, type AnchorIntent } from "@/links/anchor-state";

/**
 * One omni row. Derived from `OmniItem` rather than restated so a row can
 * never drift from the item it becomes — the builder's job is to add `id` and
 * `content`, nothing else.
 */
export interface OmniAnchorRow
  extends Pick<OmniItem, "pos" | "anchorUuid" | "anchorState"> {
  /** The omni item id — `baseId`, plus `@<i>` when the card has >1 row. */
  omniId: string;
  /**
   * True iff this row is KNOWN to sit on a live paragraph: the authority's
   * verdict AND a resolved position. The mount gap (no index yet ⇒ no
   * position) answers `false` — the margin fails OPEN there, since it can key
   * a marker on a raw stored pid, but an omni row with nothing to point at
   * must not offer a Jump. Never re-derive it from `pos` alone: `pos` is a
   * seed the live resolver supersedes.
   *
   * **Stated honestly: this is not (yet) the Jump predicate everywhere.** Only
   * `Archive` gates its Jump and orphan chrome on it; the other five builders
   * gate on `anchorUuid != null` (= "the card stores an anchor"), which is
   * each panel's own pre-369 rule, preserved byte-for-byte. The two differ for
   * a card whose anchor is UNRECOVERABLE: those five still render a Jump that
   * `jumpToCard` cannot resolve. That is a pre-existing false affordance in a
   * surface this task did not set out to renegotiate, so it is recorded here
   * and in AGENTS.md rather than silently changed under a refactor.
   */
  anchored: boolean;
}

/**
 * Build a card's omni rows from the ONE anchor authority.
 *
 * @param freeIntent the card's declared intent, consulted ONLY when the card
 *   stores no paragraph anchor at all. Panels differ here and the difference
 *   is editorial, not derivable: an unlinked note/todo/revision/cutter/report
 *   is deliberately FREE by that panel's own rule, while an archive clip reads
 *   its own `unanchored` flag. A card whose stored anchor is DEAD does not take
 *   this path — it is classified from the CARD RECORD instead, so a note/todo/
 *   revision/cutter/report that lost its marker reads `orphaned` (red) rather
 *   than being laundered into `free`. The one record that carries an
 *   `unanchored` field of its own is `ArchivedSnippet`, so a born-free clip
 *   with a dead stored pid does read `free` — byte-identical to pre-369, where
 *   the same branch consulted the same flag, and the right answer: the clip
 *   was deliberately never placed.
 */
export function buildOmniAnchorRows(
  card: CardWithLinks,
  baseId: string,
  resolve: CardAnchorResolver,
  freeIntent: AnchorIntent | null,
): OmniAnchorRow[] {
  const { rows, anchored } = resolve(card);

  if (rows.length === 0) {
    // No stored anchor at all.
    return [
      {
        omniId: baseId,
        pos: null,
        anchorState: resolveAnchorState(null, freeIntent),
        anchored: false,
      },
    ];
  }

  const multi = rows.length > 1;
  return rows.map((row, i) => {
    // A live WITNESS for an anchored row (the authority already said this pid
    // resolves); the card's own intent decides free-vs-orphaned otherwise.
    const witness = anchored ? row.pos : null;
    const intent = anchored ? null : (card as AnchorIntent);
    return {
      omniId: multi ? `${baseId}@${i}` : baseId,
      pos: witness,
      anchorUuid: row.pid,
      anchorState: resolveAnchorState(witness, intent),
      anchored: witness != null,
    };
  });
}
