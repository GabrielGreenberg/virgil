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

/** `data-card-key` prefix → EntityKind. Cutter splits comment vs.
 *  suggestion into two prefixes that both map to "cut". Kinds we don't
 *  participate in linking with (bib, error, ai, example) are absent so
 *  hovering those cards is a no-op. */
const PREFIX_TO_KIND: Record<string, EntityKind> = {
  note: "note",
  todo: "todo",
  archive: "archive",
  quotation: "quotation",
  revision: "revision",
  footnote: "footnote",
  citation: "citation",
  "cutter-comment": "cut",
  "cutter-suggestion": "cut",
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
      // Only fire when the cursor is over a card in a *panel* — exclude
      // cards rendered inline in the editor (e.g. footnote anchors with
      // data-card-key would otherwise double-fire). Panel cards live
      // inside elements with `data-card` or under panel scroll roots and
      // never inside `.ProseMirror`.
      if (el.closest(".ProseMirror")) return null;

      const cardEl = el.closest<HTMLElement>("[data-card-key]");
      if (!cardEl) return null;
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
