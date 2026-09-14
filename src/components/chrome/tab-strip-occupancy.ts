"use client";

/**
 * Tab-strip occupancy — the ONE ladder for a crowded tab strip, shared by
 * BOTH strips (task 561, Gabriel's decision on the fork task 395 left open):
 *
 *   - the OUTER Virgil-bar strip (src/components/editor-layout/TabStrip.tsx),
 *   - the INNER Library panel strip
 *     (library/components/panel-tabs/PanelTabStrip.tsx).
 *
 * The geometry SSOT beside this file (folder-tab-geometry.ts) owns the tab's
 * SILHOUETTE; this module owns what a strip does when its tabs do not fit:
 *
 *   1. COMPRESS — inactive tabs share the width (`flex-shrink`, weighted by
 *      their natural width so long names give first) and their LABELS
 *      ellipsize down to {@link INACTIVE_MIN_LABEL_PX}; the ACTIVE tab is
 *      `shrink-0` and RESISTS, holding its name to the variant's own reserved
 *      floor (`FOLDER_TAB_VARIANTS[v].activeMinContent`).
 *   2. SCROLL — past the floors the strip scrolls horizontally (a native
 *      `overflow-x: auto` scroller with its scrollbar hidden; a vertical wheel
 *      over the strip is mapped onto it, {@link wheelToStripScroll}), and the
 *      ACTIVE tab is always nudged fully into view by the minimum
 *      `scrollLeft` delta ({@link nudgeTabIntoView}) — on activation, on open,
 *      on a neighbour's close, and when the strip itself resizes.
 *
 * Before this the INNER strip had the whole ladder as "F#15" and the OUTER
 * strip had none of it: every tab `shrink-0`, the row `width: max-content`,
 * and a hard `overflow-x: clip` that simply lost the rightmost tabs with
 * nothing on screen to say they existed. `ACTIVE_MIN_CONTENT` sat in the
 * shared geometry module and was read by ONE strip while the other
 * hand-wrote a different floor (`minWidth: 80`), and `INACTIVE_MIN_CONTENT`
 * was private to the inner strip — a shared SSOT with one consumer, which is
 * this repo's recurring "half-consolidated" shape.
 *
 * ── Why the floor is on the LABEL, not the tab ────────────────────────────
 * The inner strip's floor was a tab-level `minWidth: 60`, which is chrome-
 * BLIND: a tab with a pin, a menu and a close button has 62px of fixed chrome,
 * so at the floor its content overflowed the tab. A floor on the label's
 * `min-width` composes with whatever chrome the tab carries — the tab's
 * automatic flex minimum is then `fixed chrome + INACTIVE_MIN_LABEL_PX` by
 * construction. The value reproduces the plain closable inner tab's old floor
 * byte-for-byte (60 − 40px of chrome = 20), so nothing shipped moves.
 *
 * ── Keystroke sanctity ────────────────────────────────────────────────────
 * Nothing here subscribes to the editor. The ONE ResizeObserver
 * ({@link useTabStripScroller}) observes the strip's own scroller box, is
 * RAF-coalesced behind a width-equality bail, and is PARKED on the
 * layout-gesture bus (settles once on the end edge). The wheel listener is
 * element-scoped and O(1). Typing leaves `__virgilBusStats().emitCount` flat.
 */

import { useEffect, useLayoutEffect, useRef, type CSSProperties, type RefObject } from "react";
import { parkDuringLayoutGesture } from "@/lib/pane-resize";
import { TAB_LABEL_MAX_PX } from "./folder-tab-geometry";

/**
 * The INACTIVE-tab floor, on the LABEL: an inactive tab's name never
 * ellipsizes below this many px before the strip starts to scroll. The tab's
 * own floor is derived — its fixed chrome (padding, icon, close/menu/pin
 * buttons) plus this — so it composes with every tab shape without a per-shape
 * number.
 */
export const INACTIVE_MIN_LABEL_PX = 20;

/**
 * The label's `min-width` value: the floor, but never WIDER than the name
 * itself — a two-letter tab is not padded out to the floor, so the roomy
 * layout is byte-identical to the pre-561 one and the inline↔folder
 * pixel-stability contract holds for short names too. `calc-size()` is
 * Chromium 129+; Virgil is Chromium-only (FSA), and the folder tab's own
 * width already rides it.
 */
export const TAB_LABEL_FLOOR_MIN_WIDTH = `calc-size(max-content, min(size, ${INACTIVE_MIN_LABEL_PX}px))`;

