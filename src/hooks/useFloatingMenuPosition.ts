"use client";

/**
 * Position a portaled popover next to an anchor and keep it inside the
 * viewport. Caller passes the anchor rect + a list of preferred
 * placements (e.g., `[{ side: "below" }, { side: "above" }]`); the first
 * placement whose bounds fit wins, the last is used and clamped if none
 * fit. Measurement comes from the rendered element (ref + ResizeObserver),
 * not from caller-supplied size estimates — so menus whose content grows
 * stay in-bounds without each consumer re-deriving its own height math.
 *
 * Scope: the hook owns its own measurement, content-size changes, and
 * window resize. By default it does NOT subscribe to scroll — repositioning
 * on scroll is consumer-specific (see SelectionActionsMenu's scroll-idle
 * suppression). Consumers that need scroll-tracking either pass a new
 * `anchorRect` and let the hook rerun, OR opt in to the built-in
 * `trackAnchor` RAF-coalesced scroll/resize re-anchor (Menu-primitive
 * graft, design §3.3) which re-reads the anchor on every scroll/resize.
 *
 * Two optional capabilities the Menu primitive needs (design §3.3), both
 * off by default so existing callers are byte-identical:
 *   - `maxHeight` (boolean): when set, the result `style` carries a
 *     `maxHeight` clamping the menu to the space available below/above the
 *     anchor for the chosen placement (minus `margin`), with `overflowY:
 *     auto`. Lets a tall list scroll instead of overflowing the viewport
 *     (BibEntryPicker's hand-rolled clamp folds in here).
 *   - `trackAnchor` (() => DOMRect | AnchorRect | null): when supplied, the
 *     hook installs a capture-phase scroll + resize listener (RAF-coalesced
 *     to one re-read per frame) that calls this thunk and re-feeds the
 *     anchor. The slash caret / bib-picker / tab-plus scroll re-reads unify
 *     onto this. The thunk is the authority while present; the static
 *     `anchorRect` is the initial/fallback measurement.
 */

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";

export type FloatingMenuSide = "above" | "below" | "left-of" | "right-of";
export type FloatingMenuAlign = "start" | "center" | "end";

export interface FloatingMenuPlacement {
  side: FloatingMenuSide;
  /** Cross-axis alignment relative to the anchor. Defaults to "start". */
  align?: FloatingMenuAlign;
}

interface AnchorRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}

export interface UseFloatingMenuPositionOptions {
  /** The trigger's bounding rect in viewport coords. Repass when it changes. */
  anchorRect: DOMRect | AnchorRect | null;
  /** Placement candidates, tried in order. */
  placements: FloatingMenuPlacement[];
  /** Distance between anchor and menu in px. Default 6. */
  gap?: number;
  /** Min distance from viewport edges in px. Default 8. */
  margin?: number;
  /**
   * Clamp the menu's height to the space available for the chosen placement
   * (design §3.3). When `true`, the result `style` carries a computed
   * `maxHeight` + `overflowY: "auto"` so a tall list scrolls instead of
   * overflowing the viewport. Off by default (existing callers unaffected).
   */
  maxHeight?: boolean;
  /**
   * RAF-coalesced scroll/resize re-anchor (design §3.3). When supplied, the
   * hook installs a capture-phase `scroll` + `resize` listener that — at most
   * once per animation frame — calls this thunk and re-feeds the returned
   * rect as the live anchor. Used by caret-anchored / scroll-following menus
   * (slash, bib-picker, tab-plus). The thunk is authoritative while present;
   * the static `anchorRect` is the initial/fallback. Off by default.
   */
  trackAnchor?: () => DOMRect | AnchorRect | null;
}

export interface UseFloatingMenuPositionResult {
  /** Attach to the menu element. */
  ref: (el: HTMLElement | null) => void;
  /** Spread on the menu element. Includes `visibility: "hidden"` until
   *  the first measurement so the popover can be measured off-screen
   *  without a visible flicker. */
  style: CSSProperties;
}

interface Coords {
  left: number;
  top: number;
}
interface Size {
  w: number;
  h: number;
}

