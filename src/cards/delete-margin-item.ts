/**
 * Delete-or-unanchor for a single margin item.
 *
 * Contract: Delete/Backspace on a focused margin marker routes through this
 * helper rather than the old "just remove the paragraph link" path. The
 * result cuts down the number of incidental ways an unanchored card can
 * come into being:
 *
 *   1. **Multi-anchor card** (anchored to >1 paragraph): detach the card
 *      from exactly the link(s) THIS marker is drawn from — the row's own
 *      `sources` (task 1149) — and leave it alive with its other anchors. No
 *      confirm, no card deletion.
 *
 *   2. **Last-anchor card with content**: ask the user via the shared
 *      "This item has text. Delete it?" dialog. Cancel is a true no-op —
 *      both the link and the card are preserved. The same holds for a
 *      DOWNSTREAM refusal: a card owning a live applied splice raises the
 *      lifecycle SETTLE prompt (task 238) and its Cancel keeps the card, so
 *      this helper strips no mark unless the delete reports it committed.
 *
 *   3. **Last-anchor card with no content**: delete the card silently.
 *      The user wouldn't lose anything they typed.
 *
 * When a card carries an inline `linkedAnchor` mark (a Mode-B text-range
 * anchor — ANY kind made from a selection: notes, cuts, revisions, reports,
 * todos, …), the card-delete path strips it. The multi-anchor branch strips
 * a mark only when the deleted marker IS that Mode-B link (its row's source
 * names it): a Mode-B link is anchored where its mark is, so detaching the
 * row and leaving the mark would paint the marker straight back (task 1149).
 * The card-delete path reads the mark off the CARD itself
 * (`getTextAnchor`), never off a caller argument: it used to be passed by
 * four of the six marker kinds, so a todo's tint outlived its card until the
 * `useLinkedAnchorReconciler` sweep reaped it (task 939).
 *
 * Sibling unanchor paths (paragraph-deletion that orphans an anchor,
 * text-range deletion within a surviving paragraph) are handled in
 * `src/lib/tiptap/linked-anchor.ts` — they preserve the anchor by leaving
 * a placeholder paragraph in place, so a card never quietly loses its
 * home through incidental editor edits.
 */

import type { Editor } from "@tiptap/react";
import {
  getTextAnchor,
  removeLinkedAnchor,
  type AnchorRowSource,
  type CardWithLinks,
} from "@/links/links";
import type { ConfirmOptions } from "@/components/ConfirmDialog";
import {
  CARD_DELETE_CONFIRM_MESSAGE,
  cardHasContent,
  type CardContentKind,
} from "@/cards/has-content";
import { cardKindFromRecord } from "@/cards/predicates";
import type { MarkerType } from "@/cards/types";
import type { TextObjectKind } from "@/text-objects/types";
import type { DeclinableCardDelete } from "@/panels/card-lifecycle-registry";

/** Margin marker kinds that map to deletable cards — `MarkerType` minus the
 *  non-card `"error"` marker (errors aren't cards; their marker dismisses the
 *  lint entry). An applied revision/cutter suggestion keeps its ordinary
 *  `"revision"`/`"cut"` marker (Phase 1c), so its `onDelete` already routes
 *  through that kind's handler bundle — no separate namespace is needed.
 *  Derived, so a new card-bearing marker namespace automatically needs a
 *  handler bundle here or fails to typecheck. */
export type MarginItemKind = Exclude<MarkerType, "error">;

/** Per-kind handler bundle. `buildMarginItemHandlers` produces one of
 *  these maps from a set of hook returns. */
