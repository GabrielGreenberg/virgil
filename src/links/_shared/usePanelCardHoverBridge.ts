"use client";

/**
 * Single document-level mouseover/mouseout listener that turns hovering
 * any panel card into an entity-level hover event. Reads the card's
 * `data-card-key` (format: `${prefix}:${id}`) and maps the prefix to an
 * EntityKind. Replaces the per-panel `onHoverNote` / `onHoverCard` props
 * that previously had to be threaded through Notes / Revisions / Cutter.
 *
 * Cards in every panel (and Omni) already carry `data-card-key` via
 * `cardPopKey()` in panel-registry.ts, so this works for all kinds without
 * touching individual panel components.
 */

import { useEffect } from "react";
import type { EntityKind } from "./entity-hover";

/** `data-card-key` prefix → EntityKind. One-to-one mapping; the registry's
 *  `revision` prefix maps to the `comment` EntityKind because the card
 *  kind is named `comment` even though its data-card-key is `revision:…`.
 *  Non-anchored kinds (bib, error, ai) are absent so hovering those cards
 *  is a no-op. */
const PREFIX_TO_KIND: Record<string, EntityKind> = {
  note: "note",
  todo: "todo",
  archive: "archive",
  quotation: "quotation",
  example: "example",
  revision: "comment",
  "revision-suggestion": "revision-suggestion",
  footnote: "footnote",
  citation: "citation",
  "cutter-comment": "cutter-comment",
  "cutter-suggestion": "cutter-suggestion",
};

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
      const idx = key.indexOf(":");
      if (idx <= 0) return null;
      const prefix = key.slice(0, idx);
      const id = key.slice(idx + 1);
      const kind = PREFIX_TO_KIND[prefix];
      if (!kind || !id) return null;
      return { id, kind };
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
