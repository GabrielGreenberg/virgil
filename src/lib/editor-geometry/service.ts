/**
 * EditorGeometry service — the ONE per-editor "where is it on screen?" engine
 * (perf Wave 2, C4).
 *
 * This is the marginalia registry's measurement engine EVOLVED into an
 * editor-attached service (the `getBus` / `getDocProducts` precedent), so the
 * app's geometry consumers — marginalia today; breadcrumb, grab-handle hover,
 * caret placement, in-text positions across this wave — share one
 * IO-culled, RO-driven, ε-bailed, gesture-parked measurement pass instead of
 * each re-walking the doc and re-reading rects privately. The engine itself
 * is the proven one: IntersectionObserver near-zone culling (±800 px), one
 * per-editor ResizeObserver, a sparse uuid-keyed metrics cache with a parked
 * (positioned-but-not-painted) twin, sub-pixel equality bails, a
 * RAF-coalesced measure pass, and layout-gesture parking. See
 * `useMarginaliaRegistry` (the thin adapter this was lifted from) for the
 * original invariants; they all still hold:
 *
 *   1. Layout state comes from layout observers, never from edit events.
 *   2. Per-block measurements only exist for blocks in the viewport
 *      near-zone; off-screen blocks resolve to `null`.
 *   3. Cost scales with the size of the change, not with document size.
 *   4. Derived state is pulled on demand (`getMetrics(uuid)` → maybe null).
 *
 * Lifecycle: `getOrCreateGeometry(editor)` (registry.ts) attaches the
 * service object to the editor — idempotent, render-safe, no observers
 * created. `retain()` refcounts the ENGINE: the first retain starts the
 * observers / bus subscription / window listener, the last release stops
 * them and clears all state. React consumers ride the adapter hooks; the
 * split exists so `subscribe`/`getMetrics` are callable from the first
 * render while everything effectful stays in effects.
 */

import type { Editor } from "@tiptap/react";
import { pickProbeEditor } from "@/lib/active-editor-probe";
import {
  type AnchorNodeMetrics,
  resolveMarginaliaHost,
} from "@/lib/marginalia";
import {
  walkAnchorableBlocks,
  resolveDomForUuid,
} from "@/lib/marginalia-blocks";
import {
  findEditorScrollFor,
  findRowScroll,
} from "@/components/editor-layout/layout-scroll";
import { getBus } from "@/lib/tiptap/doc-structure";
import { resolveGlyphAnchor } from "./glyph-anchor";
import {
  recordKeystrokeWork,
  KEYSTROKE_WORK_MARGINALIA_RO,
  KEYSTROKE_WORK_VIEWPORT_CACHE_RO,
} from "@/lib/keystroke-latency-probe";
import { rafCoalesced } from "@/lib/raf-coalesced";
import {
  isLayoutGestureActive,
  parkDuringLayoutGesture,
} from "@/lib/pane-resize";
import {
  LAYOUT_SITE_MARGINALIA,
  LAYOUT_SITE_VIEWPORT_CACHE,
} from "@/lib/layout-gesture-probe";
import {
  computeViewportFrame,
  viewportFramesEqual,
  EMPTY_VIEWPORT_FRAME,
  type EditorViewportFrame,
} from "./viewport-frame";
import {
  onFontReady,
  opticalCenterY,
  resolveInlineContextElement,
  resolveLineHeightPx,
} from "@/lib/text-metrics";

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

/**
 * Measure one anchorable block. Pure — no state mutation.
 *
 * The vertical anchor (`top`) for a prose block is derived from the SAME
 * grab-handle geometry SSOT the drag handles use: `resolveInlineContextElement`
 * ([text-metrics.ts]) descends the block's wrapper NodeView to the element that
 * carries the first visual text line (handling `heading-wrapper` h1–**h6**,
 * `par-title-wrapper`, `title-field-wrapper`, `list-title-wrapper`, `blockquote`,
 * `<pre>`→`<code>`, `expex-item`), and the anchor is the OPTICAL cap-band center
 * of that first line via the shared `opticalCenterY(lineTop, target)` primitive
 * ([text-metrics.ts] — the same one `block-frame.ts` composes). Storing `top =
 * opticalCenter − lineHeight/2` makes the grid's `cellAt` formula (`top +
 * row·lineHeight + (lineHeight − ICON)/2`, whose row-0 icon-CENTER is `top +
 * lineHeight/2`) land each marker on the optical middle of the text line —
 * pixel-aligned with the grab handle on the same block.
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
 * of the service.
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
    // container that declares it, before the text SSOT. KIND-GATED since task
    // 336: an unconditional query costs a FULL-SUBTREE walk to report the
    // no-match that is the only possible answer for prose and containers — a
    // whole-list scan per wrap-changing keystroke on a `bulletList`.
    const anchorOverride = resolveGlyphAnchor(dom);

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
    // Shared line-height parse — the `* 1.2` "normal"-leading approximation
    // lives once, in `resolveLineHeightPx`, not re-inlined here.
    const lineHeight = resolveLineHeightPx(style, parseFloat(style.fontSize));

    let top: number;
    if (anchorOverride) {
      // Declared visual top — center the marker on the override's own line
      // box (unchanged behavior for titled tex-block / expex `(n)`).
      top = targetRect.top - hostRect.top;
    } else {
      // Optical cap-band center of the first text line — the canonical
      // vertical anchor grab handles use, via the shared `opticalCenterY`
      // primitive (block-frame.ts `opticalCenterY` composes the same one).
      // Store `optical − lineHeight/2` so the grid centers the icon on it.
      // `style` is threaded in: it is already this target's computed style, and
      // the primitive would otherwise read it a second time (task 336).
      const optical = opticalCenterY(
        targetRect.top - hostRect.top,
        target,
        style,
      );
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

// ── Dev perf probe (multi-doc safe) ────────────────────────────────────────
// `window.__marginaliaStats()` must read the service of the editor being
// TYPED INTO so the recompute-count check stays trustworthy with N warm editors
// mounted (keep-alive). A single last-render-wins global would read the wrong
// (often hidden) service. We keep a per-editor map and resolve the FOCUSED
// editor on demand (falling back to the sole one). Dev-only.
const geometryStatsByEditor = new Map<Editor, () => unknown>();
let probeInstalled = false;
function installProbe() {
  if (probeInstalled || typeof window === "undefined") return;
  probeInstalled = true;
  const read = () => {
    const ed = pickProbeEditor(geometryStatsByEditor.keys());
    const stats = ed ? geometryStatsByEditor.get(ed) : undefined;
    return stats ? stats() : null;
  };
  (
    window as unknown as { __marginaliaStats?: () => unknown }
  ).__marginaliaStats = read;
  // Wave-2 alias: the service outgrew its marginalia origin; both names
  // read the same focused-editor stats (incl. the blocksAtY hover-path
  // counters — the mousemove-work visibility no probe had).
  (window as unknown as { __geometryStats?: () => unknown }).__geometryStats =
    read;
}

export interface GeometryStats {
  cached: number;
  observed: number;
  recomputes: number;
  version: number;
  /** Hover-path probe: total blocksAtY calls / how many answered null
   *  (fell back to a legacy scan). A healthy live editor trends nulls → 0
   *  after the near-zone populates. */
  blocksAtYCalls: number;
  blocksAtYNulls: number;
  /** Invalidation cascades run (task 336). Each is one O(observed) pass, so
   *  the contract this counter exists to make visible is ONE PER RO FLUSH,
   *  never one per entry — a rewrap inside a list delivers the `<li>` and its
   *  title wrapper together, and a cascade from the topmost of them subsumes
   *  the other. Typing that changes no wrap leaves it flat. */
  cascades: number;
}