export interface MarginItemHandlers<TCard extends CardWithLinks = CardWithLinks> {
  /** Look up the card by id within this kind's collection. */
  findCard: (cardId: string) => TCard | undefined;
  /**
   * This kind's whole collection.
   *
   * The delete path asks by ID; the capture-retarget sweep
   * ({@link import("./retarget-anchors").retargetDisplacedAnchors}) asks the
   * COLLECTION — *which cards name a uuid this capture is about to remove?* A
   * Mode-A anchor lives on the card, not in the document, so it cannot be
   * found by walking the removed slice. One bundle, both directions, so the
   * two questions can never be answered from two tables.
   */
  cards: ReadonlyArray<TCard>;
  /** Card-content-kind for the has-content predicate. For kinds whose
   *  marker covers multiple card kinds (e.g. cut → comment + suggestion),
   *  pass a resolver that picks the right CardContentKind given the card. */
  contentKind: CardContentKind | ((card: TCard) => CardContentKind);
  /** Remove one STORED paragraph pid from the card — the capture-retarget's
   *  door, which asks by stored pid. NOT the margin Delete's door: a marker is
   *  drawn from a RESOLVED row, and its pid need not be stored (see
   *  {@link detach}). */
  unanchor: (cardId: string, paragraphId: string) => void;
  /** Detach the card from the links one margin row is drawn from — the
   *  multi-anchor Delete's door (task 1149). The sources are the row's own
   *  provenance (`MarginMarkerRow.sources`), so the door removes the link
   *  behind the marker by identity rather than by a pid match. */
  detach: (cardId: string, sources: readonly AnchorRowSource[]) => void;
  /**
   * Anchor the card to `paragraphId` — the inverse of {@link unanchor}, and
   * the half a capture-retarget needs. `paragraphSnapshot` is the target's
   * normalized text, so the fresh Mode-A link is self-healing on reload
   * exactly as the drop-mode re-anchor gesture's is.
   */
  reanchor: (
    cardId: string,
    paragraphId: string,
    targetKind?: TextObjectKind,
    paragraphSnapshot?: string | null,
  ) => void;
  /** Hard-delete the card from its hook's state. Resolves `false` when the
   *  delete DECLINED — the lifecycle executor's SETTLE prompt can be cancelled
   *  for a card that owns a live in-document splice (task 238), and a cancel
   *  means the card survives. The caller strips the inline mark only on a
   *  commit, so the answer is REQUIRED: a `void` delete here is a type error
   *  (task 1119), never a refusal silently read as success. */
  delete: DeclinableCardDelete;
}

export interface DeleteMarginItemArgs {
  kind: MarginItemKind;
  cardId: string;
  /** Paragraph UUID the deleted marker was anchored to. */
  paragraphId: string;
  /**
   * The card's RESOLVED anchor cohort — every pid it draws a marker for,
   * `paragraphId` included. Required, and it must be the `cardPids` carried by
   * the very row the deleted marker was built from
   * ({@link import("@/links/card-anchor-rows").buildMarginMarkerRows}).
   *
   * This is the door's ONLY input for "is this the card's last anchor?". It
   * used to be re-derived here from `getLinkedTextObjectIds(card)` — the
   * card's STORED pids — while the marker carried a pid the four-rung resolver
   * had RECOVERED through the `linkedAnchor` mark or the text snapshot. For
   * such a card the two lists are disjoint: the diff removed nothing, reported
   * a phantom sibling, and routed a single-anchor card into the multi-anchor
   * branch, whose `unanchor` names a pid the card does not store. That is a
   * no-op with no confirm, no deletion and no feedback — the card was simply
   * undeletable from the margin until a reload (task 669).
   *
   * Passing the cohort makes the two answers ONE answer. In the mount gap the
   * authority's rows are the raw stored pids, so this degrades to exactly the
   * old list where the old list was right.
   */
  anchorPids: readonly string[];
  /**
   * The links the deleted marker is drawn from — the `sources` of the SAME
   * row as `anchorPids` (task 1149). The multi-anchor branch detaches exactly
   * these. It used to `unanchor(cardId, paragraphId)`, a match on the card's
   * STORED pids: for a Mode-B link (stored pid kept, link kept by design) the
   * marker came straight back on the next pass, and for a recovered paragraph
   * the card stores no such pid at all — a silent no-op either way.
   */
  sources: readonly AnchorRowSource[];
  // NOTE (task 939): no `anchorId` argument. The `linkedAnchor` mark to strip
  // is read off the card (`getTextAnchor`) at commit time, so no caller can
  // forget it — four of the six marker kinds used to pass it, todo and
  // archive did not.
  /** Per-kind handler bundle for this `kind`. */
  handlers: MarginItemHandlers;
  /** Imperative confirm — typically from `useConfirmDialog().confirm`. */
  confirm: (opts: ConfirmOptions) => Promise<boolean>;
  /** Live editor instance, used to strip the `linkedAnchor` mark when
   *  the card is fully deleted. */
  editor: Editor | null;
}

/** See file header for the behavior contract. Pure async function — no
 *  React coupling, easy to unit-test. */
