"use client";

import type { CSSProperties, ReactNode } from "react";

/**
 * Shared section shape for the leftmost library column: a quiet heading above
 * a scrollable body, as text on the manila with no frame, the way the editor's
 * tool gutter reads. Used by `LibrariesNavigator` and `MyPapersPod` so the two
 * stacked sections stay visually identical.
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
        ...style,
      }}
    >
      <div
        style={{
          flexShrink: 0,
          padding: "8px 14px 4px",
          fontSize: 12,
          fontWeight: 600,
          color: "var(--muted)",
        }}
      >
        {title}
      </div>
      <div
        className="panel-scroll"
        style={{
          flex: 1,
          minHeight: 0,
          paddingBottom: 4,
        }}
      >
        {children}
      </div>
    </div>
  );
}