/** A hover hit from {@link EditorGeometryService.blocksAtY} — the block's
 *  uuid plus its live node DOM (the element the IO observes, which IS
 *  `editor.view.nodeDOM(pos)` for the block). */
export interface BlockAtY {
  uuid: string;
  el: HTMLElement;
}

/**
 * Kill-switch for the service-backed hover resolvers (grab handle + the
 * par-title band): `localStorage["virgil:geom-hover"] = "off"` reverts to
 * the legacy full-document scans (which also remain the automatic fallback
 * whenever `blocksAtY` cannot answer).
 */
export function geomHoverEnabled(): boolean {
  try {
    return (
      typeof localStorage === "undefined" ||
      localStorage.getItem("virgil:geom-hover") !== "off"
    );
  } catch {
    return true;
  }
}

export interface EditorGeometryService {
  /** The editor this service is attached to (identity check for adapters). */
  readonly editor: Editor;
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
  /** Diagnostic counters. `version` bumps on EVERY `notify()` (recompute,
   *  intersection enter/leave, observed-set sync) — the correct re-render
   *  trigger; `recomputes` bumps only on `flushRecompute`. */
  stats(): GeometryStats;
  /**
   * Innermost-first anchorable blocks whose vertical band contains
   * `clientY` (viewport coords) — the hover-path replacement for the
   * O(doc) `querySelectorAll("[data-uuid]")` + rect-per-candidate sweep
   * (diagnosis S2/D1: 1,063 rect reads per mousemove at 2,883 blocks).
   * Answers from the near-zone CACHE: one host-rect read converts to host
   * space, then every containment test is arithmetic on cached metrics —
   * zero per-block DOM reads. Bands can lag a reflow by a frame until the
   * RO re-measures; hover affordances tolerate that by construction (they
   * re-schedule on the same RO).
   *
   * Returns `null` when it CANNOT answer (engine not started / hidden /
   * nothing observed yet) — callers fall back to their legacy scan — and
   * `[]` when the answer is genuinely "no block at this Y" (a gap).
   */
  blocksAtY(clientY: number): BlockAtY[] | null;
  /**
   * The editor's viewport frame (text edges, pod rect, scroll band, portal
   * context) — ONE cached measurement per editor, refreshed only on real
   * layout change (engine RO on the editor/scroll elements, window resize,
   * layout-gesture end edge). Replaces the per-consumer
   * `useEditorViewportCache` instances (C7). Returns the EMPTY frame until
   * the engine's first refresh — consumers already bail on
   * `editorEl === null` / `offsetHeight === 0`, exactly as they did against
   * the hook's initial EMPTY_CACHE.
   */
  getViewportFrame(): EditorViewportFrame;
  /** Fires when a committed viewport refresh CHANGED the frame (the
   *  equality bail holds otherwise). Separate channel from `subscribe` —
   *  metrics churn (near-zone enter/leave) must not re-run caret-placement
   *  effects, and a frame refresh must not re-render marginalia. */
  subscribeViewport(cb: () => void): () => void;
  /** Monotonic committed-refresh counter — the `useSyncExternalStore`
   *  snapshot for `subscribeViewport` consumers (the hook's `version`). */
  viewportVersion(): number;
  /**
   * `view.coordsAtPos(pos)` behind a per-frame, per-doc memo: entries are
   * keyed on the live `state.doc` identity (any edit invalidates) and the
   * whole memo clears on the next animation frame (scroll/resize between
   * frames invalidates). Within one frame at one doc, N consumers reading
   * the same pos pay ONE forced-layout read (the caret-placement
   * consolidation half of C7). Returns null where `coordsAtPos` throws —
   * callers treat it as their existing catch path. NOT safe against a
   *  same-frame layout WRITE between two reads; the placement consumers
   *  are all read-only RAF passes, which is the contract.
   */
  coordsAtPosCached(
    pos: number,
  ): { left: number; right: number; top: number; bottom: number } | null;
  /**
   * Keep-alive visibility. While `false` (hidden pane) every measurement
   * callback is inert — observers still fire on display:none flips but
   * would read 0-boxes and cache garbage. The adapter hook feeds this from
   * the KeepAliveSlot visibility context via a LAYOUT effect (so the
   * re-show RO notification, delivered post-commit, already reads `true`).
   */
  setVisible(v: boolean): void;
  /**
   * Refcount the ENGINE. The first retain starts observers / bus
   * subscription / window listener; the last release stops them and clears
   * all state (metrics, observed set, parked positions). Returns the
   * release function — call it exactly once, from the owning effect's
   * cleanup.
   */
  retain(): () => void;
}

