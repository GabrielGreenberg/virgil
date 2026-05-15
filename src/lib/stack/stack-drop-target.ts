"use client";

import { useEffect, useState } from "react";

/**
 * Stack-drop-target signal — module-level, mirrors `dock-drag.ts`.
 *
 * Producer: `FloatingPanel.tsx`'s drag handler calls
 * `setStackDropTarget(true)` while the cursor is over the StackIcon
 * during a card/block float drag.
 *
 * Consumer: `StackIcon.tsx` subscribes via `useStackDropTarget()` and
 * paints the blue illuminated ring while active.
 *
 * This signal lives outside React Context because the producer
 * (FloatingPanel) and the consumer (StackIcon, body-portaled) sit in
 * unrelated parts of the React tree. The same architectural call as
 * `dock-drag.ts` and the drop-mode controller's session signal.
 */

let active = false;
const listeners = new Set<() => void>();

export function setStackDropTarget(next: boolean) {
  if (active === next) return;
  active = next;
  for (const l of listeners) l();
}

export function getStackDropTarget(): boolean {
  return active;
}

export function useStackDropTarget(): boolean {
  const [t, setT] = useState<boolean>(active);
  useEffect(() => {
    const sub = () => setT(getStackDropTarget());
    listeners.add(sub);
    sub();
    return () => {
      listeners.delete(sub);
    };
  }, []);
  return t;
}

/**
 * Cached viewport rect of the StackIcon, updated by the icon component
 * via a ResizeObserver. The FloatingPanel hit-test reads this each frame
 * (cheap pure-data lookup) instead of querying the DOM.
 */
let iconRect: { left: number; top: number; right: number; bottom: number } | null = null;

export function setStackIconRect(
  rect: { left: number; top: number; right: number; bottom: number } | null,
) {
  iconRect = rect;
}

/** True when the cursor falls within the icon's circular hit area. */
export function isOverStackIcon(clientX: number, clientY: number): boolean {
  const r = iconRect;
  if (!r) return false;
  // Bounding-box first (fast reject), then radius check for the circle.
  if (clientX < r.left || clientX > r.right || clientY < r.top || clientY > r.bottom) {
    return false;
  }
  const cx = (r.left + r.right) / 2;
  const cy = (r.top + r.bottom) / 2;
  const radius = Math.min(r.right - r.left, r.bottom - r.top) / 2;
  const dx = clientX - cx;
  const dy = clientY - cy;
  return dx * dx + dy * dy <= radius * radius;
}

/** Height (px) of the draggable header region of a FloatingPanel — the
 *  area the user actually grabs to move the float. Used for the
 *  header-over-icon hit-test below. */
export const STACK_HEADER_HIT_HEIGHT = 44;

/** True when the float's header rectangle overlaps the icon's bounding
 *  area. More forgiving than `isOverStackIcon` for drag affordance: as
 *  long as ANY part of the header strip is over the circle, the icon
 *  illuminates. */
export function isHeaderOverStackIcon(panel: {
  x: number;
  y: number;
  width: number;
}): boolean {
  const r = iconRect;
  if (!r) return false;
  const headerLeft = panel.x;
  const headerRight = panel.x + panel.width;
  const headerTop = panel.y;
  const headerBottom = panel.y + STACK_HEADER_HIT_HEIGHT;
  // Rect intersection on horizontal axis
  if (headerRight < r.left || headerLeft > r.right) return false;
  // Rect intersection on vertical axis
  if (headerBottom < r.top || headerTop > r.bottom) return false;
  return true;
}