function computeCoords(
  anchor: AnchorRect,
  size: Size,
  placement: FloatingMenuPlacement,
  gap: number,
): Coords {
  const align = placement.align ?? "start";
  if (placement.side === "below" || placement.side === "above") {
    const top =
      placement.side === "below"
        ? anchor.bottom + gap
        : anchor.top - gap - size.h;
    const left =
      align === "start"
        ? anchor.left
        : align === "center"
          ? anchor.left + (anchor.width - size.w) / 2
          : anchor.right - size.w;
    return { left, top };
  }
  const left =
    placement.side === "right-of"
      ? anchor.right + gap
      : anchor.left - gap - size.w;
  const top =
    align === "start"
      ? anchor.top
      : align === "center"
        ? anchor.top + (anchor.height - size.h) / 2
        : anchor.bottom - size.h;
  return { left, top };
}

function fits(
  c: Coords,
  size: Size,
  vw: number,
  vh: number,
  margin: number,
): boolean {
  return (
    c.left >= margin &&
    c.left + size.w <= vw - margin &&
    c.top >= margin &&
    c.top + size.h <= vh - margin
  );
}

function clampToViewport(
  c: Coords,
  size: Size,
  vw: number,
  vh: number,
  margin: number,
): Coords {
  return {
    left: Math.max(margin, Math.min(c.left, vw - size.w - margin)),
    top: Math.max(margin, Math.min(c.top, vh - size.h - margin)),
  };
}

/**
 * Space available between the anchor and the relevant viewport edge for a
 * given placement side — the basis for the optional `maxHeight` clamp. For a
 * below/above placement that's the gap between the anchor edge and the
 * viewport bottom/top; for a side placement (left-of / right-of) the menu
 * spans vertically from the anchor top, so the limit is the space down to the
 * viewport bottom. All minus `margin`. Returns `Infinity`-free positive px.
 */
function availableHeightFor(
  anchor: AnchorRect,
  side: FloatingMenuSide,
  vh: number,
  gap: number,
  margin: number,
): number {
  if (side === "below") return Math.max(0, vh - margin - (anchor.bottom + gap));
  if (side === "above") return Math.max(0, anchor.top - gap - margin);
  // left-of / right-of: the menu's top aligns near the anchor; clamp to the
  // space from the anchor top down to the bottom margin (the common case —
  // align "start"/"center" both start at/above the anchor top).
  return Math.max(0, vh - margin - anchor.top);
}

