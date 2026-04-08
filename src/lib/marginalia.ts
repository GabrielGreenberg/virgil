/**
 * Marginalia system — shared types and metadata for the gutter icons that
 * sit to the left and right of paragraphs in the editor.
 *
 * Each consumer panel (quotations, notes, archive, revisions, cut) registers
 * markers via the <Marginalia> gutter component. Markers are anchored to a
 * paragraph by its UUID and packed into rows of 3 next to the paragraph's
 * first line.
 */

import type { PanelId } from "@/hooks/useViewPrefs";

export type MarkerType = "quote" | "note" | "archive" | "revision" | "cut";

export interface MarginaliaMarker {
  /** Stable per-marker id (e.g. quotation group id, note id) */
  id: string;
  /** Marker category — drives icon/color */
  type: MarkerType;
  /** Paragraph UUID this marker is anchored to */
  paragraphId: string;
  /** Optional: side override. If omitted, uses MARKER_META[type].defaultSide */
  side?: "left" | "right";
  /** Whether this marker is currently selected/highlighted */
  selected?: boolean;
  /** Click handler — typically opens the panel and selects the item */
  onClick?: () => void;
  /** Tooltip text */
  title?: string;
}

export interface MarkerMeta {
  /** Display label */
  label: string;
  /** Panel id this marker belongs to (used to look up which side is currently docked) */
  panelId: PanelId;
  /** Fallback side if the panel is closed */
  defaultSide: "left" | "right";
  /** Color token for the marker icon */
  color: string;
  /** Hover background */
  bg: string;
  /** Selected background */
  selectedBg: string;
  /** Border color */
  border: string;
  /** SVG path data — rendered inside a 16x16 viewBox */
  icon: React.ReactNode;
}

import * as React from "react";

const QuoteIcon = React.createElement(
  "svg",
  {
    width: 14,
    height: 14,
    viewBox: "0 0 16 16",
    fill: "currentColor",
    stroke: "none",
  },
  React.createElement("path", {
    d: "M3 3.5C3 5.5 4 7 5.5 7.5L4.5 9C3 8.5 1.5 6.8 1.5 4.2c0-2 1.2-3.2 2.8-3.2 1.3 0 2.2.9 2.2 2.1S5.5 5.2 4.2 5.2c-.4 0-.8-.1-1.2-.3v-1.4z",
    transform: "translate(0, 3)",
  }),
  React.createElement("path", {
    d: "M10 3.5C10 5.5 11 7 12.5 7.5L11.5 9C10 8.5 8.5 6.8 8.5 4.2c0-2 1.2-3.2 2.8-3.2 1.3 0 2.2.9 2.2 2.1s-1 2.1-2.3 2.1c-.4 0-.8-.1-1.2-.3v-1.4z",
    transform: "translate(0, 3)",
  })
);

const NoteIcon = React.createElement(
  "span",
  {
    style: {
      fontSize: 11,
      fontWeight: 700,
      fontFamily: "var(--font-sans), system-ui, sans-serif",
      lineHeight: 1,
    },
  },
  "N"
);

const ArchiveIcon = React.createElement(
  "svg",
  {
    width: 14,
    height: 14,
    viewBox: "0 0 16 16",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.4,
    strokeLinecap: "round",
    strokeLinejoin: "round",
  },
  React.createElement("rect", { x: 2, y: 2, width: 12, height: 12, rx: 2.5 }),
  React.createElement("text", {
    x: 8,
    y: 11.2,
    textAnchor: "middle",
    fontSize: 9,
    fontWeight: 600,
    fontFamily: "var(--font-sans), sans-serif",
    fill: "currentColor",
    stroke: "none",
  }, "A")
);

const RevisionIcon = React.createElement(
  "svg",
  {
    width: 14,
    height: 14,
    viewBox: "0 0 16 16",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.3,
    strokeLinecap: "round",
    strokeLinejoin: "round",
  },
  React.createElement("path", {
    d: "M2 2.5h12a.5.5 0 0 1 .5.5v8a.5.5 0 0 1-.5.5H4.5L2 13.5V3a.5.5 0 0 1 .5-.5z",
  })
);

const CutIcon = React.createElement(
  "svg",
  {
    width: 14,
    height: 14,
    viewBox: "0 0 16 16",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.3,
    strokeLinecap: "round",
    strokeLinejoin: "round",
  },
  React.createElement("circle", { cx: 4, cy: 4, r: 2 }),
  React.createElement("circle", { cx: 4, cy: 12, r: 2 }),
  React.createElement("path", { d: "M13 3L5.5 10.5" }),
  React.createElement("path", { d: "M9.5 9.5L13 13" })
);

export const MARKER_META: Record<MarkerType, MarkerMeta> = {
  quote: {
    label: "Quotation",
    panelId: "quotations",
    defaultSide: "left",
    color: "#a16207",
    bg: "#fffbeb",
    selectedBg: "#fde68a",
    border: "#fcd34d",
    icon: QuoteIcon,
  },
  note: {
    label: "Note",
    panelId: "notes",
    defaultSide: "right",
    color: "#15803d",
    bg: "#f0fdf4",
    selectedBg: "#bbf7d0",
    border: "#86efac",
    icon: NoteIcon,
  },
  archive: {
    label: "Archived",
    panelId: "archive",
    defaultSide: "right",
    color: "#5a7a99",
    bg: "#f0f5fa",
    selectedBg: "#dbeafe",
    border: "#a8c1d8",
    icon: ArchiveIcon,
  },
  revision: {
    label: "Revision",
    panelId: "revisions",
    defaultSide: "right",
    color: "#9333ea",
    bg: "#faf5ff",
    selectedBg: "#e9d5ff",
    border: "#d8b4fe",
    icon: RevisionIcon,
  },
  cut: {
    label: "Cut",
    panelId: "cutter",
    defaultSide: "right",
    color: "#b45757",
    bg: "#fef2f2",
    selectedBg: "#fecaca",
    border: "#fca5a5",
    icon: CutIcon,
  },
};

/** Number of icon columns per row in the gutter grid */
export const MARGINALIA_COLS = 3;
/** Size of an individual marker button */
export const MARGINALIA_ICON_SIZE = 22;
/** Vertical spacing between rows */
export const MARGINALIA_ROW_GAP = 2;
/**
 * Width of one gutter (left or right), in pixels.
 * Sized to fit MARGINALIA_COLS columns exactly so markers never overflow
 * the gutter and cause horizontal scroll. The editor column's side padding
 * must be at least this wide.
 */
export const MARGINALIA_GUTTER_WIDTH =
  MARGINALIA_COLS * (MARGINALIA_ICON_SIZE + MARGINALIA_ROW_GAP);