/**
 * The attribute every tab LABEL span carries, so the bar's occupancy
 * measurement ({@link tabRowNaturalWidth}) can find the labels a compression
 * has ellipsized without knowing either strip's markup.
 */
export const TAB_LABEL_ATTR = "data-tab-label";

/** Spread onto every tab label span (both strips, active and inactive). */
export const TAB_LABEL_ATTRS = { [TAB_LABEL_ATTR]: "" } as const;

/**
 * Style for an INACTIVE tab's label: the compression floor. The label must
 * also be `overflow: hidden` + `text-overflow: ellipsis` + `white-space:
 * nowrap` (Tailwind `truncate`, or the inner strip's inline triple) and must
 * NOT declare `min-width: 0`, or the floor is gone.
 */
export const INACTIVE_TAB_LABEL_STYLE: CSSProperties = {
  minWidth: TAB_LABEL_FLOOR_MIN_WIDTH,
};

/**
 * The scroll axis of a tab strip's SCROLLER box. `overflow-y` is stated
 * EXPLICITLY as `hidden`: per CSS Overflow 3, `auto` on one axis coerces a
 * `visible` other axis to `auto`, and an unstated vertical axis would then
 * grow a (hidden but real) 1px vertical scroll range from the active tab's
 * seam overhang. `hidden` keeps the axis a clip — and the overhang is kept
 * INSIDE that clip by {@link TAB_STRIP_SEAM_PADDING}, never by leaving the
 * axis visible.
 */
export const TAB_STRIP_SCROLLER_STYLE: CSSProperties = {
  overflowX: "auto",
  overflowY: "hidden",
  // The scrollbar is chrome the strip does not want: Chrome/Safari-style bare
  // scrolling (Gabriel's reference), same treatment the inner strip shipped.
  scrollbarWidth: "none",
};

/**
 * The seam trick, stated once: the active folder tab hangs
 * `FOLDER_TAB_SEAM_OVERLAP` (1px) BELOW the strip so its open-bottom
 * silhouette merges into the canvas/body. Inside a scroll container that
 * overhang would be scrollable overflow and the clip would eat it. A 1px
 * bottom PADDING keeps the overhang inside the scroller's padding box (which
 * a clip never touches), and the matching −1px margin keeps the strip's outer
 * footprint unchanged. The inner strip has carried this pair since task 324;
 * the outer strip takes the same pair now that it scrolls.
 */
export function tabStripSeamPadding(seamOverlapPx: number): CSSProperties {
  return { paddingBottom: seamOverlapPx, marginBottom: -seamOverlapPx };
}

// ── Scroll primitives ───────────────────────────────────────────────────────

/**
 * Scroll `tab` fully into `scroller`'s view by the MINIMUM `scrollLeft` delta
 * — never `el.scrollIntoView()`, which centres/over-scrolls, scrolls every
 * ANCESTOR too, and races any smooth scroll in flight (AGENTS.md → "Refocus is
 * not navigation"). Instant, not smooth: a second programmatic scroll landing
 * during a smooth one is the double-scroll shape that section records.
 *
 * Returns the delta applied (0 when the tab was already in view, or when the
 * strip does not overflow at all).
 */
export function nudgeTabIntoView(scroller: HTMLElement, tab: HTMLElement): number {
  if (scroller.scrollWidth <= scroller.clientWidth) return 0; // nothing to scroll
  const s = scroller.getBoundingClientRect();
  const t = tab.getBoundingClientRect();
  let delta = 0;
  if (t.right > s.right) delta = t.right - s.right;
  else if (t.left < s.left) delta = t.left - s.left;
  if (delta === 0) return 0;
  const before = scroller.scrollLeft;
  scroller.scrollLeft = before + delta;
  return scroller.scrollLeft - before;
}

/** One "line" of a `deltaMode: DOM_DELTA_LINE` wheel event, in px. Chromium
 *  always reports pixels; the line/page arms are for completeness. */
const WHEEL_LINE_PX = 16;

/**
 * Map a VERTICAL wheel gesture over the strip onto horizontal scroll — the
 * convention Firefox's tab strip and VS Code's editor tabs use, and what a
 * mouse user (no horizontal wheel) needs to reach an off-screen tab at all.
 *
 * Deliberately narrow: a genuine horizontal `deltaX` (a trackpad swipe, or
 * Shift+wheel, which Chromium already re-axes into `deltaX`) is left to the
 * browser's own scroll handling; a `ctrlKey` wheel is a pinch-zoom and is
 * never hijacked; and a wheel that cannot move the strip in that direction
 * (already at the end, or no overflow at all) is NOT consumed, so the event
 * bubbles exactly as it did before this listener existed.
 *
 * Returns true when the strip scrolled — the caller `preventDefault()`s ONLY
 * then. Must be wired as a NON-passive native listener: React's `onWheel` is
 * registered passive and cannot prevent the default.
 */
