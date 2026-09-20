/**
 * Mode-B linked-anchor re-apply (RC-B — the single load-time recovery WRITER).
 *
 * On reload the `.tex` parse does NOT drop the in-doc `linkedAnchor` mark — it
 * RESURRECTS every `\vlid` pair as a HARDCODED `kind:"note"`/`linkCard:""` mark
 * (`applyLinkedAnchorBoundaries`), and the serializer dropped kind/linkCard/
 * tintColor on the way out. So a revision/cutter/todo/report/highlight span
 * reloads MISLABELED as a note, and the sidecar `links[]` are the only surviving
 * record of its true kind + tint. RC-B re-stamps each Mode-B card's mark from
 * its persisted snapshot. This used to live in a SECOND writer in `EditorLayout`
 * (the `applyLinkedAnchors` effect) that raced the EditorPane load reconcile
 * (RC-A); RC-B collapses it into the one load reconcile pass so there is exactly
 * ONE load-time owner. It lives in this leaf module (no React, no editor import)
 * so the EditorPane reconcile effect can call it and the RC-B tests can drive it
 * against a real `new Editor` without dragging the EditorPane tree into jsdom.
 *
 * ORDERING (load-bearing): the EditorPane effect calls this BEFORE the six
 * per-panel `reconcileAnchors(editor)` calls. Re-applying first makes the marks
 * LIVE in the doc, so when RC-A then builds its resolver index every healthy
 * un-re-anchored Mode-B card wins the resolver's live-mark rung (rung 2 →
 * mode:'B') and RC-A leaves its `textRange` intact. If the re-apply ran AFTER
 * RC-A, the resolver's rung-2b self-heal would already have converted those
 * cards to Mode-A (a healthy Mode-B's `linkedRange` link carries its live
 * enclosing-paragraph uuid in `textObjectIds`), stripping the range and losing
 * the tint — exactly the make-or-break case (an un-re-anchored Mode-B
 * highlight) the chip protects.
 *
 * RE-ANCHORED-HYBRID EXCLUSION: a Mode-B card that ALSO carries a separate
 * clean Mode-A (`targetKind !== "linkedRange"`) link is one the drop re-anchor
 * relocated — its true home is the Mode-A link, and its old mark anchorId is
 * dead. Re-applying that dead anchorId by text search would re-tint the OLD
 * paragraph (the RC1 reload-revert). Excluded here, RC-A then converts it to a
 * clean Mode-A link on P_new (no stray mark). A re-anchored note never reaches
 * here at all (CHIP-A's `clearModeB` already dropped its linkedRange link, so
 * `getTextAnchor` is null); todo/revision/cutter/report/highlight land as the
 * double-link hybrid and are caught by `hasSeparateModeALink`.
 *
 * HIGHLIGHTS LAST: a highlight whose range sits inside a broader
 * revision/cutter selection wins the overlap (`setMark` replaces the earlier
 * `linkedAnchor` mark in the overlap; were the highlight overwritten,
 * `LinkedAnchorGuard` would fire a spurious orphan event and strip the
 * highlight's textRange from its sidecar).
 *
 * LOAD-ONLY: invoked once per doc-open from the gated reconcile effect, never
 * on the keystroke path. The injected `applyLinkedAnchors`
 * (`applyLinkedAnchorsImpl`) now RECONCILES rather than skips: a present mark
 * whose kind/linkCard/tintColor disagrees with its sidecar record is re-stamped
 * IN PLACE (the BUG1 fix); a present mark that already agrees is a no-op (still
 * idempotent). The re-stamp transactions carry `addToHistory:false`.
 */

import { getTextAnchor, type CardWithLinks, type LinkedAnchorKind } from "../links";
import { defaultTintForLinkedAnchorKind } from "@/cards/legacy-token-crosswalk";
import {
  MODE_B_COLLECTIONS,
  markKindForCardKind,
  type ModeBBag,
  type ModeBRecord,
} from "@/cards/mode-b-collections";

