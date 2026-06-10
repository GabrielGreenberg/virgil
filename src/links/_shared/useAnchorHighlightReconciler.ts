"use client";

/**
 * Single owner of the four DOM attributes that paint card selection and
 * hover across the editor body and the side panels:
 *
 *   - `data-card-selected`  ("paragraph" for Mode A paragraph anchors,
 *                            "true" for Mode B text ranges and inline
 *                            atoms)
 *   - `data-card-hovered`   (same value vocabulary)
 *   - `data-paragraph-kind` (color token; CSS uses it for the accent rail)
 *   - `data-margin-side`    ("left" | "right"; picks the edge of the rail)
 *
 * Replaces the older `useCardSelectionHighlight` + `useCardHoverHighlight`
 * pair, which captured `applied[]` arrays in their closures and relied on
 * conditional preservation logic to avoid stomping each other's attrs.
 * Both flaws produced intermittent staleness when a card was moved or
 * deleted while its paragraph was hovered — the hover effect held its
 * collections in a ref and never re-ran on card-collection changes, so
 * captured paragraph references outlived the move.
 *
 * The reconciler is idempotent. Every effect run sweeps the editor root
 * for any element bearing any of the four attrs, clears all four, then
 * re-applies based on the current `cardStore` `selected` card (the single
 * halo — N1: selection ⟂ expansion, so expanded-but-unselected cards do NOT
 * paint) and hover ref. No captured DOM references, no conditional
 * preservation, no inter-effect coordination.
 *
 * A sibling `useDanglingRefPruner` (same module, exported as part of the
 * same hook for ergonomics) clears `cardStore` entries that point to
 * cards no longer present in the collections, so deletion auto-clears
 * the bar without requiring per-kind delete handlers to know about
 * `cardStore`.
 */

import { useEffect, useLayoutEffect, useMemo } from "react";
import type { Editor } from "@tiptap/react";
import {
  cardStore,
  useHover,
  useSelection,
  type AnchoredCardRef,
} from "./anchored-card-store";
import type { CardKind } from "@/panels/_shared/types";
import { isInlineAtomCardKind } from "@/cards/predicates";
import { cssTokenForCardKind } from "@/cards/legacy-token-crosswalk";
import {
  cardKeyForEntity,
  findEntity,
} from "./entity-hover";
import type { EntityCollectionSlots } from "@/cards/entity-collections";
import type { Link } from "./types";
import { resolveLink } from "../links";

const DATA_CARD_SELECTED = "data-card-selected";
const DATA_CARD_HOVERED = "data-card-hovered";
const DATA_PARAGRAPH_KIND = "data-paragraph-kind";
const DATA_MARGIN_SIDE = "data-margin-side";

/** Map a CardKind to the kind token used by `data-paragraph-kind`
 *  selectors in globals.css. Single-sourced through the legacy-token crosswalk
 *  (R-C: byte-identical tokens — note→"note", cutter-*→"cut", revision-*→
 *  "comment", report/-request→"report", archive→"archive", todo→"todo", all
 *  others→null) so a paragraph anchor and a Mode B span for the same card
 *  paint in the same color. */
const paragraphKindFor = cssTokenForCardKind;

/** Synthesized Link for an inline-atom card (footnote / citation) — those
 *  aren't kept in collections, so we fabricate one for `resolveLink` to
 *  follow. */
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

function entityExists(ref: AnchoredCardRef, c: EntityCollectionSlots): boolean {
  // Inline-atom kinds (footnote / citation) aren't kept in collections; their
  // existence is the editor's job. Treat them as always-present so the pruner
  // never drops them. Routed through the single-source predicate.
  if (isInlineAtomCardKind(ref.kind)) return true;
  return findEntity(ref, c) !== undefined;
}

function linksForRef(ref: AnchoredCardRef, c: EntityCollectionSlots): Link[] {
  if (ref.kind === "footnote" || ref.kind === "citation") {
    return [linkForInlineAtom(ref.kind, ref.id)];
  }
  const entity = findEntity(ref, c);
  return entity?.links ? [...entity.links] : [];
}

export interface UseAnchorHighlightReconcilerArgs {
  editor: Editor | null;
  collections: EntityCollectionSlots;
}

