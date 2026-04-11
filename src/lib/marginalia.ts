/**
 * Marginalia system — shared types, MIME constants, and metadata for the
 * gutter icons that sit to the left and right of paragraphs in the editor.
 *
 * Each consumer panel (quotations, notes, archive, revisions, cut, todo)
 * registers markers via the <Marginalia> gutter component. Markers are
 * anchored to any node that carries a UUID attr and packed into rows next
 * to the node's first line.
 *
 * ## Adding a new marginalia type
 *
 * 1. Add its MIME constant below and include it in the appropriate drag
 *    category (ANCHOR_DRAG_TYPES for paragraph-level anchoring, or leave
 *    it out for inline insertion).
 * 2. Add an entry to MarkerType and MARKER_META.
 * 3. Add a drop handler in Editor.tsx's handleDrop chain.
 * 4. Wire the event listener and marker generation in EditorLayout.tsx.
 */

import type { PanelId } from "@/hooks/useViewPrefs";
import type { NodeType } from "@tiptap/pm/model";

// ---------------------------------------------------------------------------
// Anchor-target detection (schema-based)
// ---------------------------------------------------------------------------

/**
 * Returns true if the given node type can serve as a marginalia anchor target.
 * Detection: the node type's attribute spec declares a `uuid` attribute.
 */
export function isAnchorableNode(nodeType: NodeType): boolean {
  return nodeType.spec.attrs?.uuid !== undefined;
}

/**
 * Returns true if the anchorable node is an atom (no interior cursor
 * positions). Atoms need DOM-rect-based position computation instead of
 * coordsAtPos.
 */
export function isAnchorableAtom(nodeType: NodeType): boolean {
  return isAnchorableNode(nodeType) && nodeType.isAtom;
}

/** @deprecated Use `isAnchorableNode(node.type)` instead. */
export const ANCHORABLE_NODES = new Set([
  "paragraph",
  "heading",
  "bulletList",
  "orderedList",
  "displayMath",
  "latexComment",
  "titleField",
  "blockquote",
  "codeBlock",
]);

/** @deprecated Use `isAnchorableAtom(node.type)` instead. */
export const ANCHORABLE_ATOMS = new Set(["displayMath", "latexComment"]);

// ---------------------------------------------------------------------------
// Centralized MIME type constants
// ---------------------------------------------------------------------------

/** Drag a gutter icon to re-anchor it to a different paragraph. */
export const MIME_MARGINALIA_MOVE = "application/x-virgil-marginalia-move";
/** Drag a quotation group card to anchor it to a paragraph. */
export const MIME_QUOTATION = "application/x-virgil-quotation";
/** Drag a note badge to anchor/insert a note. */
export const MIME_NOTE = "application/x-virgil-note";
/** Drag a todo item to anchor it to a paragraph. */
export const MIME_TODO = "application/x-virgil-todo";
/** Drag an archive anchor badge to re-anchor an orphaned snippet. */
export const MIME_ARCHIVE_ANCHOR = "application/x-virgil-archive-anchor-id";

/** Drag an individual quote pod to insert quoted text + citation. */
export const MIME_QUOTE = "application/x-virgil-quote";
/** Drag a citation to insert it inline. */
export const MIME_CITATION = "application/x-virgil-citation";
/** Drag an archive card to restore its text into the document. */
export const MIME_ARCHIVE = "application/x-virgil-archive-id";
/** Drag a footnote to move it to a new position. */
export const MIME_FOOTNOTE = "application/x-virgil-footnote";
/** Drag an AI request marker into the editor. */
export const MIME_AI_REQUEST = "application/x-virgil-ai-request";

/**
 * All MIME types that represent paragraph-level anchor/link operations.
 * These trigger the vertical drop indicator and suppress ProseMirror's
 * native horizontal dropcursor.
 */
export const ANCHOR_DRAG_TYPES: readonly string[] = [
  MIME_MARGINALIA_MOVE,
  MIME_QUOTATION,
  MIME_NOTE,
  MIME_TODO,
  MIME_ARCHIVE_ANCHOR,
];

/** Returns true if the DataTransfer contains a paragraph-level anchor drag. */
export function isAnchorDrag(dt: DataTransfer | null): boolean {
  return dt != null && ANCHOR_DRAG_TYPES.some((t) => dt.types.includes(t));
}

export type MarkerType = "quote" | "note" | "archive" | "revision" | "cut" | "todo";

export interface MarginaliaMarker {
  /** Stable per-marker id — unique per marker instance (may be composite for multi-anchor) */
  id: string;
  /** Original entity id (e.g. quotation group id, note id) when id is a composite key */
  entityId: string;
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
  /** Remove this anchor (not the underlying data) */
  onDelete?: () => void;
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

const TodoIcon = React.createElement(
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
  React.createElement("path", { d: "M5 8l2 2 4-4" })
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
  todo: {
    label: "Todo",
    panelId: "todo",
    defaultSide: "right",
    color: "#0369a1",
    bg: "#f0f9ff",
    selectedBg: "#bae6fd",
    border: "#7dd3fc",
    icon: TodoIcon,
  },
};

/** Number of icon columns per row in the gutter grid */
export const MARGINALIA_COLS = 2;
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
