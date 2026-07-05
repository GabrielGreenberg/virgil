"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useSyncExternalStore } from "react";
import type { Editor } from "@tiptap/react";
import { pickProbeEditor } from "@/lib/active-editor-probe";
import { type AnchorNodeMetrics } from "@/lib/marginalia";
import {
  walkAnchorableBlocks,
  resolveDomForUuid,
} from "@/lib/marginalia-blocks";
import { findRowScroll } from "@/components/editor-layout/layout-scroll";
import { getBus } from "@/lib/tiptap/doc-structure";
import { useIsVisible } from "@/lib/keep-alive/visibility-context";
import {
  capHeight,
  capTopOffset,
  resolveInlineContextElement,
} from "@/lib/text-metrics";

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
  /** Diagnostic — exposed for the success-criteria test. `version` bumps on
   *  EVERY `notify()` (recompute, intersection enter/leave, observed-set sync),
   *  so it — not `recomputes` — is the correct re-render trigger for consumers
   *  that must reflect an intersection-only cache change (a block scrolling into
   *  the near-zone and getting measured). `recomputes` bumps only on
   *  `flushRecompute`. */
  stats(): {
    cached: number;
    observed: number;
    recomputes: number;
    version: number;
  };
}

/** Root margin for the intersection observer — viewport ±800 px. */
const NEAR_ZONE_PX = 800;

/**
 * Max RAF retries for a single `pendingObserve` uuid before we stop the
 * self-driven RAF loop for it (CHIP-B NIT 1). A uuid whose `[data-uuid]`
 * decoration NEVER paints (e.g. a stale card pointing at a removed block) would
 * otherwise self-reschedule the O(doc) `syncObservedSet` every frame forever —
 * a perpetual CPU loop on an idle doc. After this many frames we evict it from
 * `pendingObserve` so the RAF loop stops; it is then retried only on the next
 * `syncObservedSet` (a real structural transaction, or another uuid's RAF
 * retry). Crucially the eviction does NOT mark the uuid as observed: the
 * `alreadyObserving` short-circuit keys off `attached` (the set `io.observe`
 * was actually called for), so an evicted-but-still-live uuid is re-resolved on
 * every future sync until its DOM finally paints. A uuid that paints within the
 * cap is observed normally.
 */
const MAX_OBSERVE_RETRIES = 5;

