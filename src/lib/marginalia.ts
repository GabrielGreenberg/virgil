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
 *    presentation row to MARKER_META below (label / icon only — panel +
 *    accent derive from the registry via `src/cards/marker-meta.ts`; the
 *    margin SIDE is not a row, it is resolved from the owning panel's dock by
 *    `src/lib/margin-side.ts`).
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

import type { NodeType } from "@tiptap/pm/model";
import type { Editor } from "@tiptap/react";
import type { EntityKind } from "@/links/_shared/entity-hover";
import type { MarkerType } from "@/cards/types";
// Right-margin geometry SSOT — the overlay-scrollbar footprint the marker
// outer-pad must clear. constants.ts is import-free, so no cycle.
import {
  SCROLLBAR_GUTTER,
  MARKER_SCROLLBAR_GAP,
} from "@/components/editor-layout/constants";

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
// Marginalia host-pod contract (single source of truth)
// ---------------------------------------------------------------------------

/**
 * The DOM attribute marking the white pod (`position: relative`) that both the
 * measurement registry and the renderer key off. The registry measures every
 * block's host-relative `top`/`domTop` against this pod's rect
 * (`useMarginaliaRegistry`), and the renderer `createPortal`s the markers into
 * it (`Marginalia`). Those two must resolve the SAME element by construction,
 * so the attribute name, the selector, and the resolution live here once —
 * never re-derived at a call site. The producer is the pod's JSX attribute
 * (`EditorPane`'s `editor-pane-pod`).
 */
export const MARGINALIA_HOST_ATTR = "data-marginalia-host";

/** The presence selector for {@link MARGINALIA_HOST_ATTR}. */
export const MARGINALIA_HOST_SELECTOR = `[${MARGINALIA_HOST_ATTR}]`;

/**
 * Resolve the marginalia host pod for an editor: the nearest
 * `[data-marginalia-host]` ancestor of the editor's ProseMirror DOM, or `null`
 * (no editor, no view yet, or a detached/reparented view). This is the ONE
 * resolver both readers call — the registry to fix its measurement origin and
 * the renderer to fix its portal target — so their equality is structural, not
 * a hand-mirrored coincidence across two module-local closures.
 */
