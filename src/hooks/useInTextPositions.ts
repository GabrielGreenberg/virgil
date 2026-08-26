"use client";

import { useState, useEffect, useLayoutEffect, useMemo, useCallback, useRef } from "react";
import type { Editor } from "@tiptap/react";
import { DATA_LINK_CARD, linkCardIdSelector } from "@/links/link-dom-contract";
import { findEditorScrollFor } from "@/components/editor-layout/layout-scroll";
import { useIsVisible } from "@/lib/keep-alive/visibility-context";
import { requestLowPriority } from "@/lib/keep-alive/schedule-low-priority";
import { getBus } from "@/lib/tiptap/doc-structure";
import { resolveVisiblePosBand } from "@/lib/editor-geometry/viewport-probe";
import { holdWithinEpsilon, HEIGHT_EPSILON_PX } from "@/lib/reposition-policy";
import {
  createConvergenceController,
  type ConvergenceController,
  type MeasureOutcome,
} from "@/lib/editor-geometry/settle-convergence";
import { onFontReady } from "@/lib/text-metrics";
import {
  isLayoutGestureActive,
  parkDuringLayoutGesture,
} from "@/lib/pane-resize";
import { LAYOUT_SITE_IN_TEXT_POSITIONS } from "@/lib/layout-gesture-probe";
import {
  recordKeystrokeWork,
  KEYSTROKE_WORK_INTEXT_RO,
} from "@/lib/keystroke-latency-probe";

/** Viewport gating margin — items within ±NEAR_ZONE_PX of the visible
 *  range still get measured, so scrolling slightly doesn't flash through
 *  default-height placeholders. */
const NEAR_ZONE_PX = 600;

export interface PositionItem {
  id: string;
  pos: number; // ProseMirror document position
}

/**
 * Helper: find approximate document position for a text snippet.
 * Used by RevisionsPanel where comments store selectedText but no pos.
 */
export function findTextPosition(editor: Editor | null, text: string): number {
  if (!editor || !text) return 0;
  const docText = editor.state.doc.textBetween(0, editor.state.doc.content.size, "\n");
  const snippet = text.slice(0, 40);
  const idx = docText.indexOf(snippet);
  if (idx < 0) return 0;
  // Convert text offset to doc position
  let pos = 0;
  let textOffset = 0;
  editor.state.doc.descendants((node, nodePos) => {
    if (pos > 0) return false;
    if (node.isText) {
      const len = (node.text || "").length;
      if (textOffset + len > idx) {
        pos = nodePos + (idx - textOffset);
        return false;
      }
      textOffset += len;
    } else if (node.isBlock && textOffset > 0) {
      textOffset += 1;
    }
    return true;
  });
  return pos;
}

const MIN_GAP = 4; // small extra gap between entries beyond their height
const DEFAULT_ENTRY_HEIGHT = 60; // fallback before entries are rendered

/**
 * Height a card contributes to the cascade, given its freshly-read height this
 * pass (`measured`, present only when the card is inside the ±NEAR_ZONE_PX
 * measurement band) and its last real height RETAINED across the viewport gate
 * (`retained`).
 *
 * WHY THE RETAINED VALUE IS TRUSTWORTHY (task 490 — read this before changing
 * the fallback order). The original justification was "a card's rendered height
 * is scroll-invariant, so a height read once stays truthful after the card
 * scrolls out of the band". That is true of SCROLL and false of everything
 * else: a card COLLAPSES, EXPANDS, swaps presence tier, or finishes laying out
 * a late font / KaTeX span / image — all of which change its height, none of
 * which is a scroll. The gate that decides whether to re-read is asked of the
 * ANCHOR's viewport Y (`inViewport`, below) and of the anchor's document POSITION
 * (the `deferredItems` band route), never of the CARD — and the cascade is
 * precisely the mechanism that makes those two differ. So a card that shrank
 * while its anchor was out of band kept its OLD, TALLER height, which the
 * cascade then reserved: Gabriel's "archive cards are displacing to the same
 * extent as they would be when open", verbatim. The same hole is SYMMETRIC — a
 * card that GREW out of band keeps a too-SMALL height and the next card packs
 * on top of it, which is the task-043 overlap this cache exists to prevent,
 * arriving from the other side.
 *
 * What makes it trustworthy now is not an invariant about scrolling but a
 * WRITER: the per-card ResizeObserver (see `noteObservedHeights` below) records
 * every height CHANGE as it happens, at every scroll position, from the
 * post-layout number the observer already carries. The near-zone gate exists to
 * avoid a FORCED layout read; an RO entry is not one, so there is nothing to
 * gate. The pass's own `getBoundingClientRect` read stays as the SEED for a card
 * the observer has not delivered yet (first paint, a wrapper that mounted this
 * commit) and as the corroboration for in-zone cards.
 *
 * The retained real height ALWAYS beats `DEFAULT_ENTRY_HEIGHT`: the
 * near-zone gate substitutes the 60px placeholder for out-of-zone cards, and a
 * 120–200px card packed into a 60px slot makes the cascade pile the NEXT card
 * on top of it — the "render overlapped, then de-overlap ~500ms later" jump
 * (task 043). Feeding the cascade the retained truth means the first pass after
 * scroll-into-view is already correct: no overlapping frame, no snap.
 *
 * This is the card-side twin of task 041's `parked` last-good-metrics idea
 * (`useMarginaliaRegistry.ts`) — "retain real geometry across the viewport
 * gate" ported from marker metrics to the card height input. Only the fallback
 * order differs: fresh read → retained real → placeholder.
 */
export function retainedEntryHeight(
  measured: number | undefined,
  retained: number | undefined,
): number {
  return measured ?? retained ?? DEFAULT_ENTRY_HEIGHT;
}

/**
 * Settle tuning lives in `settle-convergence.ts` (task 370) — this hook owns
 * only the VERDICT each pass reports (`MeasureOutcome`), never the termination
 * rule.
 *
 * What retired here: a rAF loop that stopped the first frame the editor's
 * `scrollHeight` was unchanged (`SETTLE_STABLE_FRAMES = 1`), or after a
 * 30-frame cap. `scrollHeight` is a TOTAL, and inner layout moves inside an
 * unchanged total constantly (a KaTeX span sizing, an expex example reflowing,
 * a figure NodeView swapping a same-height placeholder) while an absolutely
 * positioned lane never touches it at all — so on a card-dense page the loop
 * declared victory one frame into a settle that had barely begun, and NOTHING
 * re-measured until the user scrolled. Visible as a lane packed contiguously
 * from the top at minimum spacing that SNAPS on the first scroll.
 *
 * The criterion is now the consumer's own fixed point: two consecutive passes
 * that commit nothing past the task-328 hysteresis. Nothing to keep in sync —
 * `changed` below IS the epsilon comparison.
 */

/**
 * Clean-re-show suppression window (ms). On a clean keep-alive re-show the
 * display:none→flex flip resizes the editor and every omni card 0→real, which
 * detonates the editor + per-card ResizeObservers into a wasted full measure
 * pass even though cached geometry is already correct. The re-show effect opens
 * this window so those reflow-storm triggers are swallowed; cached positions
 * render instantly. Short enough that a genuine post-switch resize re-measures
 * normally just after.
 */
const RESHOW_SUPPRESS_MS = 250;

/**
 * Degenerate-measure threshold. On a cold/un-laid-out editor `coordsAtPos`
 * reports anchors above the pod top, so the *pre-clamp* natural goes
 * strongly negative; the old `if (naturalTop < 0) naturalTop = 0` clamp
 * baked those into a top-stack. A legitimate all-top-anchored deck sits at
 * pre-clamp natural ≈ 0 (a few px negative at most), NOT well below this,
 * so the sign+magnitude distinguishes the two. Tuned conservative (one card
 * height) so a single near-top card never trips the guard. */
const DEGENERATE_NATURAL_PX = -DEFAULT_ENTRY_HEIGHT; // -60px
/** Min count of strongly-negative items required to call a measure
 *  degenerate. ≥2 distinct anchors landing well above the pod is the
 *  signature of an un-laid-out editor, not a real layout. */
const DEGENERATE_MIN_COUNT = 2;

