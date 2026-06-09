"use client";

/**
 * Single document-level mouseover/mouseout listener that turns hovering
 * any panel card into an entity-level hover event. Reads the card's
 * `data-card-key` (format: `float:card:<kind>:<id>`) and maps the kind to an
 * EntityKind. Replaces the per-panel `onHoverNote` / `onHoverCard` props
 * that previously had to be threaded through Notes / Revisions / Cutter.
 *
 * Cards in every panel (and Omni) already carry `data-card-key` via
 * `cardPopKey()` in panel-registry.ts, so this works for all kinds without
 * touching individual panel components.
 */

import { useEffect } from "react";
import { ANCHORED_CARD_KINDS, type EntityKind } from "./entity-hover";
import { parseAnyKey } from "@/floats/float-key";

/** The anchored card kinds eligible for three-surface hover. A parsed
 *  `float:card:<kind>:<id>` whose kind is in this set is an entity; everything
 *  else (text-object floats, non-anchored bib/error/ai) is a no-op. */
const ANCHORED_KINDS: ReadonlySet<string> = new Set<string>(ANCHORED_CARD_KINDS);

export function usePanelCardHoverBridge(
  setHoveredEntity: (id: string | null, kind: EntityKind | null) => void,
): void {
  useEffect(() => {
    const resolve = (target: EventTarget | null): { id: string; kind: EntityKind } | null => {
      const el =
        target instanceof Element
          ? target
          : target instanceof Node
            ? target.parentElement
            : null;
      if (!el) return null;

      const cardEl = el.closest<HTMLElement>("[data-card-key]");
      if (!cardEl) return null;
      // Only fire when the cursor is over a card in a *panel* — exclude
      // cards rendered inline in the main editor (e.g. footnote anchors
      // with data-card-key would otherwise double-fire). Test the card
      // root itself, not the hovered element: card bodies often contain
      // their own embedded ProseMirror (notes, todos, comments…) and
      // checking the hovered element would falsely bail on body hover.
      if (cardEl.closest(".ProseMirror")) return null;
      const key = cardEl.getAttribute("data-card-key") || "";
      const parsed = parseAnyKey(key);
      // Card-domain floats only; text-object floats aren't hover entities.
      if (!parsed || parsed.domain !== "card") return null;
      if (!ANCHORED_KINDS.has(parsed.kind)) return null;
      return { id: parsed.id, kind: parsed.kind as EntityKind };
    };

    const onOver = (e: MouseEvent) => {
      const ref = resolve(e.target);
      if (ref) setHoveredEntity(ref.id, ref.kind);
    };

    const onOut = (e: MouseEvent) => {
      const fromRef = resolve(e.target);
      if (!fromRef) return;
      const toRef = resolve(e.relatedTarget);
      if (toRef && toRef.id === fromRef.id) return;
      setHoveredEntity(null, null);
    };

    document.addEventListener("mouseover", onOver);
    document.addEventListener("mouseout", onOut);
    return () => {
      document.removeEventListener("mouseover", onOver);
      document.removeEventListener("mouseout", onOut);
    };
  }, [setHoveredEntity]);
}