export function useFloatingMenuPosition(
  opts: UseFloatingMenuPositionOptions,
): UseFloatingMenuPositionResult {
  const {
    anchorRect,
    placements,
    gap = 6,
    margin = 8,
    maxHeight = false,
    trackAnchor,
  } = opts;

  // Memoize the anchor by its primitive fields so a fresh DOMRect-shaped
  // literal each render (typical caller pattern) doesn't churn the effects
  // below — only actual position changes do.
  const anchorLeft = anchorRect?.left ?? null;
  const anchorTop = anchorRect?.top ?? null;
  const anchorRight = anchorRect?.right ?? null;
  const anchorBottom = anchorRect?.bottom ?? null;
  const anchorWidth = anchorRect?.width ?? null;
  const anchorHeight = anchorRect?.height ?? null;
  const stableAnchor = useMemo<AnchorRect | null>(() => {
    if (
      anchorLeft == null ||
      anchorTop == null ||
      anchorRight == null ||
      anchorBottom == null ||
      anchorWidth == null ||
      anchorHeight == null
    ) {
      return null;
    }
    return {
      left: anchorLeft,
      top: anchorTop,
      right: anchorRight,
      bottom: anchorBottom,
      width: anchorWidth,
      height: anchorHeight,
    };
  }, [
    anchorLeft,
    anchorTop,
    anchorRight,
    anchorBottom,
    anchorWidth,
    anchorHeight,
  ]);

  const [pos, setPos] = useState<Coords | null>(null);
  // The computed clamp for the chosen placement when `maxHeight` is on; null
  // when the feature is off or no anchor is resolved yet.
  const [clampHeight, setClampHeight] = useState<number | null>(null);
  const elRef = useRef<HTMLElement | null>(null);

  // The live anchor used at measure time: the `trackAnchor` thunk's result
  // (authoritative while supplied + non-null) falls back to the static
  // `stableAnchor`. Stash the thunk in a ref so the scroll/resize listeners
  // can call the latest one without re-subscribing.
  const trackAnchorRef = useRef(trackAnchor);
  useLayoutEffect(() => {
    trackAnchorRef.current = trackAnchor;
  }, [trackAnchor]);

  const reposition = useCallback(() => {
    const el = elRef.current;
    if (typeof window === "undefined") return;
    // Prefer the live tracked anchor (scroll/caret-following menus); fall back
    // to the static one. Normalize a DOMRect-ish to the AnchorRect shape.
    const tracked = trackAnchorRef.current?.() ?? null;
    const anchor: AnchorRect | null = tracked
      ? {
          left: tracked.left,
          top: tracked.top,
          right: tracked.right,
          bottom: tracked.bottom,
          width: tracked.width,
          height: tracked.height,
        }
      : stableAnchor;
    if (!el || !anchor) return;
    const rect = el.getBoundingClientRect();
    const size: Size = { w: rect.width, h: rect.height };
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    let chosen: Coords | null = null;
    let chosenSide: FloatingMenuSide | null = null;
    for (const placement of placements) {
      const coords = computeCoords(anchor, size, placement, gap);
      if (fits(coords, size, vw, vh, margin)) {
        chosen = coords;
        chosenSide = placement.side;
        break;
      }
    }
    if (!chosen) {
      const last =
        placements[placements.length - 1] ?? {
          side: "below" as FloatingMenuSide,
        };
      const coords = computeCoords(anchor, size, last, gap);
      chosen = clampToViewport(coords, size, vw, vh, margin);
      chosenSide = last.side;
    }
    const next = chosen;
    setPos((prev) =>
      prev && prev.left === next.left && prev.top === next.top ? prev : next,
    );
    if (maxHeight && chosenSide) {
      const avail = availableHeightFor(anchor, chosenSide, vh, gap, margin);
      setClampHeight((prev) => (prev === avail ? prev : avail));
    } else if (clampHeight !== null) {
      setClampHeight(null);
    }
  }, [stableAnchor, placements, gap, margin, maxHeight, clampHeight]);

  // Stash the latest reposition fn so the listeners below can call the
  // current implementation without re-subscribing on every change.
  const repositionRef = useRef(reposition);
  useLayoutEffect(() => {
    repositionRef.current = reposition;
  }, [reposition]);

  // Initial / anchor-change measurement. Defer one microtask so this
  // doesn't count as a synchronous setState in the effect body, and so
  // the layout effect can return before React commits the resulting
  // state update.
  useLayoutEffect(() => {
    queueMicrotask(() => repositionRef.current());
  }, [reposition]);

  // Mount-time listeners. Both call reposition from event-handler
  // contexts, not synchronously from the effect body.
  const setRef = useCallback((el: HTMLElement | null) => {
    elRef.current = el;
  }, []);

  useLayoutEffect(() => {
    const el = elRef.current;
    if (!el) return;
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => repositionRef.current());
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useLayoutEffect(() => {
    if (typeof window === "undefined") return;
    const onResize = () => repositionRef.current();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // Optional scroll/resize re-anchor (design §3.3). Installed ONLY when a
  // `trackAnchor` thunk is supplied; RAF-coalesced so a burst of scroll
  // events triggers at most one re-read per frame (keystroke-sanctity: this
  // is scroll/resize-driven, never on the editor transaction path). The
  // capture phase catches scrolls in any nested scroll container, not just
  // the window.
  const tracking = !!trackAnchor;
  useEffect(() => {
    if (!tracking) return;
    if (typeof window === "undefined") return;
    let raf = 0;
    const onScrollOrResize = () => {
      if (raf) return;
      raf = window.requestAnimationFrame(() => {
        raf = 0;
        repositionRef.current();
      });
    };
    window.addEventListener("scroll", onScrollOrResize, true);
    window.addEventListener("resize", onScrollOrResize);
    return () => {
      if (raf) window.cancelAnimationFrame(raf);
      window.removeEventListener("scroll", onScrollOrResize, true);
      window.removeEventListener("resize", onScrollOrResize);
    };
  }, [tracking]);

  const style: CSSProperties = pos
    ? {
        position: "fixed",
        left: pos.left,
        top: pos.top,
        ...(clampHeight !== null
          ? { maxHeight: clampHeight, overflowY: "auto" as const }
          : null),
      }
    : { position: "fixed", left: 0, top: 0, visibility: "hidden" };

  return { ref: setRef, style };
}