/** A single item's raw (pre-clamp) measurement. `preClampTop` is the raw
 *  `coords.top - podRect.top` before the ≥0 clamp; the degeneracy guard
 *  reads it to decide whether the whole measure is trustworthy. */
interface RawMeasure {
  preClampTop: number;
  height: number;
  pos: number;
}

/**
 * Pure self-validation: is this freshly-read measure degenerate (taken
 * against an un-laid-out editor) rather than a real layout?
 *
 * A measure is degenerate when ≥`DEGENERATE_MIN_COUNT` items have a
 * pre-clamp natural top at or below `DEGENERATE_NATURAL_PX` (strongly
 * negative) AND their resolved `pos` values are spread across the doc
 * (so it's genuinely "many distinct anchors all reporting above the pod",
 * the un-laid-out signature, not a couple of co-located top cards). A
 * legitimate deck anchored at the very top of the document sits at
 * pre-clamp ≈ 0, never strongly negative, so it does NOT trip this.
 *
 * Caller only ACTS on a degenerate verdict when it already holds a good
 * cached measure to retain — there's no previous-good to keep on the very
 * first paint, so a first-paint degenerate still commits (and the settle
 * loop / font-ready ping corrects it), never leaving a permanently blank
 * column.
 */
export function isDegenerateMeasure(
  raws: ReadonlyArray<RawMeasure>,
): boolean {
  let negCount = 0;
  let minPos = Infinity;
  let maxPos = -Infinity;
  for (const r of raws) {
    if (r.preClampTop <= DEGENERATE_NATURAL_PX) {
      negCount += 1;
      if (r.pos < minPos) minPos = r.pos;
      if (r.pos > maxPos) maxPos = r.pos;
    }
  }
  if (negCount < DEGENERATE_MIN_COUNT) return false;
  // Pos-spread guard: the strongly-negative items must span distinct doc
  // anchors. (Co-located items can't both be legitimately far above the
  // pod once laid out; a spread of anchors all above the pod is the
  // un-laid-out fingerprint.)
  return maxPos > minPos;
}

/** A (doc pos → pod-relative top) reference point for the out-of-zone
 *  approximation. Knots are this pass's EXACT reads (in-band items) plus two
 *  exact endpoints: (0, editor-top-in-pod) and (docSize, editor-top +
 *  scrollHeight). Sorted by pos, tops monotone non-decreasing. */
export interface TopKnot {
  pos: number;
  top: number;
}

/**
 * Approximate the pod-relative top for an OUT-OF-ZONE item by linear
 * interpolation between the surrounding knots (wave-2b C5). Pure arithmetic —
 * this is what replaces the per-item `coordsAtPos` forced-layout read for
 * items far outside the scroll band, where block-height variance between
 * knots is invisible anyway. Both endpoints are exact (O(1) reads), so the
 * approximation is anchored at the document's real extent; the common
 * single-edit case shifts everything below the edit uniformly, which linear
 * interpolation between an exact in-band knot and the exact doc-end knot
 * reproduces closely. Items the user can SEE are never approximated — since
 * task 327 that is a structural guarantee rather than an assumption: band
 * membership is decided on the item's `pos` against the band's document
 * position range (`resolveVisiblePosBand`), so an approximation can never
 * disqualify itself from the exact read that would correct it. The
 * scroll-idle refinement re-runs the pass while approximated items exist, so
 * a jump-to-far-card settles exact.
 *
 * `knots` must be sorted by pos with ≥1 entry; out-of-range positions clamp
 * to the outermost knots.
 */
export function approxTopForPos(
  pos: number,
  knots: ReadonlyArray<TopKnot>,
): number {
  if (knots.length === 0) return 0;
  if (pos <= knots[0].pos) return knots[0].top;
  const last = knots[knots.length - 1];
  if (pos >= last.pos) return last.top;
  // Binary search for the upper surrounding knot.
  let lo = 0;
  let hi = knots.length - 1;
  while (lo + 1 < hi) {
    const mid = (lo + hi) >> 1;
    if (knots[mid].pos <= pos) lo = mid;
    else hi = mid;
  }
  const a = knots[lo];
  const b = knots[hi];
  if (b.pos === a.pos) return a.top;
  const t = (pos - a.pos) / (b.pos - a.pos);
  return a.top + t * (b.top - a.top);
}

const DEFAULT_ENTRY = (id: string) => linkCardIdSelector(id);

/** Optional pin: hold one card at a fixed OFFSET from its natural
 *  (anchor-derived) top. Cards AFTER the pinned card in source-anchor-order
 *  cascade off the pinned card's bottom; cards BEFORE cascade upward off the
 *  pinned card's top. Net effect: the deck reflows around the pin without
 *  overlap.
 *
 *  ANCHOR-RELATIVE, not pod-absolute (task 362). The pin's absolute Y is
 *  re-derived here, every measure, as `naturalTop + offset` — so a pinned
 *  card rides every document edit with its anchor, exactly as its margin
 *  marker does. Storing the absolute Y instead froze a derived answer: the
 *  anchor moved, the marker moved with it, and the card did not.
 *
 *  A pin whose card has no measured natural top is INERT (it names no row
 *  the cascade can place), which is also what happens when the anchor is
 *  deleted — the deck simply re-packs naturally. */
export interface Pinned {
  id: string;
  /** Pod-relative pixels from the card's natural top. Computed at publish
   *  time (`omni-card-placement.ts`) as `desiredPodTop - naturalTop`. */
  offset: number;
}

/** Per-item measurement consumed by the pure cascade resolver. */
export interface NaturalEntry {
  /** Pod-relative top from `coordsAtPos(pos).top - podRect.top`,
   *  clamped to 0 (negative values appear when an unanchored block sits
   *  above the pod). */
  naturalTop: number;
  /** Measured card height, or `DEFAULT_ENTRY_HEIGHT` if not yet rendered. */
  height: number;
}

/**
 * Pure-JS cascade resolver. Given measured natural positions + heights
 * and the current item list, returns a Map of final pod-relative Y
 * values. If `pinned` is set, the pinned card's position is forced to
 * `its natural top + pinned.offset` and the cascade reflows in both
 * directions to avoid overlap.
 *
 * This is the hot path on every pin change. NO DOM reads — operates
 * entirely on numbers measured separately.
 */
export function resolveCascade(
  natural: Map<string, NaturalEntry>,
  items: ReadonlyArray<PositionItem>,
  pinned: Pinned | null,
): Map<string, number> {
  if (items.length === 0 || natural.size === 0) return new Map();

  // The pin's absolute Y is DERIVED, here, from the natural top this pass
  // measured (task 362) — never carried. An unmeasured pinned card resolves
  // to null and the pin is inert, the same as a pin naming a card that is
  // no longer in the deck.
  const pinnedNatural = pinned ? natural.get(pinned.id) : undefined;
  const pinnedTop = pinned && pinnedNatural
    ? pinnedNatural.naturalTop + pinned.offset
    : null;

  // Build sorted list by natural top (so cascade-after is well-defined).
  // Skip items we haven't measured yet — they're not renderable.
  type Row = { id: string; top: number; height: number };
  const rows: Row[] = [];
  for (const it of items) {
    const nat = natural.get(it.id);
    if (!nat) continue;
    rows.push({ id: it.id, top: nat.naturalTop, height: nat.height });
  }
  rows.sort((a, b) => a.top - b.top);

  // Forward pass: push cards down to avoid overlap with their predecessor.
  // Apply the pin override mid-loop so cards AFTER the pinned one pack
  // below the pinned card's actual top, not below its natural top.
  for (let i = 0; i < rows.length; i++) {
    if (i > 0) {
      const prev = rows[i - 1];
      const minTop = prev.top + prev.height + MIN_GAP;
      if (rows[i].top < minTop) rows[i].top = minTop;
    }
    if (pinned && pinnedTop !== null && rows[i].id === pinned.id) {
      rows[i].top = pinnedTop;
    }
  }

  // Backward pass: when pinning moved the pinned card UP, cards anchored
  // BEFORE it can now overlap. Pull them upward (in source-anchor order,
  // bottom-up) until they clear. With `transform: translateY` positioning
  // this is essentially free; the deck stays symmetric around the pin
  // instead of overlapping on the upward side.
  if (pinnedTop !== null) {
    for (let i = rows.length - 1; i > 0; i--) {
      const cur = rows[i];
      const prev = rows[i - 1];
      const maxPrevTop = cur.top - prev.height - MIN_GAP;
      if (prev.top > maxPrevTop) prev.top = maxPrevTop;
    }
  }

  const map = new Map<string, number>();
  for (const r of rows) map.set(r.id, r.top);
  return map;
}

