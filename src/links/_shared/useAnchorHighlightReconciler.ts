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
 *   - `data-margin-side`    ("left" | "right"; picks the edge of the rail —
 *                            resolved LIVE from the card kind's panel dock via
 *                            `marginSideForCardKind`, the same authority the
 *                            marginalia grid packs against, so the rail and the
 *                            margin marker are never on opposite edges)
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
  useStoreHover,
  useStoreSelection,
  type AnchoredCardRef,
  type CardStore,
} from "./anchored-card-store";
import { isInlineAtomCardKind } from "@/cards/predicates";
import { isInlineAtomLifecycleOn } from "@/lib/identity/inline-atom-lifecycle-flag";
import { cssTokenForCardKind } from "@/cards/legacy-token-crosswalk";
import {
  cardKeyForEntity,
  findEntity,
} from "./entity-hover";
import type { EntityCollectionSlots } from "@/cards/entity-collections";
import type { Link } from "./types";
import { resolveLink } from "../links";
import { requestHighlightLink } from "./request-marks";
import {
  setAnchorHighlightTargets,
  selectedAttrs,
  hoveredAttrs,
  type AnchorHighlightTarget,
  type AnchorHighlightAttrs,
} from "@/lib/tiptap/anchor-highlight-deco";
import {
  marginSideForCardKind,
  type PanelSideMap,
} from "@/lib/margin-side";

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

function entityExists(
  ref: AnchoredCardRef,
  c: EntityCollectionSlots,
  liveAtomIds: ReadonlySet<string> | null,
): boolean {
  // Inline-atom kinds (footnote / citation) aren't kept in `collections`; their
  // liveness is the editor's. T2 §3b.2: when the inline-atom lifecycle is on,
  // the reconciler is handed the LIVE atom-id set, so `entityExists` is
  // answerable — a deleted footnote/citation now reads as gone and its stale
  // `cardStore` selection/hover/expand ref clears (the prune-exemption ghost
  // class, FN-A1-01 etc.). When the set is unavailable (flag off, or the editor
  // isn't ready), fall back to the legacy always-present treatment so a
  // transient re-parse gap never drops a valid selection — and so flag-off
  // behavior is byte-identical.
  if (isInlineAtomCardKind(ref.kind)) {
    if (liveAtomIds == null) return true;
    return liveAtomIds.has(ref.id);
  }
  return findEntity(ref, c) !== undefined;
}

/** Narrow view of a suggestion card for the applied-change synthesis. The
 *  reconciler's `findEntity` returns the widened `{id,kind?,links?}` shape, but
 *  a suggestion entity IS the full card at runtime, so we read `status` /
 *  `appliedChange` through this cast. */
type AppliedSuggestionEntity = {
  kind?: string;
  status?: string;
  appliedChange?: {
    anchorId: string;
    anchorUuid: string;
    replacement: string;
    originalText: string;
  };
};

/** Synthesized Mode-B link for an APPLIED pending-AI-change. Its persisted card
 *  links still point at the ORIGINAL span, whose text the splice replaced — so
 *  `resolveLink` can't find that mark and degrades to a whole-paragraph vertical
 *  bar. The live blue `linkedAnchor` mark is under `appliedChange.anchorId`
 *  instead; this link points the reconciler at it, so it paints the AI-written
 *  span as an inline text highlight (never the paragraph rail). Returns null
 *  unless `ref` is an applied suggestion — pending/stale/kept cards fall back to
 *  their persisted links, and a lost mark degrades to the paragraph as before. */
export function appliedChangeLink(
  ref: AnchoredCardRef,
  entity: { id: string; kind?: string; links?: Link[] },
): Link | null {
  if (ref.kind !== "revision-suggestion" && ref.kind !== "cutter-suggestion") {
    return null;
  }
  const sugg = entity as AppliedSuggestionEntity;
  if (
    sugg.kind !== "suggestion" ||
    sugg.status !== "applied" ||
    !sugg.appliedChange
  ) {
    return null;
  }
  const ac = sugg.appliedChange;
  return {
    id: ac.anchorId,
    kind: "anchor",
    anchor: {
      type: "textObject",
      targetKind: "linkedRange",
      textObjectIds: [ac.anchorUuid],
      textRange: {
        anchorId: ac.anchorId,
        textSnapshot: ac.replacement || ac.originalText,
      },
    },
    target: { type: "card", ref: { kind: ref.kind, id: ref.id } },
    createdAt: "",
  };
}

