"use client";

/**
 * Selection-driven placement for anchored cards. When `cardStore.selection`
 * changes via a user gesture (clicking the card itself, not via search /
 * deep-link), this hook scrolls the editor so the *closest anchor to the
 * viewport center* aligns with the selected card's vertical position.
 *
 * Asymmetry rule: text/marginalia → card alignment is handled by the
 * existing `openForCard` flow (per-surface click handlers). This hook
 * covers the inverse: card → text alignment. Hover never moves anything.
 *
 * Multi-anchor cards: every anchor of the same card stays highlighted by
 * `useAnchorHighlightReconciler`; the placement just chooses *which* of
 * those anchors the document scroll aligns to (closest to viewport center;
 * fallback: first in source order).
 */

import { useEffect, useRef } from "react";
import type { Editor } from "@tiptap/react";
import { resolveLink } from "../links";
import { alignEntryToYIfNeeded } from "@/components/editor-layout/layout-scroll";
import { cardPopKey } from "@/panels/panel-registry";
import type { CardKind } from "@/panels/_shared/types";
import {
  useStoreSelection,
  type AnchoredCardRef,
  type CardStore,
} from "./anchored-card-store";
import {
  cardKeyForEntity,
  findEntity,
} from "./entity-hover";
import type { EntityCollectionSlots } from "@/cards/entity-collections";
import type { Link } from "./types";

/** Synthesize a Link for inline-atom selections (footnote, citation) so
 *  resolveLink can find the in-editor element. */
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

function getAnchorLinks(
  ref: AnchoredCardRef,
  collections: EntityCollectionSlots,
): Link[] {
  if (ref.kind === "footnote" || ref.kind === "citation") {
    return [linkForInlineAtom(ref.kind, ref.id)];
  }
  const entity = findEntity(ref, collections);
  return entity?.links ?? [];
}

export interface UsePlacementArgs {
  editor: Editor | null;
  collections: EntityCollectionSlots;
  /** This doc's interaction store (threaded from the EditorPane body, which
   *  runs ABOVE the pane's own CardStoreProvider — so it can't read context).
   *  Resolved once from `getCardStore(docId)`. */
  store: CardStore;
}