export function wheelToStripScroll(scroller: HTMLElement, e: WheelEvent): boolean {
  if (e.ctrlKey) return false;
  if (e.deltaX !== 0 || e.deltaY === 0) return false;
  const max = scroller.scrollWidth - scroller.clientWidth;
  if (max <= 0) return false;
  const px =
    e.deltaMode === 1
      ? e.deltaY * WHEEL_LINE_PX
      : e.deltaMode === 2
        ? e.deltaY * scroller.clientWidth
        : e.deltaY;
  const before = scroller.scrollLeft;
  const next = Math.max(0, Math.min(max, before + px));
  if (next === before) return false;
  scroller.scrollLeft = next;
  return true;
}

/** How close to a strip edge a DRAG has to be before the strip auto-scrolls. */
export const DRAG_EDGE_ZONE_PX = 28;
/** How far each `dragover` inside the edge zone moves the strip. */
export const DRAG_EDGE_STEP_PX = 8;

/**
 * Edge-zone auto-scroll for an HTML5 drag over the strip (a paper/library tab
 * torn out of the Library, or an inner tab being reordered): once the strip
 * overflows, dragging toward either edge slides the hidden tabs into reach.
 * Called from `onDragOver`, which the browser fires continuously while the
 * pointer is held over the element — so one small step per event IS the
 * auto-scroll, with no timer to own. Call it AFTER the drop-index rect reads,
 * so the write never sits between two of the gesture's own reads.
 */
export function autoScrollForDrag(scroller: HTMLElement, clientX: number): void {
  if (scroller.scrollWidth <= scroller.clientWidth) return;
  const r = scroller.getBoundingClientRect();
  if (clientX < r.left + DRAG_EDGE_ZONE_PX) scroller.scrollLeft -= DRAG_EDGE_STEP_PX;
  else if (clientX > r.right - DRAG_EDGE_ZONE_PX) scroller.scrollLeft += DRAG_EDGE_STEP_PX;
}

/**
 * Clamp a drop-indicator x (strip-relative) into the scroller's VISIBLE span,
 * so a drop past the scrolled-out boundary still paints a bar at the edge the
 * hidden tabs are beyond, instead of an indicator nobody can see. `stripLeft`
 * is the viewport x the indicator's `left` is measured from.
 */
export function clampIndicatorX(
  x: number,
  scroller: HTMLElement | null,
  stripLeft: number,
  indicatorWidth: number,
): number {
  if (!scroller) return x;
  const r = scroller.getBoundingClientRect();
  const lo = r.left - stripLeft;
  const hi = r.left + scroller.clientWidth - stripLeft - indicatorWidth;
  if (hi <= lo) return x;
  return Math.max(lo, Math.min(hi, x));
}

// ── The natural width a compression has hidden ──────────────────────────────

/**
 * The tab row's NATURAL (max-content) width, recovered from a row that may be
 * COMPRESSED or OVERFLOWING — the number the bar's occupancy predicate needs
 * (bar-occupancy.ts), and the reason compression and measurement had to be
 * separated: the pre-561 row was `width: max-content` + `shrink-0`, so its
 * box WAS the natural width, and that is exactly what made it incompressible.
 *
 * Three regimes, one formula, `natural = box + deficit + overflow`:
 *   - ROOMY: the row sits at its max-content width; no label is ellipsized
 *     past its cap and nothing overflows — `natural = box`.
 *   - COMPRESSED (fits at the scroller's width by ellipsizing): each label's
 *     `scrollWidth` still reports its un-ellipsized text width while its
 *     `clientWidth` reports what it was allowed to show, so the sum of what
 *     the labels LOST is exactly what the row gave up — `natural = box +
 *     deficit`. A label capped at `TAB_LABEL_MAX_PX` was ellipsized before any
 *     compression, so the cap bounds its natural contribution.
 *   - OVERFLOWING (every label at its floor, tabs sticking out of the row):
 *     the stick-out is the scroller's own `scrollWidth − clientWidth`.
 *
 * Reads are post-layout DOM properties (`scrollWidth` / `clientWidth`) and
 * force no layout when called from a ResizeObserver callback. Cost O(tabs),
 * on a fire that happens only on tab open/close/rename/activation or a strip
 * resize — never on a keystroke. Honest limit: in the compressed regimes the
 * verdict is always "the tabs do not fit", whatever the deficit's magnitude,
 * so a stale deficit (a tab opened while already compressed fires no resize)
 * can never put the verdict on the wrong side; the box + deficit reading is
 * exact whenever the regime can change.
 */
