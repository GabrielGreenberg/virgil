"use client";

import { useRef, useCallback, useEffect, useMemo } from "react";
import type { PanelKind } from "@/panels/_shared/types";

/**
 * Unified pristine-card tracking across all card kinds.
 *
 * A pristine card is one that was created via a "+" / toolbar path with no
 * seed content — a truly blank card. If the user clicks outside the card's
 * DOM before editing it, the manager calls the registered discard handler
 * for that kind to drop the card from state.
 *
 * Cards that were created with seed content (anchor, paragraph link, text,
 * etc.) are never registered as pristine and therefore never auto-discarded.
 *
 * Cards opt into the watcher by rendering
 *   `data-pristine-card-kind="<kind>"` and `data-pristine-card-id="<id>"`
 * on their outermost DOM element (and any popped-out floating wrapper).
 * The watcher looks them up by id via `document.querySelectorAll` so multiple
 * mount points (list row + floating copy) are both considered "inside".
 */

/**
 * Discard bucket key. Pristine discard is PANEL-level — a click-away from a
 * blank card drops it regardless of which polymorphic kind it is (e.g.
 * cutter-comment + cutter-suggestion share the one `cutter` bucket; report +
 * report-request share `reports`). So the bucket is the owning panel id,
 * derived from the card registry via `panelForCardKind(kind)` at the call
 * site — replacing the former hand-kept `note|cut|report|todo|footnote|citation`
 * union that drifted from both `CardKind` and `PanelKind`. The watcher matches
 * pristine cards by `data-pristine-card-id` only, so this token is internal
 * bookkeeping (which Set + which discard callback), never a DOM selector.
 */
export type PristineBucket = PanelKind;

export interface PristineKindApi {
  markNew(id: string): void;
  markDirty(id: string): void;
  isPristine(id: string): boolean;
  registerDiscard(discard: (id: string) => void): () => void;
  discardAll(): void;
}

export interface PristineCardManager {
  forKind(kind: PristineBucket): PristineKindApi;
}

export function usePristineCardManager(): PristineCardManager {
  const setsRef = useRef<Map<PristineBucket, Set<string>>>(new Map());
  const discardRef = useRef<Map<PristineBucket, (id: string) => void>>(new Map());

  const getSet = useCallback((kind: PristineBucket): Set<string> => {
    let s = setsRef.current.get(kind);
    if (!s) {
      s = new Set();
      setsRef.current.set(kind, s);
    }
    return s;
  }, []);

  useEffect(() => {
    const handler = (e: PointerEvent) => {
      const target = e.target as Element | null;
      if (!target) return;
      const pending: Array<{ kind: PristineBucket; id: string }> = [];
      for (const [kind, ids] of setsRef.current) {
        for (const id of ids) {
          const selector = `[data-pristine-card-id="${CSS.escape(id)}"]`;
          const nodes = document.querySelectorAll(selector);
          if (nodes.length === 0) continue;
          let inside = false;
          for (const node of nodes) {
            if (node.contains(target)) {
              inside = true;
              break;
            }
          }
          if (!inside) pending.push({ kind, id });
        }
      }
      if (pending.length === 0) return;
      // Defer the actual discard past the click-away's blur-flush. A card body
      // editor (RichTextField) debounces its `onChange` (250ms) and only flushes
      // it on `blur` — and `blur` fires AFTER this `pointerdown`. The flushed
      // onChange routes through the owning hook's edit setter, which calls
      // `markDirty(id)` (removing it from the Set). So a card the user typed
      // into within the debounce window is still pristine at pointerdown time
      // but becomes dirty by the next macrotask. Re-checking membership on a
      // `setTimeout(0)` spares it; a genuinely-untouched blank card stays in the
      // Set and is still discarded. (Footnotes layer their own deferred
      // content-check in EditorPane's discard handler — that composes: this
      // re-check short-circuits before it for a footnote the user typed into.)
      setTimeout(() => {
        for (const { kind, id } of pending) {
          const ids = setsRef.current.get(kind);
          if (!ids || !ids.has(id)) continue; // typed into during the defer → keep it
          ids.delete(id);
          const discard = discardRef.current.get(kind);
          if (discard) discard(id);
        }
      }, 0);
    };
    document.addEventListener("pointerdown", handler, true);
    return () => document.removeEventListener("pointerdown", handler, true);
  }, [getSet]);

  const forKind = useCallback(
    (kind: PristineBucket): PristineKindApi => ({
      markNew: (id: string) => {
        getSet(kind).add(id);
      },
      markDirty: (id: string) => {
        getSet(kind).delete(id);
      },
      isPristine: (id: string) => getSet(kind).has(id),
      registerDiscard: (discard: (id: string) => void) => {
        discardRef.current.set(kind, discard);
        return () => {
          if (discardRef.current.get(kind) === discard) {
            discardRef.current.delete(kind);
          }
        };
      },
      discardAll: () => {
        const ids = Array.from(getSet(kind));
        getSet(kind).clear();
        const discard = discardRef.current.get(kind);
        if (discard) {
          for (const id of ids) discard(id);
        }
      },
    }),
    [getSet],
  );

  // Memoize the return so the manager has stable identity across
  // renders. EditorPane calls `pristineManager.forKind("citations")` inside a
  // useMemo with `[pristineManager]` as the dep — a fresh object literal here
  // would invalidate that memo every render, which in turn invalidates
  // pristine-bearing callbacks inside `useCitations` and breaks the
  // memoized citations-hook bubble-up through `paneState`.
  return useMemo(() => ({ forKind }), [forKind]);
}