function linksForRef(ref: AnchoredCardRef, c: EntityCollectionSlots): Link[] {
  if (ref.kind === "footnote" || ref.kind === "citation") {
    return [linkForInlineAtom(ref.kind, ref.id)];
  }
  const entity = findEntity(ref, c);
  if (!entity) return [];
  const applied = appliedChangeLink(ref, entity);
  if (applied) return [applied];
  // Open AI request: a Mode-A `aiRequest` card lights its persistent request
  // wash (the blue `pending-ai-request` mark) on hover/select, via a synthesized
  // Mode-B link at the request mark's anchorId — the request-open twin of the
  // applied-change synthesis above. Non-request / Mode-B cards fall through to
  // their persisted links (null return).
  const request = requestHighlightLink(ref, entity);
  if (request) return [request];
  return entity.links ? [...entity.links] : [];
}

export interface UseAnchorHighlightReconcilerArgs {
  editor: Editor | null;
  collections: EntityCollectionSlots;
  /** This doc's interaction store (threaded from the EditorPane body, which runs
   *  ABOVE the pane's own CardStoreProvider). The hover/selection painters and
   *  the dangling-ref prune all target this per-doc instance. */
  store: CardStore;
  /** Bumps when the footnote/citation set changes (the inline-atom structural
   *  revision counter). Threaded so the dangling-ref prune RE-RUNS when an
   *  inline atom is added/removed — a collection-identity change never fires for
   *  the inline kinds (they aren't in `collections`), so without this the prune
   *  effect would never re-fire on an inline delete. T2 §3b.2. */
  atomRevision?: number;
  /**
   * Which side each panel is docked on right now — the SAME map the marginalia
   * grid packs against (`EditorPane`'s `marginaliaPanelSides`).
   *
   * The Mode-A paragraph rail is the card's margin chrome, and `globals.css`
   * says so in as many words ("a kind-colored vertical line on the same side as
   * the margin marker"). Before task 205 the rail read a `link.anchor.margin.side`
   * frozen into the sidecar at create time, which knew nothing about docking —
   * so docking Notes to the LEFT moved the marker and left the rail on the
   * right. Both now resolve through `marginSideForCardKind` with this map.
   *
   * Keystroke-safe: this is a `useMemo` over the placement list, so its identity
   * changes only on a dock/reorder — never on a keystroke. It is ALSO the map
   * `<Marginalia>` already memoizes its whole grid pass on, so its stability is
   * pre-existing load-bearing behavior, not a new obligation.
   *
   * REQUIRED, deliberately. It has one production caller, and an optional prop
   * with an empty-map default would let a future refactor drop that one line
   * and silently restore the dock-blind behaviour this exists to remove — no
   * type error, no test failure. A host that genuinely has no strips states so
   * by passing `{}`; that is a decision, not an inherited default. (AGENTS.md:
   * "A defaulted argument is a decision nobody made.") A call-site census in
   * `margin-side-ssot.test.tsx` pins that the production site passes the LIVE
   * map rather than an empty literal.
   */
  panelSides: PanelSideMap;
}

/** Walk the editor's footnote + citation nodes into a live atom-id set, for the
 *  inline-atom prune (the C14 ghost-halo fix). Returns null when the editor is
 *  not ready — the caller then falls back to the legacy always-present
 *  treatment. O(atoms in doc); runs only in the prune effect (which re-fires on
 *  the inline structural counter), never per keystroke. */
function liveAtomIdSet(editor: Editor | null): ReadonlySet<string> | null {
  if (!editor || editor.isDestroyed || !editor.isInitialized) return null;
  const ids = new Set<string>();
  editor.state.doc.descendants((node) => {
    if (node.type.name === "footnote") {
      const id = (node.attrs.footnoteId as string) || (node.attrs.linkId as string) || "";
      if (id) ids.add(id);
      return false;
    }
    if (node.type.name === "citation") {
      const id = (node.attrs.citationId as string) || "";
      if (id) ids.add(id);
    }
    return true;
  });
  return ids;
}

