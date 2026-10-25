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
 * A caller that surfaces the card itself says so on the selection change
 * — `store.select(ref, { placement: "none" })`, or `store.withoutPlacement`
 * around a per-kind slot setter — and this hook then leaves the document
 * where it is (task 1283: the intent rides the doc's own CardStore).
 *
 * Multi-anchor cards: every anchor of the same card stays highlighted by
 * `useAnchorHighlightReconciler`; the placement just chooses *which* of
 * those anchors the document scroll aligns to (closest to viewport center;
 * fallback: first in source order).
 */

import { useEffect, useRef } from "react";
import type { Editor } from "@tiptap/react";
import { isPaneElementVisible } from "@/lib/keep-alive/pane-visibility";
import { resolveLink } from "../links";
import { alignEntryToYIfNeeded } from "@/components/editor-layout/layout-scroll";
import { cardPopKey } from "@/panels/panel-registry";
import type { CardKind } from "@/panels/_shared/types";
import {
  useStoreSelection,
  type AnchoredCardRef,
  type CardStore,
} from "./anchored-card-store";
import { cardKeyForEntity } from "./entity-hover";
import { linksForCardRef } from "./card-anchor-links";
import type { EntityCollectionSlots } from "@/cards/entity-collections";

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
    // effect runs for the same selection short-circuit cleanly. The intent
    // is read from THIS doc's store, for THIS selection (task 1283): a select
    // made with `placement: "none"` (marker click, atom click, a brand-new
    // card — each surfaces the card itself) must not drag the document. It
    // used to be one module-level flag consumed by whichever mounted pane's
    // effect ran first, and stranded by a no-op select.
    if (store.isPlacementSuppressed(selection)) return;

    // Locate the card element. Multiple matches are possible (popped
    // float + native panel mount); pick the first that's actually
    // rendered (`isPaneElementVisible` — the keep-alive visible rung).
    const cardKey = cardKeyForEntity(selection);
    if (!cardKey) return;
    const cardCandidates = document.querySelectorAll<HTMLElement>(
      `[data-card-key="${cardKey}"]`,
    );
    if (cardCandidates.length === 0) return;
    let cardEl: HTMLElement | null = null;
    for (const el of cardCandidates) {
      if (isPaneElementVisible(el)) { cardEl = el; break; }
    }
    if (!cardEl) cardEl = cardCandidates[0];
    const cardY = cardEl.getBoundingClientRect().top;

    // Find every in-editor anchor for this card.
    const links = linksForCardRef(selection, collections);
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
  }, [selection, editor, collections, store]);
}

// Helper to keep type-checker happy with CardKind import (used implicitly
// via cardKeyForEntity / cardPopKey internal types).
export type { CardKind };
// cardPopKey re-exported as a convenience for callers that build keys
// from the entity ref shape.
export { cardPopKey };
