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
  "texBlock",
  "exampleBlock",
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
/** Drag raw text content for inline insertion (no entity identity). */
export const MIME_TEXT_INSERT = "application/x-virgil-text-insert";
/** Drag a cut card (Cutter tool) to anchor it to a paragraph. */
export const MIME_CUT = "application/x-virgil-cut";
/**
 * Drag the floating "selection chip" into a side panel (Notes / Revisions /
 * Cutter) to create a linked-margin item anchored to the selected range.
 * Panel-level drop, not gutter-level — intentionally not in ANCHOR_DRAG_TYPES.
 */
export const MIME_SELECTION_ANCHOR = "application/x-virgil-selection-anchor";

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
  MIME_CUT,
];

/** Returns true if the DataTransfer contains a paragraph-level anchor drag. */
export function isAnchorDrag(dt: DataTransfer | null): boolean {
  return dt != null && ANCHOR_DRAG_TYPES.some((t) => dt.types.includes(t));
}

export type MarkerType = "quote" | "note" | "archive" | "revision" | "cut" | "todo" | "error";

export interface MarginaliaMarker {
  /** Stable per-marker id — unique per marker instance (may be composite for multi-anchor) */
  id: string;
  /** Original entity id (e.g. quotation group id, note id) when id is a composite key */
  entityId: string;
  /**
   * Anchored-card kind this marker belongs to. Markers self-subscribe to
   * the global cardStore via this kind + entityId to compute their own
   * selected/hovered state — no prop threading from a parent decoration
   * loop. Optional only because legacy "error" markers (which aren't
   * anchored cards) don't carry it.
   */
  entityKind?:
    | "note" | "highlight" | "footnote" | "citation" | "quotation" | "example"
    | "todo" | "archive" | "comment" | "revision-suggestion"
    | "cutter-comment" | "cutter-suggestion";
  /** Marker category — drives icon/color */
  type: MarkerType;
  /** Paragraph UUID this marker is anchored to */
  paragraphId: string;
  /** Optional: side override. If omitted, uses MARKER_META[type].defaultSide */
  side?: "left" | "right";
  /** Click handler — typically opens the panel and selects the item.
   *  `clickY` is the viewport Y of the clicked gutter marker, used by
   *  the panel host to align the opened card next to the source. */
  onClick?: (clickY?: number) => void;
  /** Remove this anchor (not the underlying data) */
  onDelete?: () => void;
  /** Tooltip text */
  title?: string;
  /** When true the marker renders at reduced opacity (e.g. done todos) */
  muted?: boolean;
  /**
   * Linked anchor id, when this marker is bound to a specific text range
   * via the `linkedAnchor` mark. Used to drive range highlighting on
   * hover/click.
   */
  anchorId?: string;
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
  /** Icon background (constant across all interaction states) */
  bg: string;
  /** Border + interaction-ring color */
  border: string;
  /** SVG path data — rendered inside a 16x16 viewBox */
  icon: React.ReactNode;
}

// ---------------------------------------------------------------------------
// Line-aligned margin grid types
// ---------------------------------------------------------------------------

/** Enhanced position data for a UUID-bearing anchor node */
export interface AnchorNodeMetrics {
  /** Paragraph UUID */
  id: string;
  /** Top of the first text line (px) — used for icon positioning in the grid */
  top: number;
  /** Top of the full DOM element (px) — used for hit-testing in drop resolution */
  domTop: number;
  /** Total height (px) of the node element */
  height: number;
  /** Computed line-height (px) of this specific node type */
  lineHeight: number;
  /** Number of text lines this node occupies */
  lineCount: number;
  /** Whether this node is an atom (displayMath, latexComment) — atoms get 1 line = full height */
  isAtom: boolean;
}

/** A fully resolved grid cell position for a single marker */
export interface GridCell {
  /** 0-based column within the side gutter */
  col: number;
  /** 0-based row corresponding to a text line */
  row: number;
  /** Absolute pixel X offset within the gutter div */
  x: number;
  /** Absolute pixel Y offset within the scroll container */
  y: number;
}

/** A marker with its final pixel position computed by the grid algorithm */
export interface PositionedMarker extends MarginaliaMarker {
  side: "left" | "right";
  cell: GridCell;
  /** Whether this marker overflowed the grid and is clamped to the last row */
  overflow: boolean;
}

import * as React from "react";
import {
  IconQuotations,
  IconNotes,
  IconArchive,
  IconRevisions,
  IconCutter,
  IconTodo,
  IconErrors,
} from "@/components/editor-layout/panel-icons";
import { DEFAULT_PANEL_COLORS, markerPaletteFromAccent } from "@/lib/panel-theme";

