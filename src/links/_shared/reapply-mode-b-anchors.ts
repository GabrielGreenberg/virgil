/**
 * Mode-B linked-anchor re-apply (RC-B — the single load-time recovery WRITER).
 *
 * On reload the `.tex` parse drops every in-doc `linkedAnchor` mark (only the
 * sidecar's `links[]` survive), so each Mode-B card's range tint must be
 * re-stamped from its persisted snapshot. This used to live in a SECOND writer
 * in `EditorLayout` (the `applyLinkedAnchors` effect) that raced the EditorPane
 * load reconcile (RC-A); RC-B collapses it into the one load reconcile pass so
 * there is exactly ONE load-time owner. It lives in this leaf module (no React,
 * no editor import) so the EditorPane reconcile effect can call it and the RC-B
 * tests can drive it against a real `new Editor` without dragging the EditorPane
 * tree into jsdom.
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
 * on the keystroke path. The injected `applyLinkedAnchors` is itself idempotent
 * — it skips any record whose anchorId is already marked in the doc.
 */

import { getTextAnchor, type CardWithLinks, type LinkedAnchorKind } from "../links";

/** One re-apply instruction: re-stamp `kind`'s `linkedAnchor` mark with
 *  `anchorId` over the doc text `text`. Matches the `EditorHandle`'s
 *  `applyLinkedAnchors` record shape. */
export interface ModeBReapplyRecord {
  anchorId: string;
  kind: LinkedAnchorKind;
  text: string;
}

/** The one editor capability this module needs — re-stamp marks from records.
 *  Structural so the leaf module never imports the heavy Editor component. */
export type ApplyLinkedAnchorsFn = (records: ModeBReapplyRecord[]) => void;

export interface ModeBCardArrays {
  notes: readonly CardWithLinks[];
  todoItems: readonly CardWithLinks[];
  comments: readonly CardWithLinks[];
  cutterCards: readonly CardWithLinks[];
  highlights: readonly CardWithLinks[];
}

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

/** Build the records for one kind's cards, skipping cards with no live text
 *  anchor and the re-anchored hybrids.
 *
 *  `textFor` resolves the snapshot text for a card given its `getTextAnchor`
 *  result. It defaults to `ta.anchorText` (every kind except revisions); the
 *  revision branch threads a `selectedText` fallback to match the retired
 *  EditorLayout effect byte-for-byte. A card whose resolved text is empty is
 *  skipped (the retired effect's `applyLinkedAnchors` no-op'd it too). */
function collectModeBRecords(
  cards: readonly CardWithLinks[],
  kindFor: (card: CardWithLinks) => LinkedAnchorKind,
  out: ModeBReapplyRecord[],
  textFor: (card: CardWithLinks, anchorText: string) => string = (_c, t) => t,
): void {
  for (const card of cards) {
    if (hasSeparateModeALink(card)) continue; // re-anchored hybrid → RC-A heals it
    const ta = getTextAnchor(card);
    if (!ta) continue;
    const text = textFor(card, ta.anchorText);
    if (!text) continue;
    out.push({ anchorId: ta.anchorId, kind: kindFor(card), text });
  }
}

/**
 * Build the Mode-B re-apply record set in the EXACT order and with the EXACT
 * inclusion rules of the retired `EditorLayout.applyLinkedAnchors` effect
 * (note → todo → revision → cutter → highlight LAST), plus the
 * re-anchored-hybrid exclusion. Pure — separated from the dispatch so tests can
 * assert the record set without an editor.
 */
export function buildModeBReapplyRecords(
  arrays: ModeBCardArrays,
): ModeBReapplyRecord[] {
  const records: ModeBReapplyRecord[] = [];
  collectModeBRecords(arrays.notes, () => "note", records);
  collectModeBRecords(arrays.todoItems, () => "todo", records);
  // Revisions: the retired effect fell back to `selectedText` when the
  // textRange snapshot was empty (`ta.anchorText || (c.selectedText ?? "")`).
  collectModeBRecords(
    arrays.comments,
    () => "revision",
    records,
    (c, anchorText) =>
      anchorText || ((c as { selectedText?: string }).selectedText ?? ""),
  );
  collectModeBRecords(
    arrays.cutterCards,
    (c) =>
      (c as { kind?: string }).kind === "suggestion"
        ? "cutter-suggestion"
        : "cutter-comment",
    records,
  );
  // Highlights LAST — see the module header (overlap last-wins).
  collectModeBRecords(arrays.highlights, () => "highlight", records);
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
