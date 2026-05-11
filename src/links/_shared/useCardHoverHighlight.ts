"use client";

/**
 * Hover-side counterpart to `useCardSelectionHighlight`. Given a hovered
 * `(entityId, entityKind)` pair, this hook:
 *
 *   1. Resolves the entity to its Link[] and writes `data-card-hovered` on
 *      every resolvable in-editor anchor element (paragraph for Mode A,
 *      span for Mode B, atom for footnote/citation).
 *   2. Writes `data-card-hovered` on the panel card element matching the
 *      entity's `data-card-key`. This gives card-side hover feedback
 *      without touching any individual panel component.
 *
 * Cleanup mirrors the selection hook: stale attributes are stripped on
 * each effect run, including across panel scroll containers (cards live
 * outside the editor's view DOM).
 *
 * The hook is intentionally read-only — sources of hover (margin icons,
 * card mouseover, text mouseover) write to a single
 * `(hoveredEntityId, hoveredEntityKind)` state pair, and this hook is the
 * single consumer that paints the resulting visuals.
 */

import { useLayoutEffect, useRef } from "react";
import type { Editor } from "@tiptap/react";
import type { CardKind } from "@/panels/_shared/types";
import type { Link } from "./types";
import { resolveLink } from "../links";
import {
  cardKeyForEntity,
  findEntity,
  type EntityCollections,
  type EntityKind,
} from "./entity-hover";

const DATA_CARD_HOVERED = "data-card-hovered";
const DATA_PARAGRAPH_KIND = "data-paragraph-kind";
const DATA_MARGIN_SIDE = "data-margin-side";

/** Map a CardKind to the kind token used by `data-paragraph-kind`
 *  selectors in globals.css. Mirrors useCardSelectionHighlight so a
 *  paragraph hovered and a paragraph selected paint in the same color. */
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

export interface UseCardHoverHighlightArgs extends EntityCollections {
  editor: Editor | null;
  hoveredEntityId: string | null;
  hoveredEntityKind: EntityKind | null;
}

export function useCardHoverHighlight(args: UseCardHoverHighlightArgs): void {
  const {
    editor,
    hoveredEntityId,
    hoveredEntityKind,
    notes,
    cutterCards,
    archiveSnippets,
    quotationGroups,
    todos,
    comments,
    examples,
  } = args;

  // Collections are only needed for entity resolution — they shouldn't
  // trigger re-runs of the paint effect. Stash them in a ref so the
  // effect only re-fires when the hovered entity actually changes.
  const collectionsRef = useRef<EntityCollections>({
    notes, cutterCards, comments, todos, archiveSnippets, quotationGroups, examples,
  });
  collectionsRef.current = {
    notes, cutterCards, comments, todos, archiveSnippets, quotationGroups, examples,
  };

  useLayoutEffect(() => {
    const stale = document.querySelectorAll<HTMLElement>(`[${DATA_CARD_HOVERED}]`);
    for (const el of stale) el.removeAttribute(DATA_CARD_HOVERED);

    if (!hoveredEntityId || !hoveredEntityKind) return;
    const ref = { id: hoveredEntityId, kind: hoveredEntityKind };
    const collections = collectionsRef.current;

    // 1) Anchor elements in the editor (paragraph / text-range / atom).
    const links: Link[] = [];
    if (hoveredEntityKind === "footnote" || hoveredEntityKind === "citation") {
      links.push(linkForInlineAtom(hoveredEntityKind, hoveredEntityId));
    } else {
      const entity = findEntity(ref, collections);
      if (entity?.links) for (const l of entity.links) links.push(l);
    }

    const appliedParagraphKind: HTMLElement[] = [];
    const appliedMarginSide: HTMLElement[] = [];
    if (editor && !editor.isDestroyed && editor.isInitialized) {
      for (const link of links) {
        const resolved = resolveLink(editor, link);
        if (!resolved?.domEl) continue;
        const v = resolved.kind === "paragraph" ? "paragraph" : "true";
        resolved.domEl.setAttribute(DATA_CARD_HOVERED, v);
        if (resolved.kind === "paragraph") {
          const pk = paragraphKindFor(link.target.ref.kind);
          if (pk) {
            resolved.domEl.setAttribute(DATA_PARAGRAPH_KIND, pk);
            appliedParagraphKind.push(resolved.domEl);
          }
          // Mode A paragraphs render the kind color as a side-aware line
          // (matches the margin marker's side). Mirror selection-hook
          // behavior so hover and selection paint on the same edge.
          if (link.anchor.type === "anchor") {
            resolved.domEl.setAttribute(
              DATA_MARGIN_SIDE,
              link.anchor.margin.side,
            );
            appliedMarginSide.push(resolved.domEl);
          }
        }
      }
    }

    // 2) Panel card element via data-card-key. Multiple matches possible
    //    (popped-out floats, omni + native), so we set on all of them.
    const cardKey = cardKeyForEntity(ref, collections);
    if (cardKey) {
      const cards = document.querySelectorAll<HTMLElement>(
        `[data-card-key="${cardKey}"]`,
      );
      for (const el of cards) el.setAttribute(DATA_CARD_HOVERED, "true");
    }

    return () => {
      const live = document.querySelectorAll<HTMLElement>(
        `[${DATA_CARD_HOVERED}]`,
      );
      for (const el of live) el.removeAttribute(DATA_CARD_HOVERED);
      for (const el of appliedParagraphKind) {
        // Don't remove if the selection hook still needs it (paragraph
        // is currently selected). Selection and hover share this
        // attribute.
        if (
          el.getAttribute("data-card-selected") !== "paragraph"
        ) {
          el.removeAttribute(DATA_PARAGRAPH_KIND);
        }
      }
      for (const el of appliedMarginSide) {
        if (
          el.getAttribute("data-card-selected") !== "paragraph"
        ) {
          el.removeAttribute(DATA_MARGIN_SIDE);
        }
      }
    };
  }, [editor, hoveredEntityId, hoveredEntityKind]);
}