export function usePlacement({ editor, collections, store }: UsePlacementArgs): void {
  const selection = useStoreSelection(store);
  // Magnetism guard: this effect's deps re-fire on every render because
  // `collections` is a fresh object literal at the call site. Without
  // this ref, the scroll would re-run on every render and drag the user
  // back to the selected card whenever they tried to scroll away. Only
  // scroll on an actual selection change.
  const lastScrolledRef = useRef<AnchoredCardRef | null>(null);
  useEffect(() => {
    // Consume the suppress flag UP FRONT, on every effect run. This is the
    // only consumer of `_suppressNextPlacement`, so consuming here on
    // every entry means callers that set the flag right before a setter
    // (suppressNextPlacement → setSelected*Id, or setSelectionWithoutPlacement)
    // get reliable suppression even though `useEffect` is a passive
    // effect that runs in a macrotask after paint. The earlier
    // microtask-clear design lost the flag before this effect ran.
    const wasSuppressed = consumeSuppressFlag();
    if (!selection) {
      // Cleared on deselect so re-selecting the same card later still
      // counts as a fresh change worth scrolling for.
      lastScrolledRef.current = null;
      return;
    }
    if (!editor || editor.isDestroyed || !editor.isInitialized) return;

    const prev = lastScrolledRef.current;
    if (prev && prev.kind === selection.kind && prev.id === selection.id) return;

    // Mark before doing work — abortive paths (no DOM yet, no anchor)
    // shouldn't keep retrying us on every following render. Also keeps
    // suppressed selections from re-firing on later effect runs (the
    // `prev === selection` short-circuit above takes over).
    lastScrolledRef.current = selection;

    // Suppression takes effect AFTER marking lastScrolledRef so future
    // effect runs for the same selection short-circuit cleanly.
    if (wasSuppressed) return;

    // Locate the card element. Multiple matches are possible (popped
    // float + native panel mount); pick the first that's actually
    // visible-ish (offsetParent != null).
    const cardKey = cardKeyForEntity(selection);
    if (!cardKey) return;
    const cardCandidates = document.querySelectorAll<HTMLElement>(
      `[data-card-key="${cardKey}"]`,
    );
    if (cardCandidates.length === 0) return;
    let cardEl: HTMLElement | null = null;
    for (const el of cardCandidates) {
      if (el.offsetParent != null) { cardEl = el; break; }
    }
    if (!cardEl) cardEl = cardCandidates[0];
    const cardY = cardEl.getBoundingClientRect().top;

    // Find every in-editor anchor for this card.
    const links = getAnchorLinks(selection, collections);
    if (links.length === 0) return;

    const viewportMid = window.innerHeight / 2;
    let best: { el: HTMLElement; dist: number } | null = null;
    for (const link of links) {
      const r = resolveLink(editor, link);
      if (!r?.domEl) continue;
      const dist = Math.abs(r.domEl.getBoundingClientRect().top - viewportMid);
      if (!best || dist < best.dist) best = { el: r.domEl, dist };
    }
    // Fallback: first in source order, even if not currently rendered
    // in viewport — still better than no scroll.
    if (!best) {
      for (const link of links) {
        const r = resolveLink(editor, link);
        if (r?.domEl) { best = { el: r.domEl, dist: 0 }; break; }
      }
    }
    if (!best) return;

    // The necessity rule decides whether the document moves. This hook is
    // where the rule was FIRST discovered, as a private `Math.abs(anchorY -
    // cardY) < 8` skip — right about the question and alone in asking it,
    // while five sibling reposition paths moved unconditionally. It now reads
    // the shared predicate (task 328), which subsumes the 8px jitter guard in
    // its epsilon rung and adds the two this copy never had: an anchor that
    // is already fully visible, or one within the band's "far" threshold,
    // does not drag the document to meet a card the user can already see.
    alignEntryToYIfNeeded(best.el, cardY);
  }, [selection, editor, collections]);
}

/** The suppress flag. Consumed by `usePlacement`'s effect on every entry
 *  (including the entry triggered by the very setter that raised it), so the
 *  suppression is reliable. No microtask clear: `useEffect` is a passive
 *  (macrotask) effect, so a microtask clear would race and consume the flag
 *  BEFORE the effect runs.
 *
 *  A second, store-taking raiser (`setSelectionWithoutPlacement`) sat here
 *  with zero callers and was removed in task 202 — every real caller raises
 *  the flag then calls its own setter, which is the shape below. */
let _suppressNextPlacement = false;

/** Imperative escape hatch for callers that change selection via the
 *  legacy slot setters (which route through cardStore.select) and
 *  don't want placement to fire. The usual case is a marker click in the
 *  editor or a margin icon click in the panel column: alignment is
 *  handled by `alignOmniCardWithClick` (offset-based card shift), not by
 *  scrolling the row (which would drag the editor too — both views share
 *  the row scroll). Honors the asymmetry rule in this hook's docstring:
 *  text/marginalia → card alignment is the caller's responsibility;
 *  usePlacement only handles card → text alignment.
 *
 *  Call BEFORE the selection-changing setter:
 *      suppressNextPlacement();
 *      setSelectedCitationId(id);
 *
 *  Flag is consumed at the top of every `usePlacement` effect entry, so
 *  the next run (triggered by the suppressed setter) skips alignment. */
export function suppressNextPlacement(): void {
  _suppressNextPlacement = true;
}

/** Read-side helper used by the placement effect to honor the suppress flag. */
export function consumeSuppressFlag(): boolean {
  const v = _suppressNextPlacement;
  _suppressNextPlacement = false;
  return v;
}

// Helper to keep type-checker happy with CardKind import (used implicitly
// via cardKeyForEntity / cardPopKey internal types).
export type { CardKind };
// cardPopKey re-exported as a convenience for callers that build keys
// from the entity ref shape.
export { cardPopKey };
