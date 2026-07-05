"use client";

import type { CSSProperties, ReactNode } from "react";

/**
 * Shared pod shape for the leftmost library column. A rounded rectangle
 * with a fixed-height header (`title` slot) above a scrollable body.
 * Used by `LibrariesNavigator` and `MyPapersPod` so the two stacked pods
 * stay visually identical.
 */
interface Props {
  title: ReactNode;
  children: ReactNode;
  /** Forwarded to the outer wrapper. Use for `flex` sizing in the
   *  parent column layout (e.g. `flex: 1` for fill, `flex: "0 0 auto"`
   *  + a `maxHeight` for content-sized). */
  style?: CSSProperties;
}

export default function NavPod({ title, children, style }: Props) {
  return (
    <div
      style={{
        flex: 1,
        minHeight: 0,
        display: "flex",
        flexDirection: "column",
        background: "var(--surface)",
        // Library page-edge chrome → --library-edge (a tint of --library-bg),
        // not the top-bar token --topbar-border, so this pod's frame + title
        // divider read as the same harmonious library edge as the tab strip and
        // body frame instead of a warm-taupe-on-cool clash (task 048).
        border: "1px solid var(--library-edge)",
        borderRadius: "var(--library-manila-radius)",
        overflow: "hidden",
        ...style,
      }}
    >
      <div
        style={{
          flexShrink: 0,
          padding: "10px 14px 8px",
          fontSize: 13,
          fontWeight: 500,
          color: "var(--foreground)",
          borderBottom: "1px solid var(--library-edge)",
        }}
      >
        {title}
      </div>
      <div
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: "auto",
          padding: "8px 0",
        }}
      >
        {children}
      </div>
    </div>
  );
}