/**
 * Computes pod-relative Y positions for panel items so they align with
 * their corresponding paragraphs in the TipTap editor.
 *
 * Architecture: measurement and resolution are split.
 *
 *   1. **Measurement** (DOM-touching, slow): `coordsAtPos` per IN-BAND item
 *      and `getBoundingClientRect` per in-band card; out-of-band items are
 *      interpolated (`approxTopForPos`, zero DOM reads — wave-2b C5) and
 *      refined to exact on scroll idle. "In-band" is decided on the item's
 *      document POSITION against the band's pos range (task 327), never on
 *      the item's own previously-committed top. Writes a ref and bumps a
 *      version counter. Runs on editor content change, card-size change
 *      (ResizeObserver), window resize, or items-list change.
 *
 *   2. **Resolution** (pure JS, fast): cascade + optional pin override.
 *      Runs in `useMemo` on every render of the consumer. Pin changes
 *      flow through here in O(N) JS with no layout flush — that's the
 *      whole point: clicking a marker should not measure the DOM.
 *
 * Under the unified row scroll, the panel column and the editor column
 * share the same scroll source. Positions are computed pod-relative
 * (`coords.top - podRect.top`), which is scroll-invariant: both rects
 * shift by the same amount on natural scroll, so the cached map stays
 * correct without recompute.
 *
 * Returns:
 *   - `positions`: Map<id, topPx> in pod-relative coordinates. Render
 *     each card with `transform: translateY(${px}px)` inside a
 *     `position: relative` container of height `editorContentHeight`.
 *   - `editorContentHeight`: the editor view's natural DOM height, used
 *     to size the positioned region so the panel column extends through
 *     the document.
 *   - `panelScrollRef`: ref for the panel pod (the `position: relative`
 *     container hosting absolute children).
 */