interface RegistryState {
  cache: Map<string, AnchorNodeMetrics>;
  /**
   * Last-good metrics for blocks that scrolled OUT of the near-zone (genuine
   * viewport-leave). Kept OUT of `cache` so `getMetrics` still returns `null`
   * for them — the render gate stays viewport-scoped (an off-screen block isn't
   * painted, and the painted-marker set stays bounded to the near-zone). On
   * re-entry the parked value is reused when the fresh re-measure is within ε of
   * it, so a block that did NOT reflow while off-screen re-enters at a
   * byte-identical Y (no scroll-jump); a real reflow (beyond ε) commits the
   * fresh measurement instead. Reaped when the block leaves the doc. This is the
   * "positioned but not painted" state that decouples the metrics cache from the
   * visibility gate (task 041) — the cache used to double as both, so a
   * viewport-leave deleted the position and forced a from-scratch re-measure on
   * every re-entry, which surfaced any pending off-screen reflow as a snap.
   */
  parked: Map<string, AnchorNodeMetrics>;
  observed: Map<string, HTMLElement>;
  /**
   * The set of live anchorable uuids as of the last `syncObservedSet`. Drives
   * removed-uuid reaping (the drop loop) and document order, NOT the
   * "already observing?" decision — that is `attached`. (Pre-fix this set
   * doubled as the observe short-circuit, which silently broke whenever a uuid
   * landed in `lastUuidSet` WITHOUT being attached: a retry-cap eviction, or a
   * transient `walkAnchorableBlocks` exclusion that dropped a still-live block.
   * Such a uuid was then treated as "already observing" forever and its marker
   * never re-rendered — the list-item-note cull, RC.)
   */
  lastUuidSet: Set<string>;
  /**
   * The set of uuids for which `io.observe(el)` has actually been called and
   * not since `unobserve`'d. This — not `lastUuidSet` — is the truth the
   * `alreadyObserving` short-circuit reads. INVARIANT: a live uuid (present in
   * `walkAnchorableBlocks`) is skipped by the new-uuid loop ONLY if it is in
   * `attached`. So any path that leaves a live uuid un-attached (DOM not painted
   * yet, retry-cap eviction, or a transient walk-exclusion drop) is self-healed:
   * the next sync sees it un-attached and re-observes it. A uuid that is never
   * attachable (its DOM never paints) is bounded out of the RAF loop by
   * `MAX_OBSERVE_RETRIES` but stays eligible for re-attachment on real syncs.
   */
  attached: Set<string>;
  /**
   * UUIDs that are live in the doc but not yet attached (their decoration DOM
   * hadn't painted when `syncObservedSet` last ran, so `io.observe` was
   * skipped). Drives the self-driven RAF retry so a quiet doc still re-resolves
   * them without waiting for the next structural transaction (CHIP-B "first-
   * paint observe miss" / the list-item self-heal). Bounded per-uuid by
   * `observeAttempts`/`MAX_OBSERVE_RETRIES` so a never-painting uuid can't pin
   * the RAF loop.
   */
  pendingObserve: Set<string>;
  /**
   * Per-uuid RAF-retry count for `pendingObserve` (CHIP-B NIT 1). Incremented
   * each time `scheduleObserveRetry`'s frame re-runs `syncObservedSet` while a
   * uuid is still un-attached; at `MAX_OBSERVE_RETRIES` the uuid is evicted from
   * `pendingObserve` so the RAF loop stops. Reset for a uuid once it attaches,
   * and whenever it is freshly seen un-attached by a structural sync (a
   * removed-then-readded — or transiently-dropped — uuid gets its budget back).
   */
  observeAttempts: Map<string, number>;
  pendingRecompute: Set<string>;
  /** Document order of every observed UUID — kept in sync on structure-change. */
  docOrder: string[];
  version: number;
  recomputes: number;
  rafId: number;
  /** RAF handle for the pending-observe retry (CHIP-B); 0 when idle. */
  observeRetryRafId: number;
  /**
   * One-shot: the last `syncObservedSet` dropped a uuid whose DOM is still live
   * (a transient `walkAnchorableBlocks` exclusion). Such a uuid isn't in the
   * pending-observe set (it wasn't in that walk's `nextSet`), so this flag lets
   * the bounded retry RAF re-run the sync even when `pendingObserve` is empty.
   * Cleared at the top of the retry; the recovered next walk re-attaches the
   * uuid, so it doesn't re-arm and the loop ends.
   */
  healResyncPending: boolean;
  intersectionObserver: IntersectionObserver | null;
  resizeObserver: ResizeObserver | null;
  hostEl: HTMLElement | null;
  subscribers: Set<() => void>;
}

function emptyState(): RegistryState {
  return {
    cache: new Map(),
    parked: new Map(),
    observed: new Map(),
    lastUuidSet: new Set(),
    attached: new Set(),
    pendingObserve: new Set(),
    observeAttempts: new Map(),
    pendingRecompute: new Set(),
    docOrder: [],
    version: 0,
    recomputes: 0,
    rafId: 0,
    observeRetryRafId: 0,
    healResyncPending: false,
    intersectionObserver: null,
    resizeObserver: null,
    hostEl: null,
    subscribers: new Set(),
  };
}

