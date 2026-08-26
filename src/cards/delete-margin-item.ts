/**
 * Delete-or-unanchor for a single margin item.
 *
 * Contract: Delete/Backspace on a focused margin marker routes through this
 * helper rather than the old "just remove the paragraph link" path. The
 * result cuts down the number of incidental ways an unanchored card can
 * come into being:
 *
 *   1. **Multi-anchor card** (anchored to >1 paragraph): just remove THIS
 *      paragraph link, leave the card alive with its other anchors. No
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
 * When a card carries an inline `linkedAnchor` mark (text-range anchor —
 * notes / cuts / revisions), we strip the mark only on the card-delete
 * path. In the multi-anchor unanchor branch the mark stays bound to the
 * surviving paragraphs.
 *
 * Sibling unanchor paths (paragraph-deletion that orphans an anchor,
 * text-range deletion within a surviving paragraph) are handled in
 * `src/lib/tiptap/linked-anchor.ts` — they preserve the anchor by leaving
 * a placeholder paragraph in place, so a card never quietly loses its
 * home through incidental editor edits.
 */

import type { Editor } from "@tiptap/react";
import {
  getLinkedTextObjectIds,
  removeLinkedAnchor,
  type CardWithLinks,
} from "@/links/links";
import type { ConfirmOptions } from "@/components/ConfirmDialog";
import {
  cardHasContent,
  type CardContentKind,
} from "@/cards/has-content";
import type { MarkerType } from "@/cards/types";
import type { TextObjectKind } from "@/text-objects/types";

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
  /** Remove one paragraph link from the card (the "unanchor" path). */
  unanchor: (cardId: string, paragraphId: string) => void;
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
  /** Hard-delete the card from its hook's state. Returns `false` when the
   *  delete DECLINED — the lifecycle executor's SETTLE prompt can be cancelled
   *  for a card that owns a live in-document splice (task 238), and a cancel
   *  means the card survives. A handler that can't decline may return `void`. */
  delete: (cardId: string) => void | boolean | Promise<void | boolean>;
}

export interface DeleteMarginItemArgs {
  kind: MarginItemKind;
  cardId: string;
  /** Paragraph UUID the deleted marker was anchored to. */
  paragraphId: string;
  /** Inline text-range anchor id, if the card carried a `linkedAnchor`
   *  mark. Set for notes / cuts / revisions; absent for paragraph-only
   *  anchored cards. */
  anchorId?: string;
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
  const { cardId, paragraphId, anchorId, handlers, confirm, editor } = args;
  const card = handlers.findCard(cardId);
  if (!card) return;

  // Compute remaining paragraph anchors after we drop this one. Cards
  // can be anchored to multiple paragraphs (`links[]` with N entries);
  // we only escalate to a card-delete when this was the LAST one.
  const remaining = getLinkedTextObjectIds(card).filter((p) => p !== paragraphId);

  if (remaining.length > 0) {
    // Multi-anchor: just remove this paragraph link. Do NOT strip the
    // text-range mark — it's still bound to the other paragraph(s).
    handlers.unanchor(cardId, paragraphId);
    return;
  }

  // This is the card's last anchor. Confirm-on-content before deleting.
  const contentKind =
    typeof handlers.contentKind === "function"
      ? handlers.contentKind(card)
      : handlers.contentKind;
  if (cardHasContent(contentKind, card)) {
    const ok = await confirm({
      message: "This item has text. Delete it?",
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

interface NotesDep {
  notes: ReadonlyArray<CardWithLinks>;
  addNoteTextObjectId: AddParagraphLink;
  removeNoteTextObjectId: (id: string, paragraphId: string) => void;
  deleteNote: (id: string) => void;
}
interface ArchiveDep {
  snippets: ReadonlyArray<CardWithLinks>;
  addParagraphId: AddParagraphLink;
  removeParagraphId: (id: string, paragraphId: string) => void;
  deleteSnippet: (id: string) => void;
}
interface CutterDep {
  cards: ReadonlyArray<CardWithLinks & { kind: "comment" | "suggestion" }>;
  addCardParagraphId: AddParagraphLink;
  removeCardParagraphId: (id: string, paragraphId: string) => void;
  deleteCard: (id: string) => void;
}
interface TodosDep {
  items: ReadonlyArray<CardWithLinks>;
  addParagraphId: AddParagraphLink;
  removeParagraphId: (id: string, paragraphId: string) => void;
  deleteItem: (id: string) => void;
}
interface RevisionsDep {
  cards: ReadonlyArray<CardWithLinks & { kind: "comment" | "suggestion" }>;
  addCardParagraphId: AddParagraphLink;
  removeCardParagraphId: (id: string, paragraphId: string) => void;
  deleteCard: (id: string) => void;
}
interface ReportsDep {
  cards: ReadonlyArray<CardWithLinks & { kind: "report" | "report-request" }>;
  addCardParagraphId: AddParagraphLink;
  removeCardParagraphId: (id: string, paragraphId: string) => void;
  deleteCard: (id: string) => void;
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
      reanchor: deps.notes.addNoteTextObjectId,
      delete: deps.notes.deleteNote,
    },
    archive: {
      findCard: (id) => deps.archive.snippets.find((s) => s.id === id),
      cards: deps.archive.snippets,
      contentKind: "archive",
      unanchor: deps.archive.removeParagraphId,
      reanchor: deps.archive.addParagraphId,
      delete: deps.archive.deleteSnippet,
    },
    cut: {
      findCard: (id) => deps.cutter.cards.find((c) => c.id === id),
      cards: deps.cutter.cards,
      contentKind: (card) =>
        (card as { kind?: string }).kind === "suggestion"
          ? "cutter-suggestion"
          : "cutter-comment",
      unanchor: deps.cutter.removeCardParagraphId,
      reanchor: deps.cutter.addCardParagraphId,
      delete: deps.cutter.deleteCard,
    },
    todo: {
      findCard: (id) => deps.todos.items.find((t) => t.id === id),
      cards: deps.todos.items,
      contentKind: "todo",
      unanchor: deps.todos.removeParagraphId,
      reanchor: deps.todos.addParagraphId,
      delete: deps.todos.deleteItem,
    },
    revision: {
      findCard: (id) => deps.revisions.cards.find((r) => r.id === id),
      cards: deps.revisions.cards,
      contentKind: (card) =>
        (card as { kind?: string }).kind === "suggestion"
          ? "revision-suggestion"
          : "revision-comment",
      unanchor: deps.revisions.removeCardParagraphId,
      reanchor: deps.revisions.addCardParagraphId,
      delete: deps.revisions.deleteCard,
    },
    report: {
      findCard: (id) => deps.reports.cards.find((r) => r.id === id),
      cards: deps.reports.cards,
      contentKind: (card) =>
        (card as { kind?: string }).kind === "report-request"
          ? "report-request"
          : "report",
      unanchor: deps.reports.removeCardParagraphId,
      reanchor: deps.reports.addCardParagraphId,
      delete: deps.reports.deleteCard,
    },
  };
}