export function useInTextPositions(
  editor: Editor | null,
  items: PositionItem[],
  enabledProp: boolean,
  entry: string | ((id: string) => string) = DEFAULT_ENTRY,
  pinned: Pinned | null = null,
  /**
   * Optional live-position resolver. `item.pos` is captured when the item
   * list is (re)built — which, post keystroke-sanctity refactor, happens
   * only on *structural* change, so it goes stale as plain typing shifts
   * later content. `measure()` runs on every reflow (editor ResizeObserver),
   * so resolving the live pos here — from the DocStructureObserver snapshot,
   * which is re-mapped every transaction — keeps cards from drifting on the
   * keystroke that wraps a line. Returns `undefined` to fall back to
   * `item.pos`. See `useStructuralRevisions` + `docs/perf/keystroke-sanctity-findings.md`.
   */
  resolvePos?: (id: string) => number | undefined,
) {
  // Keep-alive re-show invariant: "hidden is frozen, not torn down; re-show is a
  // REPUBLISH of cached geometry, not a re-measure — unless something provably
  // changed while hidden." A hidden (display:none) editor measures nothing —
  // coordsAtPos/getBoundingClientRect both return 0 — so while hidden we RETAIN
  // the last-good `naturalRef` (the doc got zero transactions and pod-relative
  // tops are scroll-invariant, so it stays correct). `enabled` is DECOUPLED from
  // visibility: `enabledProp` is the identity axis (genuinely-off panel ⇒ clear),
  // and `isVisible` is read LIVE via a ref so a hidden↔visible flip never
  // re-creates `measure`/re-runs the wiring effect by identity. The dirty-gate
  // (a structural bus event OR a container-WIDTH change while hidden) is the only
  // thing that opts a re-show back into a (bounded) re-measure. See
  // MEMO_INSTANT_SWITCH.md §4.
  const isVisible = useIsVisible();
  const isVisibleRef = useRef(isVisible);
  // Set only when a real invalidation occurs WHILE HIDDEN: a DocStructureBus
  // structural event (the existing onBlocksAdded/Removed subscription, gated on
  // !isVisible) or — detected on re-show — a container-width change. Consumed
  // (and reset) once per hidden→visible transition by the re-show effect.
  const dirtyWhileHiddenRef = useRef(false);
  // Editor content width at the last VISIBLE measure. A width change invalidates
  // pod-relative tops (wrap reflows anchors); height/scroll changes do not.
  const lastWidthRef = useRef(0);
  // On a re-show the display flip resizes the (display:none→flex) editor and every
  // omni card 0→real, which detonates the editor/per-card ResizeObservers — and
  // the switch's upstream re-renders can spuriously re-run the wiring effect's
  // measure() — into wasted full measure passes even though cached geometry is
  // already correct. The sync effect below opens this window on EVERY
  // hidden→visible flip so ALL measure paths are swallowed; the re-show effect
  // then adds back exactly ONE bounded measure iff the hook is dirty.
  const suppressMeasureUntilRef = useRef(0);
  // Set by the sync effect on a genuine hidden→visible flip; consumed by the
  // re-show effect (which runs later in the same commit, after the wiring effect).
  const reshowPendingRef = useRef(false);
  const [editorContentHeight, setEditorContentHeight] = useState(0);
  const panelScrollRef = useRef<HTMLDivElement>(null);
  const naturalRef = useRef<Map<string, NaturalEntry>>(new Map());
  // Last REAL card height per id, RETAINED across the ±NEAR_ZONE_PX viewport
  // gate so an out-of-zone pass reuses it instead of the 60px placeholder that
  // would pack the following card on top of it (the overlap-then-snap of task
  // 043). Card-side twin of task 041's `parked` (useMarginaliaRegistry.ts),
  // consumed via `retainedEntryHeight`.
  //
  // TWO writers, and the second is the AUTHORITY (task 490): the measure pass's
  // in-zone `getBoundingClientRect` SEEDS it, and the per-card ResizeObserver
  // (`noteObservedHeights`) keeps it CURRENT — because a height change is an
  // EVENT, and the observer is the thing that sees every one of them wherever
  // the card is. See `retainedEntryHeight`'s header for the hole that left:
  // a card that collapsed while its anchor was out of band kept its expanded
  // height forever, and the cascade reserved it.
  // Cleared only on genuine disable/empty (alongside `naturalRef`); pruned to
  // the live item set each measure.
  const realHeightRef = useRef<Map<string, number>>(new Map());
  // Ids whose committed naturalTop is an APPROXIMATION (out-of-zone item,
  // wave-2b C5) rather than an exact coordsAtPos read. Rebuilt per measure
  // pass; consumed by the scroll-idle refinement, which re-runs the pass
  // only while this is non-empty (a deck with everything exact costs a
  // scroll exactly one Set-size check).
  const approxIdsRef = useRef<Set<string>>(new Set());
  const [measureVersion, setMeasureVersion] = useState(0);
  // The ONE settle door (task 370). Every "the world may have moved" trigger —
  // cold mount, font-ready, the editor RO, the structural bus, the scroll-idle
  // refinement, a dirty keep-alive re-show — enters `request()`, and each gets
  // the SAME answer: keep measuring until two consecutive passes agree within
  // the task-328 hysteresis, or the wall-clock budget runs out. Created lazily
  // by the wiring effect (it needs `measureRef`), torn down with it.
  const convergeRef = useRef<ConvergenceController | null>(null);
  // `onFontReady` now returns a disposer (called in the effect cleanup), so a
  // fresh closure per effect run doesn't accumulate. This ref is the belt to
  // that suspenders: it lets an already-queued ping bail after unmount/disable
  // so a late `document.fonts.ready` never measures a torn-down editor.
  const fontReadyActiveRef = useRef(false);

  // A measure TRIGGER (RO/resize/settle/font-ready) AND the wiring effect's own
  // measure() may fire when measuring would be wrong or wasteful: while hidden
  // (coords read 0), or during the brief re-show suppression window. measure()
  // itself also bails when hidden; this gate additionally swallows the re-show
  // reflow storm. The DIRTY and COLD re-show paths do not have to dodge this
  // gate — they ZERO the window first (their verdict voids the window's own
  // premise) and then enter the shared convergence door like everything else.
  const canMeasureNow = useCallback(
    () =>
      isVisibleRef.current &&
      (typeof performance === "undefined" ||
        performance.now() >= suppressMeasureUntilRef.current),
    [],
  );

  // The gated trigger door. A trigger arriving while the pane is hidden, or
  // inside the re-show suppression window, is DROPPED — not deferred — and that
  // asymmetry with the pass-level gate is the whole of the keep-alive contract:
  //
  //  • A TRIGGER during the window is storm noise BY CONSTRUCTION. The window is
  //    only ever open on a re-show whose cached geometry is already correct (a
  //    DIRTY or COLD re-show zeroes it first), and the display flip resizes the
  //    editor and every card 0->real, so the editor RO and every per-card RO
  //    fire. Arming on those would make a CLEAN warm switch pay a settle it does
  //    not need — the instant-switch invariant, and a regression this task
  //    introduced and then took back out (adversarial review, measured against a
  //    browser-faithful observer: 6 coordsAtPos reads and 15 deferred spin passes
  //    where the contract says ZERO).
  //  • A PASS of an ALREADY-ARMED chain, by contrast, reports `deferred` and
  //    RETRIES. That chain has a reason to exist which predates the window, and
  //    killing it is exactly the pre-370 bug (`if (!canMeasureNow()) return;`
  //    with no reschedule, which one hidden or suppressed frame made permanent).
  //
  // Drop at the door, retry inside the pass.
  const requestSettle = useCallback(() => {
    if (!canMeasureNow()) return;
    convergeRef.current?.request();
  }, [canMeasureNow]);

  /**
   * Record what the per-card ResizeObserver just SAW (task 490).
   *
   * > **A retained measurement is invalidated by the EVENT that changes it,
   * > never by a proxy for the card's visibility.** The observer already fires
   * > on every height change, for every rendered card, wherever it sits; its
   * > entry already carries the new size, POST-layout, so reading it forces
   * > nothing. The near-zone gate exists to skip a FORCED layout read — there
   * > is no forced read here, so there is nothing to gate.
   *
   * Two rules the write earns:
   *
   *  - **A ZERO or non-finite size is not a measurement.** A `display:none`
   *    keep-alive pane reports 0×0 for every element, and a wrapper that has
   *    not painted yet reports 0 — writing either would corrupt the cache into
   *    exactly the "packed contiguously from the top" shape the hidden-pane
   *    bail in `measure()` exists to prevent. Skipping keeps the last good
   *    value, which is the retain-across-a-hide contract.
   *  - **BORDER box, to match the seed.** The measure pass writes
   *    `getBoundingClientRect().height` (a border box); `contentRect` is the
   *    CONTENT box. They coincide for the wrapper the omni renders (no padding,
   *    no border) — but two writers of one cache must not speak two boxes, so
   *    `borderBoxSize` is preferred and `contentRect` is the fallback for an
   *    implementation that does not publish it.
   *
   * The id is recovered from the SAME attribute the effect observes by, so this
   * is exact for the string form of `entry` (every production caller). A caller
   * that passes a selector FUNCTION cannot be inverted, so it keeps the
   * pre-490 behaviour — stated rather than silently approximated.
   */
  const noteObservedHeights = useCallback(
    (entries: ReadonlyArray<ResizeObserverEntry>) => {
      if (typeof entry !== "string") return;
      for (const e of entries) {
        const id = (e.target as HTMLElement).getAttribute(entry);
        if (!id) continue;
        const h = e.borderBoxSize?.[0]?.blockSize ?? e.contentRect?.height;
        if (typeof h !== "number" || !Number.isFinite(h) || h <= 0) continue;
        realHeightRef.current.set(id, h);
      }
    },
    [entry],
  );

  // Is the user typing into a card body inside THIS pod? Per-keystroke
  // sub-pixel height jitter (different glyph widths) would otherwise tick
  // `setMeasureVersion` and re-position every card, which reads as the typed
  // card "jumping" — worst in focus mode, where the cascade has too few items
  // to absorb one card's wobble.
  //
  // Hoisted to hook scope by task 370 so it gates EVERY pass, not just the
  // per-card ResizeObserver's. It is a `deferred`, never an `inert`: a cold
  // load that happens to coincide with card typing must still converge, so the
  // chain retries — and the `focusout` handler re-arms, which is what keeps a
  // long typing session from outliving the deadline and stranding a
  // half-settled deck.
  const isTypingInPanel = useCallback(() => {
    const panelEl = panelScrollRef.current;
    if (!panelEl || typeof document === "undefined") return false;
    const active = document.activeElement as HTMLElement | null;
    return !!(
      active &&
      panelEl.contains(active) &&
      active.getAttribute("contenteditable") === "true"
    );
  }, []);

  // Visibility flip detector — the FIRST effect to run on a flip (declared before
  // the wiring + re-show effects), so the suppression window is already open by
  // the time the wiring effect's measure() runs in the same commit.
  // useLayoutEffect (not passive): the long-lived observer/RAF closures must see
  // fresh visibility at commit, BEFORE the browser delivers the post-flip
  // ResizeObserver batch — otherwise a re-show measure could race a stale `false`.
  const syncWasVisibleRef = useRef(isVisible);
  useLayoutEffect(() => {
    const wasVisible = syncWasVisibleRef.current;
    syncWasVisibleRef.current = isVisible;
    isVisibleRef.current = isVisible;
    if (isVisible && !wasVisible) {
      // Genuine hidden→visible re-show: pre-emptively swallow the reflow storm
      // and any spurious wiring-effect re-run. The re-show effect (later this
      // commit) downgrades to a single bounded measure iff the hook is dirty.
      suppressMeasureUntilRef.current =
        (typeof performance !== "undefined" ? performance.now() : 0) +
        RESHOW_SUPPRESS_MS;
      reshowPendingRef.current = true;
    }
  }, [isVisible]);

  // Reports what the pass DID, so the convergence controller can fold verdicts
  // without knowing anything about geometry (task 370). Every early return
  // below is one of the four outcomes, and the distinction that matters is
  // `deferred` (could not honestly measure — RETRY) vs `inert` (nothing to
  // converge on — STOP): the pre-370 settle loop conflated "cannot measure this
  // frame" with "done", so a single hidden/suppressed frame killed the settle
  // permanently.
  const measure = useCallback((): MeasureOutcome => {
    // HIDDEN (but enabled): RETAIN the cached geometry — bail before any DOM read
    // (coordsAtPos/getBoundingClientRect return 0 under display:none, which would
    // corrupt naturalTop to 0 for every card). The doc received zero transactions
    // while hidden and pod-relative tops are scroll-invariant, so the retained
    // cache is still correct on re-show. This RETAINS (does not clear) so the
    // degeneracy guard below stays armed and the warm re-show never enters the
    // size-0 cold heal. DEFERRED, never inert: the cache is still live and the
    // deck still needs converging — the re-show effect is what re-arms.
    if (!isVisibleRef.current) return "deferred";
    // GENUINELY disabled or empty: clear (keyed on enabledProp, NOT visibility).
    if (!editor || !enabledProp || items.length === 0) {
      if (naturalRef.current.size > 0) {
        naturalRef.current = new Map();
        setMeasureVersion((v) => v + 1);
      }
      // Genuine disable/empty (NOT a hide — that returns above): drop the
      // retained heights alongside the naturals so a later re-enable measures
      // from truth rather than reusing stale geometry.
      realHeightRef.current.clear();
      setEditorContentHeight(0);
      // INERT: there is no deck to converge on. The controller terminates
      // rather than burning its deadline; a later item arrival re-arms through
      // the companion one-shot like any other trigger.
      return "inert";
    }

    const panelEl = panelScrollRef.current;
    // No pod yet (first commit ordering) — retry, don't declare victory.
    if (!panelEl) return "deferred";

    const podRect = panelEl.getBoundingClientRect();
    const editorDom = editor.view.dom as HTMLElement;
    // Read ONCE per pass and share: the band probes below and the deferred
    // branch's `editorTopInPod` all want it, and each read is a forced layout.
    const editorRect = editorDom.getBoundingClientRect();
    // Dirty-gate width baseline: record the content width at each visible measure.
    // A width change while hidden (window resize / panel toggle) re-wraps text and
    // moves anchors, so the re-show effect compares against this to decide dirty.
    // clientWidth reads layout without forcing a reflow beyond what follows.
    lastWidthRef.current = editorDom.clientWidth;
    const nextContentHeight = editorDom.scrollHeight;
    setEditorContentHeight((prev) =>
      prev === nextContentHeight ? prev : nextContentHeight,
    );

    // Viewport gate for per-card measurement: items whose paragraph
    // anchor sits far outside the visible scroll range get DEFAULT_ENTRY_HEIGHT
    // instead of a per-card `getBoundingClientRect`. The cascade resolver
    // still positions them so click/scroll-into-view works; we just
    // don't pay the layout-read cost for cards the user can't see.
    const scrollEl = findEditorScrollFor(editorDom);
    // The band twice over: the REAL visible edges (what the pos-band probes
    // ask about — they are on screen, which is what keeps the probe on the
    // browser's fast hit-test path) and the ±NEAR_ZONE_PX padded edges (the
    // px comparison for the per-card height read below, which measures
    // nothing and can name an off-screen Y freely).
    let visibleTop = -Infinity;
    let visibleBottom = Infinity;
    let viewTop = -Infinity;
    let viewBottom = Infinity;
    if (scrollEl) {
      const sr = scrollEl.getBoundingClientRect();
      visibleTop = sr.top;
      visibleBottom = sr.bottom;
      viewTop = sr.top - NEAR_ZONE_PX;
      viewBottom = sr.bottom + NEAR_ZONE_PX;
    }

    // ── Wave-2b C5: exact reads for the scroll band, arithmetic for the rest.
    // `coordsAtPos` is a forced-layout read, and pre-C5 it ran for EVERY item
    // every pass (only the card-rect read was culled) — O(items) layout reads
    // per RO fire on a doc whose card deck is mostly off-screen. Items are
    // CLASSIFIED against the band first: in-band (or never measured) → exact
    // read; out-of-band → deferred to an `approxTopForPos` interpolation over
    // this pass's exact knots. The scroll-idle refinement re-runs the pass
    // when approximated items exist, so an item scrolled into view settles to
    // exact.
    //
    // The classification is by POS, not by retained px (task 327). C5 shipped
    // it the other way — each already-measured item was judged by its own
    // retained pod-relative top — and that gate READS THE VALUE IT EXISTS TO
    // REFINE, which makes its error mode absorbing: an item whose retained top
    // is wrong by more than NEAR_ZONE_PX is classified out-of-band,
    // re-approximated from the same knots, and classified out AGAIN, forever.
    // The exact read that would correct the retained top is precisely what the
    // wrong retained top prevents. A cold prod open plants exactly that seed
    // (the first measure races FOUT / KaTeX / figure NodeViews and commits
    // compressed tops — see the degeneracy guard's "commit rather than render
    // a blank column" note — while a restored mid-doc scroll puts the viewport
    // far from the well-seeded region), so the lane rendered at wrong Ys with
    // never-measured placeholder heights and could never heal.
    //
    // Resolving the band to a POSITION range instead moves the comparison into
    // a space where our input is ground truth: `pos` is maintained by the
    // observer's mapping, never estimated. No output of this pass can
    // influence the next pass's eligibility, so the fixed point stops being
    // representable rather than merely unlikely.
    //
    // Cost: TWO `posAtCoords` probes per pass replace the per-item px compare.
    // They are handed the VISIBLE edges, not the padded ones — an off-screen
    // probe defeats the browser's hit-test and drops into ProseMirror's
    // doc-proportional rect scan, which would have quietly reinstated the
    // O(blocks) forced-layout cost C5 exists to remove. `resolveVisiblePosBand`
    // owns that rule (and the padding, converted to pos space), and fails OPEN
    // on anything it can't resolve.
    //
    // A never-measured item is still exact-read regardless of band (the C5
    // behaviour): "have I ever measured this?" is a fact about history, not a
    // derived geometry estimate, and it only ever WIDENS the exact set — so it
    // cannot re-introduce the absorbing state, while it keeps the cold pass
    // richly seeded with knots for everything that follows.
    // ── Hysteresis (task 328): the ONE place a card's rendered top is
    // decided is this commit, so it is the one place that can decide a
    // re-measure isn't worth showing. A pass that would move a card by less
    // than `REPOSITION_EPSILON_PX` — or resize it by less than
    // `HEIGHT_EPSILON_PX` — keeps the previously committed value, so
    // `changed` stays false, `measureVersion` doesn't bump, and the deck
    // doesn't re-render at all.
    //
    // This is what kills the per-scroll-pause "reset" (task 328, example 1):
    // the C5 scroll-idle refinement re-runs the pass on every 150ms scroll
    // pause while approximated items exist, and post-327 its corrections are
    // small — but small and visible are different things, and each one used
    // to commit. Height gets the tighter epsilon because it feeds the
    // cascade: every card packed below an unchanged card inherits its wobble.
    //
    // Comparing against the COMMITTED value (never the last measured one) is
    // what bounds the error at one epsilon instead of letting a slow real
    // drift integrate silently: five 3px moves in the same direction reach
    // 15px from the commit and commit.
    const committed = (
      id: string,
      naturalTop: number,
      height: number,
    ): NaturalEntry => {
      const prev = naturalRef.current.get(id);
      return {
        naturalTop: holdWithinEpsilon(prev?.naturalTop, naturalTop),
        height: holdWithinEpsilon(prev?.height, height, HEIGHT_EPSILON_PX),
      };
    };

    const band = resolveVisiblePosBand(
      editor.view,
      visibleTop,
      visibleBottom,
      NEAR_ZONE_PX,
      editorRect,
    );
    const next = new Map<string, NaturalEntry>();
    const raws: RawMeasure[] = [];
    const nextApprox = new Set<string>();
    type Resolved = { id: string; pos: number };
    const exactItems: Resolved[] = [];
    const deferredItems: Resolved[] = [];
    for (const item of items) {
      // Prefer the live snapshot pos (re-mapped every transaction) so cards
      // track their anchor as plain typing shifts content; fall back to the
      // captured pos for kinds the resolver doesn't cover.
      const livePos = resolvePos?.(item.id);
      const pos = Math.min(livePos ?? item.pos, editor.state.doc.content.size);
      if (
        naturalRef.current.has(item.id) &&
        (pos < band.start || pos > band.end)
      ) {
        deferredItems.push({ id: item.id, pos });
        continue;
      }
      exactItems.push({ id: item.id, pos });
    }

    const knots: TopKnot[] = [];
    for (const { id, pos } of exactItems) {
      let preClampTop: number;
      let coordsTop: number;
      try {
        const coords = editor.view.coordsAtPos(pos);
        coordsTop = coords.top;
        preClampTop = coords.top - podRect.top;
      } catch {
        continue; // skip items with invalid positions
      }

      // Read the live height ONLY when in-zone (the perf gate: out-of-zone
      // cards skip the getBoundingClientRect layout read). A real read is
      // RETAINED so any later out-of-zone pass reuses the truthful height
      // instead of the 60px placeholder — the card-side twin of 041's `parked`.
      const inViewport = coordsTop >= viewTop && coordsTop <= viewBottom;
      let measuredHeight: number | undefined;
      if (inViewport) {
        const selector =
          typeof entry === "string" ? `[${entry}="${id}"]` : entry(id);
        const el = panelEl.querySelector(selector) as HTMLElement | null;
        if (el) measuredHeight = el.getBoundingClientRect().height;
      }
      if (measuredHeight !== undefined)
        realHeightRef.current.set(id, measuredHeight);
      const height = retainedEntryHeight(
        measuredHeight,
        realHeightRef.current.get(id),
      );

      raws.push({ preClampTop, height, pos });
      knots.push({ pos, top: preClampTop });
      // The committed natural retains the historical ≥0 clamp (negative
      // values legitimately appear when an unanchored block sits just above
      // the pod). The degeneracy guard below — which reads the *pre-clamp*
      // values in `raws` — is what protects against baking a top-stack from
      // an un-laid-out editor.
      //
      // …and then HYSTERESIS (task 328): a pass that would move this card by
      // less than the epsilon keeps the committed value. The knots above are
      // deliberately fed the RAW read — the interpolation is arithmetic about
      // the document, not about what the deck currently shows.
      next.set(id, committed(id, preClampTop < 0 ? 0 : preClampTop, height));
    }

    // Approximate the deferred (out-of-band) items — zero DOM reads. The two
    // endpoint knots are EXACT O(1) reads: the editor's top edge in pod
    // coordinates, and that edge plus the content height already read above.
    if (deferredItems.length > 0) {
      const editorTopInPod = editorRect.top - podRect.top;
      knots.push({ pos: 0, top: editorTopInPod });
      knots.push({
        pos: editor.state.doc.content.size,
        top: editorTopInPod + nextContentHeight,
      });
      knots.sort((a, b) => a.pos - b.pos);
      // Monotone tops: interpolation must never invert document order (a
      // footnote atom's line box can read above its neighbor's).
      for (let i = 1; i < knots.length; i++) {
        if (knots[i].top < knots[i - 1].top) knots[i].top = knots[i - 1].top;
      }
      for (const { id, pos } of deferredItems) {
        const approx = approxTopForPos(pos, knots);
        nextApprox.add(id);
        next.set(
          id,
          committed(
            id,
            approx < 0 ? 0 : approx,
            // Out-of-band by construction — the retained real height (or the
            // placeholder for a never-measured card), exactly as before.
            retainedEntryHeight(undefined, realHeightRef.current.get(id)),
          ),
        );
      }
    }
    approxIdsRef.current = nextApprox;

    // Self-validation (Part B): if this measure is degenerate — many
    // distinct anchors reporting strongly above the pod, the signature of
    // an editor that hasn't reached final layout — DON'T overwrite the
    // previously-cached good naturals with clamped-to-0 garbage (which the
    // cascade would spread into a top-stack). Retain the last good positions
    // and let the settle loop / font-ready ping re-measure once layout is
    // final. Only enforced when we HAVE a previous-good measure to keep; on
    // the very first paint there's nothing to retain, so we still commit
    // (the settle loop then corrects it) rather than render a blank column.
    if (naturalRef.current.size > 0 && isDegenerateMeasure(raws)) {
      // The pass REJECTED ITSELF, so it is evidence of nothing — emphatically
      // not agreement. Keep converging: this is the cold-start frame the loop
      // exists for, and the pre-370 code's "one stable scrollHeight" could and
      // did fire while these were still arriving.
      return "deferred";
    }

    // Bound the retained-height cache to the live item set: a card removed from
    // the list drops its cached height (reuse is O(cards), so the cache stays
    // ~item-sized even on a churny ~500-card doc). Only when it has grown past
    // the item count, so a steady-state deck pays nothing.
    if (realHeightRef.current.size > items.length) {
      const live = new Set(items.map((it) => it.id));
      for (const id of realHeightRef.current.keys()) {
        if (!live.has(id)) realHeightRef.current.delete(id);
      }
    }

    // Only bump measureVersion if measurements *actually* changed.
    // Otherwise we feed back into the ResizeObserver and re-render loop:
    // setState → commit → RO fires (the new wrapper transforms tickle
    // layout) → schedule → measure → setState → … 60 fps.
    let changed = next.size !== naturalRef.current.size;
    if (!changed) {
      for (const [id, entry] of next) {
        const prev = naturalRef.current.get(id);
        if (!prev || prev.naturalTop !== entry.naturalTop || prev.height !== entry.height) {
          changed = true;
          break;
        }
      }
    }
    naturalRef.current = next;
    if (changed) setMeasureVersion((v) => v + 1);
    // THE CONVERGENCE OBSERVATION. `changed` is already the task-328 epsilon
    // comparison (every value above went through `committed()`, which holds a
    // sub-epsilon move at its previously committed value), so "this pass agrees
    // with the last one within the hysteresis" needs no second rule — it is
    // exactly `!changed`.
    return changed ? "changed" : "stable";
  }, [editor, items, enabledProp, entry, resolvePos]);

  // Trigger measurement on editor updates, viewport resize, editor
  // content-height changes, and on the next paint after items change.
  // useLayoutEffect so the first measure runs synchronously after commit;
  // setMeasureVersion schedules a re-render that picks up the new natural
  // data via the useMemo below.
  // The wiring below must NOT re-arm when `measure` gets a new identity (it
  // closes over `items`/`resolvePos`, so every card add/remove/reorder mints
  // one). Pre-wave-2 the wiring effect had `measure` in its deps, so an items
  // rebuild tore down and re-armed EVERYTHING — including the ~30-frame
  // settle loop, whose per-frame re-measures are O(cards) `coordsAtPos`: the
  // diagnosis's S4 "settle loop re-arms on items identity churn" storm. The
  // long-lived closures read the latest measure through this ref instead;
  // the small companion effect after the wiring keeps the one-shot
  // "items changed → re-measure once" behavior.
  const measureRef = useRef(measure);
  useLayoutEffect(() => {
    measureRef.current = measure;
  }, [measure]);

  useLayoutEffect(() => {
    // Keyed on `enabledProp` (NOT visibility, NOT `measure`): a
    // hidden↔visible flip or an items rebuild no longer tears down / re-arms
    // this wiring, and the cache is RETAINED across a hide (cleared only on
    // a genuine disable). Re-show is handled by the dedicated visibility
    // effect below; items changes by the companion one-shot effect.
    if (!enabledProp) {
      if (naturalRef.current.size > 0) {
        naturalRef.current = new Map();
        setMeasureVersion((v) => v + 1);
      }
      realHeightRef.current.clear();
      return;
    }

    if (!editor) return;

    // Every geometry trigger enters the ONE door (task 370). Pre-370 this fired
    // a single rAF-coalesced pass — right only when one pass is enough, which
    // is exactly what a cold load, a font swap and a late NodeView mount all
    // falsify. `request()` costs the same per fire (a re-arm never enqueues a
    // second pass; one pending pass is the whole rate limit), and adds only the
    // trailing CONFIRMATION passes — idle-paced, bounded at two by the fixed
    // point.
    //
    // The hidden/suppressed gate moves INSIDE the controller's measure closure
    // above, so a trigger that arrives while suppressed is deferred-and-retried
    // instead of dropped on the floor.
    const schedule = () => {
      requestSettle();
    };

    // Part A — settle by CONVERGENCE (task 370). The initial `measure()` races
    // async layout: web fonts swap (FOUT) and React NodeViews (KaTeX math,
    // expex examples, figures/images) mount and size AFTER first paint, moving
    // every line. `coordsAtPos` read before that returns tops that are too
    // small → the cascade packs every card sequentially from the top at MIN_GAP.
    //
    // Pre-370 this was healed by a rAF loop that terminated on ONE stable
    // editor `scrollHeight` — a proxy for the wrong quantity (inner layout
    // moves within an unchanged total; an absolutely-positioned lane never
    // touches it) — after which NOTHING re-measured until the user scrolled.
    // The loop is now the shared controller, whose termination rule is the
    // consumer's own fixed point: two consecutive passes that commit nothing
    // past the hysteresis. See `settle-convergence.ts` for the criterion, the
    // rAF→idle ramp, the wall-clock cap and the per-trigger cost argument.
    //
    // Neither this nor A.2 is an editor update/transaction subscriber, so both
    // stay OFF the keystroke path.
    const converge = createConvergenceController(() => {
      // The hook's POLICY layer sits here, not in the controller.
      //  • HIDDEN ⇒ park the chain (`inert`). A hidden pane measures zeros, and
      //    the re-show effect below is what re-arms — spinning the deadline out
      //    against a `display:none` pane buys nothing.
      //  • SUPPRESSED (the RESHOW_SUPPRESS_MS window) ⇒ `deferred`, so the pass
      //    is DELAYED and retried rather than swallowed. That lets the window
      //    keep doing its job (absorbing the display-flip reflow storm) without
      //    ever eating a genuinely-needed convergence pass — it simply re-tries
      //    until the window closes (and the DIRTY re-show closes it early,
      //    because a dirty verdict voids the window's own premise).
      //  • TYPING into a card body in this pod ⇒ `deferred`, the hoisted gate.
      if (!isVisibleRef.current) return "inert";
      if (!canMeasureNow()) return "deferred";
      if (isTypingInPanel()) return "deferred";
      return measureRef.current();
    });
    convergeRef.current = converge;
    // Cold mount: arm it. `schedule()` below and every other trigger re-enter
    // the same door rather than firing a lone pass.
    converge.request();

    // A.2 — FOUT corrector. When web fonts swap in, every line shifts; the
    // metrics module clears its own caches on `document.fonts.ready` and we
    // re-measure so the deck snaps to the corrected coordinates. `onFontReady`
    // returns a disposer (called in cleanup below); the mounted ref additionally
    // guards an already-queued ping.
    //
    // `onFontReady` is a one-shot module-global that arms
    // `document.fonts.ready.then(...)` ONCE (see text-metrics.ts ~:221). Any
    // mount that happens AFTER fonts have already resolved registers a callback
    // that NEVER fires. That residual gap is harmless: the A.1 settle loop above
    // runs unconditionally on every run of THIS effect (regardless of font-ready
    // state), so whenever this effect runs it re-measures once layout settles.
    //
    // KEEP-ALIVE RE-SHOW (display:none→show without remount) is NO LONGER handled
    // by this effect re-running. `enabled` is decoupled from visibility, so this
    // wiring effect does not re-run on a flip, the cache is RETAINED across the
    // hide, and the dedicated `[isVisible]` re-show effect below decides: a CLEAN
    // re-show republishes cached geometry (zero coordsAtPos, zero settle — which
    // is why the trigger door DROPS the flip's reflow storm rather than deferring
    // it); a DIRTY or COLD re-show enters the convergence door, deferred off the
    // flip. The chain armed here is the COLD-MOUNT arm; since task 370 it is not
    // the only one, because every trigger enters the same door.
    // Locked by `useInTextPositions-visibility-remeasure.test.tsx`.
    // (LIVE-FSA OWED: jsdom can't lay out, so the real hidden→show layout settle —
    // fonts/KaTeX/expex reflow — must still be feel-checked in a real browser
    // against the L2 paper↔Library bounce.)
    fontReadyActiveRef.current = true;
    const disposeFontReady = onFontReady(() => {
      if (fontReadyActiveRef.current) schedule();
    });
    // Card positions are anchored to PM coords. Subscribe to the
    // DocStructureObserver: structural changes (block add/remove) are
    // when card mappings might shift. Pure text edits don't move
    // cards; the editor DOM's ResizeObserver below covers any
    // wrap-induced reflow that would shift Y coords.
    //
    // DIRTY-GATE (keystroke-safe): these are the SAME emitCount-gated channels
    // already used here (no new subscriber). When the editor is HIDDEN, a
    // structural change can't be measured (coords read 0) — instead mark the
    // hook dirty so the re-show effect re-measures once. When visible, behave
    // exactly as before (schedule a re-measure). A plain keystroke in the
    // VISIBLE editor fires no onBlocks* event (content-only diff), so this never
    // runs on the keystroke path and `emitCount` stays flat.
    const onStructural = () => {
      if (!isVisibleRef.current) {
        dirtyWhileHiddenRef.current = true;
        return;
      }
      schedule();
    };
    const bus = getBus(editor);
    const unsubBlocks = bus
      ? (() => {
          const u1 = bus.onBlocksAdded(onStructural);
          const u2 = bus.onBlocksRemoved(onStructural);
          return () => {
            u1();
            u2();
          };
        })()
      : null;

    // The in-text deck re-measures every tracked marker position — parked for
    // the duration of a continuous layout gesture and settled once at the end
    // (task 317). Both geometry triggers go through it; the structural-bus and
    // font-ready paths stay live (they aren't gesture-driven).
    const geometryPark = parkDuringLayoutGesture(
      schedule,
      LAYOUT_SITE_IN_TEXT_POSITIONS,
    );
    const onWindowResize = () => geometryPark.fire();
    window.addEventListener("resize", onWindowResize);

    let editorObs: ResizeObserver | null = null;
    try {
      const editorDom = editor.view?.dom as HTMLElement | undefined;
      if (editorDom && typeof ResizeObserver !== "undefined") {
        editorObs = new ResizeObserver(() => {
          recordKeystrokeWork(KEYSTROKE_WORK_INTEXT_RO);
          geometryPark.fire();
        });
        editorObs.observe(editorDom);
      }
    } catch {
      // ignore
    }

    // Scroll-idle refinement (wave-2b C5): approximated (out-of-band) tops are
    // good enough while off-screen, but a jump-to-far-card must SETTLE to
    // exact once the scroll lands — and nothing else re-measures on scroll
    // (pod-relative tops are scroll-invariant, so the hook deliberately has no
    // per-frame scroll path). Debounced to scroll IDLE, and a no-op unless
    // approximated items exist — a fully-exact deck pays one Set-size check
    // per idle edge, never a measure. Skipped while a layout gesture is live
    // (drag auto-scroll); the gesture's own end-edge settle re-measures.
    const scrollEl = findEditorScrollFor(editor.view?.dom as HTMLElement | undefined);
    let scrollIdleTimer: number | null = null;
    const SCROLL_REFINE_IDLE_MS = 150;
    const onScrollForRefine = () => {
      if (scrollIdleTimer !== null) window.clearTimeout(scrollIdleTimer);
      scrollIdleTimer = window.setTimeout(() => {
        scrollIdleTimer = null;
        if (approxIdsRef.current.size === 0) return;
        if (isLayoutGestureActive()) return;
        schedule();
      }, SCROLL_REFINE_IDLE_MS);
    };
    scrollEl?.addEventListener("scroll", onScrollForRefine, { passive: true });

    return () => {
      converge.stop();
      convergeRef.current = null;
      fontReadyActiveRef.current = false;
      disposeFontReady();
      unsubBlocks?.();
      window.removeEventListener("resize", onWindowResize);
      geometryPark.dispose();
      editorObs?.disconnect();
      if (scrollIdleTimer !== null) window.clearTimeout(scrollIdleTimer);
      scrollEl?.removeEventListener("scroll", onScrollForRefine);
    };
  }, [editor, enabledProp, canMeasureNow, isTypingInPanel, requestSettle]);

  // Companion one-shot: an items/resolvePos rebuild (fresh `measure`
  // identity) re-measures ONCE — the behavior the wiring effect's re-run
  // used to provide, without the teardown/re-arm (settle loop, observers,
  // park) that came with it.
  useLayoutEffect(() => {
    if (!enabledProp) return;
    if (canMeasureNow()) {
      measure();
      convergeRef.current?.request();
      return;
    }
    // Couldn't measure. If that is because the pane is HIDDEN, the deck just
    // gained (or lost) cards that were never measured and never observed by the
    // per-card ResizeObserver — so the cached geometry is NOT a faithful
    // republish and the re-show must not take its CLEAN branch. Pre-370 this
    // case had no marker at all and the new cards simply never got positions
    // until some unrelated trigger happened by.
    if (!isVisibleRef.current) dirtyWhileHiddenRef.current = true;
  }, [measure, enabledProp, canMeasureNow]);

  // Keep-alive re-show effect — the heart of the instant-switch fix. Fires ONLY
  // on a genuine hidden→visible transition (a tab switch back to this doc), never
  // on mount or an editor/enabledProp change. Three outcomes:
  //   • CLEAN  ⇒ the cached `naturalRef` is still correct (doc unchanged, tops are
  //     scroll-invariant). Do NOTHING but open a brief suppression window so the
  //     display-flip reflow storm (editor + per-card ResizeObservers firing
  //     0→real) doesn't detonate a wasted full measure. Cards render at cached
  //     positions instantly — zero coordsAtPos, zero settle.
  //   • DIRTY  ⇒ a structural change happened while hidden, the item set was
  //     rebuilt while hidden, OR the container width changed (re-wrap). CONVERGE,
  //     deferred off the visible flip via requestLowPriority so no long task
  //     blocks the transition. Not "one bounded re-measure" any more: one pass is
  //     right only when one pass is enough, and a re-wrap is the same async
  //     settle a cold mount has. The degeneracy guard is armed (cache retained ⇒
  //     size>0), so a transient bad read can't corrupt the deck.
  //   • COLD   ⇒ never measured yet (size 0): the wiring effect's convergence
  //     chain owns the first open — but that chain PARKS (`inert`) while the
  //     pane is hidden, and the wiring effect does NOT re-run on a flip. So a
  //     pane that mounted hidden would otherwise have no settler at all once
  //     shown. Re-arm here (task 370). Pre-370 the same shape was worse than a
  //     park: the settle step did `if (!canMeasureNow()) return;` with no
  //     reschedule, so ONE hidden or suppressed frame killed the settle
  //     permanently and nothing re-measured until the user scrolled.
  // KEYSTROKE SANCTITY: fires on visibility transitions only — never per
  // transaction, no new editor.on/bus subscriber. `emitCount` stays flat.
  useLayoutEffect(() => {
    if (!reshowPendingRef.current) return; // only a genuine hidden→visible flip
    reshowPendingRef.current = false;
    if (!enabledProp || !editor) return;
    if (naturalRef.current.size === 0) {
      // COLD: nothing cached to republish, so the suppression window is
      // protecting nothing — a measure here cannot be "wasted". Void it and
      // converge, for the same reason the DIRTY branch does.
      suppressMeasureUntilRef.current = 0;
      convergeRef.current?.request();
      return;
    }

    const editorDom = editor.view?.dom as HTMLElement | undefined;
    const widthChanged =
      !!editorDom &&
      lastWidthRef.current !== 0 &&
      editorDom.clientWidth !== lastWidthRef.current;
    const dirty = dirtyWhileHiddenRef.current || widthChanged;
    dirtyWhileHiddenRef.current = false;

    // CLEAN: the cached deck is still correct (the doc took zero transactions
    // and pod-relative tops are scroll-invariant), so we do NOT re-enter
    // convergence — the dirty-gate is the whole permission. The suppression
    // window opened by the sync effect swallows the display-flip reflow storm
    // meanwhile, and since no chain is armed there is nothing for it to defer.
    if (!dirty) return;

    // DIRTY: converge, deferred off the critical flip. Two interactions worth
    // stating, because they used to be in tension:
    //
    //  • It is NOT "exactly one bounded re-measure" any more. One pass was only
    //    ever right when one pass was enough, and a re-show whose width changed
    //    re-wraps every paragraph — the same async settle a cold mount has.
    //
    //  • THE SUPPRESSION WINDOW IS CLOSED HERE, and that is a rule rather than
    //    a workaround. The window exists to protect a CLEAN re-show's cached
    //    geometry from the display-flip reflow storm; a DIRTY verdict is
    //    precisely the evidence that its premise ("the cache is already
    //    correct") is false. Waiting it out instead would have deferred the
    //    correction by RESHOW_SUPPRESS_MS — worse than pre-370, which dodged
    //    the window by calling `measure()` directly.
    //
    //    Closing it does NOT re-admit the storm's cost: the storm's triggers
    //    all enter `request()`, which coalesces to ONE pending pass however
    //    many observers fire. And it is closed inside the deferred callback,
    //    not at flip time, so the storm is still swallowed for the duration of
    //    the deferral and only the deliberate convergence runs.
    return requestLowPriority(() => {
      suppressMeasureUntilRef.current = 0;
      convergeRef.current?.request();
    });
  }, [editor, enabledProp, isVisible]);

  // Observe card-size changes (e.g. bibliography pod expanding) so the
  // cascade reflows correctly. Dep on `measureVersion` so we re-observe
  // whenever cards mount/unmount.
  //
  // Important: skip the recompute while the user is actively typing into
  // a card editor inside this panel. Per-keystroke sub-pixel height jitter
  // (different glyph widths) would otherwise tick `setMeasureVersion` and
  // re-position every card every frame — visually the typed card "jumps"
  // as the cascade reflows, which the user perceives as carriage-return
  // behavior in the edit view. The effect is especially visible in focus
  // mode where the cascade has few items and a single card's wobble isn't
  // absorbed by neighbors. That gate is now `isTypingInPanel` at hook scope,
  // read by EVERY pass inside the controller's measure closure (task 370) — so
  // a font-ready ping or a structural event during card typing can no longer
  // walk around it either. On blur the focusout handler re-arms convergence, so
  // positions snap to truth (and a typing session that outran the deadline gets
  // a fresh budget rather than a stranded deck).
  useEffect(() => {
    if (!enabledProp) return;
    const panelEl = panelScrollRef.current;
    if (!panelEl || typeof ResizeObserver === "undefined") return;
    // Both enter the ONE convergence door (task 370) rather than firing a lone
    // rAF pass. A card whose body mounts late (a KaTeX-bearing note, an image)
    // resizes ONCE and then settles over several frames — precisely the shape a
    // single pass gets wrong. The hidden / suppression / typing gates all live
    // in the controller's measure closure now, so these are bare requests; the
    // controller coalesces a resize storm to one pending pass.
    const onResize = (entries: ResizeObserverEntry[]) => {
      // BOOKKEEPING FIRST, ALWAYS — then the (gated) measurement. This is the
      // geometry service's own rule, one lane over (AGENTS.md "The scroll
      // half": *defer the MEASUREMENT, never the BOOKKEEPING*). Every gate
      // below `requestSettle` (hidden pane, the re-show suppression window,
      // typing in a card body, the degeneracy guard, the convergence budget)
      // can make this pass commit nothing; none of them is a reason to forget
      // WHAT THE OBSERVER JUST SAW. Recording here is what makes the retained
      // height a live fact rather than a memory of the last time the ANCHOR
      // happened to be on screen (task 490).
      noteObservedHeights(entries);
      requestSettle();
    };
    const onFocusOut = () => {
      // No manual frame defer needed: the controller's first pass is already
      // rAF/idle-scheduled, so `activeElement` has settled by the time the
      // typing gate reads it.
      requestSettle();
    };
    const obs = new ResizeObserver(onResize);
    const bareAttr = typeof entry === "string" ? entry : DATA_LINK_CARD;
    panelEl.querySelectorAll(`[${bareAttr}]`).forEach((el) => obs.observe(el));
    panelEl.addEventListener("focusout", onFocusOut);
    return () => {
      obs.disconnect();
      panelEl.removeEventListener("focusout", onFocusOut);
    };
  }, [measureVersion, enabledProp, entry, requestSettle, noteObservedHeights]);

  // Pure-JS resolution. On a pin change, this is the ONLY thing that
  // re-runs — no DOM reads, no layout flush, no second commit.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const positions = useMemo(
    () => resolveCascade(naturalRef.current, items, pinned),
    [measureVersion, items, pinned],
  );

  // Exposed because a pin is stored ANCHOR-RELATIVE (task 362) and the
  // publish site therefore needs the card's natural top; the pod hands it on
  // through `data-omni-natural-top`.
  //
  // Keyed on `measureVersion` alone — a NARROWER dep list than `positions`
  // (which also depends on `items` and `pinned`), because neither of those
  // can change a natural. The invariant the wrapper's render relies on
  // (`positions.get(id) !== undefined ⇒ naturals.get(id) !== undefined`)
  // therefore does NOT rest on the two memos sharing a trigger; it rests on
  // `measure()` being the only writer of `naturalRef` and bumping the
  // version whenever it commits a change — so a pass held by hysteresis
  // republishes nothing, which is correct, and any pass that ADDS an entry
  // bumps. Worth writing down: widen either memo's deps and this argument,
  // not a dep-list equality, is what has to keep holding.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const naturals = useMemo(
    () => naturalRef.current as ReadonlyMap<string, NaturalEntry>,
    [measureVersion],
  );

  return { positions, naturals, editorContentHeight, panelScrollRef };
}
