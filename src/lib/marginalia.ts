/**
 * Marginalia system — shared types, MIME constants, and metadata for the
 * gutter icons that sit to the left and right of paragraphs in the editor.
 *
 * Each consumer panel (notes, archive, revisions, cut, todo)
 * registers markers via the <Marginalia> gutter component. Markers are
 * anchored to any node that carries a UUID attr and packed into rows next
 * to the node's first line.
 *
 * ## Adding a new marginalia type
 *
 * 1. Add its MIME constant below and include it in the appropriate drag
 *    category (ANCHOR_DRAG_TYPES for paragraph-level anchoring, or leave
 *    it out for inline insertion).
 * 2. Add the token to `MarkerType` (`src/cards/types.ts`), declare it on the
 *    owning card kind(s) in `CARD_REGISTRY` (`markerType` field), and add a
 *    presentation row to MARKER_META below (label / defaultSide / icon —
 *    panel + accent derive from the registry via `src/cards/marker-meta.ts`).
 * 3. Add a drop handler in Editor.tsx's handleDrop chain.
 * 4. Wire the event listener and marker generation in EditorPane.tsx (the
 *    live gutter-marker builder).
 */

import type { PanelId } from "@/hooks/useViewPrefs";
import type { NodeType } from "@tiptap/pm/model";
import type { EntityKind } from "@/links/_shared/entity-hover";
import type { MarkerType } from "@/cards/types";

// Canonical home moved to `src/cards/types.ts` (beside `CardMeta.markerType`,
// A6/R17). Re-exported here so this module's existing importers are unchanged.
export type { MarkerType } from "@/cards/types";

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

// ---------------------------------------------------------------------------
// Centralized MIME type constants
// ---------------------------------------------------------------------------

/** Drag a gutter icon to re-anchor it to a different paragraph. */
export const MIME_MARGINALIA_MOVE = "application/x-virgil-marginalia-move";
/** Drag a note badge to anchor/insert a note. */
export const MIME_NOTE = "application/x-virgil-note";
/** Drag a todo item to anchor it to a paragraph. */
export const MIME_TODO = "application/x-virgil-todo";
/** Drag an archive anchor badge to re-anchor an orphaned snippet. */
export const MIME_ARCHIVE_ANCHOR = "application/x-virgil-archive-anchor-id";

/** Drag a citation to insert it inline. */
export const MIME_CITATION = "application/x-virgil-citation";
/** Drag an archive card to restore its text into the document. */
export const MIME_ARCHIVE = "application/x-virgil-archive-id";
/** Drag a footnote to move it to a new position. */
export const MIME_FOOTNOTE = "application/x-virgil-footnote";
/** Drag raw text content for inline insertion (no entity identity). */
export const MIME_TEXT_INSERT = "application/x-virgil-text-insert";
/** Drag a cut card (Cutter tool) to anchor it to a paragraph. */
export const MIME_CUT = "application/x-virgil-cut";
/** Drag a report card (report or report-request) to anchor it to a paragraph. */
export const MIME_REPORT = "application/x-virgil-report";
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
  MIME_NOTE,
  MIME_TODO,
  MIME_ARCHIVE_ANCHOR,
  MIME_CUT,
  MIME_REPORT,
];

/** Returns true if the DataTransfer contains a paragraph-level anchor drag. */
export function isAnchorDrag(dt: DataTransfer | null): boolean {
  return dt != null && ANCHOR_DRAG_TYPES.some((t) => dt.types.includes(t));
}

export interface MarginaliaMarker {
  /** Stable per-marker id — unique per marker instance (may be composite for multi-anchor) */
  id: string;
  /** Original entity id (e.g. note id) when id is a composite key */
  entityId: string;
  /**
   * Anchored-card kind this marker belongs to. Markers self-subscribe to
   * the global cardStore via this kind + entityId to compute their own
   * selected/hovered state — no prop threading from a parent decoration
   * loop. Optional only because legacy "error" markers (which aren't
   * anchored cards) don't carry it.
   */
  /** Anchored-card kind for the three-surface hover. Was a hand-kept inline
   *  union duplicating `ANCHORED_CARD_KINDS`; now reuses `EntityKind`. */
  entityKind?: EntityKind;
  /** Marker category — drives icon/color */
  type: MarkerType;
  /** TextObject UUID this marker is anchored to. May be any kind in
   *  the `textObject` schema group (paragraph, heading, listItem,
   *  exampleItem, atom blocks, etc.) — the field is kind-agnostic.
   *  Renamed from `paragraphId` in Phase D7. */
  textObjectId: string;
  /** Optional: side override. If omitted, uses MARKER_META[type].defaultSide */
  side?: "left" | "right";
  /** Click handler — typically opens the panel and selects the item.
   *  `clickY` is the viewport Y of the clicked gutter marker, used by
   *  the panel host to align the opened card next to the source. */
  onClick?: (clickY?: number) => void;
  /** Delete this anchor. If it's the last anchor on the underlying card,
   *  delete the card (with a confirm dialog when the card has text); if
   *  other anchors remain, just drop this paragraph link. Routes through
   *  `deleteMarginItem` in `src/lib/cards/delete-margin-item.ts`. */
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
}

