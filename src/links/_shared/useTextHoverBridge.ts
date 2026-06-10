"use client";

/**
 * Single delegated DOM listener that turns text-element mouse events
 * inside the editor into entity-level hover and click events.
 *
 * Two flows:
 *
 *   1. **mouseover/mouseout** on `.linked-anchor[data-link-id]` (Mode B
 *      text-range marks for notes / cuts / revisions) and inline atoms
 *      with `[data-link-card]` (footnote / citation atoms) — call
 *      `setHoveredEntity({ id, kind })`. One listener handles every kind
 *      generically; we read identity straight off the DOM.
 *
 *   2. **click** on `.linked-anchor[data-link-id]` — dispatch a single
 *      `virgil-linked-anchor-click` event with `{ entityId, kind, clickY }`.
 *      A bridge in EditorLayout consumes it and routes through `openForCard`
 *      so the click behaves identically to clicking the corresponding
 *      margin icon.
 *
 * The `anchorIdMap` is built from notes/cutterCards/comments via
 * `getTextAnchor`. For inline atoms we don't need the map — the
 * `data-link-card` attribute carries `kind:id` directly.
 */

import { useEffect, useMemo, useRef } from "react";
import type { Editor } from "@tiptap/react";
import type { UserNote, CutterCard, RevisionCard, ReportItem } from "@/lib/types";
import { getTextAnchor } from "../links";
import { cardKindFromRecord } from "@/cards/predicates";
import type { EntityKind } from "./entity-hover";

interface AnchorIdEntry {
  entityId: string;
  kind: EntityKind;
}

export interface UseTextHoverBridgeArgs {
  editor: Editor | null;
  notes: ReadonlyArray<UserNote>;
  cutterCards: ReadonlyArray<CutterCard>;
  comments: ReadonlyArray<RevisionCard>;
  reportCards: ReadonlyArray<ReportItem>;
  setHoveredEntity: (id: string | null, kind: EntityKind | null) => void;
}

export function useTextHoverBridge({
  editor,
  notes,
  cutterCards,
  comments,
  reportCards,
  setHoveredEntity,
}: UseTextHoverBridgeArgs): void {
  // Map: anchorId -> { entityId, kind }. Built once per entity-collection
  // change; re-keyed via ref so the DOM listener always sees fresh data
  // without re-subscribing on every entity edit.
  const anchorIdMap = useMemo(() => {
    const m = new Map<string, AnchorIdEntry>();
    for (const n of notes) {
      const a = getTextAnchor(n);
      if (a) m.set(a.anchorId, { entityId: n.id, kind: "note" });
    }
    for (const c of cutterCards) {
      const a = getTextAnchor(c);
      if (!a) continue;
      m.set(a.anchorId, { entityId: c.id, kind: cardKindFromRecord(c, "cutter") });
    }
    for (const r of comments) {
      const a = getTextAnchor(r);
      if (!a) continue;
      m.set(a.anchorId, { entityId: r.id, kind: cardKindFromRecord(r, "revisions") });
    }
    for (const rep of reportCards) {
      const a = getTextAnchor(rep);
      if (!a) continue;
      m.set(a.anchorId, { entityId: rep.id, kind: cardKindFromRecord(rep, "reports") });
    }
    return m;
  }, [notes, cutterCards, comments, reportCards]);

  const mapRef = useRef(anchorIdMap);
  mapRef.current = anchorIdMap;

  useEffect(() => {
    const root = editor?.view.dom;
    if (!root) return;

    /** Resolve an event target to an `(entityId, kind)` ref by walking up
     *  to the nearest linked element. Returns null if none. */
    const resolveTarget = (target: EventTarget | null): AnchorIdEntry | null => {
      const el =
        target instanceof Element
          ? target
          : target instanceof Node
            ? target.parentElement
            : null;
      if (!el) return null;

      // Mode B text-range span.
      const anchorEl = el.closest<HTMLElement>(".linked-anchor[data-link-id]");
      if (anchorEl) {
        const anchorId = anchorEl.getAttribute("data-link-id");
        if (anchorId) {
          const entry = mapRef.current.get(anchorId);
          if (entry) return entry;
        }
      }

      // Citation atom (`<span class="citation-node" data-citation-id=...>`).
      const citation = el.closest<HTMLElement>("[data-citation-id]");
      if (citation) {
        const id = citation.getAttribute("data-citation-id");
        if (id) return { entityId: id, kind: "citation" };
      }

      // Footnote atom (`<sup class="footnote-marker" data-footnote-id=...>`).
      const footnote = el.closest<HTMLElement>(
        "[data-footnote-id], .footnote-marker",
      );
      if (footnote) {
        const id = footnote.getAttribute("data-footnote-id");
        if (id) return { entityId: id, kind: "footnote" };
      }

      // Generic data-link-card fallback (covers any future link atom that
      // adopts the canonical contract).
      const atomEl = el.closest<HTMLElement>("[data-link-card]");
      if (atomEl) {
        const card = atomEl.getAttribute("data-link-card") || "";
        const idx = card.indexOf(":");
        if (idx > 0) {
          const k = card.slice(0, idx);
          const id = card.slice(idx + 1);
          if ((k === "footnote" || k === "citation") && id) {
            return { entityId: id, kind: k };
          }
        }
      }

      return null;
    };

    const onMouseOver = (e: MouseEvent) => {
      const ref = resolveTarget(e.target);
      if (ref) setHoveredEntity(ref.entityId, ref.kind);
    };

    const onMouseOut = (e: MouseEvent) => {
      // Only clear when leaving a linked element AND not entering another
      // one. relatedTarget is what the cursor moved into.
      const fromRef = resolveTarget(e.target);
      if (!fromRef) return;
      const toRef = resolveTarget(e.relatedTarget);
      if (toRef && toRef.entityId === fromRef.entityId) return;
      setHoveredEntity(null, null);
    };

    const onClick = (e: MouseEvent) => {
      // Only handle Mode B text-range spans here. Inline atoms (footnote,
      // citation) already dispatch their own `virgil-*-click` events from
      // their node views.
      const el =
        e.target instanceof Element
          ? e.target
          : e.target instanceof Node
            ? e.target.parentElement
            : null;
      if (!el) return;
      const anchorEl = el.closest<HTMLElement>(".linked-anchor[data-link-id]");
      if (!anchorEl) return;

      const anchorId = anchorEl.getAttribute("data-link-id");
      if (!anchorId) return;
      const entry = mapRef.current.get(anchorId);
      if (!entry) return;

      e.preventDefault();
      e.stopPropagation();
      const rect = anchorEl.getBoundingClientRect();
      window.dispatchEvent(
        new CustomEvent("virgil-linked-anchor-click", {
          detail: {
            entityId: entry.entityId,
            kind: entry.kind,
            clickY: rect.top,
          },
        }),
      );
    };

    root.addEventListener("mouseover", onMouseOver);
    root.addEventListener("mouseout", onMouseOut);
    root.addEventListener("click", onClick, true);
    return () => {
      root.removeEventListener("mouseover", onMouseOver);
      root.removeEventListener("mouseout", onMouseOut);
      root.removeEventListener("click", onClick, true);
    };
  }, [editor, setHoveredEntity]);
}
