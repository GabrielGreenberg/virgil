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
 *      both the link and the card are preserved.
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

/** Margin marker kinds that map to deletable cards — `MarkerType` minus the
 *  non-card markers: `"error"` (errors aren't cards; their marker dismisses the
 *  lint entry) and `"pending-change"` (Phase 1c — a DERIVED presence marker for
 *  an applied revision/cutter suggestion; its `onDelete` routes through the
 *  underlying card's own `"revision"`/`"cut"` handler bundle, so it needs no
 *  bundle of its own). Derived, so a new card-bearing marker namespace
 *  automatically needs a handler bundle here or fails to typecheck. */
export type MarginItemKind = Exclude<MarkerType, "error" | "pending-change">;

/** Per-kind handler bundle. `buildMarginItemHandlers` produces one of
 *  these maps from a set of hook returns. */
export interface MarginItemHandlers<TCard extends CardWithLinks = CardWithLinks> {
  /** Look up the card by id within this kind's collection. */
  findCard: (cardId: string) => TCard | undefined;
  /** Card-content-kind for the has-content predicate. For kinds whose
   *  marker covers multiple card kinds (e.g. cut → comment + suggestion),
   *  pass a resolver that picks the right CardContentKind given the card. */
  contentKind: CardContentKind | ((card: TCard) => CardContentKind);
  /** Remove one paragraph link from the card (the "unanchor" path). */
  unanchor: (cardId: string, paragraphId: string) => void;
  /** Hard-delete the card from its hook's state. */
  delete: (cardId: string) => void;
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

  // Strip the inline mark (if any) so the highlight clears, then hard-delete.
  if (anchorId && editor) {
    removeLinkedAnchor(editor, anchorId);
  }
  handlers.delete(cardId);
}

// ---------------------------------------------------------------------------
// Builder — collapses the per-kind wiring that's identical between every
// consumer (EditorPane and EditorLayout) into one place. Consumers call
// this from a `useMemo` over their hook returns and pass the resulting
// map into `deleteMarginItem({ handlers: handlers[kind], ... })`.
// ---------------------------------------------------------------------------

interface NotesDep {
  notes: ReadonlyArray<CardWithLinks>;
  removeNoteTextObjectId: (id: string, paragraphId: string) => void;
  deleteNote: (id: string) => void;
}
interface ArchiveDep {
  snippets: ReadonlyArray<CardWithLinks>;
  removeParagraphId: (id: string, paragraphId: string) => void;
  deleteSnippet: (id: string) => void;
}
interface CutterDep {
  cards: ReadonlyArray<CardWithLinks & { kind: "comment" | "suggestion" }>;
  removeCardParagraphId: (id: string, paragraphId: string) => void;
  deleteCard: (id: string) => void;
}
interface TodosDep {
  items: ReadonlyArray<CardWithLinks>;
  removeParagraphId: (id: string, paragraphId: string) => void;
  deleteItem: (id: string) => void;
}
interface RevisionsDep {
  cards: ReadonlyArray<CardWithLinks & { kind: "comment" | "suggestion" }>;
  removeCardParagraphId: (id: string, paragraphId: string) => void;
  deleteCard: (id: string) => void;
}
interface ReportsDep {
  cards: ReadonlyArray<CardWithLinks & { kind: "report" | "report-request" }>;
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
      contentKind: "note",
      unanchor: deps.notes.removeNoteTextObjectId,
      delete: deps.notes.deleteNote,
    },
    archive: {
      findCard: (id) => deps.archive.snippets.find((s) => s.id === id),
      contentKind: "archive",
      unanchor: deps.archive.removeParagraphId,
      delete: deps.archive.deleteSnippet,
    },
    cut: {
      findCard: (id) => deps.cutter.cards.find((c) => c.id === id),
      contentKind: (card) =>
        (card as { kind?: string }).kind === "suggestion"
          ? "cutter-suggestion"
          : "cutter-comment",
      unanchor: deps.cutter.removeCardParagraphId,
      delete: deps.cutter.deleteCard,
    },
    todo: {
      findCard: (id) => deps.todos.items.find((t) => t.id === id),
      contentKind: "todo",
      unanchor: deps.todos.removeParagraphId,
      delete: deps.todos.deleteItem,
    },
    revision: {
      findCard: (id) => deps.revisions.cards.find((r) => r.id === id),
      contentKind: (card) =>
        (card as { kind?: string }).kind === "suggestion"
          ? "revision-suggestion"
          : "revision-comment",
      unanchor: deps.revisions.removeCardParagraphId,
      delete: deps.revisions.deleteCard,
    },
    report: {
      findCard: (id) => deps.reports.cards.find((r) => r.id === id),
      contentKind: (card) =>
        (card as { kind?: string }).kind === "report-request"
          ? "report-request"
          : "report",
      unanchor: deps.reports.removeCardParagraphId,
      delete: deps.reports.deleteCard,
    },
  };
}
