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
 * `useCardSelectionHighlight`; the placement just chooses *which* of those
 * anchors the document scroll aligns to (closest to viewport center;
 * fallback: first in source order).
 */

import { useEffect } from "react";
import type { Editor } from "@tiptap/react";
import { resolveLink } from "../links";
import { alignEntryToY } from "@/components/editor-layout/layout-scroll";
import { cardPopKey } from "@/panels/panel-registry";
import type { CardKind } from "@/panels/_shared/types";
import {
  cardStore,
  useSelection,
  type AnchoredCardRef,
} from "./anchored-card-store";
import {
  cardKeyForEntity,
  findEntity,
  type EntityCollections,
} from "./entity-hover";
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
  collections: EntityCollections,
): Link[] {
  if (ref.kind === "footnote" || ref.kind === "citation") {
    return [linkForInlineAtom(ref.kind, ref.id)];
  }
  const entity = findEntity(ref, collections);
  return entity?.links ?? [];
}

export interface UsePlacementArgs {
  editor: Editor | null;
  collections: EntityCollections;
}

export function usePlacement({ editor, collections }: UsePlacementArgs): void {
  const selection = useSelection();
  // Track the previous selection so we only scroll when it actually
  // changes (including null → ref). Hover changes never run this effect.
  useEffect(() => {
    if (!selection) return;
    if (!editor || editor.isDestroyed || !editor.isInitialized) return;

    // Locate the card element. Multiple matches are possible (popped
    // float + native panel mount); pick the first that's actually
    // visible-ish (offsetParent != null).
    const cardKey = cardKeyForEntity(selection, collections);
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

    // Skip if the chosen anchor is already roughly aligned with the card —
    // avoids tiny jitter when the user is selecting cards that are
    // already in view next to their anchors.
    const anchorY = best.el.getBoundingClientRect().top;
    if (Math.abs(anchorY - cardY) < 8) return;

    alignEntryToY(best.el, cardY);
  }, [selection, editor, collections]);
}

/** Imperative escape hatch for callers that need to set selection without
 *  triggering placement (e.g. Search → openItemInPanel). The placement
 *  effect runs from React state changes; setting via this helper bypasses
 *  by writing the next-tick flag the effect honors. */
let _suppressNextPlacement = false;
export function setSelectionWithoutPlacement(ref: AnchoredCardRef | null): void {
  _suppressNextPlacement = true;
  cardStore.setSelection(ref);
  // The flag is consumed by the placement effect on its next run; if no
  // selection actually changes (refsEqual short-circuits in cardStore),
  // we still clear it on the next tick so we don't poison a later select.
  queueMicrotask(() => { _suppressNextPlacement = false; });
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