/**
 * Measure one anchorable block. Pure — no state mutation.
 *
 * The vertical anchor (`top`) for a prose block is derived from the SAME
 * grab-handle geometry SSOT the drag handles use: `resolveInlineContextElement`
 * ([text-metrics.ts]) descends the block's wrapper NodeView to the element that
 * carries the first visual text line (handling `heading-wrapper` h1–**h6**,
 * `par-title-wrapper`, `title-field-wrapper`, `list-title-wrapper`, `blockquote`,
 * `<pre>`→`<code>`, `expex-item`), and the anchor is the OPTICAL cap-band center
 * of that first line (`firstLineRect.top + capTopOffset + capHeight/2`, the same
 * `opticalCenterY` `block-frame.ts` resolves). Storing `top = opticalCenter −
 * lineHeight/2` makes the grid's `cellAt` formula (`top + row·lineHeight +
 * (lineHeight − ICON)/2`, whose row-0 icon-CENTER is `top + lineHeight/2`) land
 * each marker on the optical middle of the text line — pixel-aligned with the
 * grab handle on the same block.
 *
 * Why this replaced the old two-branch measurement: the previous code forked
 * between `coordsAtPos(pos+1)` (a caret/line top) for bare prose and
 * `getBoundingClientRect().top` (a border-box top) for wrappers, and its
 * heading descent only matched `h1,h2,h3`. When a block's DOM flipped branch
 * between the first paint and a settle re-measure (bare `<p>` → wrapper /
 * decoration mount), the reference point changed and the marker JUMPED (worst
 * on divider-on headings, where the wrapper carries the divider margin);
 * h4–h6 fell through to the `coordsAtPos` branch entirely. Reading ONE stable
 * reference — the resolved text element's optical center, identical to the grab
 * handle — makes first-paint and settle agree, kills the divider/h4–h6 miss,
 * and unifies the two independent measurement paths into one.
 *
 * Atoms (displayMath / latexComment) and blocks that declare an explicit
 * `[data-glyph-anchor]` visual top (the titled tex-block pod, the expex `(n)`
 * number) keep their border-box-top anchor unchanged — they are not text lines,
 * so the optical-center math doesn't apply.
 *
 * Returns `null` if the block can't be measured (no DOM, no host).
 *
 * Exported for the measurement-contract test (heading-text anchor incl. h4–h6,
 * optical-center alignment, no wrapper/divider chrome). Otherwise an internal
 * of the registry.
 */
export function measureBlock(
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

    // [data-glyph-anchor] override — a NodeView's declared "visual top" for
    // kinds whose wrapper carries label chrome above the pod (titled tex-block
    // pod, expex `(n)` number). Consulted for both atoms and the rare non-atom
    // container that declares it, before the text SSOT.
    const anchorOverride = dom.querySelector(
      "[data-glyph-anchor]",
    ) as HTMLElement | null;

    // ── Atoms: anchor on the element's own border-box top (no text line). ──
    if (isAtom) {
      let top = domTop;
      let measuredHeight = height;
      if (anchorOverride) {
        const overrideRect = anchorOverride.getBoundingClientRect();
        top = overrideRect.top - hostRect.top;
        measuredHeight = overrideRect.height;
      }
      return {
        id,
        top,
        domTop,
        height,
        lineHeight: measuredHeight,
        lineCount: 1,
        isAtom,
      };
    }

    // ── Prose: resolve the first-line text element via the grab-handle SSOT
    //    (or honor an explicit glyph-anchor override), then anchor on its
    //    optical cap-band center. ──
    const target = anchorOverride ?? resolveInlineContextElement(dom);
    const targetRect = target.getBoundingClientRect();

    const style = window.getComputedStyle(target);
    const lh = parseFloat(style.lineHeight);
    const lineHeight = Number.isFinite(lh)
      ? lh
      : parseFloat(style.fontSize) * 1.2;

    let top: number;
    if (anchorOverride) {
      // Declared visual top — center the marker on the override's own line
      // box (unchanged behavior for titled tex-block / expex `(n)`).
      top = targetRect.top - hostRect.top;
    } else {
      // Optical cap-band center of the first text line — the canonical
      // vertical anchor grab handles use (block-frame.ts `opticalCenterY`).
      // Store `optical − lineHeight/2` so the grid centers the icon on it.
      const optical =
        targetRect.top -
        hostRect.top +
        capTopOffset(target) +
        capHeight(target) / 2;
      top = optical - lineHeight / 2;
    }

    const pt = parseFloat(style.paddingTop) || 0;
    const pb = parseFloat(style.paddingBottom) || 0;
    const contentHeight = targetRect.height - pt - pb;
    const lineCount = Math.max(1, Math.round(contentHeight / lineHeight));

    return { id, top, domTop, height, lineHeight, lineCount, isAtom };
  } catch {
    return null;
  }
}

