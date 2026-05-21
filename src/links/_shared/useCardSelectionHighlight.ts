"use client";

/**
 * Centralized "selected card → highlight its in-editor anchor" sync.
 *
 * Replaces three previously-scattered effects:
 *   - `useLinkHighlight` (Mode B linked-anchor spans for notes/cuts/revisions)
 *   - A per-selectedCitationId effect that added `citation-highlight-bib`
 *   - A per-selectedFootnoteId effect that added `footnote-highlight-marker`
 *
 * And fills in the gaps those didn't cover:
 *   - Mode A paragraph anchors on notes / cuts / revisions / todos /
 *     archive / quotations — the paragraph itself now gets a highlight
 *     when its card is selected.
 *
 * The hook consumes one selection slot per card kind plus the live card
 * collections (needed to look up a card's `links[]` from its id) and
 * writes a single `data-card-selected` attribute on every resolved
 * anchor DOM element. CSS in globals.css handles the actual visual,
 * with per-element-kind rules so atoms, text ranges, and paragraphs
 * each get an appropriate treatment.
 *
 * Cleanup on re-render strips stale attributes before re-applying.
 */

import { useEffect } from "react";
import type { Editor } from "@tiptap/react";
import type {
  ArchivedSnippet,
  CutterCard,
  QuotationGroup,
  RevisionCard,
  TodoItem,
  UserNote,
} from "@/lib/types";
import type { CardKind } from "@/panels/_shared/types";
import { cardPopKey } from "@/panels/panel-registry";
import type { Link } from "./types";
import { resolveLink } from "../links";

const DATA_CARD_SELECTED = "data-card-selected";
const DATA_PARAGRAPH_KIND = "data-paragraph-kind";
const DATA_MARGIN_SIDE = "data-margin-side";

/** Map a CardKind to the kind token used by `data-paragraph-kind`
 *  selectors in globals.css. The token aligns with the existing
 *  `.linked-anchor[data-link-card^="<kind>:"]` map so a paragraph
 *  anchor and a Mode B span for the same card paint in the same color. */
function paragraphKindFor(kind: CardKind): string | null {
  switch (kind) {
    case "note":               return "note";
    case "cutter-comment":
    case "cutter-suggestion":  return "cut";
    case "comment":
    case "revision-suggestion": return "comment";
    case "archive":            return "archive";
    case "quotation":          return "quotation";
    case "todo":               return "todo";
    default:                   return null;
  }
}

/** Domain-aware resolver for a selected card → a Link record that
 *  jumpToLink/resolveLink can follow. Inline-atom cards (footnote,
 *  citation) need a synthesized link because they're identified by the
 *  atom's own id, not by a `links[]` array. */
function linkForInlineAtom(
  nodeName: "footnote" | "citation",
  id: string,
): Link {
  return {
    id,
    kind: nodeName,
    anchor: { type: "inline-atom", nodeName, pos: null },
    target: { type: "card", ref: { kind: nodeName, id } },
    createdAt: "",
  };
}

export interface UseCardSelectionHighlightArgs {
  editor: Editor | null;

  // Selection slots (null = no card of that kind is selected).
  selectedNoteId: string | null;
  selectedFootnoteId: string | null;
  selectedCitationId: string | null;
  selectedCutterCardId: string | null;
  selectedCommentId: string | null;
  selectedTodoId: string | null;
  selectedArchiveId: string | null;
  selectedQuotationGroupId: string | null;

  // Lookups — needed to find a card's `links[]` from its id.
  notes: UserNote[];
  cutterCards: CutterCard[];
  archiveSnippets: ArchivedSnippet[];
  quotationGroups: QuotationGroup[];
  todos: TodoItem[];
  comments: RevisionCard[];
}