/** One re-apply instruction: re-stamp `kind`'s `linkedAnchor` mark with
 *  `anchorId` over the doc text `text`. Matches the `EditorHandle`'s
 *  `applyLinkedAnchors` record shape.
 *
 *  The optional fields make the re-stamp AUTHORITATIVE (BUG1 reconcile):
 *  - `tintColor`— the kind-derived persistent tint (the theme-accent band for
 *    highlights, `null` otherwise),
 *    re-applied so a highlight's band survives the `.tex` round-trip.
 *  - `paragraphId` — the card's stored containing-paragraph uuid; Chip 6 scopes
 *    the text search to it (declared here so the record shape is stable).
 *  - `cardId`   — the authoritative owning-card id, carried with the record. The
 *    reconcile does NOT currently derive `linkCard` from it: it preserves the
 *    mark's existing (empty-on-load) `linkCard` and lets the KIND fallback drive
 *    colour + consumer resolution — see the apply-linked-anchors linkCard policy.
 *    Kept for a possible future self-describing-linkCard enhancement (REVIEW.md). */
export interface ModeBReapplyRecord {
  anchorId: string;
  kind: LinkedAnchorKind;
  text: string;
  cardId?: string;
  tintColor?: string | null;
  paragraphId?: string;
}

/** The one editor capability this module needs — re-stamp marks from records.
 *  Structural so the leaf module never imports the heavy Editor component. */
export type ApplyLinkedAnchorsFn = (records: ModeBReapplyRecord[]) => void;

/** The Mode-B card bag this writer re-applies from. Was a hand-written
 *  six-field interface whose membership had to be kept in sync by eye with the
 *  orphan reaper's and the hover bridge's own lists — the drift that left the
 *  hover bridge knowing four of six (task 666). It is now the ONE total bag
 *  (`ModeBBag`), so the slot set here is the slot set everywhere. The old
 *  `reports` field is now `reportCards`, matching `CardFloatCtx` /
 *  `EntityCollectionSlots`. */
export type ModeBCardArrays = ModeBBag;

/** A Mode-B card carries a separate clean Mode-A link iff the drop re-anchor
 *  relocated it (the double-link hybrid). Such a card must be excluded from the
 *  Mode-B mark re-apply so its dead anchorId is not re-stamped at the old
 *  paragraph; RC-A then heals it to a single clean Mode-A link. */
export function hasSeparateModeALink(card: CardWithLinks): boolean {
  for (const link of card.links ?? []) {
    if (
      link.anchor.type === "textObject" &&
      link.anchor.targetKind !== "linkedRange"
    ) {
      return true;
    }
  }
  return false;
}

/** The containing-paragraph uuid the card's Mode-B (`linkedRange`) link carries
 *  in `textObjectIds[0]`, or `undefined`. Chip 6 scopes `reanchorByText`'s text
 *  search to this paragraph; until then it's carried for shape stability. */
function modeBParagraphId(card: CardWithLinks): string | undefined {
  for (const link of card.links ?? []) {
    if (
      link.anchor.type === "textObject" &&
      link.anchor.targetKind === "linkedRange"
    ) {
      return link.anchor.textObjectIds[0];
    }
  }
  return undefined;
}

/** Build the records for one kind's cards, skipping cards with no live text
 *  anchor and the re-anchored hybrids.
 *
 *  `textFor` resolves the snapshot text for a card given its `getTextAnchor`
 *  result. It defaults to `ta.anchorText` (every kind except revisions); the
 *  revision branch threads a `selectedText` fallback to match the retired
 *  EditorLayout effect byte-for-byte. A card whose resolved text is empty is
 *  skipped (the retired effect's `applyLinkedAnchors` no-op'd it too).
 *
 *  Each record also carries the kind-derived `tintColor` (a non-null per-card
 *  `highlightColor` override wins for highlights), the stored `paragraphId`, and
 *  the owning `cardId` (carried but not stamped into `linkCard` — see the type
 *  doc) — so the reconcile re-stamp is faithful (BUG1). */
