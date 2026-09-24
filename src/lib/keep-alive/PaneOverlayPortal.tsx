"use client";

// The ONE door for a pane-owned overlay portaled OUT of its pane (task 753).
//
// A kept-alive pane is hidden with `display:none` on its KeepAliveSlot — which
// hides the slot's own subtree and nothing else. An overlay a pane portals
// into `document.body` (the ⚡ margin bolt, the pending-change pill) sits
// outside that subtree, so the hide never reaches it: it stays painted — and
// clickable — at its last fixed coordinates over whichever pane is now shown,
// dispatching into a document the user cannot see. Re-placing on the SHOW edge
// (task 598) cannot fix that, because nothing fires on the HIDE edge.
//
// So the door does not ask the overlay to re-place on hide: it does not render
// the portal at all unless this pane is the shown one. A hidden pane then
// paints nothing outside itself BY CONSTRUCTION. The overlay's own placement
// state survives (the component stays mounted), so the owner's existing
// show-edge re-place still settles it on re-show.
//
// The census `pane-overlay-portal-census.test.ts` makes this the door: every
// `createPortal(` in the pane's import closure goes through here or is
// allowlisted with a reason.

import { type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useIsVisible } from "./visibility-context";

export function PaneOverlayPortal({
  children,
  container,
}: {
  children: ReactNode;
  /** Defaults to `document.body`. */
  container?: Element | DocumentFragment | null;
}) {
  const isVisible = useIsVisible();
  if (!isVisible || typeof document === "undefined") return null;
  return createPortal(children, container ?? document.body);
}
