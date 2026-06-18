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
 * THREE PAINT SURFACES, TWO MECHANISMS:
 *
 *   1. IN-EDITOR NODE/ATOM targets (paragraph / heading / listItem blocks,
 *      footnote / citation atoms) are painted via a ProseMirror DECORATION
 *      (`AnchorHighlightDecorator` in `anchor-highlight-deco.ts`). The
 *      reconciler resolves each link to live PM coordinates + an attr bag and
 *      pushes the COMPLETE desired NODE target list through
 *      `setAnchorHighlightTargets`. PM owns the attrs, so it never treats them
 *      as a foreign mutation and never redraws the node — eliminating the
 *      listItem/heading hover-cull + the residual hover-highlight loss + the
 *      per-hover layout churn. (Raw setAttribute onto a `Decoration.node`-
 *      decorated block with no wrapper-guarded NodeView `ignoreMutation` was
 *      the root cause.)
 *
 *   2. IN-EDITOR Mode-B TEXT RANGES (`linkedAnchor` mark spans) are painted by
 *      RAW `setAttribute` directly onto the `.linked-anchor` span
 *      (`resolved.domEl`). A `.linked-anchor` is a plain mark span — NOT a
 *      `Decoration.node`-owned block — so a raw setAttribute does NOT redraw or
 *      detach it. Crucially, the consuming CSS requires the attr+class on the
 *      SAME element (`.linked-anchor[data-card-hovered="true"]` /
 *      `[data-card-selected="true"]`, globals.css). A `Decoration.inline` over
 *      a TEXT node wraps it in a FRESH inner `<span>` (TextViewDesc
 *      `applyOuterDeco`, `needsWrap` for nodeType 3), landing the attrs on a
 *      CHILD of `.linked-anchor` — so the CSS never matches. Mode-B therefore
 *      stays on the raw-setAttribute sweep path (this is the same path it used
 *      pre-decoration, and Mode-B was never part of the redraw root cause).
 *
 *   3. PANEL CARDS (`[data-card-key]` elements in the rail / floats) are
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

  // Reconcile from the current (selection, hover, collections) tuple.
  // Idempotent: recomputes the desired in-editor NODE-decoration targets, the
  // desired Mode-B `.linked-anchor` raw-attr targets, and the desired
  // panel-card key sets from scratch, then (1) hands the editor decorations the
  // COMPLETE node target list, (2) sweeps + restamps the Mode-B spans, and
  // (3) sweeps + restamps the panel cards. No captured DOM references; no
  // inter-effect coordination.
  useLayoutEffect(() => {
    // ── In-editor NODE/ATOM targets, keyed by PM start position. First write
    // wins per position (selection is single-card; no precedence among
    // selected refs). Selection and hover are tracked separately so "selection
    // wins" for kind/side on a shared element matches the legacy guard. ─────
    const selectedNodeTargets = new Map<number, AnchorHighlightResolved>();
    const hoveredNodeTargets = new Map<number, AnchorHighlightResolved>();
    // ── Mode-B text-range targets, keyed by the live `.linked-anchor` DOM
    // element (raw-setAttribute path). Mirrors the legacy element-keyed maps. ─
    const selectedRangeEls = new Map<HTMLElement, AnchorHighlightAttrs>();
    const hoveredRangeEls = new Map<HTMLElement, AnchorHighlightAttrs>();
    const selectedCardKeys = new Set<string>();
    const hoveredCardKeys = new Set<string>();

    const editorReady =
      editor != null && !editor.isDestroyed && editor.isInitialized;

    const collectTargets = (
      ref: AnchoredCardRef,
      intoNode: Map<number, AnchorHighlightResolved>,
      intoRange: Map<HTMLElement, AnchorHighlightAttrs>,
    ): void => {
      if (!editorReady) return;
      const links = linksForRef(ref, stableCollections);
      for (const link of links) {
        const resolved = resolveLink(editor, link);
        if (!resolved) continue;
        if (resolved.kind === "text-range") {
          // ── Mode-B (text-range): paint RAW onto the `.linked-anchor` span
          // so the attr lands on the SAME element the CSS selects. A
          // `Decoration.inline` would wrap the text in a fresh child span and
          // miss `.linked-anchor[data-card-hovered]`. (value "true", no
          // kind/side — same as the legacy raw path.) ───────────────────────
          if (!resolved.domEl) continue;
          if (intoRange.has(resolved.domEl)) continue;
          intoRange.set(resolved.domEl, { value: "true", kind: null, side: null });
          continue;
        }
        // ── Node / inline-atom (Mode-A blocks + footnote/citation atoms):
        // route through the `Decoration.node` plugin so PM owns the attrs and
        // never redraws the block. ────────────────────────────────────────
        const node = editor.state.doc.nodeAt(resolved.pos);
        if (!node) continue;
        const from = resolved.pos;
        const to = resolved.pos + node.nodeSize;
        if (intoNode.has(from)) continue;
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
        intoNode.set(from, {
          shape: "node",
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
      collectTargets(selected, selectedNodeTargets, selectedRangeEls);
      collectCardKey(selected, selectedCardKeys);
    }
    if (hover) {
      collectTargets(hover, hoveredNodeTargets, hoveredRangeEls);
      collectCardKey(hover, hoveredCardKeys);
    }

    // ── Build the NODE decoration target list and hand it to PM. ───────────
    if (editorReady) {
      const decoTargets: AnchorHighlightTarget[] = [];
      for (const t of selectedNodeTargets.values()) {
        decoTargets.push({
          shape: "node",
          from: t.from,
          to: t.to,
          attrs: selectedAttrs(t.attrs),
        });
      }
      for (const t of hoveredNodeTargets.values()) {
        // If selection already painted this position, its kind/side win —
        // emit only the hover marker (no kind/side). Otherwise hover supplies
        // them. Mirrors the legacy `!selectedEls.has(el)` guard.
        const selectionOwnsThisPos = selectedNodeTargets.has(t.from);
        decoTargets.push({
          shape: "node",
          from: t.from,
          to: t.to,
          attrs: hoveredAttrs(t.attrs, !selectionOwnsThisPos),
        });
      }
      setAnchorHighlightTargets(editor.view, decoTargets);

      // ── Mode-B `.linked-anchor` spans: sweep every previously-stamped span
      // inside the editor root, then re-stamp from the desired sets. A
      // `.linked-anchor` is a plain mark span (not Decoration.node-owned), so
      // raw setAttribute neither redraws nor detaches it — and it satisfies
      // the `.linked-anchor[data-card-*]` CSS contract. This is the legacy
      // pre-decoration Mode-B behavior, restored exactly: selection-wins for
      // kind/side (Mode-B has none, but the guard is preserved) + clear-on-
      // unhover. ─────────────────────────────────────────────────────────────
      const root = editor.view.dom;
      const staleRangeSpans = root.querySelectorAll<HTMLElement>(
        `.linked-anchor[${DATA_CARD_SELECTED}], .linked-anchor[${DATA_CARD_HOVERED}], .linked-anchor[${DATA_PARAGRAPH_KIND}], .linked-anchor[${DATA_MARGIN_SIDE}]`,
      );
      for (const el of staleRangeSpans) {
        el.removeAttribute(DATA_CARD_SELECTED);
        el.removeAttribute(DATA_CARD_HOVERED);
        el.removeAttribute(DATA_PARAGRAPH_KIND);
        el.removeAttribute(DATA_MARGIN_SIDE);
      }
      for (const [el, a] of selectedRangeEls) {
        el.setAttribute(DATA_CARD_SELECTED, a.value);
        if (a.kind) el.setAttribute(DATA_PARAGRAPH_KIND, a.kind);
        if (a.side) el.setAttribute(DATA_MARGIN_SIDE, a.side);
      }
      for (const [el, a] of hoveredRangeEls) {
        el.setAttribute(DATA_CARD_HOVERED, a.value);
        // Selection wins for kind/side on a shared span (legacy
        // `!selectedEls.has(el)` guard).
        if (!selectedRangeEls.has(el)) {
          if (a.kind) el.setAttribute(DATA_PARAGRAPH_KIND, a.kind);
          if (a.side) el.setAttribute(DATA_MARGIN_SIDE, a.side);
        }
      }
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

/** A resolved in-editor NODE/ATOM target before the selected/hovered attr bag
 *  is materialized (selection-vs-hover kind/side precedence is applied at
 *  emit time). Mode-B text ranges do NOT use this — they go through the raw
 *  `.linked-anchor` setAttribute path, keyed by DOM element. */
interface AnchorHighlightResolved {
  shape: "node";
  from: number;
  to: number;
  attrs: AnchorHighlightAttrs;
}