function collectModeBRecords(
  cards: ReadonlyArray<ModeBRecord>,
  kindFor: (card: ModeBRecord) => LinkedAnchorKind,
  out: ModeBReapplyRecord[],
  textFor: (card: ModeBRecord, anchorText: string) => string = (_c, t) => t,
): void {
  for (const card of cards) {
    if (hasSeparateModeALink(card)) continue; // re-anchored hybrid → RC-A heals it
    const ta = getTextAnchor(card);
    if (!ta) continue;
    const text = textFor(card, ta.anchorText);
    if (!text) continue;
    const kind = kindFor(card);
    // Tint is kind-derived (only highlights carry a band, and it is the
    // theme-accent SENTINEL, not a resolved hex — task 174); a future per-card
    // `highlightColor` override wins when non-null.
    const override = (card as { highlightColor?: string | null }).highlightColor;
    const tintColor =
      typeof override === "string" && override
        ? override
        : defaultTintForLinkedAnchorKind(kind);
    out.push({
      anchorId: ta.anchorId,
      kind,
      text,
      cardId: card.id,
      tintColor,
      paragraphId: modeBParagraphId(card),
    });
  }
}

/**
 * Build the Mode-B re-apply record set by walking the ONE Mode-B collection
 * SSOT (`MODE_B_COLLECTIONS`), whose declared order IS the EXACT order of the
 * retired `EditorLayout.applyLinkedAnchors` effect (note → todo → revision →
 * cutter → report → highlight LAST; reports added in the BUG1 fix) — the
 * highlights-last rationale now lives with the table. Inclusion rules
 * (empty-text skip, the re-anchored-hybrid exclusion) are unchanged. Pure —
 * separated from the dispatch so tests can assert the record set without an
 * editor.
 */
export function buildModeBReapplyRecords(
  arrays: ModeBCardArrays,
): ModeBReapplyRecord[] {
  const records: ModeBReapplyRecord[] = [];
  for (const collection of MODE_B_COLLECTIONS) {
    collectModeBRecords(
      arrays[collection.slot],
      // The mark's `kind` attr for this record — the spine kind resolved by the
      // collection's own `kindOf` (the `cardKindFromRecord` SSOT for the
      // polymorphic slots), then folded into the mark namespace. Byte-identical
      // to the retired per-slot literals, including both revision kinds sharing
      // the single `"revision"` mark. The `?? "note"` is unreachable-defensive:
      // every kind bound to a Mode-B slot has a mark token by construction (the
      // module's dev canary + the census pin it).
      (card) => markKindForCardKind(collection.kindOf(card)) ?? "note",
      records,
      // Revisions ONLY: the retired effect fell back to `selectedText` when the
      // textRange snapshot was empty (`ta.anchorText || (c.selectedText ?? "")`).
      // This is a TEXT-resolution nuance of that one slot, not a membership
      // fact — kept slot-scoped so the record set stays byte-identical.
      collection.slot === "comments"
        ? (c, anchorText) =>
            anchorText || ((c as { selectedText?: string }).selectedText ?? "")
        : undefined,
    );
  }
  return records;
}

/**
 * Re-apply every surviving Mode-B card's `linkedAnchor` mark from its persisted
 * snapshot via the injected `applyLinkedAnchors`. Returns the number of records
 * applied (for no-op short-circuits / tests).
 */
export function reapplyModeBAnchors(
  applyLinkedAnchors: ApplyLinkedAnchorsFn,
  arrays: ModeBCardArrays,
): number {
  const records = buildModeBReapplyRecords(arrays);
  if (records.length > 0) {
    applyLinkedAnchors(records);
  }
  return records.length;
}