const MARGIN_ICON_SIZE = 16;

const QuoteIcon = React.createElement(IconQuotations, { size: MARGIN_ICON_SIZE, hideFrame: true });
const NoteIcon = React.createElement(IconNotes, { size: MARGIN_ICON_SIZE });
const ArchiveIcon = React.createElement(IconArchive, { size: MARGIN_ICON_SIZE });
const RevisionIcon = React.createElement(IconRevisions, { size: MARGIN_ICON_SIZE });
const CutIcon = React.createElement(IconCutter, { size: MARGIN_ICON_SIZE });
const TodoIcon = React.createElement(IconTodo, { size: MARGIN_ICON_SIZE });
const ErrorIcon = React.createElement(IconErrors, { size: MARGIN_ICON_SIZE });

/** Build a MARKER_META row by deriving the color quartet from a panel-theme accent.
 *  All marginalia markers share the same `markerPaletteFromAccent` math so a
 *  user color override on a panel re-tints its gutter icon automatically. */
function meta(
  accentKey: keyof typeof DEFAULT_PANEL_COLORS,
  base: { label: string; panelId: PanelId; defaultSide: "left" | "right"; icon: React.ReactNode },
): MarkerMeta {
  const palette = markerPaletteFromAccent(DEFAULT_PANEL_COLORS[accentKey]);
  return { ...base, ...palette };
}

export const MARKER_META: Record<MarkerType, MarkerMeta> = {
  quote:    meta("quote",    { label: "Quotation", panelId: "quotations", defaultSide: "left",  icon: QuoteIcon }),
  note:     meta("note",     { label: "Note",      panelId: "notes",      defaultSide: "right", icon: NoteIcon }),
  archive:  meta("archive",  { label: "Archived",  panelId: "archive",    defaultSide: "right", icon: ArchiveIcon }),
  revision: meta("revision", { label: "Revision",  panelId: "revisions",  defaultSide: "right", icon: RevisionIcon }),
  cut:      meta("cut",      { label: "Cut",       panelId: "cutter",     defaultSide: "right", icon: CutIcon }),
  todo:     meta("todo",     { label: "Todo",      panelId: "todo",       defaultSide: "right", icon: TodoIcon }),
  // error reuses the footnote rust accent intentionally — same color family,
  // distinguished by the icon glyph.
  error:    meta("footnote", { label: "Error",     panelId: "errors",     defaultSide: "right", icon: ErrorIcon }),
};

/** Number of icon columns per row in the gutter grid */
export const MARGINALIA_COLS = 2;
/** Size of an individual marker button */
export const MARGINALIA_ICON_SIZE = 22;
/** Horizontal spacing between columns */
export const MARGINALIA_COL_GAP = 6;
/** Inner padding between the icon column and the text-pod edge */
export const MARGINALIA_INNER_PAD = 8;
/** Outer padding between the icon column and the panel/viewport edge.
 *  Left is widened to 22px to host the heading fold-chevron in that
 *  strip; right is squeezed to 6px to keep the text column width
 *  unchanged once the editor's horizontal padding shifts to compensate. */
export const MARGINALIA_OUTER_PAD_LEFT = 22;
export const MARGINALIA_OUTER_PAD_RIGHT = 6;
/** Back-compat alias — equal to LEFT, the side whose icon packing
 *  depends on the gutter width. */
export const MARGINALIA_OUTER_PAD = MARGINALIA_OUTER_PAD_LEFT;
/**
 * Width of one gutter, in pixels. Side-specific because the left gutter
 * hosts the fold-chevron in its outer-pad strip.
 * Layout: [OUTER_PAD] col col [INNER_PAD] [text edge]
 */
const ICONS_BLOCK_WIDTH =
  MARGINALIA_COLS * MARGINALIA_ICON_SIZE +
  (MARGINALIA_COLS - 1) * MARGINALIA_COL_GAP;
export const MARGINALIA_GUTTER_WIDTH_LEFT =
  MARGINALIA_OUTER_PAD_LEFT + ICONS_BLOCK_WIDTH + MARGINALIA_INNER_PAD;
export const MARGINALIA_GUTTER_WIDTH_RIGHT =
  MARGINALIA_OUTER_PAD_RIGHT + ICONS_BLOCK_WIDTH + MARGINALIA_INNER_PAD;
/** Back-compat alias — equal to the LEFT gutter width. Callers that care
 *  about side should use the side-specific constants above. */
export const MARGINALIA_GUTTER_WIDTH = MARGINALIA_GUTTER_WIDTH_LEFT;