/** One overflowing (node, side) grid (R16): the markers that didn't fit in
 *  the node's line grid. The gutter renders a "+K" pill in the reserved
 *  `cell` (the grid's last cell); clicking it opens a popover listing
 *  `hidden` as ordinary marker buttons (click/delete/drag behave normally). */
export interface MarkerOverflowGroup {
  side: "left" | "right";
  /** Reserved last grid cell where the "+K" pill renders. */
  cell: GridCell;
  /** TextObject UUID whose grid overflowed. */
  textObjectId: string;
  /** The markers that did not fit, in builder order. */
  hidden: MarginaliaMarker[];
}

import * as React from "react";
import {
  IconNotes,
  IconArchive,
  IconRevisions,
  IconCutter,
  IconTodo,
  IconReports,
  IconErrors,
} from "@/components/editor-layout/panel-icons";
import { DEFAULT_PANEL_COLORS, markerPaletteFromAccent } from "@/lib/panel-theme";
import {
  panelForMarkerType,
  panelThemeKeyForMarkerType,
} from "@/cards/marker-meta";

const MARGIN_ICON_SIZE = 16;

const NoteIcon = React.createElement(IconNotes, { size: MARGIN_ICON_SIZE });
const ArchiveIcon = React.createElement(IconArchive, { size: MARGIN_ICON_SIZE });
const RevisionIcon = React.createElement(IconRevisions, { size: MARGIN_ICON_SIZE });
const CutIcon = React.createElement(IconCutter, { size: MARGIN_ICON_SIZE });
const TodoIcon = React.createElement(IconTodo, { size: MARGIN_ICON_SIZE });
const ReportIcon = React.createElement(IconReports, { size: MARGIN_ICON_SIZE, hideFrame: true });
const ErrorIcon = React.createElement(IconErrors, { size: MARGIN_ICON_SIZE });

/** Build a MARKER_META row. The owning panel and the accent color derive from
 *  `CARD_REGISTRY` via `src/cards/marker-meta.ts` (R17) — only the
 *  marginalia-local presentation fields (label / defaultSide / icon) are
 *  declared per-row here. All markers share the same
 *  `markerPaletteFromAccent` math so a user color override on a panel
 *  re-tints its gutter icon automatically. */
function meta(
  type: MarkerType,
  base: { label: string; defaultSide: "left" | "right"; icon: React.ReactNode },
): MarkerMeta {
  const palette = markerPaletteFromAccent(
    DEFAULT_PANEL_COLORS[panelThemeKeyForMarkerType(type)],
  );
  return { ...base, panelId: panelForMarkerType(type), ...palette };
}

export const MARKER_META: Record<MarkerType, MarkerMeta> = {
  note:     meta("note",     { label: "Note",      defaultSide: "right", icon: NoteIcon }),
  archive:  meta("archive",  { label: "Archived",  defaultSide: "right", icon: ArchiveIcon }),
  revision: meta("revision", { label: "Revision",  defaultSide: "right", icon: RevisionIcon }),
  cut:      meta("cut",      { label: "Cut",       defaultSide: "right", icon: CutIcon }),
  todo:     meta("todo",     { label: "Todo",      defaultSide: "right", icon: TodoIcon }),
  report:   meta("report",   { label: "Report",    defaultSide: "left",  icon: ReportIcon }),
  // error derives from the registry "error" theme key — byte-identical to the
  // old hand-pointed footnote rust accent (DEFAULT_PANEL_COLORS.error ===
  // DEFAULT_PANEL_COLORS.footnote, pinned in marker-meta-derivation.test.ts);
  // same color family as footnotes, distinguished by the icon glyph.
  error:    meta("error",    { label: "Error",     defaultSide: "right", icon: ErrorIcon }),
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