export function resolveMarginaliaHost(
  editor: Editor | null | undefined,
): HTMLElement | null {
  if (!editor) return null;
  try {
    return (
      (editor.view?.dom?.closest(
        MARGINALIA_HOST_SELECTOR,
      ) as HTMLElement | null) ?? null
    );
  } catch {
    return null;
  }
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
/**
 * Drag a bibliography entry ONTO a citation card to merge its key in. Carried
 * *in addition to* `MIME_CITATION` on a `BibEntryCard` drag (the same drag can
 * still be dropped into prose as an inline `\cite`). A `CitationCard`'s own
 * atom-move drag carries `MIME_CITATION` alone — so the citation-card drop ring
 * gates on THIS type, lighting iff the drop would actually merge (a bib-entry
 * drag), never on a citation-card-over-citation-card drag. Card-merge target
 * only — deliberately NOT in `EDITOR_INSERT_DRAG_TYPES` or `ANCHOR_DRAG_TYPES`.
 */
export const MIME_BIB_MERGE = "application/x-virgil-bib-merge";
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

/**
 * All MIME types the main editor's `handleDrop` accepts as an inline insert /
 * entity placement — a citation, raw text, or a footnote move. The editor's
 * `dragover` handler uses this set to give these drags a clean `"move"` drop
 * affordance instead of the browser's default green-plus `copy` cursor (which
 * an `effectAllowed="copy"` source would otherwise yield over the
 * contenteditable surface). `dropEffect` is purely cosmetic — it does not
 * change what `handleDrop` does with the payload. Sources of these drags must
 * advertise `effectAllowed = "copyMove"` so the `"move"` effect isn't reset to
 * `"none"` here while `"copy"` still works at the panel/card merge targets.
 */
export const EDITOR_INSERT_DRAG_TYPES: readonly string[] = [
  MIME_CITATION,
  MIME_TEXT_INSERT,
  MIME_FOOTNOTE,
];

/** True if the DataTransfer carries an editor inline-insert / placement drag. */
export function isEditorInsertDrag(dt: DataTransfer | null): boolean {
  return (
    dt != null && EDITOR_INSERT_DRAG_TYPES.some((t) => dt.types.includes(t))
  );
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
  /** Optional: per-marker side override. Omitted by every production builder
   *  (the margin follows the panel dock); it is the first rung of
   *  `marginSideForMarkerType`'s override > dock > registry-default ladder and
   *  is exercised by the grid suites, which need a dock-independent side. */
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
  // NOTE (task 205): no `panelId` column either. Its ONE production reader was
  // the grid's `panelSides[meta.panelId]` dock lookup, and that moved into
  // `marginSideForMarkerType`, which derives the panel itself from
  // `CARD_REGISTRY` via `panelForMarkerType`. Leaving it would reproduce, one
  // field over, exactly the written-but-unread column this task deleted
  // `defaultSide` for. Ask `panelForMarkerType(type)` when you need the panel.
  // NOTE (task 205): no `defaultSide` column here any more. It was the THIRD
  // hand-maintained copy of "which side does this panel live on?", alongside
  // `PANEL_REGISTRY.defaultStripSide` and `links.ts`'s `inferMarginSide`
  // switch; the three agreed only by coincidence. The side a marker sits on —
  // override > live dock > registry default — is resolved by
  // `marginSideForMarkerType` (`@/lib/margin-side`), which the anchor rail
  // calls too, so the marker and the rail cannot land on opposite edges.
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
  /**
   * Vertical anchor (px, host-relative) for grid icon positioning. For a prose
   * block this is `opticalCenterY − lineHeight/2`, so the grid's
   * `top + lineHeight/2` (row-0 icon center) lands on the first text line's
   * OPTICAL cap-band center — the same anchor the grab handle uses
   * (`block-frame.ts` `opticalCenterY`), derived via the shared
   * `resolveInlineContextElement` SSOT in `useMarginaliaRegistry.measureBlock`.
   * For an atom / glyph-anchor-override block it is the element's border-box top.
   */
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
import { panelThemeKeyForMarkerType } from "@/cards/marker-meta";

const MARGIN_ICON_SIZE = 16;

const NoteIcon = React.createElement(IconNotes, { size: MARGIN_ICON_SIZE });
const ArchiveIcon = React.createElement(IconArchive, { size: MARGIN_ICON_SIZE });
const RevisionIcon = React.createElement(IconRevisions, { size: MARGIN_ICON_SIZE });
const CutIcon = React.createElement(IconCutter, { size: MARGIN_ICON_SIZE });
const TodoIcon = React.createElement(IconTodo, { size: MARGIN_ICON_SIZE });
const ReportIcon = React.createElement(IconReports, { size: MARGIN_ICON_SIZE });
const ErrorIcon = React.createElement(IconErrors, { size: MARGIN_ICON_SIZE });

/** Build a MARKER_META row. The owning panel and the accent color derive from
 *  `CARD_REGISTRY` via `src/cards/marker-meta.ts` (R17); the default SIDE is
 *  no longer a row at all (task 205 — see the `MarkerMeta` note above: it
 *  lives once on `PANEL_REGISTRY.defaultStripSide` and is read through
 *  `marginSideForMarkerType`). Only the marginalia-local presentation fields
 *  (label / icon) are declared per-row here. All markers share the same
 *  `markerPaletteFromAccent` math so a user color override on a panel
 *  re-tints its margin icon automatically. */
function meta(
  type: MarkerType,
  base: { label: string; icon: React.ReactNode },
): MarkerMeta {
  const palette = markerPaletteFromAccent(
    DEFAULT_PANEL_COLORS[panelThemeKeyForMarkerType(type)],
  );
  return { ...base, ...palette };
}

export const MARKER_META: Record<MarkerType, MarkerMeta> = {
  note:     meta("note",     { label: "Note",      icon: NoteIcon }),
  archive:  meta("archive",  { label: "Archived",  icon: ArchiveIcon }),
  revision: meta("revision", { label: "Revision",  icon: RevisionIcon }),
  cut:      meta("cut",      { label: "Cut",       icon: CutIcon }),
  todo:     meta("todo",     { label: "Todo",      icon: TodoIcon }),
  report:   meta("report",   { label: "Report",    icon: ReportIcon }),
  // error derives from the registry "error" theme key — byte-identical to the
  // old hand-pointed footnote rust accent (DEFAULT_PANEL_COLORS.error ===
  // DEFAULT_PANEL_COLORS.footnote, pinned in marker-meta-derivation.test.ts);
  // same color family as footnotes, distinguished by the icon glyph.
  error:    meta("error",    { label: "Error",     icon: ErrorIcon }),
};

/** Number of icon columns per row in the margin grid */
export const MARGINALIA_COLS = 2;
/** Size of an individual marker button */
export const MARGINALIA_ICON_SIZE = 22;
/** Horizontal spacing between columns */
export const MARGINALIA_COL_GAP = 6;
/** Inner padding between the icon column and the text-pod edge */
export const MARGINALIA_INNER_PAD = 8;

/**
 * Edge length (px) of the square selection-bolt (⚡) button. Hoisted ABOVE the
 * right-lane band list (`RIGHT_LANE_BANDS`) because the bolt is one of its bands
 * (the inboard slot), so the lane width + the bolt/grid offsets all depend on
 * this. The one place the button's pixel size lives is here in the right-margin
 * SSOT (SelectionActionsMenu.tsx imports it for its `width`/`height`). Sized to
 * one menu row's vertical rhythm.
 */
export const MARGINALIA_BOLT_SIZE = 28;

/**
 * Breathing gap between the marker grid's outer (right) edge and the bolt
 * band's left edge — reuses the inter-column gap (6px), so the bolt reads as a
 * third "column" one gap outboard of the marker grid.
 */
export const MARGINALIA_BOLT_MARKER_GAP = MARGINALIA_COL_GAP;
/**
 * Clearance the bolt keeps from the scrollbar gutter when it is tucked into a
 * CRAMPED code-view gutter (the compressed-split fallback in
 * SelectionActionsMenu — the lane isn't reserved, so the bolt sits against the
 * scrollbar rather than in its inboard slot). Equal to the ratified
 * marker→scrollbar gap so the tucked bolt clears the bar by the same margin the
 * grid does. In the NORMAL (lane-reserved) layout the bolt is INBOARD of the
 * grid, so it never abuts the scrollbar — this only bites the cramped tuck.
 */
export const MARGINALIA_BOLT_SCROLLBAR_GAP = MARKER_SCROLLBAR_GAP;

/** Outer padding between the icon column and the panel/viewport edge (LEFT).
 *  Widened to 22px to host the heading fold-chevron in that strip (no scrollbar
 *  on the left). The RIGHT side no longer has a single "outer pad" scalar — its
 *  lane is the ordered `RIGHT_LANE_BANDS` SSOT below (the bolt band is now
 *  INBOARD of the grid, so the lane isn't a simple [outer][icons][inner]). */
export const MARGINALIA_OUTER_PAD_LEFT = 22;
/** Back-compat alias — equal to LEFT, the side whose icon packing
 *  depends on the margin width. */
export const MARGINALIA_OUTER_PAD = MARGINALIA_OUTER_PAD_LEFT;
/**
 * Width of the icon block (both columns + the inter-column gap). Exported so
 * the left-margin geometry can compute the grid's inner edge without
 * re-deriving the column math. Layout (left): [OUTER_PAD] col col [INNER_PAD]
 * [text edge]. (The right side derives its column offsets from the band list.)
 */
export const ICONS_BLOCK_WIDTH =
  MARGINALIA_COLS * MARGINALIA_ICON_SIZE +
  (MARGINALIA_COLS - 1) * MARGINALIA_COL_GAP;
/**
 * Width of the LEFT margin, in px — the left lane hosts the fold-chevron in its
 * outer-pad strip and no scrollbar, so it keeps the simple scalar form.
 */
export const MARGINALIA_MARGIN_WIDTH_LEFT =
  MARGINALIA_OUTER_PAD_LEFT + ICONS_BLOCK_WIDTH + MARGINALIA_INNER_PAD;

// ── Right-lane band SSOT ────────────────────────────────────────────────────
//
// The right margin seats FOUR chrome elements in ONE ordered lane, measured
// rightward from the text edge (= the marker container's left edge, which is
// `podRight − MARGINALIA_MARGIN_WIDTH_RIGHT`) out to the pod's right edge.
// Expressing the lane as a single ordered band list makes disjointness a
// STRUCTURAL invariant — sequential, non-overlapping bands cannot collide, so
// no hand-checked docstring is load-bearing — and gives the bolt x, the marker
// grid x, the scrollbar x, and the `--editor-pr` floor ONE source.
//
// BOLT_PLACEMENT = "inboard": the selection bolt (⚡) is the FIRST band after
// the inner pad — between the text and the markers — so the marginalia markers
// sit to its RIGHT (Gabriel, 2026-07-03). The prior design placed the bolt
// OUTBOARD (at the lane's far edge) AND anchored it to the TEXT edge while the
// markers are POD-anchored; the two coordinate systems only coincided at the
// 104px floor, so dragging the right margin wide slid the pod-anchored markers
// outboard while the text-anchored bolt stayed put → the bolt drifted onto the
// markers. Seating the bolt inboard AND anchoring it to `podRight` (see
// SelectionActionsMenu.computePlacement) makes it margin-invariant and, in code
// view, automatically clipped-edge-correct (the pod is inside the clip).
//
//   text edge → [INNER_PAD 8][BOLT 28][BOLT_MARKER_GAP 6][col0 22][COL_GAP 6]
//               [col1 22][MARKER_SCROLLBAR_GAP 3][SCROLLBAR_GUTTER 9] → pod edge
//
// The total is UNCHANGED at 104: the bolt band was already counted in the lane
// (it just moved from the outer edge to the inboard slot), so the reserved
// `--editor-pr` floor and the visible margin do NOT change — the markers shift
// outward by exactly the bolt band, back to abutting the scrollbar (their
// pre-bolt-band home), and the bolt takes the slot nearest the text.
export const MARGINALIA_BOLT_PLACEMENT = "inboard" as const;

interface RightLaneBand {
  /** Stable key for offset lookups + the disjointness test. */
  readonly key: string;
  /** Band width in px. */
  readonly width: number;
}

/** The ordered right-margin lane, text edge → pod edge. The `col0`/`col1`
 *  bands ARE the marker columns, so the grid x and the bolt x derive from the
 *  same list the scrollbar and the lane width do. */
export const RIGHT_LANE_BANDS: readonly RightLaneBand[] = [
  { key: "inner-pad", width: MARGINALIA_INNER_PAD },
  { key: "bolt", width: MARGINALIA_BOLT_SIZE },
  { key: "bolt-marker-gap", width: MARGINALIA_BOLT_MARKER_GAP },
  { key: "col0", width: MARGINALIA_ICON_SIZE },
  { key: "col-gap", width: MARGINALIA_COL_GAP },
  { key: "col1", width: MARGINALIA_ICON_SIZE },
  { key: "marker-scrollbar-gap", width: MARKER_SCROLLBAR_GAP },
  { key: "scrollbar", width: SCROLLBAR_GUTTER },
];

/** Container-relative left offset (px) of a band = Σ widths before it. Pure;
 *  throws on an unknown key so a typo can't silently read 0. */
export function rightLaneOffset(key: string): number {
  let x = 0;
  for (const band of RIGHT_LANE_BANDS) {
    if (band.key === key) return x;
    x += band.width;
  }
  throw new Error(`unknown right-lane band: ${key}`);
}

/**
 * Width of the RIGHT margin, in px — the sum of every band. Derived from the
 * lane list so it cannot drift from the element offsets. (= 104.)
 */
export const MARGINALIA_MARGIN_WIDTH_RIGHT = RIGHT_LANE_BANDS.reduce(
  (sum, band) => sum + band.width,
  0,
);

/**
 * Container-relative x of the marker grid's col0 (right side). Was
 * `MARGINALIA_INNER_PAD` (8); the inboard bolt band now precedes it, so col0
 * starts at `INNER_PAD + BOLT + BOLT_MARKER_GAP` (= 42). `cellAt` derives the
 * right-side column x from this so the grid and the lane never diverge.
 */
export const MARGINALIA_GRID_X_RIGHT = rightLaneOffset("col0");

/**
 * Container-relative x of the selection bolt's LEFT edge (right side) — the
 * inboard slot, one INNER_PAD off the text edge (= 8). The bolt is pod-anchored
 * at render time: absolute left = `podRight − MARGINALIA_MARGIN_WIDTH_RIGHT +
 * MARGINALIA_BOLT_X_RIGHT` (SelectionActionsMenu.computePlacement).
 */
export const MARGINALIA_BOLT_X_RIGHT = rightLaneOffset("bolt");

/** Back-compat alias — equal to the LEFT margin width. Callers that care
 *  about side should use the side-specific constants above. */
export const MARGINALIA_MARGIN_WIDTH = MARGINALIA_MARGIN_WIDTH_LEFT;

/**
 * Minimum editor margin (the `--editor-pl` / `--editor-pr` prose padding)
 * that still fully reserves the marker lane — i.e. the margin width below
 * which the marker grid would start eating into the prose text, the
 * scrollbar, or (right) collide with the selection bolt.
 *
 * Equal to the full lane width on each side, so when markers are visible the
 * margin is floored at exactly enough to host the lane. ONLY applied when
 * markers are shown (backlog #8 ratified choice): zen reading + the
 * read-only Library reader hide markers, so they keep their margin freedom
 * down to 0 and never have this floor imposed.
 *
 *   right = Σ RIGHT_LANE_BANDS                                       = 104
 *   left  = INNER_PAD(8) + ICONS_BLOCK_WIDTH(50) + OUTER_PAD_LEFT(22)  = 80
 */
export const MARGINALIA_MIN_MARGIN_RIGHT = MARGINALIA_MARGIN_WIDTH_RIGHT;
export const MARGINALIA_MIN_MARGIN_LEFT = MARGINALIA_MARGIN_WIDTH_LEFT;

/** The COMFORTABLE per-side horizontal gutter the editor caps margins at when
 *  the Code pane is open and compressing the editor. A building block of
 *  SplitWithCode's EDITOR_PANE_COMPRESSED_MIN_PX (≈300px prose + one of these
 *  per side + border) — they are NOT the same number and are deliberately
 *  decoupled (398 is visually tuned). A mechanical layout value, not a pref.
 *  Lives here so the compressed-cap-vs-marker-floor resolution
 *  (`resolveHorizontalMargin`) is a single pure, testable unit. */
export const CODE_VIEW_GUTTER_PX = 48;

/**
 * Resolve ONE side's effective horizontal editor margin from its persisted /
 * live value, given (a) whether the Code pane is compressing the editor and
 * (b) whether the marginalia marker lane is reserved.
 *
 * Two competing constraints, resolved by a single ratified priority:
 *   - Compressed code-split caps the margin at the 48px comfort gutter so the
 *     prose column reads cleanly in a narrow code view (the user's deliberate
 *     compression FOR code).
 *   - When markers are shown the margin is floored at the full lane width so
 *     the marker grid never collides with the scrollbar / bolt / text.
 *
 * The lane is NOT reserved in compressed code-split (the caller passes
 * `laneReserved=false` there, mirroring the zen / Library-reader exclusion):
 * the comfort cap WINS, markers gracefully degrade, and the editor keeps its
 * width instead of losing ~150px+ to an unused lane. So the two paths never
 * both fire — when `compress` is true the floor is inactive, and the `Math.max`
 * only bites in the normal markers-on editor (where `compress` is false).
 *
 * Pure (no React, no DOM) so it's unit-testable away from EditorPane.
 */
export function resolveHorizontalMargin(
  margin: number,
  {
    compress,
    laneReserved,
    floor,
  }: { compress: boolean; laneReserved: boolean; floor: number },
): number {
  const capped = compress ? Math.min(margin, CODE_VIEW_GUTTER_PX) : margin;
  return laneReserved ? Math.max(capped, floor) : capped;
}

/**
 * Absolute viewport x (px) of the selection bolt's LEFT edge — POD-anchored.
 *
 * The bolt (the transient ⚡ affordance at the selection head; it lives in the
 * right margin, NOT over the prose) is anchored to `podRight`, not the text
 * edge, so it tracks the pod-anchored marginalia markers instead of drifting
 * onto them. Consequences, both for free from the one anchor change:
 *   - NORMAL view: margin-invariant — dragging `--editor-pr` wide slides text
 *     AND markers AND bolt together; the bolt stays in its inboard slot.
 *   - CODE view: the pod sits INSIDE the code-split clip, so `podRight` is the
 *     VISIBLE (clipped) edge; the bolt follows the shifted margin instead of
 *     painting under the code pane (which the old text-edge anchor did, because
 *     `overflowX:clip` had pushed the prose's natural right edge off-screen).
 *
 * Two regimes, discriminated PURELY by the available right margin
 * (`podRight − editorRight`) so no `compressed` flag has to be threaded in:
 *
 *  - LANE RESERVED (normal markers-on editor, margin ≥ the 104 floor): seat the
 *    bolt in its inboard slot `podRight − MARGIN_WIDTH_RIGHT + BOLT_X_RIGHT` —
 *    between the text and the markers, disjoint from both marker columns AND
 *    the scrollbar by construction (the band SSOT). The slot is FIXED relative
 *    to the pod, so it's statically reserved and never reflows per selection.
 *  - CRAMPED (compressed code-split — only a ~48px gutter, lane NOT reserved):
 *    the inboard slot would land `MARGIN_WIDTH_RIGHT − gutter` px back OVER the
 *    prose, so instead tuck the bolt against the scrollbar inside whatever
 *    gutter exists — `podRight − SCROLLBAR_GUTTER − BOLT_SCROLLBAR_GAP − BOLT` —
 *    but FLOORED at the prose edge (`editorRight + INNER_PAD`). That gutter tuck
 *    is a fixed pod-offset that ignores `editorRight`, so below a ~48px margin it
 *    would itself land back over the prose; the floor makes prose-clearance
 *    structural in this branch too, so the bolt degrades toward the scrollbar as
 *    the margin narrows but never starts left of the text (task 045).
 *
 * Prose-clearance is the invariant in BOTH regimes: the inboard slot is taken
 * only while it clears the prose by at least INNER_PAD (`podRight − editorRight ≥
 * MARGIN_WIDTH_RIGHT`), and the cramped tuck is `Math.max`-floored at
 * `editorRight + INNER_PAD` — so `boltLeft ≥ editorRight + INNER_PAD` holds for
 * every right margin. Pure (no DOM) so the placement is unit-testable away from
 * the component; the caller (SelectionActionsMenu.computePlacement) supplies the
 * two already-cached viewport metrics.
 */
export function computeBoltLeftFromPod({
  podRight,
  editorRight,
}: {
  podRight: number;
  editorRight: number;
}): number {
  const inboard =
    podRight - MARGINALIA_MARGIN_WIDTH_RIGHT + MARGINALIA_BOLT_X_RIGHT;
  if (inboard >= editorRight + MARGINALIA_INNER_PAD) return inboard;
  // Cramped code-view gutter — tuck the bolt against the scrollbar, but FLOOR it
  // at the prose edge so it never overshoots back over the text. The gutter tuck
  // (`podRight − SCROLLBAR_GUTTER − BOLT_SCROLLBAR_GAP − BOLT`) is a fixed
  // pod-offset that ignores `editorRight`, so below a ~48px right margin it lands
  // LEFT of the prose edge; `Math.max` makes prose-clearance structural — the
  // bolt slides toward the scrollbar as the margin narrows but stops at
  // `editorRight + INNER_PAD`, degrading gracefully instead of painting over the
  // last selected words (task 045). At the 48px gutter the two are equal.
  return Math.max(
    podRight -
      SCROLLBAR_GUTTER -
      MARGINALIA_BOLT_SCROLLBAR_GAP -
      MARGINALIA_BOLT_SIZE,
    editorRight + MARGINALIA_INNER_PAD,
  );
}
