"use client";

import { useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import type { Editor } from "@tiptap/react";
import { type AnchorNodeMetrics } from "@/lib/marginalia";
import {
  walkAnchorableBlocks,
  resolveDomForUuid,
} from "@/lib/marginalia-blocks";
import { findRowScroll } from "@/components/editor-layout/layout-scroll";
import { getBus } from "@/lib/tiptap/doc-structure";

/**
 * Viewport-scoped, on-demand layout registry for UUID-bearing blocks.
 *
 * This is the architectural successor to `useMarginalia`. The old hook
 * walked the entire document on every edit; this one sources layout
 * truth from `ResizeObserver`, scopes work to the visible viewport via
 * `IntersectionObserver`, and populates a sparse cache lazily.
 *
 * Invariants — see `docs/perf/cursor-selection-reactor-audit.md` for the
 * full rationale:
 *   1. Layout state comes from layout observers, never from edit events.
 *      Pure caret movement does zero work; typing within a block that
 *      doesn't reflow does zero work.
 *   2. Per-block measurements are only computed for blocks in the viewport
 *      near-zone (viewport ±800 px). Off-screen blocks resolve to `null`.
 *   3. Cost scales with the size of the change, not with document size.
 *      A 500-paragraph doc costs the same per keystroke as a 5-paragraph one.
 *   4. Derived state is pulled on demand. Consumers call `getMetrics(uuid)`
 *      and check for `null`; eager push to every consumer was the old bug.
 *
 * Consumer surface:
 *   - `getMetrics(uuid)` — current measurement or `null` if not observed yet.
 *   - `subscribe()`     — re-render trigger via `useSyncExternalStore`.
 *   - `stats()`         — diagnostic counters (cache size, recompute count).
 */

export interface MarginaliaRegistry {
  /**
   * Current measurement for `uuid`, or `null` if the block is off-screen,
   * not yet attached, or no longer in the document. Consumers must
   * tolerate `null` by skipping render — that's the correct response
   * (the block isn't visible so its marginalia isn't visible either).
   */
  getMetrics(uuid: string): AnchorNodeMetrics | null;
  /**
   * `useSyncExternalStore`-friendly subscription. The callback fires
   * whenever any cached entry changes. Consumers re-render and re-call
   * `getMetrics` for the UUIDs they care about.
   */
  subscribe(cb: () => void): () => void;
  /** Diagnostic — exposed for the success-criteria test. */
  stats(): { cached: number; observed: number; recomputes: number };
}

/** Root margin for the intersection observer — viewport ±800 px. */
const NEAR_ZONE_PX = 800;

interface RegistryState {
  cache: Map<string, AnchorNodeMetrics>;
  observed: Map<string, HTMLElement>;
  lastUuidSet: Set<string>;
  pendingRecompute: Set<string>;
  /** Document order of every observed UUID — kept in sync on structure-change. */
  docOrder: string[];
  version: number;
  recomputes: number;
  rafId: number;
  intersectionObserver: IntersectionObserver | null;
  resizeObserver: ResizeObserver | null;
  hostEl: HTMLElement | null;
  subscribers: Set<() => void>;
}

function emptyState(): RegistryState {
  return {
    cache: new Map(),
    observed: new Map(),
    lastUuidSet: new Set(),
    pendingRecompute: new Set(),
    docOrder: [],
    version: 0,
    recomputes: 0,
    rafId: 0,
    intersectionObserver: null,
    resizeObserver: null,
    hostEl: null,
    subscribers: new Set(),
  };
}

/**
 * Measure one anchorable block. Pure — no state mutation. Lifted from
 * `useMarginalia.compute` (lines 53-119 of the old implementation).
 *
 * Returns `null` if the block can't be measured (no DOM, no host).
 */
function measureBlock(
  editor: Editor,
  pos: number,
  isAtom: boolean,
  hostRect: DOMRect,
  id: string,
): AnchorNodeMetrics | null {
  try {
    const dom = editor.view.nodeDOM(pos) as HTMLElement | null;
    if (!dom) return null;

    const domRect = dom.getBoundingClientRect();
    const domTop = domRect.top - hostRect.top;
    const height = domRect.height;

    let measureEl: HTMLElement = dom;
    if (!isAtom) {
      if (dom.classList.contains("par-title-wrapper")) {
        measureEl = dom.querySelector(".par-body-container p, p") ?? dom;
      } else if (dom.classList.contains("heading-wrapper")) {
        measureEl = dom.querySelector("h1,h2,h3") ?? dom;
      } else if (dom.classList.contains("list-title-wrapper")) {
        measureEl = dom.querySelector("ul > li, ol > li") ?? dom;
      } else if (dom.tagName === "BLOCKQUOTE") {
        measureEl =
          dom.querySelector(
            ".par-body-container p, :scope > p, :scope > h1, :scope > h2, :scope > h3",
          ) ?? dom;
      }
    }

    let top: number;
    if (isAtom) {
      top = domTop;
    } else if (measureEl !== dom) {
      const measureRect = measureEl.getBoundingClientRect();
      top = measureRect.top - hostRect.top;
    } else {
      const coords = editor.view.coordsAtPos(pos + 1);
      top = coords.top - hostRect.top;
    }

    let lineHeight: number;
    let lineCount: number;

    if (isAtom) {
      lineHeight = height;
      lineCount = 1;
    } else {
      const style = window.getComputedStyle(measureEl);
      const lh = parseFloat(style.lineHeight);
      lineHeight = Number.isFinite(lh)
        ? lh
        : parseFloat(style.fontSize) * 1.2;
      const measureRect = measureEl.getBoundingClientRect();
      const pt = parseFloat(style.paddingTop) || 0;
      const pb = parseFloat(style.paddingBottom) || 0;
      const contentHeight = measureRect.height - pt - pb;
      lineCount = Math.max(1, Math.round(contentHeight / lineHeight));
    }

    return { id, top, domTop, height, lineHeight, lineCount, isAtom };
  } catch {
    return null;
  }
}

function resolveHost(editor: Editor | null | undefined): HTMLElement | null {
  if (!editor) return null;
  try {
    return (
      (editor.view?.dom?.closest(
        "[data-marginalia-host]",
      ) as HTMLElement | null) ?? null
    );
  } catch {
    return null;
  }
}

export function useMarginaliaRegistry(
  editor: Editor | null,
): MarginaliaRegistry {
  const stateRef = useRef<RegistryState>(emptyState());

  const registry = useMemo<MarginaliaRegistry>(
    () => ({
      getMetrics: (uuid: string) =>
        stateRef.current.cache.get(uuid) ?? null,
      subscribe: (cb: () => void) => {
        stateRef.current.subscribers.add(cb);
        return () => {
          stateRef.current.subscribers.delete(cb);
        };
      },
      stats: () => ({
        cached: stateRef.current.cache.size,
        observed: stateRef.current.observed.size,
        recomputes: stateRef.current.recomputes,
      }),
    }),
    [],
  );

  // Dev-only handle for performance verification. Lets test harnesses read
  // the recompute counter without needing to crawl the React fiber tree.
  // See the audit memo's success criteria: typing 100 chars in a long doc
  // should produce <10 recomputes (≤1 per real reflow keystroke).
  if (typeof window !== "undefined") {
    (window as unknown as { __marginaliaStats?: () => unknown }).__marginaliaStats =
      registry.stats;
  }

  useEffect(() => {
    if (!editor) return;

    const state = stateRef.current;

    function notify() {
      state.version = (state.version + 1) | 0;
      for (const cb of state.subscribers) cb();
    }

    /** Re-measure UUIDs in `pendingRecompute` on the next paint. */
    function scheduleRecompute() {
      if (state.rafId) return;
      state.rafId = requestAnimationFrame(() => {
        state.rafId = 0;
        flushRecompute();
      });
    }

    function flushRecompute() {
      if (!editor || editor.isDestroyed) return;
      const host = state.hostEl ?? resolveHost(editor);
      if (!host) return;
      const hostRect = host.getBoundingClientRect();
      const pending = state.pendingRecompute;
      if (pending.size === 0) return;
      state.pendingRecompute = new Set();
      state.recomputes++;

      // Build a uuid → pos map by walking the doc once. Doing it inline
      // beats keeping a parallel uuid→pos map in sync with TipTap's
      // node lifecycle (positions shift on every structural edit).
      const blocks = walkAnchorableBlocks(editor);
      const posByUuid = new Map<string, { pos: number; isAtom: boolean }>();
      for (const b of blocks) posByUuid.set(b.uuid, { pos: b.pos, isAtom: b.isAtom });

      let changed = false;
      for (const uuid of pending) {
        if (!state.observed.has(uuid)) {
          // No longer observed (left the near-zone or removed). Drop cache.
          if (state.cache.delete(uuid)) changed = true;
          continue;
        }
        const meta = posByUuid.get(uuid);
        if (!meta) {
          if (state.cache.delete(uuid)) changed = true;
          continue;
        }
        const next = measureBlock(editor, meta.pos, meta.isAtom, hostRect, uuid);
        if (!next) {
          if (state.cache.delete(uuid)) changed = true;
          continue;
        }
        const prev = state.cache.get(uuid);
        if (
          !prev ||
          prev.top !== next.top ||
          prev.domTop !== next.domTop ||
          prev.height !== next.height ||
          prev.lineHeight !== next.lineHeight ||
          prev.lineCount !== next.lineCount
        ) {
          state.cache.set(uuid, next);
          changed = true;
        }
      }
      if (changed) notify();
    }

    /**
     * Invalidate cached Y for `uuid` and for every block below it in
     * document order — a height change in N shifts blocks N+1, N+2, …
     * down by the delta. We don't compute the delta, we just re-measure
     * on the next RAF (option (c) from the audit memo: safer than
     * computing the delta from a possibly-stale cached height).
     */
    function invalidateFromUuid(uuid: string) {
      const idx = state.docOrder.indexOf(uuid);
      if (idx < 0) {
        state.pendingRecompute.add(uuid);
      } else {
        for (let i = idx; i < state.docOrder.length; i++) {
          state.pendingRecompute.add(state.docOrder[i]);
        }
      }
      scheduleRecompute();
    }

    /**
     * Resolve the IntersectionObserver root. `findRowScroll()` returns
     * the unified row scroll container under the current layout; if it's
     * not mounted yet (initial render race), passing `null` falls back
     * to the viewport which is still correct.
     */
    function resolveRoot(): Element | null {
      return findRowScroll();
    }

    /**
     * Sync the observed set against `walkAnchorableBlocks(editor)`:
     *   - Attach the intersection observer to any UUID that's in the
     *     doc but not yet in `docOrder`.
     *   - Drop any cached UUID that's no longer in the doc.
     * Called on mount and on every structural transaction.
     */
    function syncObservedSet() {
      const io = state.intersectionObserver;
      if (!io) return;
      const blocks = walkAnchorableBlocks(editor);
      const nextSet = new Set<string>();
      const nextOrder: string[] = [];
      for (const b of blocks) {
        nextSet.add(b.uuid);
        nextOrder.push(b.uuid);
      }

      // Attach observers for new UUIDs.
      for (const uuid of nextSet) {
        if (state.lastUuidSet.has(uuid)) continue;
        const el = resolveDomForUuid(editor, uuid);
        if (!el) continue;
        io.observe(el);
      }
      // Drop observers + cache for removed UUIDs.
      let changed = false;
      for (const uuid of state.lastUuidSet) {
        if (nextSet.has(uuid)) continue;
        const el = state.observed.get(uuid);
        if (el) {
          io.unobserve(el);
          state.resizeObserver?.unobserve(el);
          state.observed.delete(uuid);
        }
        if (state.cache.delete(uuid)) changed = true;
      }
      state.lastUuidSet = nextSet;
      state.docOrder = nextOrder;
      if (changed) notify();
    }

    function onIntersection(entries: IntersectionObserverEntry[]) {
      if (!editor || editor.isDestroyed) return;
      const host = state.hostEl ?? resolveHost(editor);
      if (!host) return;
      const hostRect = host.getBoundingClientRect();

      let changed = false;
      for (const entry of entries) {
        const el = entry.target as HTMLElement;
        const uuid = el.getAttribute("data-uuid");
        if (!uuid) continue;
        if (entry.isIntersecting) {
          // Enter near-zone: observe size + measure once.
          if (!state.observed.has(uuid)) {
            state.observed.set(uuid, el);
            state.resizeObserver?.observe(el);
          }
          // Resolve pos by walking the doc — cheap relative to the
          // measurement itself, and the position can have shifted since
          // the last walk (e.g., upstream paragraph split).
          const blocks = walkAnchorableBlocks(editor);
          const block = blocks.find((b) => b.uuid === uuid);
          if (!block) continue;
          const next = measureBlock(
            editor,
            block.pos,
            block.isAtom,
            hostRect,
            uuid,
          );
          if (!next) continue;
          const prev = state.cache.get(uuid);
          if (
            !prev ||
            prev.top !== next.top ||
            prev.domTop !== next.domTop ||
            prev.height !== next.height ||
            prev.lineHeight !== next.lineHeight ||
            prev.lineCount !== next.lineCount
          ) {
            state.cache.set(uuid, next);
            changed = true;
          }
        } else {
          // Leave near-zone: detach size observation, drop cache entry.
          const observedEl = state.observed.get(uuid);
          if (observedEl) {
            state.resizeObserver?.unobserve(observedEl);
            state.observed.delete(uuid);
          }
          if (state.cache.delete(uuid)) changed = true;
        }
      }
      if (changed) notify();
    }

    function onResize(entries: ResizeObserverEntry[]) {
      for (const entry of entries) {
        const el = entry.target as HTMLElement;
        const uuid = el.getAttribute("data-uuid");
        if (!uuid) continue;
        invalidateFromUuid(uuid);
      }
    }

    function onWindowResize() {
      // Belt-and-suspenders: ResizeObserver covers per-element box changes
      // but not (e.g.) viewport-only DPR changes that don't resize any
      // observed element. Re-measure everything observed.
      for (const uuid of state.observed.keys()) {
        state.pendingRecompute.add(uuid);
      }
      scheduleRecompute();
    }

    /**
     * Subscribe to the DocStructureObserver — wakes only when blocks
     * are added or removed. Text edits within blocks don't wake the
     * registry; the IntersectionObserver / ResizeObserver pair handles
     * any wrap-induced layout change.
     */
    const bus = getBus(editor);
    const unsubBus = bus
      ? (() => {
          const u1 = bus.onBlocksAdded(() => syncObservedSet());
          const u2 = bus.onBlocksRemoved(() => syncObservedSet());
          return () => {
            u1();
            u2();
          };
        })()
      : null;

    /** First-measure pass on mount. */
    function prime() {
      const host = resolveHost(editor);
      if (!host) return;
      state.hostEl = host;

      const root = resolveRoot();
      state.intersectionObserver = new IntersectionObserver(onIntersection, {
        root,
        rootMargin: `${NEAR_ZONE_PX}px 0px ${NEAR_ZONE_PX}px 0px`,
      });
      state.resizeObserver = new ResizeObserver(onResize);

      syncObservedSet();
    }

    // Editor may already be ready when this effect runs; if not, wait
    // for `create`. RAF-defer prime so the DOM has a chance to mount
    // anchorable elements before we query them.
    let primed = false;
    function tryPrime() {
      if (primed) return;
      primed = true;
      requestAnimationFrame(() => {
        if (!editor || editor.isDestroyed) return;
        prime();
      });
    }

    if (editor.view?.dom) {
      tryPrime();
    } else {
      editor.on("create", tryPrime);
    }

    window.addEventListener("resize", onWindowResize);

    return () => {
      editor.off("create", tryPrime);
      unsubBus?.();
      window.removeEventListener("resize", onWindowResize);
      if (state.rafId) cancelAnimationFrame(state.rafId);
      state.intersectionObserver?.disconnect();
      state.resizeObserver?.disconnect();
      state.intersectionObserver = null;
      state.resizeObserver = null;
      state.observed.clear();
      state.cache.clear();
      state.lastUuidSet = new Set();
      state.docOrder = [];
      state.pendingRecompute.clear();
      state.hostEl = null;
    };
  }, [editor]);

  return registry;
}

/**
 * Convenience hook for consumers that want to re-render whenever the
 * registry's cache changes. Reads through to `getMetrics` per UUID.
 *
 * Built on top of `useMarginaliaRegistry` + `useSyncExternalStore` so
 * React's concurrent rendering sees a consistent snapshot per commit.
 */
export function useRegistryVersion(registry: MarginaliaRegistry): number {
  return useSyncExternalStore(
    (cb) => registry.subscribe(cb),
    () => registry.stats().recomputes,
    () => 0,
  );
}
