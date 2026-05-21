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
 * re-applies based on the current `cardStore` selection (transient ∪
 * stickySet) and hover ref. No captured DOM references, no conditional
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
  useStickySet,
  useTransient,
  type AnchoredCardRef,
} from "./anchored-card-store";
import type { CardKind } from "@/panels/_shared/types";
import {
  cardKeyForEntity,
  findEntity,
  type EntityCollections,
  type EntityKind,
} from "./entity-hover";
import type { Link } from "./types";
import { resolveLink } from "../links";

const DATA_CARD_SELECTED = "data-card-selected";
const DATA_CARD_HOVERED = "data-card-hovered";
const DATA_PARAGRAPH_KIND = "data-paragraph-kind";
const DATA_MARGIN_SIDE = "data-margin-side";

/** Map a CardKind to the kind token used by `data-paragraph-kind`
 *  selectors in globals.css. Aligns with the existing
 *  `.linked-anchor[data-link-card^="<kind>:"]` map so a paragraph anchor
 *  and a Mode B span for the same card paint in the same color. */
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

/** Inline-atom kinds aren't kept in collections; their existence is the
 *  editor's job. Treat them as always-present so the pruner never drops
 *  them. */
function isInlineAtomKind(kind: EntityKind): boolean {
  return kind === "footnote" || kind === "citation";
}

function entityExists(ref: AnchoredCardRef, c: EntityCollections): boolean {
  if (isInlineAtomKind(ref.kind)) return true;
  return findEntity(ref, c) !== undefined;
}

function linksForRef(ref: AnchoredCardRef, c: EntityCollections): Link[] {
  if (ref.kind === "footnote" || ref.kind === "citation") {
    return [linkForInlineAtom(ref.kind, ref.id)];
  }
  const entity = findEntity(ref, c);
  return entity?.links ? [...entity.links] : [];
}

export interface UseAnchorHighlightReconcilerArgs {
  editor: Editor | null;
  collections: EntityCollections;
}

export function useAnchorHighlightReconciler({
  editor,
  collections,
}: UseAnchorHighlightReconcilerArgs): void {
  const transient = useTransient();
  const stickySet = useStickySet();
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
    quotationGroups,
    todos,
    comments,
    examples,
    highlights,
  } = collections;
  const stableCollections = useMemo<EntityCollections>(
    () => ({
      notes,
      cutterCards,
      archiveSnippets,
      quotationGroups,
      todos,
      comments,
      examples,
      highlights,
    }),
    [
      notes,
      cutterCards,
      archiveSnippets,
      quotationGroups,
      todos,
      comments,
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
    if (s.transient && !entityExists(s.transient, stableCollections)) {
      cardStore.setTransient(null);
    }
    if (s.hover && !entityExists(s.hover, stableCollections)) {
      cardStore.setHover(null);
    }
    for (const ref of s.stickySet) {
      if (!entityExists(ref, stableCollections)) cardStore.removeSticky(ref);
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

    // First write wins for a given element. We collect transient before
    // stickySet so the primary's color/side takes precedence when multiple
    // refs share a paragraph.
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
          resolved.kind === "paragraph" && link.anchor.type === "anchor"
            ? link.anchor.margin.side
            : null;
        into.set(resolved.domEl, { kind, side, valueAttr });
      }
    };

    const collectCardKey = (ref: AnchoredCardRef, into: Set<string>): void => {
      const key = cardKeyForEntity(ref, stableCollections);
      if (key) into.add(key);
    };

    if (transient) {
      collectAnchorEls(transient, selectedEls);
      collectCardKey(transient, selectedCardKeys);
    }
    for (const ref of stickySet) {
      collectAnchorEls(ref, selectedEls);
      collectCardKey(ref, selectedCardKeys);
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
  }, [editor, transient, stickySet, hover, stableCollections]);
}
