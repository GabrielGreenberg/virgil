"use client";

import {
  FOLDER_TAB_VARIANTS,
  INK_SHIFT,
  TAB_TOP_GUTTER,
  middleInsetLeft,
  middleInsetRight,
  type FolderTabCapArt,
  type FolderTabVariant,
} from "./folder-tab-geometry";

/**
 * The ACTIVE folder-tab silhouette, as a pure chrome layer: drop it inside a
 * `position: relative` wrapper of height `FOLDER_TAB_VARIANTS[variant].svgH`
 * and it paints the manila tab (caps + stretchable middle) behind the
 * wrapper's in-flow content. Both tab strips render THIS — the outer
 * Virgil-bar tabs (DocumentFolderTab) and the inner library tabs
 * (PanelFolderTab) are one implementation.
 *
 * Geometry is owned by LAYOUT, not measurement:
 *   - two fixed-size SVG end caps (constant artwork from the geometry SSOT,
 *     half-pixel ink discipline baked in once),
 *   - a stretchable middle div (fill background + 1px top border in the edge
 *     color) that tracks the wrapper's width by layout — live at every frame
 *     of a pane drag, with zero JS.
 * There is deliberately NO ResizeObserver, NO getBoundingClientRect, NO
 * per-width `d`-string rebuild here (the class of bugs this module retired —
 * see folder-tab-geometry.ts).
 *
 * Inactive tabs are deliberately FLAT (BackgroundTab / InlineTabLabel — no
 * silhouette); this component only ever renders the active tab, so it draws
 * the OPEN-bottom outline unconditionally: the stroke omits the base edge
 * and the bottom fill row (caps' bridge rects + the middle's background
 * reaching the wrapper bottom) overlaps the body's 1px top border by
 * `FOLDER_TAB_SEAM_OVERLAP` via the wrapper's negative bottom margin —
 * z-order fusion, correct at every width including mid-drag.
 */
export function FolderTabChrome({
  variant,
  fill,
  tuckLeft,
  tuckRight,
}: {
  variant: FolderTabVariant;
  /** Tab surface color (CSS var string, e.g. "var(--surface)"). */
  fill: string;
  /** Task 053 — tuck the LEFT/RIGHT swoop foot onto the body's rounded top
   *  corner (library variant only; the strip decides). */
  tuckLeft?: boolean;
  tuckRight?: boolean;
}) {
  const spec = FOLDER_TAB_VARIANTS[variant];
  const left = tuckLeft ? spec.caps.leftTucked : spec.caps.left;
  const right = tuckRight ? spec.caps.rightTucked : spec.caps.right;

  return (
    <>
      <FolderTabCap
        art={left}
        svgH={spec.svgH}
        fill={fill}
        stroke={spec.strokeVar}
        side="left"
        overhang={0}
      />
      {/* Stretchable middle: flat top edge (1px border in the edge color, in
          the same ink band as the caps' shoulder stroke) + fill surface. Its
          background runs to the wrapper's bottom, forming the seam bridge
          across the middle span. Overlaps each cap by 1px of identical ink,
          so the joints are seamless without any width coordination. */}
      <div
        aria-hidden
        style={{
          position: "absolute",
          left: middleInsetLeft(!!tuckLeft),
          right: middleInsetRight(!!tuckRight, spec.capRightOverhang),
          top: TAB_TOP_GUTTER,
          bottom: 0,
          background: fill,
          borderTop: `1px solid ${spec.strokeVar}`,
          pointerEvents: "none",
        }}
      />
      <FolderTabCap
        art={right}
        svgH={spec.svgH}
        fill={fill}
        stroke={spec.strokeVar}
        side="right"
        overhang={spec.capRightOverhang}
      />
    </>
  );
}

function FolderTabCap({
  art,
  svgH,
  fill,
  stroke,
  side,
  overhang,
}: {
  art: FolderTabCapArt;
  svgH: number;
  fill: string;
  stroke: string;
  side: "left" | "right";
  overhang: number;
}) {
  return (
    <svg
      aria-hidden
      width={art.width}
      height={svgH}
      viewBox={`0 0 ${art.width} ${svgH}`}
      shapeRendering="geometricPrecision"
      style={{
        position: "absolute",
        top: 0,
        // A right overhang pokes the viewport past the wrapper edge so the
        // foot stroke's outer half-pixel renders instead of clipping (F#8
        // cushion outside the footprint — topbar variant).
        ...(side === "left" ? { left: 0 } : { right: -overhang }),
        pointerEvents: "none",
      }}
    >
      <g transform={`translate(${INK_SHIFT.x}, ${INK_SHIFT.y})`}>
        <path d={art.fillD} fill={fill} stroke="none" />
      </g>
      {/* The 1px seam-bridge row (unshifted, like the historical bridge rect):
          fill-colored, sitting on the wrapper's bottom row where it overlaps
          the body's top border. */}
      <rect
        x={art.bridgeX}
        y={svgH - 1}
        width={art.bridgeW}
        height={1}
        fill={fill}
      />
      <g transform={`translate(${INK_SHIFT.x}, ${INK_SHIFT.y})`}>
        <path d={art.strokeD} fill="none" stroke={stroke} strokeWidth={1} />
      </g>
    </svg>
  );
}