export function useAnchorHighlightReconciler({
  editor,
  collections,
}: UseAnchorHighlightReconcilerArgs): void {
  const selected = useSelection();
  const hover = useHover();

  // The caller (EditorPane) rebuilds `collections` every render as a fresh
  // object literal, so depending on the wrapper directly would re-fire our
  // effects every render. Memoize on the individual array identities — each
  // hook (`useNotes`, etc.) only produces a new array when its data
  // actually changed.
  const {
    notes,
    cutterCards,
    archiveSnippets,
    todoItems,
    comments,
    reportCards,
    examples,
    highlights,
  } = collections;
  const stableCollections = useMemo<EntityCollectionSlots>(
    () => ({
      notes,
      cutterCards,
      archiveSnippets,
      todoItems,
      comments,
      reportCards,
      examples,
      highlights,
    }),
    [
      notes,
      cutterCards,
      archiveSnippets,
      todoItems,
      comments,
      reportCards,
      examples,
      highlights,
    ],
  );

  // Prune dangling cardStore refs whenever a collection changes. Read
  // cardStore state imperatively so the prune doesn't subscribe to it —
  // otherwise the prune would re-fire on every selection change and could
  // cycle with the reconciler. The reconciler subscribes to cardStore
  // separately above.
  useEffect(() => {
    const s = cardStore.getState();
    if (s.selected && !entityExists(s.selected, stableCollections)) {
      cardStore.clearSelection();
    }
    if (s.hover && !entityExists(s.hover, stableCollections)) {
      cardStore.setHover(null);
    }
    for (const ref of s.expandedSet) {
      if (!entityExists(ref, stableCollections)) cardStore.collapse(ref);
    }
  }, [stableCollections]);

  // Reconcile DOM attrs from the current (selection, hover, collections)
  // tuple. Idempotent: clears every attr in the editor root, then re-writes
  // based on the desired state.
  useLayoutEffect(() => {
    type PaintEntry = {
      kind: string | null;
      side: "left" | "right" | null;
      valueAttr: "paragraph" | "true";
    };

    // First write wins for a given element. Selection is single-card, so
    // there is no precedence to resolve among multiple selected refs.
    const selectedEls = new Map<HTMLElement, PaintEntry>();
    const hoveredEls = new Map<HTMLElement, PaintEntry>();
    const selectedCardKeys = new Set<string>();
    const hoveredCardKeys = new Set<string>();

    const editorReady =
      editor != null && !editor.isDestroyed && editor.isInitialized;

    const collectAnchorEls = (
      ref: AnchoredCardRef,
      into: Map<HTMLElement, PaintEntry>,
    ): void => {
      if (!editorReady) return;
      const links = linksForRef(ref, stableCollections);
      for (const link of links) {
        const resolved = resolveLink(editor, link);
        if (!resolved?.domEl) continue;
        if (into.has(resolved.domEl)) continue;
        const valueAttr: "paragraph" | "true" =
          resolved.kind === "paragraph" ? "paragraph" : "true";
        const kind =
          resolved.kind === "paragraph"
            ? paragraphKindFor(link.target.ref.kind as CardKind)
            : null;
        const side =
          resolved.kind === "paragraph" && link.anchor.type === "textObject"
            ? link.anchor.margin.side
            : null;
        into.set(resolved.domEl, { kind, side, valueAttr });
      }
    };

    const collectCardKey = (ref: AnchoredCardRef, into: Set<string>): void => {
      const key = cardKeyForEntity(ref);
      if (key) into.add(key);
    };

    // The halo (`data-card-selected`) paints from the SELECTION slot only —
    // a single card (N1). Expansion (multi/sticky) no longer drives the
    // text/margin/card highlight; a distinct expanded marker is an A6 follow-up.
    if (selected) {
      collectAnchorEls(selected, selectedEls);
      collectCardKey(selected, selectedCardKeys);
    }
    if (hover) {
      collectAnchorEls(hover, hoveredEls);
      collectCardKey(hover, hoveredCardKeys);
    }

    // Nuke and rebuild on the editor root.
    if (editorReady) {
      const root = editor.view.dom;
      const staleInRoot = root.querySelectorAll<HTMLElement>(
        `[${DATA_CARD_SELECTED}], [${DATA_CARD_HOVERED}], [${DATA_PARAGRAPH_KIND}], [${DATA_MARGIN_SIDE}]`,
      );
      for (const el of staleInRoot) {
        el.removeAttribute(DATA_CARD_SELECTED);
        el.removeAttribute(DATA_CARD_HOVERED);
        el.removeAttribute(DATA_PARAGRAPH_KIND);
        el.removeAttribute(DATA_MARGIN_SIDE);
      }
      for (const [el, entry] of selectedEls) {
        el.setAttribute(DATA_CARD_SELECTED, entry.valueAttr);
        if (entry.kind) el.setAttribute(DATA_PARAGRAPH_KIND, entry.kind);
        if (entry.side) el.setAttribute(DATA_MARGIN_SIDE, entry.side);
      }
      for (const [el, entry] of hoveredEls) {
        el.setAttribute(DATA_CARD_HOVERED, entry.valueAttr);
        // If selection already painted kind/side on this element, leave
        // them alone. Otherwise the hover entry provides them.
        if (!selectedEls.has(el)) {
          if (entry.kind) el.setAttribute(DATA_PARAGRAPH_KIND, entry.kind);
          if (entry.side) el.setAttribute(DATA_MARGIN_SIDE, entry.side);
        }
      }
    }

    // Panel cards live outside the editor root (some in portals). Sweep
    // the [data-card-key]-bearing subset of the document independently.
    const stalePanelCards = document.querySelectorAll<HTMLElement>(
      `[data-card-key][${DATA_CARD_SELECTED}], [data-card-key][${DATA_CARD_HOVERED}]`,
    );
    for (const el of stalePanelCards) {
      el.removeAttribute(DATA_CARD_SELECTED);
      el.removeAttribute(DATA_CARD_HOVERED);
    }
    for (const key of selectedCardKeys) {
      const matches = document.querySelectorAll<HTMLElement>(
        `[data-card-key="${key}"]`,
      );
      for (const el of matches) el.setAttribute(DATA_CARD_SELECTED, "true");
    }
    for (const key of hoveredCardKeys) {
      const matches = document.querySelectorAll<HTMLElement>(
        `[data-card-key="${key}"]`,
      );
      for (const el of matches) el.setAttribute(DATA_CARD_HOVERED, "true");
    }
  }, [editor, selected, hover, stableCollections]);
}
