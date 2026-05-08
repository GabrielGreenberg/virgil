"use client";

/**
 * useSelectedAnchorSync — shared plumbing for marginalia-anchored panel items
 * (notes, text revisions, cuts). Keeps the linked-anchor highlight (via
 * activeAnchorId/Kind) bound to whichever entity is currently selected.
 * Selection is sticky — it only clears when another card is selected (or via
 * explicit setSelectedId(null) calls).
 */

import { useEffect } from "react";
import type { Link, LinkedAnchorKind } from "@/links/links";
import { getTextAnchor } from "@/links/links";

interface Entity {
  id: string;
  /** Mode B text-range anchor lives inside `links[]`, not as a top-level
   *  field. The hook resolves it via `getTextAnchor`. */
  links?: Link[];
}

interface Options<T extends Entity> {
  selectedId: string | null;
  entities: T[];
  kind: LinkedAnchorKind;
  setActiveAnchorId: React.Dispatch<React.SetStateAction<string | null>>;
  setActiveAnchorKind: React.Dispatch<React.SetStateAction<LinkedAnchorKind | null>>;
  /** Optional — when true, the hook is inactive (e.g. panel not visible). */
  disabled?: boolean;
}

export function useSelectedAnchorSync<T extends Entity>({
  selectedId,
  entities,
  kind,
  setActiveAnchorId,
  setActiveAnchorKind,
  disabled,
}: Options<T>) {
  // Sync: selected entity with an anchor drives the highlight; absence
  // releases it (but only if our kind currently owns the slot).
  useEffect(() => {
    if (disabled) return;
    const entity = selectedId ? entities.find((e) => e.id === selectedId) : null;
    const anchorId = entity ? getTextAnchor(entity)?.anchorId : undefined;
    if (anchorId) {
      setActiveAnchorId(anchorId);
      setActiveAnchorKind(kind);
      return;
    }
    setActiveAnchorKind((prev) => {
      if (prev !== kind) return prev;
      setActiveAnchorId(null);
      return null;
    });
  }, [disabled, selectedId, entities, kind, setActiveAnchorId, setActiveAnchorKind]);
}
