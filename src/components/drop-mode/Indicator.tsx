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

export function DropModeIndicator() {
  const session = useDropSession();
  if (typeof document === "undefined") return null;
  if (!session?.placement) return null;
  const p = session.placement;
  const cls =
    p.kind === "between-blocks"
      ? "dropmode-bar-gap"
      : p.kind === "paragraph-side"
        ? "dropmode-bar-side"
        : "dropmode-bar-inline";
  return createPortal(
    <div
      className={cls}
      style={{
        position: "fixed",
        left: p.rect.x,
        top: p.rect.y,
        width: p.rect.width,
        height: p.rect.height,
        pointerEvents: "none",
        zIndex: 9999,
        background: "var(--accent-blue, #2563eb)",
        borderRadius: 1,
      }}
    />,
    document.body,
  );
}
