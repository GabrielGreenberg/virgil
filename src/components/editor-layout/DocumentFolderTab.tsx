"use client";

import { memo, type ReactNode } from "react";
import { FolderTabChrome } from "@/components/chrome/FolderTabChrome";
import {
  FOLDER_TAB_SEAM_OVERLAP,
  FOLDER_TAB_VARIANTS,
  TAB_TOP_GUTTER,
} from "@/components/chrome/folder-tab-geometry";

// The topbar variant of the shared folder-tab chrome (geometry SSOT at
// src/components/chrome/folder-tab-geometry.ts): tabH 30, --topbar-border
// stroke, full-span seam bridge, footprint 2S + content (the F#8 stroke
// cushion overhangs instead of widening the box, preserving the
// inline↔folder pixel-stability contract with InlineTabLabel /
// ACTIVE_TAB_*_SHIFT_PX). The inner library tabs render the SAME chrome
// module with the "library" variant — one implementation, no forked
// geometry (the old src/components/editor-layout/folder-path.ts fork, whose
// zero-cushion top stroke was the outer strip's missing-top-outline defect,
// is deleted).
const V = FOLDER_TAB_VARIANTS.topbar;

type Props = {
  fill: string;
  onClick?: () => void;
  /** Tooltip / aria label (e.g., the doc folder name). */
  title?: string;
  /** Forwarded for color-picker integration. */
  dataPrefs?: string;
  /** Tab content (icon, label, close button). Width is layout-owned. */
  children: ReactNode;
};

/**
 * The ACTIVE outer Virgil-bar folder tab (documents, papers, libraries).
 * Inactive outer tabs are deliberately flat (InlineTabLabel — no
 * silhouette), so this component only ever renders the active state.
 *
 * The silhouette is the shared three-piece FolderTabChrome: two constant SVG
 * end caps + a stretchable middle. The content row is in-flow, so the tab
 * sizes to its label by layout — the old content ResizeObserver is deleted,
 * not parked. The stroke omits the bottom edge; the bottom fill row overlaps
 * the topbar's border-b by 1px (negative margin) so the active tab merges
 * into the canvas below.
 */
function DocumentFolderTabImpl({ fill, onClick, title, dataPrefs, children }: Props) {
  return (
    <div
      data-prefs={dataPrefs}
      className="relative flex shrink-0 cursor-default self-end"
      style={{
        height: V.svgH,
        // Integer-width discipline: max-content is fractional (text
        // metrics), and the right cap hangs off the wrapper's right edge —
        // a fractional width defeats the cap's baked half-pixel stroke
        // crispness (INK_SHIFT). Round the layout-owned width UP to a whole
        // CSS px, reproducing the old fork's Math.ceil(measured) without
        // measurement. calc-size() is Chromium 129+ — Virgil is
        // Chromium-only (FSA).
        width: "calc-size(max-content, round(up, size, 1px))",
        zIndex: 10,
        // Sit with the bottom fill row below the topbar's content area,
        // overlapping the topbar's bottom border: the open-bottom stroke +
        // matching body color merge the tab into the canvas.
        marginBottom: -FOLDER_TAB_SEAM_OVERLAP,
      }}
      onClick={onClick}
      data-hint={title}
      aria-label={title}
    >
      <FolderTabChrome variant="topbar" fill={fill} />
      {/* Tab content sits over the narrow tab portion, vertically centered.
          The S-wide swoop flare on each side is decorative; content is
          inset by the geometry SSOT and — being in-flow — SIZES the tab. */}
      <div
        className="relative flex items-center gap-1.5 pl-3.5 pr-1 text-ink-strong"
        style={{
          zIndex: 1,
          marginLeft: V.contentInsetLeft,
          marginRight: V.contentInsetRight,
          marginTop: TAB_TOP_GUTTER,
          height: V.tabH,
          minWidth: 80,
        }}
      >
        {children}
      </div>
    </div>
  );
}

export const DocumentFolderTab = memo(DocumentFolderTabImpl);
