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
 * The reconciler is idempotent. Every effect run recomputes the desired
 * (selection, hover) state from the current `cardStore` `selected` card
 * (the single halo — N1: selection ⟂ expansion, so expanded-but-unselected
 * cards do NOT paint) and hover ref. No captured DOM references, no
 * conditional preservation, no inter-effect coordination.
 *
 * TWO PAINT SURFACES, TWO MECHANISMS:
 *
 *   1. IN-EDITOR anchor targets (paragraph / heading / listItem blocks,
 *      footnote / citation atoms, Mode-B `linkedAnchor` ranges) are painted
 *      via a ProseMirror DECORATION (`AnchorHighlightDecorator` in
 *      `anchor-highlight-deco.ts`). The reconciler resolves each link to live
 *      PM coordinates + an attr bag and pushes the COMPLETE desired target
 *      list through `setAnchorHighlightTargets`. PM owns the attrs, so it
 *      never treats them as a foreign mutation and never redraws the node —
 *      eliminating the listItem/heading hover-cull + the residual
 *      hover-highlight loss + the per-hover layout churn. (Raw setAttribute
 *      onto a `Decoration.node`-decorated block with no wrapper-guarded
 *      NodeView `ignoreMutation` was the root cause.)
 *
 *   2. PANEL CARDS (`[data-card-key]` elements in the rail / floats) are
 *      plain React DOM, NOT PM nodes — a raw `setAttribute` there causes no
 *      redraw, so they stay on the sweep-and-restamp path below, unchanged.
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
import {
  setAnchorHighlightTargets,
  selectedAttrs,
  hoveredAttrs,
  type AnchorHighlightTarget,
  type AnchorHighlightAttrs,
} from "@/lib/tiptap/anchor-highlight-deco";

const DATA_CARD_SELECTED = "data-card-selected";
const DATA_CARD_HOVERED = "data-card-hovered";

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

  // Reconcile from the current (selection, hover, collections) tuple.
  // Idempotent: recomputes the desired in-editor decoration targets + the
  // desired panel-card key sets from scratch, then (1) hands the editor
  // decorations the COMPLETE target list and (2) sweeps + restamps the panel
  // cards. No captured DOM references; no inter-effect coordination.
  useLayoutEffect(() => {
    // ── In-editor targets, keyed by PM start position. First write wins
    // per position (selection is single-card; no precedence among selected
    // refs). Selection and hover are tracked separately so "selection wins"
    // for kind/side on a shared element matches the legacy guard. ─────────
    const selectedTargets = new Map<number, AnchorHighlightResolved>();
    const hoveredTargets = new Map<number, AnchorHighlightResolved>();
    const selectedCardKeys = new Set<string>();
    const hoveredCardKeys = new Set<string>();

    const editorReady =
      editor != null && !editor.isDestroyed && editor.isInitialized;

    const collectTargets = (
      ref: AnchoredCardRef,
      into: Map<number, AnchorHighlightResolved>,
    ): void => {
      if (!editorReady) return;
      const links = linksForRef(ref, stableCollections);
      for (const link of links) {
        const resolved = resolveLink(editor, link);
        if (!resolved) continue;
        // Resolve to PM coordinates + a decoration shape. Paragraph (Mode-A)
        // and inline atoms are `Decoration.node`; text-range (Mode-B) is
        // `Decoration.inline`. The value vocabulary is byte-identical to the
        // legacy raw-setAttribute path.
        let from: number;
        let to: number;
        let shape: "node" | "inline";
        if (resolved.kind === "paragraph" || resolved.kind === "inline-atom") {
          // `Decoration.node` needs the node's exact span. `inline-atom`
          // resolution carries `nodeSize`; `paragraph` does not — read the
          // live node at `pos` for its size (the same node `resolveLink`
          // located, so it always exists here).
          const node = editor.state.doc.nodeAt(resolved.pos);
          if (!node) continue;
          from = resolved.pos;
          to = resolved.pos + node.nodeSize;
          shape = "node";
        } else {
          // text-range (Mode B)
          from = resolved.from;
          to = resolved.to;
          shape = "inline";
        }
        if (into.has(from)) continue;
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
        into.set(from, {
          shape,
          from,
          to,
          attrs: { value: valueAttr, kind, side },
        });
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
      collectTargets(selected, selectedTargets);
      collectCardKey(selected, selectedCardKeys);
    }
    if (hover) {
      collectTargets(hover, hoveredTargets);
      collectCardKey(hover, hoveredCardKeys);
    }

    // ── Build the decoration target list and hand it to PM. ───────────────
    if (editorReady) {
      const decoTargets: AnchorHighlightTarget[] = [];
      for (const t of selectedTargets.values()) {
        decoTargets.push({
          shape: t.shape,
          from: t.from,
          to: t.to,
          attrs: selectedAttrs(t.attrs),
        });
      }
      for (const t of hoveredTargets.values()) {
        // If selection already painted this position, its kind/side win —
        // emit only the hover marker (no kind/side). Otherwise hover supplies
        // them. Mirrors the legacy `!selectedEls.has(el)` guard.
        const selectionOwnsThisPos = selectedTargets.has(t.from);
        decoTargets.push({
          shape: t.shape,
          from: t.from,
          to: t.to,
          attrs: hoveredAttrs(t.attrs, !selectionOwnsThisPos),
        });
      }
      setAnchorHighlightTargets(editor.view, decoTargets);
    }

    // ── Panel cards live outside the editor root (some in portals) and are
    // React DOM, not PM nodes — raw setAttribute causes no redraw there, so
    // sweep + restamp the [data-card-key]-bearing subset independently. ────
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

/** A resolved in-editor target before the selected/hovered attr bag is
 *  materialized (selection-vs-hover kind/side precedence is applied at
 *  emit time). */
interface AnchorHighlightResolved {
  shape: "node" | "inline";
  from: number;
  to: number;
  attrs: AnchorHighlightAttrs;
}