export function useCardSelectionHighlight({
  editor,
  selectedNoteId,
  selectedFootnoteId,
  selectedCitationId,
  selectedCutterCardId,
  selectedCommentId,
  selectedTodoId,
  selectedArchiveId,
  selectedQuotationGroupId,
  notes,
  cutterCards,
  archiveSnippets,
  quotationGroups,
  todos,
  comments,
}: UseCardSelectionHighlightArgs): void {
  useEffect(() => {
    if (!editor || editor.isDestroyed || !editor.isInitialized) return;
    const root = editor.view.dom;

    // Collect every link that should be highlighted right now. A single
    // card can contribute multiple links (e.g. a note anchored in three
    // paragraphs), in which case every resolvable anchor lights up.
    const activeLinks: Link[] = [];

    if (selectedFootnoteId) {
      activeLinks.push(linkForInlineAtom("footnote", selectedFootnoteId));
    }
    if (selectedCitationId) {
      activeLinks.push(linkForInlineAtom("citation", selectedCitationId));
    }

    const pushCardLinks = (card: { links?: Link[] } | undefined) => {
      if (!card?.links) return;
      for (const link of card.links) activeLinks.push(link);
    };

    if (selectedNoteId) {
      pushCardLinks(notes.find((n) => n.id === selectedNoteId));
    }
    if (selectedCutterCardId) {
      pushCardLinks(cutterCards.find((c) => c.id === selectedCutterCardId));
    }
    if (selectedArchiveId) {
      pushCardLinks(archiveSnippets.find((a) => a.id === selectedArchiveId));
    }
    if (selectedQuotationGroupId) {
      pushCardLinks(
        quotationGroups.find((g) => g.id === selectedQuotationGroupId),
      );
    }
    if (selectedTodoId) {
      pushCardLinks(todos.find((t) => t.id === selectedTodoId));
    }
    if (selectedCommentId) {
      pushCardLinks(
        comments.find((c) => c.id === selectedCommentId),
      );
    }

    // Apply. We track applied elements for cleanup.
    const applied: HTMLElement[] = [];
    const appliedParagraphKind: HTMLElement[] = [];
    const appliedMarginSide: HTMLElement[] = [];
    for (const link of activeLinks) {
      const resolved = resolveLink(editor, link);
      if (!resolved?.domEl) continue;
      const kindAttr =
        resolved.kind === "paragraph" ? "paragraph" : "true";
      resolved.domEl.setAttribute(DATA_CARD_SELECTED, kindAttr);
      applied.push(resolved.domEl);
      if (resolved.kind === "paragraph") {
        const pk = paragraphKindFor(link.target.ref.kind);
        if (pk) {
          resolved.domEl.setAttribute(DATA_PARAGRAPH_KIND, pk);
          appliedParagraphKind.push(resolved.domEl);
        }
        // Mode A paragraphs render the kind color as a vertical line on
        // the same side as the margin marker. Carry that side onto the
        // paragraph element so CSS can pick which edge to draw.
        if (link.anchor.type === "anchor") {
          resolved.domEl.setAttribute(
            DATA_MARGIN_SIDE,
            link.anchor.margin.side,
          );
          appliedMarginSide.push(resolved.domEl);
        }
      }
    }

    // Also light up every panel card that matches one of the selected
    // entities, so the card's outline picks up the same kind color at
    // the same intensity as the anchor in the editor body. Cards live
    // outside the editor root, so we search the whole document.
    // CardKind → data-card-key prefix is *not* identity (e.g. "comment"
    // → "revision:"), so always go through cardPopKey.
    const cardKeys = activeLinks.map((l) =>
      cardPopKey(l.target.ref.kind, l.target.ref.id),
    );
    const cardEls: HTMLElement[] = [];
    for (const key of cardKeys) {
      const matches = document.querySelectorAll<HTMLElement>(
        `[data-card-key="${key}"]`,
      );
      for (const el of matches) {
        el.setAttribute(DATA_CARD_SELECTED, "true");
        cardEls.push(el);
      }
    }

    // Defensive: also clear any stale data-card-selected attrs anywhere
    // in the document that we didn't just apply. Handles edges where a
    // previous render painted an element that's no longer in our applied
    // set — e.g. a card was deleted while its paragraph was momentarily
    // out of the DOM, so the cleanup closure's `applied` array didn't
    // capture the element. Set lookup is O(1) vs Array.includes O(n).
    //
    // Also sweep `data-paragraph-kind` / `data-margin-side` on the same
    // elements so the CSS accent bar can't render even if the kind/side
    // attrs got left behind. Skip when the paragraph is hovered, since
    // the hover hook owns those attrs in that case.
    const expected = new Set<HTMLElement>([...applied, ...cardEls]);
    const stale = document.querySelectorAll<HTMLElement>(
      `[${DATA_CARD_SELECTED}]`,
    );
    for (const el of stale) {
      if (expected.has(el)) continue;
      el.removeAttribute(DATA_CARD_SELECTED);
      if (!el.hasAttribute("data-card-hovered")) {
        el.removeAttribute(DATA_PARAGRAPH_KIND);
        el.removeAttribute(DATA_MARGIN_SIDE);
      }
    }

    return () => {
      for (const el of applied) el.removeAttribute(DATA_CARD_SELECTED);
      for (const el of cardEls) el.removeAttribute(DATA_CARD_SELECTED);
      for (const el of appliedParagraphKind) {
        // Don't remove if the hover hook still needs it (paragraph is
        // currently hovered). Selection and hover share this attribute.
        if (!el.hasAttribute("data-card-hovered")) {
          el.removeAttribute(DATA_PARAGRAPH_KIND);
        }
      }
      for (const el of appliedMarginSide) {
        if (!el.hasAttribute("data-card-hovered")) {
          el.removeAttribute(DATA_MARGIN_SIDE);
        }
      }
    };
  }, [
    editor,
    selectedNoteId,
    selectedFootnoteId,
    selectedCitationId,
    selectedCutterCardId,
    selectedCommentId,
    selectedTodoId,
    selectedArchiveId,
    selectedQuotationGroupId,
    notes,
    cutterCards,
    archiveSnippets,
    quotationGroups,
    todos,
    comments,
  ]);
}
