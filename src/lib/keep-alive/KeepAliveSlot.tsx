"use client";

// A mount-once + visibility-toggle wrapper. The child stays mounted (its state,
// editor, parsed doc, scroll all preserved) while hidden; only the parent
// removing it from render unmounts it (the eviction signal). Visibility flips
// cost NOTHING — no remount.
//
// CSS invariant (load-bearing): the hidden wrapper uses `display:none`, NOT
// `visibility:hidden`. display:none (a) removes it from flex flow so the hidden
// slot steals no space / doesn't push the visible pane down, and (b) makes
// `offsetHeight === 0` and `coordsAtPos`/`getBoundingClientRect` return 0 — the
// authoritative signal the measurement followers early-out on. visibility:hidden
// would keep real geometry and defeat every guard.

import { type ReactNode } from "react";
import { KeepAliveVisibilityProvider } from "./visibility-context";

export function KeepAliveSlot({
  isVisible,
  children,
  className = "flex flex-1 min-h-0 overflow-hidden",
}: {
  isVisible: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div style={{ display: isVisible ? "flex" : "none" }} className={className}>
      <KeepAliveVisibilityProvider isVisible={isVisible}>
        {children}
      </KeepAliveVisibilityProvider>
    </div>
  );
}