export async function deleteMarginItem(args: DeleteMarginItemArgs): Promise<void> {
  const { cardId, paragraphId, anchorPids, sources, handlers, confirm, editor } = args;
  const card = handlers.findCard(cardId);
  if (!card) return;

  // Compute remaining paragraph anchors after we drop this one. Cards
  // can be anchored to multiple paragraphs (`links[]` with N entries);
  // we only escalate to a card-delete when this was the LAST one.
  //
  // The cohort comes FROM the row this marker was drawn from — the four-rung
  // authority's answer — not from the card's stored pids, which say something
  // different for every mark-/snapshot-recovered card. See `anchorPids`.
  const remaining = anchorPids.filter((p) => p !== paragraphId);

  if (remaining.length > 0) {
    // Multi-anchor: detach exactly the link(s) this marker is drawn from.
    // `remaining` is the authority's cohort, so other markers really are
    // painted for this card (task 669 M3) — and `sources` is the same row's
    // answer to "which link?", so the detach can neither miss (a recovered
    // pid the card does not store) nor leave the binding standing (a Mode-B
    // link, anchored where its mark is — task 1149).
    handlers.detach(cardId, sources);
    // A whole-link detach of a link that carries a mark strips the mark too,
    // AFTER the write (same order as the card-delete path below). Any other
    // mark of the card stays: it belongs to a surviving link.
    if (editor) {
      for (const s of sources) {
        if (s.pid == null && s.anchorId) removeLinkedAnchor(editor, s.anchorId);
      }
    }
    return;
  }

  // This is the card's last anchor. Confirm-on-content before deleting.
  const contentKind =
    typeof handlers.contentKind === "function"
      ? handlers.contentKind(card)
      : handlers.contentKind;
  if (cardHasContent(contentKind, card)) {
    const ok = await confirm({
      message: CARD_DELETE_CONFIRM_MESSAGE,
      confirmLabel: "Delete",
      tone: "danger",
    });
    if (!ok) return; // Cancel: link and card both preserved.
  }

  // Hard-delete FIRST, then strip the inline mark so the highlight clears.
  //
  // The order matters and it used to be the other way round. That was safe
  // while a delete could not refuse; since the lifecycle SETTLE obligation
  // (task 238) it can — a card owning a live applied splice raises a
  // keep/revert prompt whose Cancel keeps the card. Stripping first would then
  // leave a SURVIVING card with its text-range mark torn out of the document
  // (and `removeLinkedAnchor` unsets every `linkedAnchor` over that range, so
  // the colocated blue pending mark goes with it), healed only by a reload.
  // "Cancel is a true no-op" is this file's contract — keep it true.
  //
  // The mark is read off the card BEFORE the delete (the handler drops it
  // from its collection, so `findCard` cannot answer afterwards).
  const anchorId = getTextAnchor(card)?.anchorId;
  const committed = await handlers.delete(cardId);
  if (committed === false) return; // declined downstream: card + mark preserved
  if (anchorId && editor) {
    removeLinkedAnchor(editor, anchorId);
  }
}

// ---------------------------------------------------------------------------
// Builder — collapses the per-kind wiring that's identical between every
// consumer (EditorPane and EditorLayout) into one place. Consumers call
// this from a `useMemo` over their hook returns and pass the resulting
// map into `deleteMarginItem({ handlers: handlers[kind], ... })`.
// ---------------------------------------------------------------------------

/** Every hook's add-paragraph-link door has the same shape; naming it once
 *  keeps the six dep structs honest about it. */
type AddParagraphLink = (
  id: string,
  paragraphId: string,
  targetKind?: TextObjectKind,
  paragraphSnapshot?: string | null,
) => void;

/** Every hook's row-detach door (task 1149) — `detachAnchorSources` over its
 *  own collection. */
type DetachAnchorSources = (id: string, sources: readonly AnchorRowSource[]) => void;