export function createEditorGeometryService(
  editor: Editor,
): EditorGeometryService {
  // ── State (the former RegistryState, one per editor) ─────────────────────
  const cache = new Map<string, AnchorNodeMetrics>();
  /**
   * Last-good metrics for blocks that scrolled OUT of the near-zone (genuine
   * viewport-leave). Kept OUT of `cache` so `getMetrics` still returns `null`
   * for them — the render gate stays viewport-scoped. On re-entry the parked
   * value is reused when the fresh re-measure is within ε of it, so a block
   * that did NOT reflow while off-screen re-enters at a byte-identical Y (no
   * scroll-jump); a real reflow (beyond ε) commits the fresh measurement
   * instead. Reaped when the block leaves the doc (task 041).
   */
  const parked = new Map<string, AnchorNodeMetrics>();
  const observed = new Map<string, HTMLElement>();
  /**
   * The set of live anchorable uuids as of the last `syncObservedSet`. Drives
   * removed-uuid reaping (the drop loop) and document order, NOT the
   * "already observing?" decision — that is `attached`. (Pre-fix this set
   * doubled as the observe short-circuit, which silently broke whenever a uuid
   * landed here WITHOUT being attached — the list-item-note cull, RC.)
   */
  let lastUuidSet = new Set<string>();
  /**
   * The set of uuids for which `io.observe(el)` has actually been called and
   * not since `unobserve`'d. This — not `lastUuidSet` — is the truth the
   * `alreadyObserving` short-circuit reads. INVARIANT: a live uuid is skipped
   * by the new-uuid loop ONLY if it is in `attached`, so any path that leaves
   * a live uuid un-attached (DOM not painted yet, retry-cap eviction, a
   * transient walk-exclusion drop) is self-healed on the next sync.
   */
  const attached = new Set<string>();
  /**
   * UUIDs live in the doc but not yet attached (their decoration DOM hadn't
   * painted when `syncObservedSet` last ran). Drives the self-driven RAF
   * retry, bounded per-uuid by `observeAttempts`/`MAX_OBSERVE_RETRIES`.
   */
  let pendingObserve = new Set<string>();
  let observeAttempts = new Map<string, number>();
  let pendingRecompute = new Set<string>();
  /** Document order of every live UUID — kept in sync on structure-change. */
  let docOrder: string[] = [];
  /** uuid → index into `docOrder` — the O(1) twin of the old
   *  `docOrder.indexOf` (which made each RO entry O(doc), i.e. O(blocks²)
   *  per reflow frame before the gesture short-circuit). Rebuilt with
   *  `docOrder` in `syncObservedSet`, structural-event-paced. */
  let orderIndex = new Map<string, number>();
  let version = 0;
  let recomputes = 0;
  let rafId = 0;
  /** RAF handle for the pending-observe retry (CHIP-B); 0 when idle. */
  let observeRetryRafId = 0;
  /**
   * One-shot: the last `syncObservedSet` dropped a uuid whose DOM is still
   * live (a transient `walkAnchorableBlocks` exclusion). Lets the bounded
   * retry RAF re-run the sync even when `pendingObserve` is empty.
   */
  let healResyncPending = false;
  let intersectionObserver: IntersectionObserver | null = null;
  let resizeObserver: ResizeObserver | null = null;
  let hostEl: HTMLElement | null = null;
  const subscribers = new Set<() => void>();
  let visible = true;
  let refCount = 0;
  /** Set for the duration of a started engine; null while stopped. */
  let stopEngine: (() => void) | null = null;
  // Hover-path probe counters (surfaced by window.__geometryStats — the
  // mousemove-work visibility the diagnosis flagged as a probe blind spot).
  let blocksAtYCalls = 0;
  let blocksAtYNulls = 0;
  let cascades = 0;

  // ── Viewport frame (C7) ──────────────────────────────────────────────────
  // ONE cached frame per editor, its own subscriber channel (frame changes
  // must not re-render marginalia and metrics churn must not re-run
  // caret-placement effects). The identities the RO branch discriminates on:
  // the editor element + its scroll container ride the SAME ResizeObserver
  // as the near-zone blocks, so the whole engine still owns exactly one RO.
  let viewportFrame: EditorViewportFrame = EMPTY_VIEWPORT_FRAME;
  let viewportVersionCount = 0;
  const viewportSubscribers = new Set<() => void>();
  let viewportEditorEl: HTMLElement | null = null;
  let viewportScrollEl: HTMLElement | null = null;
  /** Parks the frame refresh across a continuous layout gesture (the hook's
   *  single highest-leverage park, retained: the refresh's equality bail
   *  structurally cannot hold mid-gesture). Created per engine start. */
  let viewportPark: ReturnType<typeof parkDuringLayoutGesture> | null = null;

  // coordsAtPos per-frame memo (C7). Keyed on the live doc identity (any
  // edit invalidates immediately) and cleared on the next animation frame
  // (scroll between frames invalidates). See the interface JSDoc.
  let coordsMemo: Map<
    number,
    { left: number; right: number; top: number; bottom: number }
  > | null = null;
  let coordsMemoDoc: unknown = null;
  let coordsMemoClearScheduled = false;

  function notify() {
    version = (version + 1) | 0;
    for (const cb of subscribers) cb();
  }

  /**
   * Measure + commit the viewport frame. Equality-bailed: an RO burst that
   * settles on identical geometry bumps nothing and re-runs no consumer
   * effect. The hidden-editor bail lives in `computeViewportFrame` (null →
   * keep the previous frame — the stale-geometry cascade guard).
   */
  function refreshViewportFrame() {
    if (!editor || editor.isDestroyed) return;
    let editorEl: HTMLElement | null = null;
    try {
      editorEl = editor.view.dom as HTMLElement;
    } catch {
      return;
    }
    if (!editorEl) return;
    const next = computeViewportFrame(editorEl);
    if (!next) return;
    if (viewportFramesEqual(viewportFrame, next)) return;
    viewportFrame = next;
    viewportVersionCount = (viewportVersionCount + 1) | 0;
    for (const cb of viewportSubscribers) cb();
  }

  /** Route a frame invalidation through the gesture park (one settle per
   *  gesture); outside a gesture it refreshes inline on this frame. */
  function fireViewportRefresh() {
    if (viewportPark) viewportPark.fire();
    else refreshViewportFrame();
  }

  /**
   * Observe the editor element + its scroll container with the engine's
   * ResizeObserver and prime the first frame. Runs at engine start (and is
   * re-entrant for the re-prime path): identities are re-resolved so a
   * swapped scroll container is re-observed rather than leaked.
   */
  function wireViewportObservation() {
    let editorEl: HTMLElement | null = null;
    try {
      editorEl = (editor.view?.dom as HTMLElement) ?? null;
    } catch {
      editorEl = null;
    }
    if (!editorEl) return;
    const scrollEl = findEditorScrollFor(editorEl);
    if (resizeObserver) {
      if (viewportEditorEl && viewportEditorEl !== editorEl)
        resizeObserver.unobserve(viewportEditorEl);
      if (viewportScrollEl && viewportScrollEl !== scrollEl)
        resizeObserver.unobserve(viewportScrollEl);
      resizeObserver.observe(editorEl);
      if (scrollEl) resizeObserver.observe(scrollEl);
    }
    viewportEditorEl = editorEl;
    viewportScrollEl = scrollEl;
  }

  // Task 317 — park the MEASURE PASS, never the accumulation. This is the
  // highest-fire-count follower in the app during a horizontal window drag:
  // a width change rewraps every paragraph, so the per-block RO delivers one
  // entry per near-zone block per frame. `pendingRecompute` keeps collecting
  // across the whole gesture (that set IS the work list and must not be
  // dropped); only the RAF measure pass is deferred, so the gesture costs ONE
  // flush over the union instead of one per frame. Created per engine START
  // (it holds a live bus subscription).
  let recomputePark: ReturnType<typeof parkDuringLayoutGesture> | null = null;

  // Task 416 — the SAME rule for the IO half. `onResize` has been
  // gesture-gated since 317; `onIntersection` never was, and a CONTENT drag
  // is the gesture that fires it: `auto-scroll.ts` writes `scrollTop` once
  // per RAF, so blocks cross the ±800 px near-zone boundary for the whole of
  // a long drag. Each crossing paid a `measureBlock` (a forced-layout rect
  // read) plus a `notify()` — and `notify()` is the marginalia deck's full
  // repack, i.e. the one O(markers) cost in this file. A pane-divider drag
  // and an OS window resize produce no scroll OF THEIR OWN (a rewrap that
  // shortens the scroll range can still make the UA clamp and fire one, and
  // parking is the right answer there too — the same discipline 317 already
  // applies to that gesture), so a KIND-BLIND park is right here and needs no
  // `hasActiveLayoutGesture` filter.
  //
  // The deferred NOTIFICATION rides the recompute park rather than a park of
  // its own, and that is load-bearing rather than tidy. Two parks settle
  // through two different CLOCKS — `scheduleRecompute` only ARMS a RAF while
  // `notify()` is synchronous — so a second park publishes the deck one full
  // frame BEFORE the measures it is announcing, against a cache holding every
  // mid-gesture LEAVE eviction and none of the deferred ENTER measurements.
  // Every block that left and re-entered the near-zone during the drag would
  // lose its marker for that frame, and the gesture would cost TWO O(markers)
  // repacks instead of the one this claims. One park, one clock, one settle.
  let pendingNotify = false;

  /** Re-measure UUIDs in `pendingRecompute` on the next paint. */
  function scheduleRecompute() {
    if (rafId) return;
    rafId = requestAnimationFrame(() => {
      rafId = 0;
      flushRecompute();
    });
  }

  function fireRecompute() {
    if (recomputePark) recomputePark.fire();
    else scheduleRecompute();
  }

  /**
   * uuid → { pos, isAtom } resolver for a measurement pass — LAZY, built at
   * most once per pass, and nothing is resolved when no measurable entry
   * needs it (a pure viewport-LEAVE batch pays zero).
   *
   * BUS-FIRST (wave 2 S3b): positions come from the DocStructure snapshot —
   * the observer maintains them O(edit) per transaction and the `structure`
   * getter materializes pending step-maps at read time, so the read is
   * always current. `isAtom` derives from the schema by `typeName`
   * (`isAnchorableAtom` = anchorable ∧ atom, and every entry is anchorable
   * by construction). Coverage is identical to `walkAnchorableBlocks` BY
   * CONSTRUCTION — both are "descendants ∧ isAnchorableNode ∧ non-null
   * uuid" — so the walk survives only as the fallback for editors mounted
   * WITHOUT the observer (minimal harnesses), where the bus map is absent
   * or empty.
   */
  function makePosResolver(): (
    uuid: string,
  ) => { pos: number; isAtom: boolean } | undefined {
    let resolve:
      | ((uuid: string) => { pos: number; isAtom: boolean } | undefined)
      | null = null;
    const build = () => {
      const structure = getBus(editor)?.structure;
      if (structure && structure.blocks.size > 0) {
        const nodes = editor.schema.nodes;
        return (uuid: string) => {
          const e = structure.blocks.get(uuid);
          if (!e) return undefined;
          return { pos: e.pos, isAtom: nodes[e.typeName]?.isAtom === true };
        };
      }
      const posByUuid = new Map<string, { pos: number; isAtom: boolean }>();
      for (const b of walkAnchorableBlocks(editor))
        posByUuid.set(b.uuid, { pos: b.pos, isAtom: b.isAtom });
      return (uuid: string) => posByUuid.get(uuid);
    };
    return (uuid) => {
      if (!resolve) resolve = build();
      return resolve(uuid);
    };
  }

  function flushRecompute() {
    if (!editor || editor.isDestroyed || !visible) return;
    // `pendingNotify` is a mid-gesture LEAVE's deferred repack (task 416): the
    // eviction happened inline but must not PUBLISH until the deferred ENTERS
    // beside it have been measured, so it settles here rather than on a second
    // park. A pure-leave gesture therefore has to reach this body with an
    // empty work list — hence the `||`, not a bare `size === 0` bail.
    if (pendingRecompute.size === 0 && !pendingNotify) return;
    const host = hostEl ?? resolveMarginaliaHost(editor);
    if (!host) return;
    const hostRect = host.getBoundingClientRect();
    const pending = pendingRecompute;
    pendingRecompute = new Set();
    recomputes++;

    const resolvePos = makePosResolver();

    // Seeded with what the deferred half already knows changed. Cleared only
    // once we are past the two bails above, so a flush that could not run
    // (hidden pane, no host) still owes the notify to the next one rather
    // than dropping it.
    let changed = pendingNotify;
    pendingNotify = false;
    for (const uuid of pending) {
      if (!observed.has(uuid)) {
        // No longer observed (left the near-zone or removed). Drop cache.
        if (cache.delete(uuid)) changed = true;
        continue;
      }
      const meta = resolvePos(uuid);
      if (!meta) {
        if (cache.delete(uuid)) changed = true;
        continue;
      }
      const next = measureBlock(editor, meta.pos, meta.isAtom, hostRect, uuid);
      if (!next) {
        if (cache.delete(uuid)) changed = true;
        continue;
      }
      const prev = cache.get(uuid);
      if (!prev || !metricsWithinEpsilon(prev, next)) {
        cache.set(uuid, next);
        changed = true;
      }
    }
    if (changed) notify();
  }

  /**
   * Invalidate cached Y for every uuid in `uuids` and for every block below the
   * TOPMOST of them in document order — a height change in N shifts blocks
   * N+1, N+2, … down by the delta. We don't compute the delta, we just
   * re-measure on the next RAF (option (c) from the audit memo: safer than
   * computing the delta from a possibly-stale cached height).
   *
   * Takes the whole RO FLUSH rather than one entry at a time (task 336). A
   * cascade from index `i` is a superset of a cascade from any `j > i`, so N
   * entries in one flush produce ONE pass over `observed` from the minimum
   * index — O(entries + observed) instead of O(entries × observed). The batch
   * shape is not hypothetical: a wrap-changing keystroke inside a list resizes
   * BOTH the `<li>` and its title wrapper, and both are uuid-observed, so the
   * commonest list keystroke delivered two entries and paid the cascade twice
   * for a result identical to paying it once.
   *
   * Only OBSERVED (near-zone) blocks have metrics to refresh, so the cascade
   * intersects with `observed` rather than walking the doc tail (S3b — with the
   * O(1) `orderIndex` lookup replacing the old O(doc) `indexOf`). An off-zone
   * block below re-measures on its own IO ENTER; a DETACHED block's kept-alive
   * cache entry survives an unrelated cascade, which is what the detach path
   * always intended ("stale metrics beat a culled marker until the re-observe
   * re-measures"). A uuid with no `orderIndex` still invalidates ITSELF —
   * unchanged from the per-entry form, which likewise skipped the cascade.
   */
  function invalidateFromUuids(uuids: Iterable<string>) {
    let minIdx = Infinity;
    let any = false;
    for (const uuid of uuids) {
      any = true;
      pendingRecompute.add(uuid);
      const idx = orderIndex.get(uuid);
      if (idx !== undefined && idx < minIdx) minIdx = idx;
    }
    if (!any) return;
    cascades++;
    if (minIdx !== Infinity) {
      for (const u of observed.keys()) {
        const i = orderIndex.get(u);
        if (i !== undefined && i >= minIdx) pendingRecompute.add(u);
      }
    }
    fireRecompute();
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
   *     doc but not yet attached.
   *   - Drop any cached UUID that's no longer in the doc.
   * Called on engine start and on every structural transaction.
   */
  function syncObservedSet() {
    const io = intersectionObserver;
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
    // re-evaluates the rest. `walkAnchorableBlocks` can transiently exclude a
    // still-live block; folding such a uuid permanently out with no recovery
    // is the cull RC — the attach loop + the self-heal retry make the drop
    // safe to undo: a dropped-but-still-live uuid is simply un-attached, so
    // the very next sync re-resolves and re-observes it.
    let changed = false;
    let droppedStillLive = false;
    for (const uuid of lastUuidSet) {
      if (nextSet.has(uuid)) continue;
      const el = observed.get(uuid);
      if (el) {
        io.unobserve(el);
        resizeObserver?.unobserve(el);
        observed.delete(uuid);
      }
      // Only a transient exclusion counts as still-live — if the block truly
      // left the doc, `resolveDomForUuid` is null and this is a real removal.
      if (resolveDomForUuid(editor, uuid)) droppedStillLive = true;
      attached.delete(uuid);
      if (cache.delete(uuid)) changed = true;
      // A block leaving the doc must also drop its parked (off-screen)
      // metrics so a later uuid collision can't reuse a dead position, and
      // the map stays bounded by live doc blocks.
      parked.delete(uuid);
    }

    // Attach observers for any live uuid that ISN'T already attached. The
    // short-circuit reads `attached` — NOT `lastUuidSet` — so the
    // eviction-cap and transient-drop paths can't poison it. When the
    // decoration DOM hasn't painted yet, record the uuid in `pendingObserve`
    // (bounded retries) so a self-driven RAF re-resolves it without waiting
    // for a structural tx.
    const nextPending = new Set<string>();
    const nextAttempts = new Map<string, number>();
    for (const uuid of nextSet) {
      if (attached.has(uuid)) continue;
      const el = resolveDomForUuid(editor, uuid);
      if (!el) {
        // DOM not painted yet — retry on the next sync UNLESS we've burned
        // the per-uuid RAF budget (CHIP-B NIT 1). At the cap, leave it OUT of
        // `nextPending` so the RAF loop stops; it stays in `lastUuidSet` but
        // NOT in `attached`, so the next structural sync re-resolves it.
        const attempts = (observeAttempts.get(uuid) ?? 0) + 1;
        if (attempts < MAX_OBSERVE_RETRIES) {
          nextPending.add(uuid);
          nextAttempts.set(uuid, attempts);
        }
        continue;
      }
      // Painted — observe it and record the attachment. The
      // IntersectionObserver delivers an initial callback that measures it
      // once it's in the near-zone.
      io.observe(el);
      attached.add(uuid);
    }

    lastUuidSet = nextSet;
    pendingObserve = nextPending;
    observeAttempts = nextAttempts;
    docOrder = nextOrder;
    orderIndex = new Map(nextOrder.map((u, i) => [u, i]));
    if (changed) notify();

    // Self-driven retry: a first-paint observe miss, a retry-cap eviction,
    // or a transient walk-exclusion drop all leave a live uuid un-attached.
    // Waiting for the NEXT structural transaction may never resolve on a
    // quiet doc. Gated so it costs nothing once every live uuid is attached
    // — never on the keystroke path.
    if (droppedStillLive) healResyncPending = true;
    if (pendingObserve.size > 0 || droppedStillLive) {
      scheduleObserveRetry();
    }
  }

  /**
   * Re-resolve + observe the `pendingObserve` set on the next paint. Work is
   * bounded by the number of still-unpainted uuids; a settled doc with zero
   * pending never schedules. Bounded per-uuid (CHIP-B NIT 1) so a stale
   * never-painting uuid can't pin the O(doc) sync to every frame.
   */
  function scheduleObserveRetry() {
    if (observeRetryRafId || !visible) return;
    observeRetryRafId = requestAnimationFrame(() => {
      observeRetryRafId = 0;
      if (!editor || editor.isDestroyed) return;
      // A still-live drop heal is a one-shot: clear it and re-sync once. The
      // recovered walk re-attaches the dropped uuid, so it won't re-arm.
      const healing = healResyncPending;
      healResyncPending = false;
      if (pendingObserve.size === 0 && !healing) return;
      syncObservedSet();
    });
  }

  function onIntersection(entries: IntersectionObserverEntry[]) {
    if (!editor || editor.isDestroyed || !visible) return;
    const host = hostEl ?? resolveMarginaliaHost(editor);
    if (!host) return;

    // The host rect resolves LAZILY, for the same reason `resolvePos` does:
    // `getBoundingClientRect()` is a forced-layout read, and a batch with no
    // measurable entry — a pure viewport-LEAVE (scroll-away), or ANY batch
    // during a layout gesture, both of which are exactly what a drag's
    // auto-scroll produces — must pay nothing. It was read unconditionally
    // at the top of this function until task 416.
    let hostRectCache: DOMRect | null = null;
    const hostRectOf = (): DOMRect => (hostRectCache ??= host.getBoundingClientRect());

    // Positions resolve LAZILY once per IO batch — bus-first via the
    // structure snapshot (zero doc walks; S3b), the one-walk fallback only
    // for observer-less editors. A pure viewport-LEAVE batch (scroll-away)
    // resolves nothing and pays nothing.
    const resolvePos = makePosResolver();

    // Mid-gesture the ENTER branch does its BOOKKEEPING (observe the element,
    // join the observed set, run the detach heal) and defers only the
    // MEASUREMENT — the uuid goes onto `pendingRecompute`, which is the same
    // work list `onResize` collects into, and the parked measure pass settles
    // the union exactly once on the gesture's end edge. Splitting it this way
    // rather than bailing outright is what keeps the observed set honest: the
    // set is the engine's memory of which blocks it is tracking, and dropping
    // a crossing would leave it permanently wrong after the drag.
    const gestureActive = isLayoutGestureActive();

    let changed = false;
    let deferred = false;
    for (const entry of entries) {
      const el = entry.target as HTMLElement;
      const uuid = el.getAttribute("data-uuid");
      if (!uuid) continue;
      if (entry.isIntersecting) {
        // Enter near-zone: observe size + measure once.
        if (!observed.has(uuid)) {
          observed.set(uuid, el);
          resizeObserver?.observe(el);
        }
        if (gestureActive) {
          // Deferred measure — see `gestureActive` above. `pendingRecompute`
          // accumulates across the whole gesture (that set IS the work list
          // and must not be dropped); only the pass defers.
          pendingRecompute.add(uuid);
          deferred = true;
          continue;
        }
        // Resolve pos from the once-per-batch resolver (positions can have
        // shifted since the last sync, e.g. an upstream paragraph split).
        const meta = resolvePos(uuid);
        if (!meta) continue;
        const next = measureBlock(editor, meta.pos, meta.isAtom, hostRectOf(), uuid);
        if (!next) continue;
        // Re-entry after a genuine viewport-leave: prefer the PARKED
        // position. If the block did not meaningfully reflow while
        // off-screen, the fresh re-measure is within ε of the parked value →
        // commit the parked value verbatim so the marker re-enters at a
        // byte-identical Y (no scroll-jump, no overflow-pill re-pack). A real
        // reflow (beyond ε) commits the fresh measurement. The measure still
        // runs, so an off-screen self-resize (async NodeView sizing, font
        // swap, image decode) is caught here rather than reused stale.
        const parkedMetrics = parked.get(uuid);
        const committed =
          parkedMetrics && metricsWithinEpsilon(parkedMetrics, next)
            ? parkedMetrics
            : next;
        if (parkedMetrics) parked.delete(uuid);
        const prev = cache.get(uuid);
        if (!prev || !metricsWithinEpsilon(prev, committed)) {
          cache.set(uuid, committed);
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
        //       swaps its outer DOM element for a fresh one (the classic
        //       trigger: the anchor-highlight reconciler writing foreign
        //       attrs onto a plain-PM `listItem`, which PM then redraws).
        //
        //       If we treated (b) like (a) we'd drop the stale element from
        //       `observed`/cache but leave the uuid in `attached` — and the
        //       `syncObservedSet` short-circuit would then NEVER re-observe
        //       the fresh element: the marker is culled forever (RC).
        //
        // The class fix: on a detach of a STILL-LIVE anchorable uuid, evict
        // the uuid from `attached` (and reset its retry budget) so the
        // bounded self-heal re-resolves and re-observes the fresh element.
        // KEEP the cache entry — the block didn't move, so its last metrics
        // stay valid until the re-observe re-measures (no one-frame flicker).
        const observedEl = observed.get(uuid);
        const detached = !el.isConnected;
        if (observedEl) {
          // Always drop size observation + the observed-map entry.
          resizeObserver?.unobserve(observedEl);
          observed.delete(uuid);
          // Only DETACH stops IO-observing the element. A genuine
          // viewport-leave keeps the (still-connected) element observed so it
          // fires ENTER again when it scrolls back into the near-zone.
          if (detached) intersectionObserver?.unobserve(observedEl);
        }
        if (detached && attached.has(uuid)) {
          // Re-observe path: keep the uuid eligible for the new-uuid loop.
          attached.delete(uuid);
          observeAttempts.delete(uuid);
          // Arm the bounded self-heal so a quiet doc re-observes the fresh
          // element without waiting for the next structural transaction.
          healResyncPending = true;
          scheduleObserveRetry();
          // Do NOT drop the cache — the block is still live; stale-but-close
          // metrics beat a culled marker for the frame until re-measure.
        } else {
          const cached = cache.get(uuid);
          if (cached) {
            // Genuine viewport-leave (still connected) vs a detach of an
            // already-gone block. Either way drop from `cache` so the
            // off-screen block resolves to `null` (un-painted). For a genuine
            // viewport-leave, PARK the last-good metrics so re-entry reuses
            // the Y (task 041). A detach parks nothing — there's no element
            // to re-enter, and `syncObservedSet` reaps it.
            if (!detached) parked.set(uuid, cached);
            cache.delete(uuid);
            changed = true;
          }
        }
      }
    }
    // Mid-gesture BOTH halves settle through the ONE park, in the one order
    // that is correct: `flushRecompute` measures the deferred enters and THEN
    // notifies, so the deck is published complete. Off-gesture `deferred` is
    // false by construction and this reduces to the pre-416 `if (changed)
    // notify()`, byte for byte.
    if (gestureActive) {
      if (changed) pendingNotify = true;
      if (deferred || changed) fireRecompute();
    } else if (changed) {
      notify();
    }
  }

  function onResize(entries: ResizeObserverEntry[]) {
    if (!visible) return; // hidden editor → boxes are 0; skip
    recordKeystrokeWork(KEYSTROKE_WORK_MARGINALIA_RO);
    // Viewport-frame targets first (C7): the editor element and its scroll
    // container ride this same observer. Their resize invalidates the FRAME,
    // not any block — and it must fire BEFORE the gesture short-circuit
    // below, because mid-gesture the park is exactly what should stash it
    // (skipping it here would mean no settle on the gesture's end edge).
    let viewportHit = false;
    for (const entry of entries) {
      const el = entry.target;
      if (el === viewportEditorEl || el === viewportScrollEl) {
        viewportHit = true;
        break;
      }
    }
    if (viewportHit) {
      recordKeystrokeWork(KEYSTROKE_WORK_VIEWPORT_CACHE_RO);
      fireViewportRefresh();
    }
    if (isLayoutGestureActive()) {
      // Mid-gesture the ENTIRE observed set is moving, so a per-block
      // invalidation is both redundant and quadratic: a width change delivers
      // one entry per block, so a cascade per entry is O(blocks²) per frame at
      // 300+ blocks. Collapse it to one O(observed) "everything is dirty" mark;
      // the park then defers the single measure pass to the gesture's end edge.
      // (Off-gesture the same collapse is `invalidateFromUuids` below, which
      // cascades ONCE from the flush's topmost entry.)
      recomputeAllObserved();
      return;
    }
    const dirty: string[] = [];
    for (const entry of entries) {
      const el = entry.target as HTMLElement;
      const uuid = el.getAttribute("data-uuid");
      if (uuid) dirty.push(uuid);
    }
    invalidateFromUuids(dirty);
  }

  /**
   * Queue EVERY observed block for re-measure on the next paint — the
   * "something global changed, the whole observed set may have moved"
   * recompute. Shared by the window-resize belt-and-suspenders and the
   * font-load (FOUT) corrector.
   */
  function recomputeAllObserved() {
    if (!visible) return; // hidden editor → nothing to re-measure
    for (const uuid of observed.keys()) {
      pendingRecompute.add(uuid);
    }
    fireRecompute();
  }

  function onWindowResize() {
    // Belt-and-suspenders: ResizeObserver covers per-element box changes
    // but not (e.g.) viewport-only DPR changes that don't resize any
    // observed element. Re-measure everything observed — and the viewport
    // frame (its scroll band can move without either observed element
    // resizing, e.g. a window height change with a fixed-height row).
    recomputeAllObserved();
    fireViewportRefresh();
  }

  /** First-measure pass on engine start. */
  function prime() {
    const host = resolveMarginaliaHost(editor);
    if (!host) {
      // No marginalia host (harness / non-pane editor): the block engine
      // can't run, but the viewport frame (C7) still can — it needs only
      // the view DOM. Without the RO it refreshes on window resize +
      // gesture edges only, which is the honest floor for such editors.
      wireViewportObservation();
      refreshViewportFrame();
      return;
    }
    hostEl = host;

    const root = resolveRoot();
    intersectionObserver = new IntersectionObserver(onIntersection, {
      root,
      rootMargin: `${NEAR_ZONE_PX}px 0px ${NEAR_ZONE_PX}px 0px`,
    });
    resizeObserver = new ResizeObserver(onResize);

    // Viewport-frame elements ride the SAME observer as the near-zone
    // blocks (C7) — the engine still owns exactly one ResizeObserver.
    wireViewportObservation();
    refreshViewportFrame();

    syncObservedSet();
  }

  function startEngine(): void {
    // The park holds a live bus subscription — one per started engine.
    recomputePark = parkDuringLayoutGesture(
      () => scheduleRecompute(),
      LAYOUT_SITE_MARGINALIA,
    );
    // Viewport-frame park (C7): the refresh is a getComputedStyle + 4×
    // getBoundingClientRect pass whose equality bail cannot hold mid-gesture
    // (the rects really are moving) — one settle on the end edge. Same site
    // id the retired per-consumer hook reported under.
    viewportPark = parkDuringLayoutGesture(
      () => refreshViewportFrame(),
      LAYOUT_SITE_VIEWPORT_CACHE,
    );

    // Subscribe to the DocStructureObserver — wakes only when blocks are
    // added or removed. Text edits within blocks don't wake the service; the
    // IO/RO pair handles any wrap-induced layout change. RAF-coalesced (2c):
    // a held-backspace across N blocks fires a structural emit per
    // block-merge tx — the DOM-scale observed-set resync must run once per
    // frame, not once per repeat.
    const bus = getBus(editor);
    const unsubBus = bus
      ? (() => {
          const coalescedSync = rafCoalesced(() => syncObservedSet());
          const u1 = bus.onBlocksAdded(coalescedSync.schedule);
          const u2 = bus.onBlocksRemoved(coalescedSync.schedule);
          // Order changes too (S3b): a drag-reorder preserves the uuid SET,
          // so added/removed never fire — but `docOrder`/`orderIndex` (the
          // invalidation cascade's notion of "below") went stale until the
          // next add/remove. Same coalesced sync; fires only on a real
          // reorder, never on a keystroke.
          const u3 = bus.onBlockOrderChanged(coalescedSync.schedule);
          return () => {
            coalescedSync.cancel();
            u1();
            u2();
            u3();
          };
        })()
      : null;

    // FOUT corrector — a runtime font-FAMILY swap at unchanged font-size +
    // line-height re-lays out NO block box, so no RO / IO / window-resize /
    // structural trigger fires — yet it moves every block's OPTICAL cap-band
    // center (`measureBlock` seats `top` on `opticalCenterY`, font-family
    // dependent). Re-measure the whole observed set on the wave.
    // Keystroke-sanctity: `onFontReady` fires only on a font-load wave, and
    // `flushRecompute` is ε-bailed so a wave that moves nothing notifies
    // nothing.
    const disposeFontReady = onFontReady(recomputeAllObserved);

    // Editor may already be ready when the engine starts; if not, wait for
    // `create`. RAF-defer prime so the DOM has a chance to mount anchorable
    // elements before we query them.
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

    geometryStatsByEditor.set(editor, service.stats);
    installProbe();

    stopEngine = () => {
      stopEngine = null;
      geometryStatsByEditor.delete(editor);
      editor.off("create", tryPrime);
      unsubBus?.();
      disposeFontReady();
      recomputePark?.dispose();
      recomputePark = null;
      viewportPark?.dispose();
      viewportPark = null;
      pendingNotify = false;
      window.removeEventListener("resize", onWindowResize);
      if (rafId) cancelAnimationFrame(rafId);
      rafId = 0;
      if (observeRetryRafId) cancelAnimationFrame(observeRetryRafId);
      observeRetryRafId = 0;
      healResyncPending = false;
      intersectionObserver?.disconnect();
      resizeObserver?.disconnect();
      intersectionObserver = null;
      resizeObserver = null;
      observed.clear();
      cache.clear();
      parked.clear();
      lastUuidSet = new Set();
      attached.clear();
      pendingObserve.clear();
      observeAttempts.clear();
      docOrder = [];
      pendingRecompute.clear();
      hostEl = null;
      // Viewport frame: reset to EMPTY (the hook's cleanup contract) so a
      // late reader after the last release sees the same not-ready frame a
      // pre-start reader does. No notify — subscribers are releasing too.
      viewportFrame = EMPTY_VIEWPORT_FRAME;
      viewportEditorEl = null;
      viewportScrollEl = null;
      coordsMemo = null;
      coordsMemoDoc = null;
    };
  }

  const service: EditorGeometryService = {
    editor,
    getMetrics: (uuid) => cache.get(uuid) ?? null,
    subscribe: (cb) => {
      subscribers.add(cb);
      return () => {
        subscribers.delete(cb);
      };
    },
    stats: () => ({
      cached: cache.size,
      observed: observed.size,
      recomputes,
      version,
      blocksAtYCalls,
      blocksAtYNulls,
      cascades,
    }),
    blocksAtY: (clientY) => {
      blocksAtYCalls++;
      if (!visible || !hostEl || observed.size === 0) {
        blocksAtYNulls++;
        return null;
      }
      const y = clientY - hostEl.getBoundingClientRect().top;
      const hits: { uuid: string; el: HTMLElement; top: number; bottom: number }[] = [];
      for (const [uuid, el] of observed) {
        const m = cache.get(uuid);
        if (!m) continue;
        const top = m.domTop;
        const bottom = m.domTop + m.height;
        if (y < top || y > bottom) continue;
        hits.push({ uuid, el, top, bottom });
      }
      // Innermost-first via band containment: when ranges nest, the
      // narrower-Y range is the inner one — larger top first, then smaller
      // bottom (the legacy resolver's exact sort, on cached numbers).
      hits.sort((a, b) => (a.top !== b.top ? b.top - a.top : a.bottom - b.bottom));
      return hits.map((h) => ({ uuid: h.uuid, el: h.el }));
    },
    getViewportFrame: () => viewportFrame,
    subscribeViewport: (cb) => {
      viewportSubscribers.add(cb);
      return () => {
        viewportSubscribers.delete(cb);
      };
    },
    viewportVersion: () => viewportVersionCount,
    coordsAtPosCached: (pos) => {
      if (!editor || editor.isDestroyed) return null;
      let doc: unknown;
      try {
        doc = editor.state.doc;
      } catch {
        return null;
      }
      if (!coordsMemo || coordsMemoDoc !== doc) {
        coordsMemo = new Map();
        coordsMemoDoc = doc;
      }
      const hit = coordsMemo.get(pos);
      if (hit) return hit;
      let c: { left: number; right: number; top: number; bottom: number };
      try {
        c = editor.view.coordsAtPos(pos);
      } catch {
        return null;
      }
      const out = { left: c.left, right: c.right, top: c.top, bottom: c.bottom };
      coordsMemo.set(pos, out);
      // Frame-scoped: the clear is RAF-scheduled on first population, so
      // scroll/resize between frames can never serve a stale line box. (RAF
      // callbacks run in scheduling order — this clear, armed in frame N,
      // runs before any consumer RAF armed by a frame-N+1 event.)
      if (!coordsMemoClearScheduled && typeof requestAnimationFrame !== "undefined") {
        coordsMemoClearScheduled = true;
        requestAnimationFrame(() => {
          coordsMemoClearScheduled = false;
          coordsMemo = null;
        });
      }
      return out;
    },
    setVisible: (v) => {
      visible = v;
    },
    retain: () => {
      refCount++;
      if (refCount === 1) startEngine();
      let released = false;
      return () => {
        if (released) return;
        released = true;
        refCount--;
        if (refCount === 0) stopEngine?.();
      };
    },
  };

  return service;
}
