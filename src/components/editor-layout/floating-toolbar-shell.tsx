"use client";

// The floating/detached-toolbar shell (FloatingToolbarShell, DetachedToolbar,
// PodGrabHandle, TabEndCloseButton, CollapseChevronIcon) was retired with the
// card-system refactor's detached-toolbar removal (A1 / R30). The only surviving
// export is the orientation type, still consumed by MenuBar's docked-bar plumbing.
export type ToolbarOrientation = "horizontal" | "vertical";