export function useAnchorHighlightReconciler({
  editor,
  collections,
  store,
  atomRevision,
  panelSides,
}: UseAnchorHighlightReconcilerArgs): void {
  const selected = useStoreSelection(store);
  const hover = useStoreHover(store);

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

  // Prune dangling cardStore refs whenever a collection OR the inline-atom set
  // changes. Read cardStore state imperatively so the prune doesn't subscribe to
  // it — otherwise the prune would re-fire on every selection change and could
  // cycle with the reconciler. The reconciler subscribes to cardStore
  // separately above.
  //
  // For inline kinds (footnote / citation) the liveness comes from the editor,
  // not `collections` — so the effect ALSO depends on `atomRevision` (the inline
  // structural counter) and recomputes the live atom-id set on each fire. The
  // primary inline prune is the W2b lifecycle policy (event-driven off the
  // removal); this is the idempotent belt that also clears any inline ref left
  // dangling by a non-policy removal. Gated behind the flag so flag-off keeps
  // the legacy always-present inline treatment (`liveAtomIds` stays null).
  useEffect(() => {
    const liveAtomIds = isInlineAtomLifecycleOn() ? liveAtomIdSet(editor) : null;
    const s = store.getState();
    if (s.selected && !entityExists(s.selected, stableCollections, liveAtomIds)) {
      store.clearSelection();
    }
    if (s.hover && !entityExists(s.hover, stableCollections, liveAtomIds)) {
      store.setHover(null);
    }
    for (const ref of s.expandedSet) {
      if (!entityExists(ref, stableCollections, liveAtomIds)) store.collapse(ref);
    }
    // `atomRevision` is a dep so an inline add/remove re-runs the prune (the
    // inline kinds never change `stableCollections`); `editor` so the set is
    // read from the current instance.
  }, [store, stableCollections, atomRevision, editor]);

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
        // Use the AnchoredCardRef's spine `kind` (guaranteed a real CardKind by
        // findEntity), NOT `link.target.ref.kind` — the on-disk link token can
        // be an un-normalized raw kind like "suggestion" (legacy/stale live
        // data), which the crosswalk rejects with a console error.
        const kind =
          resolved.kind === "paragraph" ? paragraphKindFor(ref.kind) : null;
        // The rail's edge comes from the ONE margin-side authority, resolved
        // against the LIVE dock — the same call `computeMarkerPositions` makes
        // for the marker itself. It used to read `link.anchor.margin.side`, a
        // dock-blind value frozen into the sidecar when the anchor was created;
        // that field is gone (task 205) precisely because a stored copy of a
        // live answer can only drift from it.
        const side =
          resolved.kind === "paragraph"
            ? marginSideForCardKind(ref.kind, panelSides)
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
    // The popped-card window ring used to select the FloatingPanel via
    // `:has([data-card-hovered])` — the inner attr doesn't inherit up. That
    // :has() was a style-invalidation amplifier (perf Wave 0, plan P5.1), so
    // the reconciler now stamps `data-contains-active-card` UPWARD onto
    // `closest('[data-floating-panel]')` at write time — O(active cards),
    // exactly when it already stamps the card attrs.
    const stalePanelHosts = document.querySelectorAll<HTMLElement>(
      "[data-floating-panel][data-contains-active-card]",
    );
    for (const el of stalePanelHosts) {
      el.removeAttribute("data-contains-active-card");
    }
    const stampPanelHost = (cardEl: HTMLElement) => {
      cardEl
        .closest<HTMLElement>("[data-floating-panel]")
        ?.setAttribute("data-contains-active-card", "true");
    };
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
      for (const el of matches) {
        el.setAttribute(DATA_CARD_SELECTED, "true");
        stampPanelHost(el);
      }
    }
    for (const key of hoveredCardKeys) {
      const matches = document.querySelectorAll<HTMLElement>(
        `[data-card-key="${key}"]`,
      );
      for (const el of matches) {
        el.setAttribute(DATA_CARD_HOVERED, "true");
        stampPanelHost(el);
      }
    }
    // `panelSides` is a dep because the rail's EDGE is derived from it: re-dock
    // a panel while a card is selected and the rail must move with the marker
    // on the same commit. Its identity changes only on a dock/reorder (a
    // `useMemo` over the placement list upstream), so this adds no per-keystroke
    // and no per-render work.
  }, [editor, selected, hover, stableCollections, panelSides]);
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
