"use client";

/**
 * useSelectedAnchorSync — shared plumbing for marginalia-anchored panel items
 * (notes, text revisions, cuts). Keeps the linked-anchor highlight (via
 * activeAnchorId/Kind) bound to whichever entity is currently selected, and
 * clears the selection on a click-away from the card + its anchor span.
 *
 * Each entity type plugs in its own state setters and the `data-*` attribute
 * its card uses; the hook handles:
 *
 *   1. Sync — when the selected entity has an anchorId, set it as the active
 *      anchor with the entity's kind. When deselected (or the entity loses
 *      its anchor via the orphan listener), release the highlight — but only
 *      if it was ours, so we don't clobber a different entity's sticky
 *      selection.
 *
 *   2. Click-away — when an entity is selected, a document-level mousedown
 *      listener clears `selectedId` unless the click lands inside the card
 *      (identified via `data-${dataAttrName}="${id}"`) or inside its anchor
 *      span in the editor. Callers may pass `skipSelectors` to carve out
 *      additional safe zones (e.g. a create button whose click would
 *      immediately reselect anyway).
 */

import { useEffect } from "react";
import type { LinkedAnchorKind } from "@/links/links";

interface Entity {
  id: string;
  anchorId?: string;
}

interface Options<T extends Entity> {
  selectedId: string | null;
  entities: T[];
  kind: LinkedAnchorKind;
  /** Attribute suffix after `data-` — e.g. "note-entry" for `data-note-entry`. */
  dataAttrName: string;
  setSelectedId: (id: string | null) => void;
  setActiveAnchorId: React.Dispatch<React.SetStateAction<string | null>>;
  setActiveAnchorKind: React.Dispatch<React.SetStateAction<LinkedAnchorKind | null>>;
  /** CSS selectors for elements whose mousedown should NOT trigger click-away. */
  skipSelectors?: string[];
  /** Optional — when true, the hook is inactive (e.g. panel not visible). */
  disabled?: boolean;
}

export function useSelectedAnchorSync<T extends Entity>({
  selectedId,
  entities,
  kind,
  dataAttrName,
  setSelectedId,
  setActiveAnchorId,
  setActiveAnchorKind,
  skipSelectors,
  disabled,
}: Options<T>) {
  // Sync: selected entity with an anchor drives the highlight; absence
  // releases it (but only if our kind currently owns the slot).
  useEffect(() => {
    if (disabled) return;
    const entity = selectedId ? entities.find((e) => e.id === selectedId) : null;
    if (entity?.anchorId) {
      setActiveAnchorId(entity.anchorId);
      setActiveAnchorKind(kind);
      return;
    }
    setActiveAnchorKind((prev) => {
      if (prev !== kind) return prev;
      setActiveAnchorId(null);
      return null;
    });
  }, [disabled, selectedId, entities, kind, setActiveAnchorId, setActiveAnchorKind]);

  // Click-away: clear selection when clicking anywhere outside the selected
  // card or its anchor span.
  useEffect(() => {
    if (disabled || !selectedId) return;
    const handler = (e: MouseEvent) => {
      const rawTarget = e.target;
      // Event targets can be text nodes or the Window — Element.closest only
      // exists on Elements. Resolve up to the parent Element when needed.
      const target: Element | null =
        rawTarget instanceof Element
          ? rawTarget
          : rawTarget instanceof Node
            ? (rawTarget.parentElement ?? null)
            : null;
      if (!target) return;
      if (target.closest(`[data-${dataAttrName}="${selectedId}"]`)) return;
      const entity = entities.find((x) => x.id === selectedId);
      if (entity?.anchorId && target.closest(`[data-link-id="${entity.anchorId}"]`)) return;
      for (const sel of skipSelectors ?? []) {
        if (target.closest(sel)) return;
      }
      setSelectedId(null);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [disabled, selectedId, entities, dataAttrName, skipSelectors, setSelectedId]);
}
