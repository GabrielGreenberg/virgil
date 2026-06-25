"use client";

import { memo } from "react";

/** Thin vertical divider drawn between non-Library tabs. Always occupies
 *  layout space (so promoting/demoting a tab doesn't shift its neighbors);
 *  only painted when both adjacent tabs are inline — adjacent to the active
 *  folder tab, the silhouette's edge serves as the divider so the line is
 *  hidden via `visibility: hidden`. Same pattern as Chrome/Edge. */
function TabSeparatorImpl({ visible }: { visible: boolean }) {
  return (
    <span
      aria-hidden
      className="self-center inline-block shrink-0 w-px h-4 mx-1"
      style={{
        background: "var(--edge-strong, #a8a29e)",
        visibility: visible ? "visible" : "hidden",
      }}
    />
  );
}

export const TabSeparator = memo(TabSeparatorImpl);
