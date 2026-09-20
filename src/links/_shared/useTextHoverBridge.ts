"use client";

/**
 * Single delegated DOM listener that turns text-element mouse events
 * inside the editor into entity-level hover and click events.
 *
 * Two flows:
 *
 *   1. **mouseover/mouseout** on `.linked-anchor[data-link-id]` (Mode B
 *      text-range marks for EVERY Mode-B kind) and inline atoms
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
 * The `anchorIdMap` is built by walking the ONE Mode-B collection SSOT
 * (`forEachModeBCard`, `@/cards/mode-b-collections`) via `getTextAnchor` — not
 * a list of collections hand-kept here. Until task 666 this hook carried its
 * own four-collection list while the reconcilers carried six, so a highlight's
 * tinted span and a selection-created todo's span were painted but INERT:
 * nothing on hover, nothing on click. The header's "one listener handles every
 * kind generically" was true of the DOM read and false of the kind set. It is
 * now true of both: the hook takes the TOTAL `ModeBBag`, so a narrow argument
 * no longer type-checks.
 *
 * For inline atoms we don't need the map — the `data-link-card` attribute
 * carries `kind:id` directly.
 */

import { useEffect, useMemo, useRef } from "react";
import type { Editor } from "@tiptap/react";
import { getTextAnchor } from "../links";
import { forEachModeBCard, type ModeBBag } from "@/cards/mode-b-collections";
import { CARD_ATOMS } from "@/lib/tiptap/atom-registry";
import {
  DATA_LINK_CARD,
  DATA_LINK_ID,
  parseLinkCardKey,
} from "../link-dom-contract";
import type { EntityKind } from "./entity-hover";

interface AnchorIdEntry {
  entityId: string;
  kind: EntityKind;
}

export interface UseTextHoverBridgeArgs {
  editor: Editor | null;
  /** Every Mode-B-bearing collection, as the total `ModeBBag`. Pass a MEMOIZED
   *  bag (EditorPane builds one and shares it with the orphan reaper and the
   *  load re-apply): the anchor map memoizes on this object's identity, so a
   *  fresh literal per render would rebuild it per render. */
  cards: ModeBBag;
  setHoveredEntity: (id: string | null, kind: EntityKind | null) => void;
}

export function useTextHoverBridge({
  editor,
  cards,
  setHoveredEntity,
}: UseTextHoverBridgeArgs): void {
  // Map: anchorId -> { entityId, kind }. Built once per entity-collection
  // change; re-keyed via ref so the DOM listener always sees fresh data
  // without re-subscribing on every entity edit.
  const anchorIdMap = useMemo(() => {
    const m = new Map<string, AnchorIdEntry>();
    forEachModeBCard(cards, (record, kind) => {
      const a = getTextAnchor(record);
      if (!a) return;
      m.set(a.anchorId, { entityId: record.id, kind });
    });
    return m;
  }, [cards]);

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
      const anchorEl = el.closest<HTMLElement>(`.linked-anchor[${DATA_LINK_ID}]`);
      if (anchorEl) {
        const anchorId = anchorEl.getAttribute(DATA_LINK_ID);
        if (anchorId) {
          const entry = mapRef.current.get(anchorId);
          if (entry) return entry;
        }
      }

      // The Card-bearing atoms, swept from the registry rather than one
      // hand-written branch per kind (task 645): each row supplies its own
      // `data-*` id attr, its class and its kind, so a fifth Card-bearing atom
      // is hovered for free.
      //
      // NEAREST-first, not registry-order-first. Two `closest()` calls, one per
      // kind, answer "which kind did I list first?" — this climbs ONCE and
      // answers "which atom is actually closest to the pointer?", which is the
      // question a hover is asking. The two agree on every shape the schema can
      // produce today (an atom is a leaf, so one can't nest inside another), so
      // this is behaviour-identical AND immune to the ordering question a new
      // registry row would otherwise raise.
      for (
        let node: Element | null = el;
        node;
        node = node.parentElement
      ) {
        for (const atom of CARD_ATOMS) {
          // The class is a second selector, not a second answer: a marker
          // rendered before its id landed matches it, `getAttribute` then says
          // null, and the climb continues — exactly the old behaviour.
          if (!node.matches(`[${atom.domIdAttr}], .${atom.domClass}`)) continue;
          const id = node.getAttribute(atom.domIdAttr);
          if (id) return { entityId: id, kind: atom.kind };
        }
      }

      // Generic data-link-card fallback (covers any future link atom that
      // adopts the canonical contract). The token is READ through
      // `parseLinkCardKey` — this branch used to hand-roll `indexOf(":")` +
      // two slices, a verbatim second copy of the parser, and the census that
      // guards the grammar only ever looked at BUILD shapes, so it was
      // structurally invisible (task 204).
      const atomEl = el.closest<HTMLElement>(`[${DATA_LINK_CARD}]`);
      if (atomEl) {
        const parsed = parseLinkCardKey(atomEl.getAttribute(DATA_LINK_CARD) || "");
        if (parsed && (parsed.kind === "footnote" || parsed.kind === "citation")) {
          return { entityId: parsed.id, kind: parsed.kind };
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
      const anchorEl = el.closest<HTMLElement>(`.linked-anchor[${DATA_LINK_ID}]`);
      if (!anchorEl) return;

      const anchorId = anchorEl.getAttribute(DATA_LINK_ID);
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
