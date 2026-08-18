"use client";

/**
 * Body-portaled indicator that paints the blue bar showing where a
 * drop-mode gesture will land. One component, three shapes, picked
 * from the active session's placement. Viewport-relative coordinates
 * — works regardless of which editor (main or card body) is under
 * the cursor.
 */

import { createPortal } from "react-dom";
import { useDropSession } from "./controller";
import { DROP_INDICATOR_Z } from "@/floats/float-policy";

export function DropModeIndicator() {
  const session = useDropSession();
  if (typeof document === "undefined") return null;
  if (!session?.placement) return null;
  const p = session.placement;
  // A "between-blocks" placement is normally a thin HORIZONTAL gap line, but
  // Feature A1's unified expex drop reuses the same kind for a VERTICAL
  // left-edge bar (taller than wide). Tag the vertical case so its height
  // transitions smoothly as it snaps between a full-item bar and a new-item
  // tick (the horizontal gap line only eases `top`).
  const cls =
    p.kind === "between-blocks"
      ? p.rect.height > p.rect.width
        ? "dropmode-bar-gap dropmode-bar-vertical"
        : "dropmode-bar-gap"
      : p.kind === "paragraph-side"
        ? "dropmode-bar-side"
        : "dropmode-bar-inline";
  // The bar is positioned by TRANSFORM, not by `left`/`top` (task 351).
  // Its position changes on every placement change — which, during a drag
  // through a dense list, is most frames — and `globals.css` eases it. Easing
  // `top` on a `position:fixed` element runs an 80 ms LAYOUT animation on the
  // main thread after every change, so the tree is essentially never clean for
  // the duration of the drag and every rect read anywhere in the app (the
  // gesture's own hit-test included) pays a forced style+layout flush. A
  // translate is composite-only. This is the same law the float shell and the
  // lift overlay already follow — "a `left`/`top` write re-lays-out every
  // frame" (AGENTS.md, Pane-drag stability) — applied to the one element in
  // the gesture that actually moves.
  return createPortal(
    <div
      className={cls}
      style={{
        position: "fixed",
        left: 0,
        top: 0,
        width: p.rect.width,
        height: p.rect.height,
        transform: `translate3d(${p.rect.x}px, ${p.rect.y}px, 0)`,
        willChange: "transform",
        pointerEvents: "none",
        zIndex: DROP_INDICATOR_Z,
        background: "var(--accent-blue, #2563eb)",
        borderRadius: 1,
      }}
    />,
    document.body,
  );
}
