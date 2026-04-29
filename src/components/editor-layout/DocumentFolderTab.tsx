"use client";

import { type ReactNode, useLayoutEffect, useRef, useState } from "react";
import { buildActiveTabStrokePath, buildTabFillPath } from "./folder-path";

const R = 10;
const S = 12;
const TAB_H = 32;
const STROKE = "var(--topbar-border, #d5d3ce)";

type Props = {
  active: boolean;
  fill: string;
  onClick?: () => void;
  /** Tooltip / aria label (e.g., the doc folder name). */
  title?: string;
  /** Forwarded for color-picker integration. */
  dataPrefs?: string;
  /** Tab content (icon, label, close button). Width is auto-measured. */
  children: ReactNode;
};

/**
 * A tab rendered as a single SVG shape with a continuous border around its
 * full outline (rounded top corners, sides, concave swoop hooks, flat bottom
 * across the flared base).
 *
 * Closed silhouette is always drawn for fill so the body color paints the
 * entire shape including the swoop hooks. For active tabs the stroke uses
 * an open path that omits the bottom edge — the canvas's own top border
 * draws that seam, so the tab merges into the canvas without a redundant
 * closing line.
 *
 * Auto-measures content width with a ResizeObserver so labels of varying
 * lengths produce correctly-sized SVG paths.
 */
export function DocumentFolderTab({
  active,
  fill,
  onClick,
  title,
  dataPrefs,
  children,
}: Props) {
  const contentRef = useRef<HTMLDivElement | null>(null);
  const [tabW, setTabW] = useState(120);

  useLayoutEffect(() => {
    const el = contentRef.current;
    if (!el) return;
    const update = () => setTabW(Math.ceil(el.getBoundingClientRect().width));
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // SVG box: extra S=12 on each side for the swoop flare. Height is TAB_H+1
  // so the bottom 1px stroke (centered on path y=TAB_H with the 0.5 pixel-
  // alignment offset) renders fully inside the viewBox instead of being
  // clipped — without that extra pixel the seam-line stroke disappears.
  const svgW = 2 * S + tabW;
  const svgH = TAB_H + 1;
  const fillPath = buildTabFillPath({ tabW, tabH: TAB_H, R, S });
  const strokePath = active
    ? buildActiveTabStrokePath({ tabW, tabH: TAB_H, R, S })
    : null;

  return (
    <div
      data-prefs={dataPrefs}
      className="relative shrink-0 cursor-default self-end"
      style={{
        width: svgW,
        height: svgH,
        zIndex: active ? 10 : 1,
        // Both states sit with their bottom 1px below the topbar's content
        // area (overlapping the topbar's bottom border). Active tabs merge
        // into the canvas via their open path + matching body color; inactive
        // tabs' own closed-path bottom stroke is collinear with the topbar's
        // border and paints in the same color, so the seam line reads as
        // continuous across the window without the tab visibly shifting
        // between states.
        marginBottom: -1,
      }}
      onClick={onClick}
      title={title}
    >
      <svg
        className="absolute inset-0 pointer-events-none"
        width={svgW}
        height={svgH}
        viewBox={`0 0 ${svgW} ${svgH}`}
        shapeRendering="geometricPrecision"
        aria-hidden
      >
        {/* Fill silhouette, translated by 0.5 so its half-stroke crispness
            aligns with the stroke pass below. */}
        <g transform="translate(0.5, 0.5)">
          <path d={fillPath} fill={fill} stroke="none" />
        </g>
        {/* Bottom-edge cover: a 1px-tall strip in the body color spanning
            the silhouette's flared base. This sits over the topbar's
            border-bottom (which is visible at the same y in screen space)
            and hides it where this tab paints. For active tabs the open
            stroke leaves this strip uncovered, so the body color flows
            into the canvas with no visible seam. For inactive tabs, the
            closed stroke below paints over this strip with the same
            topbar-border color, so the seam line reads continuously. */}
        <rect x="0" y={TAB_H} width={svgW} height="1" fill={fill} />
        {/* Stroke: closed for inactive (continuous border around the whole
            tab — including the bottom seam); open for active (omits the
            bottom edge so the canvas blends in). */}
        <g transform="translate(0.5, 0.5)">
          {strokePath ? (
            <path d={strokePath} fill="none" stroke={STROKE} strokeWidth="1" />
          ) : (
            <path d={fillPath} fill="none" stroke={STROKE} strokeWidth="1" />
          )}
        </g>
      </svg>
      {/* Tab content sits over the narrow tab portion, vertically centered.
          The S-wide swoop flare on each side is decorative; content is
          contained in the [S, S+tabW] x-range. */}
      <div
        ref={contentRef}
        className="absolute flex items-center gap-1.5 px-3.5 text-ink-strong"
        style={{
          left: S,
          top: 0,
          height: TAB_H,
          minWidth: 80,
        }}
      >
        {children}
      </div>
    </div>
  );
}