interface NotesDep {
  notes: ReadonlyArray<CardWithLinks>;
  addNoteTextObjectId: AddParagraphLink;
  removeNoteTextObjectId: (id: string, paragraphId: string) => void;
  detachNoteAnchorSources: DetachAnchorSources;
  deleteNote: DeclinableCardDelete;
}
interface ArchiveDep {
  snippets: ReadonlyArray<CardWithLinks>;
  addParagraphId: AddParagraphLink;
  removeParagraphId: (id: string, paragraphId: string) => void;
  detachAnchorSources: DetachAnchorSources;
  deleteSnippet: DeclinableCardDelete;
}
interface CutterDep {
  cards: ReadonlyArray<CardWithLinks & { kind: "comment" | "suggestion" }>;
  addCardParagraphId: AddParagraphLink;
  removeCardParagraphId: (id: string, paragraphId: string) => void;
  detachAnchorSources: DetachAnchorSources;
  deleteCard: DeclinableCardDelete;
}
interface TodosDep {
  items: ReadonlyArray<CardWithLinks>;
  addParagraphId: AddParagraphLink;
  removeParagraphId: (id: string, paragraphId: string) => void;
  detachAnchorSources: DetachAnchorSources;
  deleteItem: DeclinableCardDelete;
}
interface RevisionsDep {
  cards: ReadonlyArray<CardWithLinks & { kind: "comment" | "suggestion" }>;
  addCardParagraphId: AddParagraphLink;
  removeCardParagraphId: (id: string, paragraphId: string) => void;
  detachAnchorSources: DetachAnchorSources;
  deleteCard: DeclinableCardDelete;
}
interface ReportsDep {
  cards: ReadonlyArray<CardWithLinks & { kind: "report" | "report-request" }>;
  addCardParagraphId: AddParagraphLink;
  removeCardParagraphId: (id: string, paragraphId: string) => void;
  detachAnchorSources: DetachAnchorSources;
  deleteCard: DeclinableCardDelete;
}

export interface BuildMarginItemHandlersDeps {
  notes: NotesDep;
  archive: ArchiveDep;
  cutter: CutterDep;
  todos: TodosDep;
  revisions: RevisionsDep;
  reports: ReportsDep;
}

export function buildMarginItemHandlers(
  deps: BuildMarginItemHandlersDeps,
): Record<MarginItemKind, MarginItemHandlers> {
  return {
    note: {
      findCard: (id) => deps.notes.notes.find((n) => n.id === id),
      cards: deps.notes.notes,
      contentKind: "note",
      unanchor: deps.notes.removeNoteTextObjectId,
      detach: deps.notes.detachNoteAnchorSources,
      reanchor: deps.notes.addNoteTextObjectId,
      delete: deps.notes.deleteNote,
    },
    archive: {
      findCard: (id) => deps.archive.snippets.find((s) => s.id === id),
      cards: deps.archive.snippets,
      contentKind: "archive",
      unanchor: deps.archive.removeParagraphId,
      detach: deps.archive.detachAnchorSources,
      reanchor: deps.archive.addParagraphId,
      delete: deps.archive.deleteSnippet,
    },
    cut: {
      findCard: (id) => deps.cutter.cards.find((c) => c.id === id),
      cards: deps.cutter.cards,
      contentKind: (card) => cardKindFromRecord(card as { kind?: string }, "cutter"),
      unanchor: deps.cutter.removeCardParagraphId,
      detach: deps.cutter.detachAnchorSources,
      reanchor: deps.cutter.addCardParagraphId,
      delete: deps.cutter.deleteCard,
    },
    todo: {
      findCard: (id) => deps.todos.items.find((t) => t.id === id),
      cards: deps.todos.items,
      contentKind: "todo",
      unanchor: deps.todos.removeParagraphId,
      detach: deps.todos.detachAnchorSources,
      reanchor: deps.todos.addParagraphId,
      delete: deps.todos.deleteItem,
    },
    revision: {
      findCard: (id) => deps.revisions.cards.find((r) => r.id === id),
      cards: deps.revisions.cards,
      contentKind: (card) => cardKindFromRecord(card as { kind?: string }, "revisions"),
      unanchor: deps.revisions.removeCardParagraphId,
      detach: deps.revisions.detachAnchorSources,
      reanchor: deps.revisions.addCardParagraphId,
      delete: deps.revisions.deleteCard,
    },
    report: {
      findCard: (id) => deps.reports.cards.find((r) => r.id === id),
      cards: deps.reports.cards,
      contentKind: (card) => cardKindFromRecord(card as { kind?: string }, "reports"),
      unanchor: deps.reports.removeCardParagraphId,
      detach: deps.reports.detachAnchorSources,
      reanchor: deps.reports.addCardParagraphId,
      delete: deps.reports.deleteCard,
    },
  };
}
