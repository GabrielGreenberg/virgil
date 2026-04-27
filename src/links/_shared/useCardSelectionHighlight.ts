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
  Comment,
  CutItem,
  QuotationGroup,
  TodoItem,
  UserNote,
} from "@/lib/types";
import type { Link } from "./types";
import { resolveLink } from "../links";

const DATA_CARD_SELECTED = "data-card-selected";

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
  selectedCutId: string | null;
  selectedCommentId: string | null;
  selectedTodoId: string | null;
  selectedArchiveId: string | null;
  selectedQuotationGroupId: string | null;

  // Lookups — needed to find a card's `links[]` from its id.
  notes: UserNote[];
  cuts: CutItem[];
  archiveSnippets: ArchivedSnippet[];
  quotationGroups: QuotationGroup[];
  todos: TodoItem[];
  comments: Comment[];
}

export function useCardSelectionHighlight({
  editor,
  selectedNoteId,
  selectedFootnoteId,
  selectedCitationId,
  selectedCutId,
  selectedCommentId,
  selectedTodoId,
  selectedArchiveId,
  selectedQuotationGroupId,
  notes,
  cuts,
  archiveSnippets,
  quotationGroups,
  todos,
  comments,
}: UseCardSelectionHighlightArgs): void {
  useEffect(() => {
    if (!editor) return;
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
    if (selectedCutId) {
      pushCardLinks(cuts.find((c) => c.id === selectedCutId));
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
    for (const link of activeLinks) {
      const resolved = resolveLink(editor, link);
      if (!resolved?.domEl) continue;
      const kindAttr =
        resolved.kind === "paragraph" ? "paragraph" : "true";
      resolved.domEl.setAttribute(DATA_CARD_SELECTED, kindAttr);
      applied.push(resolved.domEl);
    }

    // Defensive: also clear any stale attrs anywhere in the editor root
    // that we didn't just apply. Handles edges where a previous render
    // painted an element that's no longer in our applied set.
    const stale = root.querySelectorAll<HTMLElement>(
      `[${DATA_CARD_SELECTED}]`,
    );
    for (const el of stale) {
      if (!applied.includes(el)) el.removeAttribute(DATA_CARD_SELECTED);
    }

    return () => {
      for (const el of applied) el.removeAttribute(DATA_CARD_SELECTED);
    };
  }, [
    editor,
    selectedNoteId,
    selectedFootnoteId,
    selectedCitationId,
    selectedCutId,
    selectedCommentId,
    selectedTodoId,
    selectedArchiveId,
    selectedQuotationGroupId,
    notes,
    cuts,
    archiveSnippets,
    quotationGroups,
    todos,
    comments,
  ]);
}