/**
 * Sub-pixel tolerance (CSS px) for treating two measurements as the SAME
 * position. A block whose remeasured geometry differs from a prior value by
 * less than this is NOT re-committed (and fires no `notify()`) — the difference
 * is imperceptible DPR/layout wobble, and churning the cache on it causes the
 * marginalia markers to twitch on scroll and re-pack their overflow pills for no
 * visible gain. A genuine reflow moves a marker by whole pixels, well past this.
 */
const POSITION_EPSILON_PX = 0.5;

/**
 * True when `a` and `b` describe the same marker position to within
 * {@link POSITION_EPSILON_PX}. `lineCount` and `isAtom` must match EXACTLY: a
 * line-count change alters the grid's row capacity (`marginalia-grid.ts`) and
 * MUST re-pack, so it is never absorbed as wobble. The continuous geometry
 * fields (`top`/`domTop`/`height`/`lineHeight`) tolerate sub-pixel drift.
 *
 * Used for three decisions in the registry, all sharing this one notion of
 * "meaningfully moved": (1) whether a parked block re-enters at its old Y
 * (reuse) or a fresh one (real reflow), and (2)/(3) whether an in-viewport
 * re-measure (`onIntersection` / `flushRecompute`) is worth re-committing +
 * notifying at all.
 */
