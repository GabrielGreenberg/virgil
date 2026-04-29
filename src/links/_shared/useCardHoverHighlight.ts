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

import { useEffect } from "react";
import type { Editor } from "@tiptap/react";
import type { Link } from "./types";
import { resolveLink } from "../links";
import {
  cardKeyForEntity,
  findEntity,
  type EntityCollections,
  type EntityKind,
} from "./entity-hover";

const DATA_CARD_HOVERED = "data-card-hovered";

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
  } = args;

  useEffect(() => {
    // Always start by clearing any stale attributes everywhere — both in
    // the editor's view DOM (anchor elements) and in the document at
    // large (panel cards live outside the editor root).
    const editorRoot = editor?.view.dom ?? null;
    const stale = document.querySelectorAll<HTMLElement>(`[${DATA_CARD_HOVERED}]`);
    for (const el of stale) el.removeAttribute(DATA_CARD_HOVERED);

    if (!hoveredEntityId || !hoveredEntityKind) return;
    const ref = { id: hoveredEntityId, kind: hoveredEntityKind };
    const collections: EntityCollections = {
      notes,
      cutterCards,
      comments,
      todos,
      archiveSnippets,
      quotationGroups,
    };

    // 1) Anchor elements in the editor (paragraph / text-range / atom).
    const links: Link[] = [];
    if (hoveredEntityKind === "footnote" || hoveredEntityKind === "citation") {
      links.push(linkForInlineAtom(hoveredEntityKind, hoveredEntityId));
    } else {
      const entity = findEntity(ref, collections);
      if (entity?.links) for (const l of entity.links) links.push(l);
    }

    if (editor && editorRoot) {
      for (const link of links) {
        const resolved = resolveLink(editor, link);
        if (!resolved?.domEl) continue;
        const v = resolved.kind === "paragraph" ? "paragraph" : "true";
        resolved.domEl.setAttribute(DATA_CARD_HOVERED, v);
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
    };
  }, [
    editor,
    hoveredEntityId,
    hoveredEntityKind,
    notes,
    cutterCards,
    archiveSnippets,
    quotationGroups,
    todos,
    comments,
  ]);
}
