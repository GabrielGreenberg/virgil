"use client";

import {
  forwardRef,
  type CSSProperties,
  type DragEvent,
  type HTMLAttributes,
  type ReactNode,
} from "react";
import { FolderTabChrome } from "@/components/chrome/FolderTabChrome";
import {
  ACTIVE_MIN_CONTENT,
  FOLDER_TAB_SEAM_OVERLAP,
  FOLDER_TAB_SWOOP,
  FOLDER_TAB_VARIANTS,
  TAB_TOP_GUTTER,
} from "@/components/chrome/folder-tab-geometry";

// The library variant of the shared folder-tab chrome (geometry SSOT at
// src/components/chrome/folder-tab-geometry.ts): tabH 32, --library-edge
// stroke, body-span seam bridge, the F#8 +1 stroke cushion inside the
// footprint. The outer Virgil-bar tabs render the SAME chrome module with the
// "topbar" variant — one implementation, no forked geometry.
const V = FOLDER_TAB_VARIANTS.library;
const S = FOLDER_TAB_SWOOP;

type WrapperProps = {
  draggable?: boolean;
  onDragStart?: (e: DragEvent<HTMLElement>) => void;
  onDragEnd?: (e: DragEvent<HTMLElement>) => void;
  onDragOver?: (e: DragEvent<HTMLElement>) => void;
  onDragLeave?: (e: DragEvent<HTMLElement>) => void;
  onDrop?: (e: DragEvent<HTMLElement>) => void;
  style?: CSSProperties;
} & Pick<HTMLAttributes<HTMLDivElement>, "onMouseEnter" | "onMouseLeave">;

type Props = {
  fill: string;
  onClick?: () => void;
  title?: string;
  children: ReactNode;
  wrapperProps?: WrapperProps;
  /** Renders as data-tab-id on the outer wrapper so DOM-traversal-based
   * drop resolution can identify which tab a target belongs to. */
  dataTabId?: string;
  /** Task 053 — tuck the LEFT/RIGHT swoop foot onto the body's rounded top
   *  corner so the outer swoop of an edge tab flows into the page frame
   *  instead of poking past it and notching. Set by the strip for the first
   *  tab (left) and a flush-right last tab (right); interior feet stay
   *  untucked. */
  tuckLeftFoot?: boolean;
  tuckRightFoot?: boolean;
};

/**
 * The ACTIVE library folder tab. Inactive tabs are deliberately flat
 * (BackgroundTab in PanelTabStrip — no silhouette), so this component only
 * ever renders the active state.
 *
 * Sizing is LAYOUT-OWNED (no measurement): the content row is in-flow, so the
 * wrapper's flex `0 0 auto` width IS the natural content width plus the
 * geometry insets — the tab grows to fit its name (incl. live rename input
 * growth) and never shrinks below the F#15 floor. The old ResizeObserver
 * pair (wrapper-width inversion + intrinsic-width recovery, tasks F#15/088)
 * and the task-090 pane-drag parking existed only to feed a measured SVG
 * `d` string; with the three-piece FolderTabChrome the silhouette tracks the
 * box by layout and all of it is deleted, not parked.
 */
export const PanelFolderTab = forwardRef<HTMLDivElement, Props>(
  function PanelFolderTab(
    {
      fill,
      onClick,
      title,
      children,
      wrapperProps,
      dataTabId,
      tuckLeftFoot,
      tuckRightFoot,
    },
    forwardedRef,
  ) {
    const { style: extraStyle, ...restWrapperProps } = wrapperProps ?? {};

    return (
      <div
        ref={forwardedRef}
        {...restWrapperProps}
        data-tab-id={dataTabId}
        style={{
          position: "relative",
          display: "flex",
          // F#15 (task 088): the active tab RESISTS the squeeze — flex-shrink:0
          // so it holds its natural width (its full title) while the background
          // tabs (flex:"1 1 auto") absorb the squeeze and ellipsize first. Once
          // the backgrounds hit their floor and the strip still overflows, the
          // F#15 scroll-active-into-view effect keeps the active tab visible —
          // the strip scrolls rather than ever ellipsizing the active name.
          // With the in-flow content row below, `auto` basis IS the natural
          // content width — no intrinsic-width measurement needed.
          flex: "0 0 auto",
          // Integer-width discipline: text metrics make max-content
          // FRACTIONAL, and the right cap is positioned off the wrapper's
          // right edge — a fractional wrapper width puts the cap's baked
          // half-pixel stroke shift (INK_SHIFT) off device-pixel phase, so
          // the tab's right edge renders AA-soft. Both retired forks
          // guaranteed integer widths (Math.ceil of the measurement); this
          // reproduces that without measuring: layout still owns the size
          // (max-content), rounded UP to a whole CSS px. calc-size() is
          // Chromium 129+ — Virgil is Chromium-only (FSA).
          width: "calc-size(max-content, round(up, size, 1px))",
          // The reserved-width floor: swoop flares + the ACTIVE_MIN_CONTENT
          // body floor + the F#8 +1 cushion (the historical inner-tab box).
          minWidth: 2 * S + ACTIVE_MIN_CONTENT + 1,
          cursor: "default",
          alignSelf: "flex-end",
          height: V.svgH,
          zIndex: 10,
          // The active tab overlaps the body's 1px top border so its bottom
          // fill row (caps' bridge rects + the middle's background) paints
          // over that border segment — the tab merges seamlessly into the
          // page while the border continues, uncovered, beside it. Fusion by
          // z-order + layout; correct at every width including mid-drag.
          marginBottom: -FOLDER_TAB_SEAM_OVERLAP,
          ...extraStyle,
        }}
        onClick={onClick}
        title={title}
      >
        <FolderTabChrome
          variant="library"
          fill={fill}
          tuckLeft={tuckLeftFoot}
          tuckRight={tuckRightFoot}
        />
        <div
          style={{
            // Above the absolutely-positioned chrome layers.
            position: "relative",
            zIndex: 1,
            display: "flex",
            alignItems: "center",
            gap: 6,
            padding: "0 8px 0 14px",
            // The content row sits over the tab body's flat span, inset by
            // the geometry SSOT (left: the foot flare S; right: S + the F#8
            // +1 cushion) — identical box to the old measured overlay, but
            // in-flow so it SIZES the wrapper instead of being pinned to a
            // measured width. Follows the top gutter down so the label stays
            // vertically centred in the manila shape.
            marginLeft: V.contentInsetLeft,
            marginRight: V.contentInsetRight,
            marginTop: TAB_TOP_GUTTER,
            height: V.tabH,
            minWidth: 0,
          }}
        >
          {children}
        </div>
      </div>
    );
  },
);
