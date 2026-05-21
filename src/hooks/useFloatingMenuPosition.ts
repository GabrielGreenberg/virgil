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
 * window resize. It does NOT subscribe to scroll — repositioning on
 * scroll is consumer-specific (see SelectionActionsMenu's scroll-idle
 * suppression). Consumers that need scroll-tracking pass a new
 * `anchorRect` and the hook reruns.
 */

import {
  useCallback,
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

export function useFloatingMenuPosition(
  opts: UseFloatingMenuPositionOptions,
): UseFloatingMenuPositionResult {
  const { anchorRect, placements, gap = 6, margin = 8 } = opts;

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
  const elRef = useRef<HTMLElement | null>(null);

  const reposition = useCallback(() => {
    const el = elRef.current;
    if (!el || !stableAnchor) return;
    if (typeof window === "undefined") return;
    const rect = el.getBoundingClientRect();
    const size: Size = { w: rect.width, h: rect.height };
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    let chosen: Coords | null = null;
    for (const placement of placements) {
      const coords = computeCoords(stableAnchor, size, placement, gap);
      if (fits(coords, size, vw, vh, margin)) {
        chosen = coords;
        break;
      }
    }
    if (!chosen) {
      const last =
        placements[placements.length - 1] ?? {
          side: "below" as FloatingMenuSide,
        };
      const coords = computeCoords(stableAnchor, size, last, gap);
      chosen = clampToViewport(coords, size, vw, vh, margin);
    }
    const next = chosen;
    setPos((prev) =>
      prev && prev.left === next.left && prev.top === next.top ? prev : next,
    );
  }, [stableAnchor, placements, gap, margin]);

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

  const style: CSSProperties = pos
    ? { position: "fixed", left: pos.left, top: pos.top }
    : { position: "fixed", left: 0, top: 0, visibility: "hidden" };

  return { ref: setRef, style };
}
