/**
 * Marginalia system — shared types, MIME constants, and metadata for the
 * margin icons that sit to the left and right of paragraphs in the editor.
 *
 * Each consumer panel (notes, archive, revisions, cut, todo)
 * registers markers via the <Marginalia> margin component. Markers are
 * anchored to any node that carries a UUID attr and packed into rows next
 * to the node's first line.
 *
 * ## Adding a new marginalia type
 *
 * 1. Add the token to `MarkerType` (`src/cards/types.ts`), declare it on the
 *    owning card kind(s) in `CARD_REGISTRY` (`markerType` field), and add a
 *    presentation row to MARKER_META below (label / defaultSide / icon —
 *    panel + accent derive from the registry via `src/cards/marker-meta.ts`).
 * 2. Register a `dropSpec` for each owning card kind (the
 *    `textObjectSideReanchorSpec` factory wired to a `ParagraphAnchorApi`
 *    sub-bag on the `DropCtx`) so the margin pin can re-anchor it through the
 *    unified drop-mode controller. Wire that sub-bag in `EditorPane`'s
 *    `DropModeProvider`.
 * 3. Emit the marker in EditorPane.tsx's `marginaliaMarkers` builder, carrying
 *    `entityKind` (the real CardKind) so the pin's `beginCardDropGesture`
 *    builds the correct `float:card:<kind>:<id>` key.
 *
 * The `MIME_*` constants below are now ONLY the inline-insertion DnD payloads
 * (citation / footnote / archive-restore / raw text). The old native
 * paragraph-anchor drags (panel→margin, margin-pin re-anchor) were folded onto
 * the drop-mode controller; `ANCHOR_DRAG_TYPES` is the residual suppress-set.
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

/**
 * Residual paragraph-anchor suppress token. The margin-pin re-anchor gesture
 * that used to set this MIME no longer exists — it was folded onto the unified
 * drop-mode controller (chip H). No code produces this DataTransfer type
 * anymore; it is kept ONLY as the lone member of `ANCHOR_DRAG_TYPES` so
 * `isAnchorDrag` stays a live (if currently never-true) guard that suppresses
 * ProseMirror's native dropcursor / inline-insert misread for any future
 * native paragraph-anchor drag that opts back into this token.
 */
export const MIME_MARGINALIA_MOVE = "application/x-virgil-marginalia-move";

/** Drag a citation to insert it inline. */
export const MIME_CITATION = "application/x-virgil-citation";
/** Drag an archive card to restore its text into the document. */
export const MIME_ARCHIVE = "application/x-virgil-archive-id";
/** Drag a footnote to move it to a new position. */
export const MIME_FOOTNOTE = "application/x-virgil-footnote";
/** Drag raw text content for inline insertion (no entity identity). */
export const MIME_TEXT_INSERT = "application/x-virgil-text-insert";
/**
 * Drag the floating "selection chip" into a side panel (Notes / Revisions /
 * Cutter) to create a linked-margin item anchored to the selected range.
 * Panel-level drop, not margin-level — intentionally not in ANCHOR_DRAG_TYPES.
 */
export const MIME_SELECTION_ANCHOR = "application/x-virgil-selection-anchor";

/**
 * All MIME types that represent paragraph-level anchor/link operations.
 * These trigger the vertical drop indicator and suppress ProseMirror's
 * native horizontal dropcursor.
 */
export const ANCHOR_DRAG_TYPES: readonly string[] = [
  MIME_MARGINALIA_MOVE,
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
   * Anchored-card kind this marker belongs to (`EntityKind` = `CardKind`).
   * Two roles:
   *  1. Markers self-subscribe to the global cardStore via this kind +
   *     entityId to compute their own selected/hovered state (the three-surface
   *     hover) — no prop threading from a parent decoration loop.
   *  2. It is the precise CardKind the margin-pin re-anchor gesture uses to
   *     build the `float:card:<kind>:<id>` key for `beginCardDropGesture`
   *     (chip H). The marker builder knows the real kind (e.g. cut →
   *     `cutter-comment`/`cutter-suggestion`, report → `report`/`report-request`),
   *     so the pin needs no `MarkerType`→CardKind disambiguation.
   * Optional only because the non-card "error" marker (not an anchored card,
   * not re-anchorable) doesn't carry it — a pin without `entityKind` is
   * click-only, never grabbable.
   */
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
   *  `clickY` is the viewport Y of the clicked margin marker, used by
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
  /**
   * CHIP-B: the card's anchor resolved to `source:'orphan'` (its stored
   * uuid + mark + text-snapshot are ALL dead in the live doc — see
   * `resolveCardAnchor`). The card still exists in its sidecar but has no
   * live paragraph to sit beside. The grid CANNOT line-align an orphan (no
   * paragraph metrics), so instead of silently culling it (the RC2 "card
   * vanishes" bug) the margin surfaces it in a fixed "unanchored — click to
   * re-pin" dock. `textObjectId` still carries the card's last-known stored
   * pid so the marker keys stably and the re-pin grab gesture has a kind+id.
   */
  unanchored?: boolean;
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
  /** 0-based column within the side margin */
  col: number;
  /** 0-based row corresponding to a text line */
  row: number;
  /** Absolute pixel X offset within the margin div */
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
 *  the node's line grid. The margin renders a "+K" pill in the reserved
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
 *  re-tints its margin icon automatically. */
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

/** Number of icon columns per row in the margin grid */
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
 *  depends on the margin width. */
export const MARGINALIA_OUTER_PAD = MARGINALIA_OUTER_PAD_LEFT;
/**
 * Width of one margin, in pixels. Side-specific because the left margin
 * hosts the fold-chevron in its outer-pad strip.
 * Layout: [OUTER_PAD] col col [INNER_PAD] [text edge]
 */
const ICONS_BLOCK_WIDTH =
  MARGINALIA_COLS * MARGINALIA_ICON_SIZE +
  (MARGINALIA_COLS - 1) * MARGINALIA_COL_GAP;
export const MARGINALIA_MARGIN_WIDTH_LEFT =
  MARGINALIA_OUTER_PAD_LEFT + ICONS_BLOCK_WIDTH + MARGINALIA_INNER_PAD;
export const MARGINALIA_MARGIN_WIDTH_RIGHT =
  MARGINALIA_OUTER_PAD_RIGHT + ICONS_BLOCK_WIDTH + MARGINALIA_INNER_PAD;
/** Back-compat alias — equal to the LEFT margin width. Callers that care
 *  about side should use the side-specific constants above. */
export const MARGINALIA_MARGIN_WIDTH = MARGINALIA_MARGIN_WIDTH_LEFT;
