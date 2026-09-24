"use client";

/**
 * `<MenuGrid>` / `<MenuList>` — the composite layout's structural regions
 * (design §3.1/§3.4, graft A). The cross-region edge is authored in
 * `nav-core.ts` (grid above list); these wrappers declare the regions
 * structurally and provide the grid's `cols` for cell layout. B1 uses
 * `<MenuList>` for the grab menu; `<MenuGrid>` ships now so B2's composite
 * lightning menu mounts without a primitive refactor.
 *
 * Items inside these wrappers register their `region` ("grid" | "list") +
 * grid `coords` via `useMenuItem` — the wrappers don't re-tag children; they
 * only lay them out. (A `useMenuGrid()` column-count context once shipped here
 * for cells that might derive coords from a flat index; no cell ever did, so
 * it went with task 748 — every grid cell passes explicit `coords`.)
 */

import type { CSSProperties, ReactNode } from "react";

export interface MenuGridProps {
  cols: number;
  style?: CSSProperties;
  className?: string;
  children: ReactNode;
}

export function MenuGrid({ cols, style, className, children }: MenuGridProps): ReactNode {
  return (
    <div
      role="presentation"
      className={className}
      style={{
        display: "grid",
        gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
        ...style,
      }}
    >
      {children}
    </div>
  );
}

export interface MenuListProps {
  style?: CSSProperties;
  className?: string;
  children: ReactNode;
}

export function MenuList({ style, className, children }: MenuListProps): ReactNode {
  return (
    <div role="presentation" className={className} style={style}>
      {children}
    </div>
  );
}
