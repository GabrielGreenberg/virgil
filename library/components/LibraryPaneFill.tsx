"use client";

import { forwardRef, type CSSProperties, type ReactNode } from "react";

// SSOT for "a Library state fills its pane."
//
// The Library tab mounts as a flex-ROW child in Virgil's nested flex tree
// (`<div className="flex flex-1 …"><LibraryTabView/></div>` in EditorLayout).
// A child that declares only `height:100%` (no `flex`/`width`) shrinks to its
// intrinsic CONTENT width along the row's main axis and pins LEFT, leaving a
// dead band on the right — even when its inner content is flex-centered.
//
// `flex:1, minHeight:0` is more robust than `height:100%` here: height:100%
// collapses when an ancestor lacks an explicit height. Paired with
// `width:100%` (+ `minWidth:0`) the child spans the full pane on the row's
// main axis. `LibraryView` documented and fixed exactly this for the loaded
// state; every Library state now routes through this one wrapper so a future
// state can't silently drift left again (task 085; sibling of task 054's
// RightDetail pane-fill).
const PANE_FILL: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  flex: 1,
  minWidth: 0,
  minHeight: 0,
  width: "100%",
};

interface Props {
  /** Center children on both axes — the pre-load splash states
   *  (loading / picker / gate) that own no internal layout of their own.
   *  Omit for content that lays itself out (LibraryView). */
  center?: boolean;
  /** Per-state extras (background, gap, padding, colour) merged over the
   *  canonical fill styles. */
  style?: CSSProperties;
  children?: ReactNode;
}

/** The one box that fills the Library pane. See {@link PANE_FILL}. */
const LibraryPaneFill = forwardRef<HTMLDivElement, Props>(function LibraryPaneFill(
  { center, style, children },
  ref,
) {
  return (
    <div
      ref={ref}
      style={{
        ...PANE_FILL,
        ...(center ? { alignItems: "center", justifyContent: "center" } : null),
        ...style,
      }}
    >
      {children}
    </div>
  );
});

export default LibraryPaneFill;