function metricsWithinEpsilon(
  a: AnchorNodeMetrics,
  b: AnchorNodeMetrics,
): boolean {
  return (
    a.lineCount === b.lineCount &&
    a.isAtom === b.isAtom &&
    Math.abs(a.top - b.top) < POSITION_EPSILON_PX &&
    Math.abs(a.domTop - b.domTop) < POSITION_EPSILON_PX &&
    Math.abs(a.height - b.height) < POSITION_EPSILON_PX &&
    Math.abs(a.lineHeight - b.lineHeight) < POSITION_EPSILON_PX
  );
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

// ── Dev perf probe (multi-doc safe) ────────────────────────────────────────
// `window.__marginaliaStats()` must read the registry of the editor being
// TYPED INTO so the recompute-count check stays trustworthy with N warm editors
// mounted (keep-alive). A single last-render-wins global would read the wrong
// (often hidden) registry. We keep a per-editor registry and resolve the
// FOCUSED editor on demand (falling back to the sole one). Dev-only.
const marginaliaStatsByEditor = new Map<Editor, () => unknown>();
let marginaliaProbeInstalled = false;
function installMarginaliaProbe() {
  if (marginaliaProbeInstalled || typeof window === "undefined") return;
  marginaliaProbeInstalled = true;
  (
    window as unknown as { __marginaliaStats?: () => unknown }
  ).__marginaliaStats = () => {
    const ed = pickProbeEditor(marginaliaStatsByEditor.keys());
    const stats = ed ? marginaliaStatsByEditor.get(ed) : undefined;
    return stats ? stats() : null;
  };
}

export function useMarginaliaRegistry(
  editor: Editor | null,
): MarginaliaRegistry {
  const stateRef = useRef<RegistryState>(emptyState());

  // Keep-alive: when this editor is hidden (display:none, kept alive across a
  // tab switch) its IntersectionObserver / ResizeObserver / window-resize
  // followers still FIRE (display:none flips intersection + collapses element
  // boxes to 0) — but measuring then would read coordsAtPos/getBoundingClientRect
  // as 0 and cache garbage. We make those callbacks INERT while hidden.
  //
  // The signal is the keep-alive visibility CONTEXT, NOT a live offsetHeight read
  // (the F6/F7/F8 viewport-cache guards use offsetHeight, but those gated paths
  // aren't unit-tested). This hook's measurement callbacks ARE exercised directly
  // by jsdom unit tests, where there is no layout so offsetHeight is ALWAYS 0 — an
  // offsetHeight gate would spuriously fire there. The context defaults to `true`
  // (no provider ⇒ every existing caller AND every test reads "visible").
  //
  // The long-lived observer closures (created once in the effect below, which
  // does NOT re-run on a visibility flip) read the latest value via a ref. The
  // ref is synced in a useLayoutEffect, NOT a passive useEffect: a visibility flip
  // re-renders this consumer and React runs the layout effect synchronously at
  // commit — BEFORE the browser delivers the re-show ResizeObserver notification
  // (which fires in the post-commit "update the rendering" step). So the observer
  // that re-measures on re-show already reads `true`. A passive effect runs after
  // paint and would lose that race (markers stuck stale until the next trigger).
  // Markers keep their last-good positions while hidden — no teardown, no flash.
  const isVisible = useIsVisible();
  const isVisibleRef = useRef(isVisible);
  useLayoutEffect(() => {
    isVisibleRef.current = isVisible;
  }, [isVisible]);

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
        version: stateRef.current.version,
      }),
    }),
    [],
  );

  // Dev-only handle for performance verification. Lets test harnesses read
  // the recompute counter without needing to crawl the React fiber tree.
  // See the audit memo's success criteria: typing 100 chars in a long doc
  // should produce <10 recomputes (≤1 per real reflow keystroke). Registered
  // per-editor (resolved to the focused one on call) so it's trustworthy with
  // N warm editors mounted — see installMarginaliaProbe above.
  useEffect(() => {
    if (typeof window === "undefined" || !editor) return;
    marginaliaStatsByEditor.set(editor, registry.stats);
    installMarginaliaProbe();
    return () => {
      marginaliaStatsByEditor.delete(editor);
    };
  }, [editor, registry]);

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
      if (!editor || editor.isDestroyed || !isVisibleRef.current) return;
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
        if (!prev || !metricsWithinEpsilon(prev, next)) {
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

      // Drop observers + cache for uuids that have LEFT the doc. Reaped first
      // so `attached` reflects only still-live uuids before the attach loop
      // re-evaluates the rest. A uuid is dropped iff the fresh walk no longer
      // contains it — but `walkAnchorableBlocks` can transiently exclude a
      // still-live block (e.g. a mid-transaction or measure-time walk). Folding
      // such a uuid permanently out of `attached`/`lastUuidSet` with no recovery
      // is the cull RC. We DON'T special-case "is it really gone?" here — the
      // attach loop below + the self-heal retry make the drop safe to undo: a
      // dropped-but-still-live uuid is simply un-attached, so the very next sync
      // re-resolves and re-observes it.
      let changed = false;
      // True when at least one uuid the walk dropped is STILL live in the DOM —
      // i.e. the walk transiently excluded a present block rather than the block
      // genuinely leaving. We must schedule a self-heal re-sync in that case so
      // the next (recovered) walk re-attaches it, even though it isn't in
      // `pendingObserve` (it isn't in `nextSet`, so the attach loop can't add it).
      let droppedStillLive = false;
      for (const uuid of state.lastUuidSet) {
        if (nextSet.has(uuid)) continue;
        const el = state.observed.get(uuid);
        if (el) {
          io.unobserve(el);
          state.resizeObserver?.unobserve(el);
          state.observed.delete(uuid);
        }
        // Only a transient exclusion counts as still-live — if the block truly
        // left the doc, `resolveDomForUuid` is null and this is a real removal.
        if (resolveDomForUuid(editor, uuid)) droppedStillLive = true;
        state.attached.delete(uuid);
        if (state.cache.delete(uuid)) changed = true;
        // A block leaving the doc must also drop its parked (off-screen) metrics
        // so a later uuid collision can't reuse a dead position, and the map
        // stays bounded by live doc blocks. (A transient walk-exclusion of a
        // still-live block clears parked harmlessly — it re-parks on its next
        // genuine viewport-leave.)
        state.parked.delete(uuid);
      }

      // Attach observers for any live uuid that ISN'T already attached. The
      // short-circuit reads `attached` (the set we actually called `io.observe`
      // for) — NOT `lastUuidSet` — so the eviction-cap and the transient-drop
      // paths can't poison it: a live uuid is skipped only when it is genuinely
      // attached. When the decoration DOM hasn't painted yet, `resolveDomForUuid`
      // is null → record the uuid in `pendingObserve` (bounded retries) so a
      // self-driven RAF re-resolves it without waiting for a structural tx.
      const nextPending = new Set<string>();
      const nextAttempts = new Map<string, number>();
      for (const uuid of nextSet) {
        if (state.attached.has(uuid)) continue;
        const el = resolveDomForUuid(editor, uuid);
        if (!el) {
          // DOM not painted yet — retry on the next sync UNLESS we've burned the
          // per-uuid RAF budget (CHIP-B NIT 1). At the cap, leave it OUT of
          // `nextPending` so the RAF loop stops; it stays in `nextSet` →
          // `lastUuidSet` but NOT in `attached`, so the next structural (or
          // another uuid's RAF) sync re-resolves it. Bounds the RAF loop without
          // ever marking an unobserved uuid as observed.
          const attempts = (state.observeAttempts.get(uuid) ?? 0) + 1;
          if (attempts < MAX_OBSERVE_RETRIES) {
            nextPending.add(uuid);
            nextAttempts.set(uuid, attempts);
          }
          continue;
        }
        // Painted — observe it and record the attachment. The IntersectionObserver
        // delivers an initial callback that measures it once it's in the near-zone.
        io.observe(el);
        state.attached.add(uuid);
      }

      state.lastUuidSet = nextSet;
      state.pendingObserve = nextPending;
      state.observeAttempts = nextAttempts;
      state.docOrder = nextOrder;
      if (changed) notify();

      // Self-driven retry: a first-paint observe miss (DOM not yet painted), a
      // retry-cap eviction, or a transient walk-exclusion drop all leave a live
      // uuid un-attached. Waiting for the NEXT structural transaction to re-sync
      // may never resolve on a quiet doc (the list-item-note cull / RC2.b
      // "appears then vanishes / never paints"). Schedule one RAF re-sync so the
      // decoration has a frame to paint and the un-attached uuid is re-observed.
      // Gated on `pendingObserve.size > 0` OR a still-live drop, so it costs
      // nothing once every live uuid is attached — never on the keystroke path.
      // The `droppedStillLive` case has no `pendingObserve` member to carry it
      // (the uuid wasn't in this walk's `nextSet`), so it's relayed via a flag;
      // the recovered next walk re-attaches it and the loop ends.
      if (droppedStillLive) state.healResyncPending = true;
      if (state.pendingObserve.size > 0 || droppedStillLive) {
        scheduleObserveRetry();
      }
    }

    /**
     * Re-resolve + observe the `pendingObserve` set on the next paint. Work
     * is bounded by the number of still-unpainted uuids (not doc size), so a
     * settled doc with zero pending never schedules. Re-runs `syncObservedSet`
     * (cheap — `walkAnchorableBlocks` + the new-uuid loop short-circuits on
     * everything already observed) so removed uuids are still reaped and the
     * pending set is recomputed honestly.
     *
     * Bounded (CHIP-B NIT 1): each retry bumps the per-uuid `observeAttempts`
     * count inside `syncObservedSet`; a uuid that never paints is evicted from
     * `pendingObserve` after `MAX_OBSERVE_RETRIES` frames. Once the pending set
     * empties (every uuid observed OR evicted) AND no still-live drop is pending,
     * this stops self-rescheduling — so a stale never-painting uuid can't pin the
     * O(doc) sync to every frame.
     */
    function scheduleObserveRetry() {
      if (state.observeRetryRafId || !isVisibleRef.current) return;
      state.observeRetryRafId = requestAnimationFrame(() => {
        state.observeRetryRafId = 0;
        if (!editor || editor.isDestroyed) return;
        // A still-live drop heal is a one-shot: clear it and re-sync once. The
        // recovered walk re-attaches the dropped uuid, so it won't re-arm.
        const healing = state.healResyncPending;
        state.healResyncPending = false;
        if (state.pendingObserve.size === 0 && !healing) return;
        syncObservedSet();
      });
    }

    function onIntersection(entries: IntersectionObserverEntry[]) {
      if (!editor || editor.isDestroyed || !isVisibleRef.current) return;
      const host = state.hostEl ?? resolveHost(editor);
      if (!host) return;
      const hostRect = host.getBoundingClientRect();

      // Resolve positions with ONE doc walk per IO batch — O(doc + K), not one
      // walk per ENTER entry (the O(K × doc) re-show storm). Built LAZILY so a
      // pure viewport-LEAVE batch (scroll-away) pays nothing. Mirrors
      // flushRecompute's posByUuid map.
      let posByUuid: Map<string, { pos: number; isAtom: boolean }> | null = null;
      const blocksFor = () => {
        if (!posByUuid) {
          posByUuid = new Map();
          for (const b of walkAnchorableBlocks(editor))
            posByUuid.set(b.uuid, { pos: b.pos, isAtom: b.isAtom });
        }
        return posByUuid;
      };

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
          // Resolve pos from the once-per-batch walk (positions can have shifted
          // since the last walk, e.g. an upstream paragraph split).
          const meta = blocksFor().get(uuid);
          if (!meta) continue;
          const next = measureBlock(
            editor,
            meta.pos,
            meta.isAtom,
            hostRect,
            uuid,
          );
          if (!next) continue;
          // Re-entry after a genuine viewport-leave: prefer the PARKED position.
          // If the block did not meaningfully reflow while off-screen, the fresh
          // re-measure is within ε of the parked value → commit the parked value
          // verbatim so the marker re-enters at a byte-identical Y (no
          // scroll-jump, no overflow-pill re-pack). A real reflow (beyond ε)
          // commits the fresh measurement. The measure still runs, so an
          // off-screen self-resize (async NodeView sizing, font swap, image
          // decode) is caught here rather than reused stale.
          const parked = state.parked.get(uuid);
          const committed =
            parked && metricsWithinEpsilon(parked, next) ? parked : next;
          if (parked) state.parked.delete(uuid);
          const prev = state.cache.get(uuid);
          if (!prev || !metricsWithinEpsilon(prev, committed)) {
            state.cache.set(uuid, committed);
            changed = true;
          }
        } else {
          // A `!isIntersecting` callback has TWO distinct causes that must be
          // handled differently:
          //
          //   (a) Genuine viewport-leave — the element scrolled out of the
          //       near-zone. The block is still in the doc with the SAME DOM
          //       element; we just stop measuring it until it returns. Drop
          //       `observed`/cache, KEEP `attached` (the element is still the
          //       one we observe; it'll re-enter and re-measure on its own).
          //
          //   (b) DOM detach — the observed element was removed from the
          //       document (`!el.isConnected`). This is NOT a viewport event:
          //       it fires when ProseMirror REDRAWS an anchorable node and
          //       swaps its outer DOM element for a fresh one. The classic
          //       trigger is the anchor-highlight reconciler writing
          //       `data-card-hovered`/`-paragraph-kind`/`-margin-side` onto a
          //       PLAIN-PM node (a `listItem`, which — unlike paragraphs and
          //       headings — has no React NodeView with `ignoreMutation`, so
          //       PM owns its `<li>` and redraws it to reconcile the foreign
          //       attrs against its `data-uuid` node-decoration). The old
          //       element detaches (0×0 → this LEAVE) while a NEW element with
          //       the same `data-uuid` is inserted in its place.
          //
          //       If we treated (b) like (a) we'd drop the stale element from
          //       `observed`/cache but leave the uuid in `attached` — and the
          //       `syncObservedSet` short-circuit (`attached.has(uuid)`) would
          //       then NEVER re-observe the fresh element. The block stays
          //       live in the doc but its marker is culled forever (sticky
          //       until reload): the list-item-note hover cull (RC).
          //
          // The class fix: on a detach of a STILL-LIVE anchorable uuid, evict
          // the uuid from `attached` (and reset its retry budget) so the
          // bounded self-heal re-resolves and re-observes the fresh element.
          // KEEP the cache entry — the block didn't move, so its last metrics
          // stay valid until the re-observe re-measures, avoiding a one-frame
          // marker flicker. This handles ANY cause of an observed element
          // being swapped out from under us (PM redraw today; a future
          // NodeView remount tomorrow), not just this one reconciler.
          const observedEl = state.observed.get(uuid);
          const detached = !el.isConnected;
          if (observedEl) {
            // Always drop size observation + the observed-map entry.
            state.resizeObserver?.unobserve(observedEl);
            state.observed.delete(uuid);
            // Only DETACH stops IO-observing the element. A genuine
            // viewport-leave keeps the (still-connected) element observed so it
            // fires ENTER again when it scrolls back into the near-zone — IO-
            // unobserving it there would cull it permanently on scroll-back.
            if (detached) state.intersectionObserver?.unobserve(observedEl);
          }
          if (detached && state.attached.has(uuid)) {
            // Re-observe path: keep the uuid eligible for the new-uuid loop.
            state.attached.delete(uuid);
            state.observeAttempts.delete(uuid);
            // Arm the bounded self-heal so a quiet doc re-observes the fresh
            // element without waiting for the next structural transaction.
            state.healResyncPending = true;
            scheduleObserveRetry();
            // Do NOT drop the cache — the block is still live; stale-but-close
            // metrics beat a culled marker for the frame until re-measure.
          } else {
            const cached = state.cache.get(uuid);
            if (cached) {
              // Genuine viewport-leave (still connected) vs a detach of an
              // already-gone block. Either way drop from `cache` so the
              // off-screen block resolves to `null` (un-painted). For a genuine
              // viewport-leave, PARK the last-good metrics: the same DOM element
              // is still observed and will re-enter on scroll-back, and reusing
              // the parked Y then keeps the marker from jumping (task 041). A
              // detach (element gone from the doc) parks nothing — there's no
              // element to re-enter, and `syncObservedSet` reaps it.
              if (!detached) state.parked.set(uuid, cached);
              state.cache.delete(uuid);
              changed = true;
            }
          }
        }
      }
      if (changed) notify();
    }

    function onResize(entries: ResizeObserverEntry[]) {
      if (!isVisibleRef.current) return; // hidden editor → boxes are 0; skip
      for (const entry of entries) {
        const el = entry.target as HTMLElement;
        const uuid = el.getAttribute("data-uuid");
        if (!uuid) continue;
        invalidateFromUuid(uuid);
      }
    }

    function onWindowResize() {
      if (!isVisibleRef.current) return; // hidden editor → nothing to re-measure
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
      if (state.observeRetryRafId) cancelAnimationFrame(state.observeRetryRafId);
      state.observeRetryRafId = 0;
      state.healResyncPending = false;
      state.intersectionObserver?.disconnect();
      state.resizeObserver?.disconnect();
      state.intersectionObserver = null;
      state.resizeObserver = null;
      state.observed.clear();
      state.cache.clear();
      state.parked.clear();
      state.lastUuidSet = new Set();
      state.attached.clear();
      state.pendingObserve.clear();
      state.observeAttempts.clear();
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
 *
 * Snapshots `version` (bumped by every `notify()`), NOT `recomputes`: the
 * registry calls `notify()` whenever the cache changes — including a block
 * ENTERING the near-zone via the IntersectionObserver and getting measured,
 * which bumps `version` but NOT `recomputes` (only `flushRecompute` does the
 * latter). Snapshotting `recomputes` therefore MISSED intersection-only updates,
 * so a marker whose anchor scrolled into view didn't re-render to its measured
 * position until some unrelated recompute fired. `version` re-renders on the
 * actual cache change. Still keystroke-safe: plain typing changes nothing in the
 * registry (no reflow / no intersection / no structural sync) → no `notify()` →
 * `version` stays flat.
 */
export function useRegistryVersion(registry: MarginaliaRegistry): number {
  return useSyncExternalStore(
    (cb) => registry.subscribe(cb),
    () => registry.stats().version,
    () => 0,
  );
}