export function tabRowNaturalWidth(
  row: HTMLElement,
  scroller: HTMLElement | null,
  rowContentWidth: number,
): number {
  let deficit = 0;
  const labels = row.querySelectorAll<HTMLElement>(`[${TAB_LABEL_ATTR}]`);
  for (let i = 0; i < labels.length; i++) {
    const label = labels[i];
    const natural = Math.min(label.scrollWidth, TAB_LABEL_MAX_PX);
    const shown = label.clientWidth;
    if (natural > shown) deficit += natural - shown;
  }
  const overflow = scroller
    ? Math.max(0, scroller.scrollWidth - scroller.clientWidth)
    : 0;
  return rowContentWidth + deficit + overflow;
}

// ── The hook both strips mount ──────────────────────────────────────────────

/**
 * The scroll half of the ladder, as ONE hook both strips mount:
 *
 *   1. ACTIVE TAB INTO VIEW on activation / open / a neighbour's close — a
 *      LAYOUT effect, so the nudge lands before the frame paints (a passive
 *      effect would paint the tab off-screen for a frame, then jump).
 *   2. ACTIVE TAB INTO VIEW on a strip RESIZE — the ONE ResizeObserver here,
 *      over the scroller's own box: RAF-coalesced, width-equality-bailed, and
 *      PARKED on the layout-gesture bus so an OS window drag or a pane drag
 *      costs one settle on its end edge, never a nudge per frame.
 *   3. VERTICAL WHEEL → HORIZONTAL SCROLL, as a non-passive native listener
 *      ({@link wheelToStripScroll}).
 *
 * `tabRefs` is the strip's own `Map<id, element>` of tab wrappers; `activeKey`
 * is the id of the active tab in it (`null` for none). Nothing here reads the
 * editor.
 */
export function useTabStripScroller(opts: {
  scrollerRef: RefObject<HTMLElement | null>;
  tabRefs: RefObject<Map<string, HTMLElement>>;
  activeKey: string | null;
  tabCount: number;
}): void {
  const { scrollerRef, tabRefs, activeKey, tabCount } = opts;

  // The resize path reads the LIVE active key at fire time (it is keyed on
  // the scroller, not on the tab set), so it is mirrored into a ref from the
  // same layout effect that performs the activation nudge — never written
  // during render.
  const activeKeyRef = useRef<string | null>(activeKey);

  // 1. Activation / open / close.
  useLayoutEffect(() => {
    activeKeyRef.current = activeKey;
    const scroller = scrollerRef.current;
    if (!scroller || activeKey === null) return;
    const tab = tabRefs.current?.get(activeKey);
    if (!tab) return;
    nudgeTabIntoView(scroller, tab);
    // `tabCount` is a dependency BY DESIGN and unused in the body: a
    // neighbour's close (or a tab opened elsewhere) can push the active tab
    // out of view without changing which tab is active.
  }, [scrollerRef, tabRefs, activeKey, tabCount]);

  // 2. Strip resize.
  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller || typeof ResizeObserver === "undefined") return;
    let raf = 0;
    let lastWidth = -1;
    const nudge = () => {
      raf = 0;
      const key = activeKeyRef.current;
      const tab = key === null ? undefined : tabRefs.current?.get(key);
      if (tab) nudgeTabIntoView(scroller, tab);
    };
    const park = parkDuringLayoutGesture(() => {
      if (raf) return;
      raf = requestAnimationFrame(nudge);
    }, "tab-strip:active-into-view");
    const ro = new ResizeObserver((entries) => {
      const w = entries[entries.length - 1]?.contentRect.width ?? -1;
      if (w === lastWidth) return;
      lastWidth = w;
      park.fire();
    });
    ro.observe(scroller);
    return () => {
      if (raf) cancelAnimationFrame(raf);
      ro.disconnect();
      park.dispose();
    };
  }, [scrollerRef, tabRefs]);

  // 3. Wheel.
  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const onWheel = (e: WheelEvent) => {
      if (wheelToStripScroll(scroller, e)) e.preventDefault();
    };
    scroller.addEventListener("wheel", onWheel, { passive: false });
    return () => scroller.removeEventListener("wheel", onWheel);
  }, [scrollerRef]);
}
