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
   * This IS the Jump predicate, everywhere — but a builder does not read it to
   * gate a Jump. It hands its callback to `withJump` below, which is the one
   * door. The field stays public because a row's chrome asks other questions
   * of it (Archive's orphan styling reads `anchorState`, the same resolution
   * by another name).
   */
  anchored: boolean;
  /**
   * **The omni surface's ONE Jump gate** (task 655).
   *
   * Hand in the panel's jump callback; get it back when this row actually has
   * somewhere to go, and `undefined` when it does not — so
   * `onJump={row.withJump(handler)}` is the whole of a builder's Jump wiring.
   *
   * A FUNCTION rather than a boolean, deliberately: a boolean is a choice, and
   * for a month the six paragraph-anchored builders chose differently. Archive
   * gated on `anchored`; Notes, Todo, Revisions, Cutter and Reports gated on
   * `anchorUuid != null` — merely "the card STORES an anchor", which is true
   * of a card whose anchor is dead. Those five painted a Jump that
   * `jumpToCard` resolves to nothing: the user pressed a control and the app
   * did nothing, silently (the false-affordance class, the shape task 136
   * fixed for `citation`, 277 for `footnote` and 435 for the archive float).
   * Task 369 recorded the divergence here rather than renegotiate it inside a
   * refactor; this is the follow-through. With no boolean in the builder's
   * hand there is no predicate for a seventh builder to pick wrongly, and
   * `omni-jump-gate.test.tsx`'s census pins that none of the six re-derives
   * one.
   *
   * Withdrawing — rather than re-pointing — is the shipped Archive rule and so
   * not a new idea in the product. Giving an orphaned omni card the margin's
   * re-pin gesture (`UnanchoredCardsChip`'s "click to re-pin") is a real
   * feature and belongs to its own task, not to a correctness fix.
   */
  withJump: <H>(handler: H) => H | undefined;
}

/** The two `withJump` implementations. Module-level constants rather than a
 *  per-row closure: a pass rebuilds every row on each structural revision, and
 *  the gate has no per-row state to capture. */
const PASS_JUMP = <H>(handler: H): H | undefined => handler;
const NO_JUMP = <H>(_handler: H): H | undefined => undefined;

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
        withJump: NO_JUMP,
      },
    ];
  }

  const multi = rows.length > 1;
  return rows.map((row, i) => {
    // A live WITNESS for an anchored row (the authority already said this pid
    // resolves); the card's own intent decides free-vs-orphaned otherwise.
    const witness = anchored ? row.pos : null;
    const intent = anchored ? null : (card as AnchorIntent);
    const canJump = witness != null;
    return {
      omniId: multi ? `${baseId}@${i}` : baseId,
      pos: witness,
      anchorUuid: row.pid,
      anchorState: resolveAnchorState(witness, intent),
      anchored: canJump,
      withJump: canJump ? PASS_JUMP : NO_JUMP,
    };
  });
}
