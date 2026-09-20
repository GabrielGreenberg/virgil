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
  MIME_FOOTNOTE,
];

/** True if the DataTransfer carries an editor inline-insert / placement drag. */
export function isEditorInsertDrag(dt: DataTransfer | null): boolean {
  return (
    dt != null && EDITOR_INSERT_DRAG_TYPES.some((t) => dt.types.includes(t))
  );
}

// ---------------------------------------------------------------------------
// Which of these MIMEs anyone actually WRITES (task 590)
// ---------------------------------------------------------------------------

/**
 * **A drag MIME's liveness is DATA, not prose.**
 *
 * Every custom `application/x-virgil-*` type above is half a contract: a
 * PRODUCER somewhere calls `dataTransfer.setData(MIME, …)` and a READER
 * somewhere calls `getData` / tests `types`. When a producer is deleted the
 * reader keeps type-checking, keeps rendering, and keeps looking live — and the
 * only record of which half survives is a hand-written comment beside the
 * reader. Those comments rot in the one direction that matters: `StackIcon`'s
 * said "today the only live HTML5 producer is `MIME_TEXT_INSERT`" for three
 * months after `ec382103` deleted the last `setData` for it, and the handler it
 * described would have been WRONG if revived (it bypassed `lib/stack/snapshot`
 * entirely). `MIME_SELECTION_ANCHOR` went further still — no producer, no
 * reader, just an exported string and a paragraph describing a gesture that was
 * never built.
 *
 * So each surviving MIME states its own answer here, and
 * [drag-mime-production.test.ts](__tests__/drag-mime-production.test.ts) checks
 * the statement against the two silos' actual `setData` call sites:
 *
 * - `produced: true` must have at least one real producer — delete the last one
 *   and the suite fails rather than leaving a reader to rot.
 * - `produced: false` must have NONE — add a producer and the suite makes you
 *   come here and say so, which is where the reader's own comment gets fixed.
 * - Either way, a MIME must have a READER outside this module. A constant
 *   nobody writes and nobody reads is not a residual, it is litter, and the
 *   registry is where that gets decided out loud instead of by a grep three
 *   months later ("a registry earns its name by being read").
 *
 * A `produced: false` row is therefore not a bug — `MIME_MARGINALIA_MOVE` and
 * `MIME_FOOTNOTE` are deliberate ARMED readers, latent traps that close the
 * moment their gesture returns. The rule is only that the deliberateness is
 * written down where the check can see it.
 */
export type DragMimeProduction = {
  /** The exported constant's NAME — what a `setData(…)` call site spells. */
  readonly constant: string;
  /** Its value, so the census can also catch a raw-string producer. */
  readonly mime: string;
} & (
  | { readonly produced: true }
  /** No `setData` anywhere: why the reader is kept anyway. */
  | { readonly produced: false; readonly retainedBecause: string }
);

export const DRAG_MIME_PRODUCTION: readonly DragMimeProduction[] = [
  {
    constant: "MIME_MARGINALIA_MOVE",
    mime: MIME_MARGINALIA_MOVE,
    produced: false,
    retainedBecause:
      "the lone ANCHOR_DRAG_TYPES member, so isAnchorDrag stays a live " +
      "dropcursor suppressor for any future native paragraph-anchor drag",
  },
  { constant: "MIME_CITATION", mime: MIME_CITATION, produced: true },
  { constant: "MIME_BIB_MERGE", mime: MIME_BIB_MERGE, produced: true },
  {
    constant: "MIME_ARCHIVE",
    mime: MIME_ARCHIVE,
    produced: false,
    retainedBecause:
      "the archive-card restore drag is read by EditorLayout's drop and " +
      "RichTextField's drop/dragover; the card-side drag handle is owed, and " +
      "its drop path is the one that already works",
  },
  {
    constant: "MIME_FOOTNOTE",
    mime: MIME_FOOTNOTE,
    produced: false,
    retainedBecause:
      "Editor.tsx's footnote-move drop is deliberately retained behind the " +
      "task-396 container gate — an armed latent-trap closure for the moment " +
      "a footnote-card drag returns",
  },
];

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
   * vanishes" bug) it is surfaced OUTSIDE the lane, in the pane's sticky
   * chrome header (`UnanchoredCardsChip`, task 410) — a card that lost its
   * anchor is a fact about the CARD, not about the margin's geometry, and an
   * affordance for it must be reachable at any scroll position and on a side
   * the lane is too cramped to host. `textObjectId` still carries the card's
   * last-known stored pid so the marker keys stably and the re-pin grab
   * gesture has a kind+id.
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
   * `resolveFirstLineTarget` SSOT in `useMarginaliaRegistry.measureBlock`.
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

/** Markers the grid could not place as cells. The margin renders a "+K" pill
 *  at `cell`; clicking it opens a popover listing `hidden` as ordinary marker
 *  buttons (click/delete/drag behave normally — they resolve their card by id,
 *  never by position, so a hidden marker is fully live).
 *
 *  Two producers, one shape:
 *   - R16, an over-full grid: more markers than the node's `lineCount × cols`,
 *     so the grid's LAST cell is reserved for the pill and the surplus hides.
 *   - Task 366, a folded crowd: block tops packed so tightly that not even
 *     ROW 0 of this node's grid fits within `MARGINALIA_MAX_MARKER_DRIFT` of
 *     its own line, so the node's markers fold into a pill placed clear of the
 *     rows above. Consecutive folded nodes share ONE pill, which is what stops
 *     a crowd from becoming a ladder of ever-more-drifted markers.
 *
 *  The two producers are one rule asked at two rows, not two rules (task 673):
 *  a cell is placed only where it lands within the bound of its own line, and
 *  what fails the bound rides a pill. Failing at row 0 means the node has no
 *  home on this side at all, so it joins the crowd's shared pill; failing at a
 *  LOWER row means the node has a home but not enough room in it, so the
 *  surplus takes the node's own R16 pill. */
export interface MarkerOverflowGroup {
  side: "left" | "right";
  /** Grid cell where the "+K" pill renders — the over-full grid's reserved
   *  last cell, or (for a folded crowd) the next free row on the side. */
  cell: GridCell;
  /** TextObject UUID that minted this pill: the node whose grid overflowed,
   *  or the FIRST node folded into this crowd. Either way it is a node that
   *  produces no other overflow group, so it is a unique key per (side, pill). */
  textObjectId: string;
  /** The markers that did not fit, in builder order (crowd: node order). */
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

// ── Vertical collision resolution (task 366) ────────────────────────────────
//
// A marker row's footprint is one icon tall. The grid places each anchor
// NODE's rows at that node's own line pitch, which is correct WITHIN a node
// and says nothing about the node next door — so wherever consecutive block
// tops sit closer together than an icon (a title/author/date stack, a run of
// short headings, small-print lines), two nodes' grids print on top of each
// other. `computeMarkerPositions` therefore runs ONE frontier walk per side
// over every row it is about to place. These two numbers are what that walk
// is allowed to do; they live here, in the margin-geometry SSOT, beside the
// icon size they are derived from.

/**
 * Hairline the collision walk leaves between two marker rows it had to
 * separate. Equal to the gap the canonical prose rhythm already produces (a
 * 24px line minus the 22px icon), so a pushed marker reads exactly like an
 * ordinary second row — and, because the walk fires only where a row would
 * land closer than this, an uncrowded document is placed byte-identically to
 * the pre-366 grid.
 */
export const MARGINALIA_ROW_MIN_GAP = 2;

/**
 * How far (px) the walk may push a marker BELOW the line it anchors to before
 * it stops pushing and folds the node's markers into a "+K" overflow pill
 * instead. Two icon heights: past that a marker reads as belonging to a
 * different paragraph, and a pill at the crowd is more honest than a marker
 * sitting beside the wrong text.
 *
 * Two limits worth stating rather than implying:
 *
 *  - The bound is on the PUSH, not on the pill. Once a crowd is dense enough
 *    that no cell fits within the bound, the pill it collapses into is itself
 *    placed clear of the frontier (i.e. further than the bound from the anchor
 *    it was minted for). That is inherent — there is no room — and one pill for
 *    the whole crowd is strictly better than a ladder of drifting markers.
 *  - It is measured at EVERY row, not only at a grid's first (task 673). It
 *    was first-row-only until then, on the reasoning that a lower row is
 *    "still beside its own block" — true only while the node's pitch is roomy
 *    enough to keep the pushes inside the block. Below a 24px pitch (icon +
 *    min gap) each row is displaced by `24 − lineHeight` CUMULATIVELY, so the
 *    drift grows without bound and the frontier is left below the block's true
 *    bottom, where it pushes or folds the node next door. 19.04px is reachable
 *    at the shipped preference sliders' minimum, so this was live, not latent.
 *    What the old reasoning was protecting survives intact: a row past the
 *    bound does NOT fold the node — it ENDS the node's grid, and the surplus
 *    rides the node's own "+K" pill (the R16 affordance for "more markers than
 *    this grid can show"). Nothing the reader can see beside its own line is
 *    hidden; the grid's capacity just stops overstating what fits.
 */
export const MARGINALIA_MAX_MARKER_DRIFT = 2 * MARGINALIA_ICON_SIZE;

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
 * Width of the LEFT marker CONTAINER, in px — the pod-anchored box
 * `MarginColumn` paints the left cells inside. It is NOT the left margin's
 * floor: since task 670 that is {@link MARGINALIA_MIN_MARGIN_LEFT}, summed from
 * {@link LEFT_LANE_BANDS}. The two were equal (80) while the chevron was an
 * undeclared occupant; keeping them separate is the point — the container is a
 * painting box on ONE anchor, the floor spans BOTH.
 */
export const MARGINALIA_MARGIN_WIDTH_LEFT =
  MARGINALIA_OUTER_PAD_LEFT + ICONS_BLOCK_WIDTH + MARGINALIA_INNER_PAD;

// ── Left-lane band SSOT (task 670) ──────────────────────────────────────────
//
// The LEFT margin seats its occupants in ONE ordered lane, pod edge → text
// edge — but unlike the right, its bands are anchored to TWO DIFFERENT EDGES,
// and that is the whole finding this list exists to make unrepresentable:
//
//   • the marker grid is POD-anchored (`MarginColumn` is `left: 0` on the pod,
//     so col0 sits at a FIXED offset from `podLeft` whatever the margin is);
//   • the fold chevron and the grab handle are CONTENT-anchored (they are
//     `position:absolute` inside `.heading-wrapper` / `.source-pod`, whose left
//     edge IS the prose content edge, so they slide with the text).
//
// Two stacks growing toward each other from opposite ends of the same strip
// therefore only coincide at ONE margin — 88px, the shipped `--editor-pl`,
// which is exactly why the collision was invisible. Narrow the margin and the
// text-anchored stack walks onto the pod-anchored one: at the pre-670
// markers-on floor (80) the chevron's 14px box overlapped col0's badge by 8px,
// and because the badge is `pointer-events:auto` under a `zIndex:10` container
// while the chevron is `z-index:1` in a pod that establishes no stacking
// context, the badge ate the chevron's clicks. This is task 325 (the bolt
// painting over col1) rotated onto the other margin.
//
//   pod edge → [outer-pad 22][col0 22] … [chevron 14][chevron-text-gap 30] ← text edge
//
// Stating the anchor PER BAND is what makes the sum meaningful: the lane's
// width is the smallest margin at which the two stacks are still disjoint, so
// `MARGINALIA_MIN_MARGIN_LEFT` (= 88) is DERIVED rather than the hand-typed
// coincidence it used to be, and `resolveLeftLane` degrades the inboard-most
// pod band below it instead of letting the stacks interleave.
export const MARGINALIA_LEFT_LANE_ANCHORS = ["pod", "text"] as const;
export type LaneAnchor = (typeof MARGINALIA_LEFT_LANE_ANCHORS)[number];

interface LeftLaneBand {
  /** Stable key for offset lookups + the disjointness sweep. */
  readonly key: string;
  /** Band width in px. */
  readonly width: number;
  /** Which edge the band's position is measured from. `"pod"` bands are laid
   *  out rightward from `podLeft`; `"text"` bands leftward from the prose
   *  content edge. */
  readonly anchor: LaneAnchor;
}

/**
 * Effective marker COLUMNS on the LEFT side. The left grid uses a single
 * column: its inner slot is reserved across all paragraphs and headings for the
 * block's grab handle / popout affordance, so a marker never lands there.
 * Hoisted to a const (rather than living only inside
 * {@link marginaliaEffectiveCols}) because {@link LEFT_LANE_BANDS} is a
 * module-scope const that has to enumerate those columns.
 */
export const MARGINALIA_EFFECTIVE_COLS_LEFT = 1;

/**
 * Distance (px) from the prose content edge LEFTWARD to the fold-chevron
 * column's outer edge — the CSS `--margin-col-chevron: -44px` offset, sign
 * flipped so it reads as a distance like every other band width.
 *
 * Authored here rather than only in `globals.css` so the lane list can contain
 * the chevron at all. The stylesheet stays the renderer's spelling and
 * `block-frame.ts` still READS the live token (a per-block override must win);
 * these constants are the lane's statement of it and the token's fallback, and
 * `marginalia-left-margin-geometry.test.ts` pins the two to each other so the
 * CSS is a derived output rather than an independent knob.
 */
export const MARGIN_COL_CHEVRON_WIDTH = 14;
/** The authored CSS value of `--margin-col-chevron` — NEGATIVE, because it is a
 *  CSS `left` offset from the block's own left edge, not a distance. */
export const MARGIN_COL_CHEVRON_OFFSET = -44;
/** …the same offset as a leftward DISTANCE from the content edge (= 44). */
export const MARGINALIA_CHEVRON_INSET = -MARGIN_COL_CHEVRON_OFFSET;

/** The ordered left-margin lane, pod edge → text edge. The `col*` bands ARE the
 *  marker columns and the `chevron` band IS the fold affordance's column, so the
 *  grid x, the chevron x and the margin floor all derive from this one list. */
export const LEFT_LANE_BANDS: readonly LeftLaneBand[] = [
  { key: "outer-pad", width: MARGINALIA_OUTER_PAD_LEFT, anchor: "pod" },
  ...Array.from(
    { length: MARGINALIA_EFFECTIVE_COLS_LEFT },
    (_unused, col): readonly LeftLaneBand[] =>
      col === 0
        ? [{ key: "col0", width: MARGINALIA_ICON_SIZE, anchor: "pod" }]
        : [
            { key: `col-gap-${col}`, width: MARGINALIA_COL_GAP, anchor: "pod" },
            { key: `col${col}`, width: MARGINALIA_ICON_SIZE, anchor: "pod" },
          ],
  ).flat(),
  { key: "chevron", width: MARGIN_COL_CHEVRON_WIDTH, anchor: "text" },
  {
    key: "chevron-text-gap",
    width: MARGINALIA_CHEVRON_INSET - MARGIN_COL_CHEVRON_WIDTH,
    anchor: "text",
  },
];

/** Offset (px) of a left-lane band from the edge it is anchored to:
 *  `"pod"` bands measure rightward from `podLeft`, `"text"` bands leftward from
 *  the prose content edge (so a text band's offset is the distance from the
 *  content edge to its RIGHT side). Pure; throws on an unknown key so a typo
 *  can't silently read 0. */
export function leftLaneOffset(key: string): number {
  let pod = 0;
  for (const band of LEFT_LANE_BANDS) {
    if (band.anchor === "pod") {
      if (band.key === key) return pod;
      pod += band.width;
    }
  }
  let text = 0;
  for (let i = LEFT_LANE_BANDS.length - 1; i >= 0; i--) {
    const band = LEFT_LANE_BANDS[i];
    if (band.anchor !== "text") continue;
    if (band.key === key) return text;
    text += band.width;
  }
  throw new Error(`unknown left-lane band: ${key}`);
}

/** Total width of the POD-anchored half of the left lane (= the grid's
 *  innermost painted edge, 44). */
export const LEFT_LANE_POD_WIDTH = LEFT_LANE_BANDS.filter(
  (b) => b.anchor === "pod",
).reduce((sum, b) => sum + b.width, 0);

/** Total width of the TEXT-anchored half of the left lane (= the chevron
 *  column's outer edge, 44). */
export const LEFT_LANE_TEXT_WIDTH = LEFT_LANE_BANDS.filter(
  (b) => b.anchor === "text",
).reduce((sum, b) => sum + b.width, 0);

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

/**
 * Container-relative x of the selection bolt's LEFT edge in the CRAMPED regime
 * — the tuck against the scrollbar gutter, expressed as a lane offset like
 * every other element rather than as loose pod arithmetic. (= 64.)
 *
 * Equal, by construction, to `podRight − SCROLLBAR_GUTTER − BOLT_SCROLLBAR_GAP
 * − BOLT_SIZE` re-based on the container's left edge, which is the form task
 * 045 pinned; also equal to `rightLaneOffset("marker-scrollbar-gap") −
 * BOLT_SIZE` while `MARGINALIA_BOLT_SCROLLBAR_GAP === MARKER_SCROLLBAR_GAP`
 * (both spellings pinned in `marginalia-right-margin-geometry.test.ts`). Stated
 * in the SAME coordinate space as `MARGINALIA_GRID_X_RIGHT` on purpose: the
 * tuck lands ON the lane's outboard marker columns, so which columns the grid
 * still gets is arithmetic over one origin (`resolveRightLane`), not a
 * comparison between two coordinate systems — the shape that let a fixed
 * pod-offset paint over col1 for a year (task 325).
 */
export const MARGINALIA_BOLT_TUCK_X_RIGHT =
  MARGINALIA_MARGIN_WIDTH_RIGHT -
  SCROLLBAR_GUTTER -
  MARGINALIA_BOLT_SCROLLBAR_GAP -
  MARGINALIA_BOLT_SIZE;

/** Back-compat alias — equal to the LEFT margin width. Callers that care
 *  about side should use the side-specific constants above. */
export const MARGINALIA_MARGIN_WIDTH = MARGINALIA_MARGIN_WIDTH_LEFT;

/**
 * Minimum editor margin (the `--editor-pl` / `--editor-pr` prose padding)
 * that still fully reserves the marker lane — i.e. the margin width below
 * which the marker grid would start eating into the prose text, the
 * scrollbar, the selection bolt (right) or the fold chevron (left).
 *
 * Σ of that side's band list on BOTH sides now, so when markers are visible the
 * margin is floored at exactly enough to host the lane. ONLY applied when
 * markers are shown (backlog #8 ratified choice) — and since task 671 "are
 * markers shown?" is not re-guessed here: it is {@link resolveMarginaliaLane}'s
 * `hosted`, the SAME value the marker render gate returns `[]` on. Zen reading
 * does hide the markers (it is a term in that predicate), so zen keeps its
 * margin freedom down to 0 and never has this floor imposed; the read-only
 * Library Reader does NOT hide them (it has hosted a full menu bundle since
 * F#16 and its markers are useful read-only), so it is floored like the editor.
 *
 *   right = Σ RIGHT_LANE_BANDS                                     = 104
 *   left  = Σ LEFT_LANE_BANDS (pod half 44 + text half 44)          =  88
 *
 * The left value CHANGED at task 670 (80 → 88) and that is the fix, not a
 * side effect: 80 counted only the pod-anchored half of the lane plus an inner
 * pad, so it floored the margin 8px INSIDE the text-anchored chevron column.
 * 88 is the shipped `--editor-pl` default, so nothing moves at rest — what
 * changes is that the drag can no longer walk the two stacks into each other.
 */
export const MARGINALIA_MIN_MARGIN_RIGHT = MARGINALIA_MARGIN_WIDTH_RIGHT;
export const MARGINALIA_MIN_MARGIN_LEFT =
  LEFT_LANE_POD_WIDTH + LEFT_LANE_TEXT_WIDTH;

// ── Lane regime: does a pod-anchored lane element still clear the prose? ─────
//
// Every element in the lane is POD-anchored — its x is a fixed offset from the
// pod edge — while the prose text edge moves with the margin. So they all face
// the SAME question: at this margin, does my slot still land in the margin, or
// back over the text? Before task 214 each consumer answered it separately, or
// not at all:
//
//   - the margin FLOOR asked it as a flag (`laneReserved` → `Math.max`);
//   - the BOLT asked it inline (`inboard >= editorRight + INNER_PAD`);
//   - the MARKER GRID never asked. It packed at the fixed 104-lane offsets
//     whatever the margin was, so a compressed code-split (48px comfort gutter,
//     lane NOT reserved) put col0's opaque badge 14px INBOARD of the text edge,
//     painting over the last words of every marked line — reachable with no
//     user action beyond opening the Code pane.
//
// ONE predicate now answers it for all of them, parameterized by the only thing
// that differs between elements: `inset`, how far the element's INNERMOST edge
// (the edge nearest the prose) sits from the pod edge on its side. Both sides
// reduce to the same arithmetic because both containers are pod-anchored:
//   right: element edge = podRight − inset, text edge = podRight − available
//   left:  element edge = podLeft  + inset, text edge = podLeft  + available
// so clearance ⟺ `available − inset ≥ INNER_PAD` either way.
//
// `available` is the MEASURED pod-edge→text-edge distance on that side
// (`podRight − editorRight`, `contentLeft − podLeft` from the geometry
// service's viewport frame) — not the `--editor-pl/pr` pref, so a pod clipped
// by the code split (where podRight is the VISIBLE edge) is answered honestly.

/**
 * Sub-pixel tolerance every lane comparison allows (task 670). Each side's band
 * list is authored in whole px and each side's floor is the EXACT sum of it, so
 * at the floor the bands are TANGENT — but `available` is a browser
 * MEASUREMENT (`contentLeft − podLeft` / `podRight − editorRight` off the
 * geometry service's viewport frame), and a fractional device-pixel ratio, a
 * browser zoom level or a transformed ancestor routinely returns 87.99 for an
 * authored 88. Without a tolerance a tangent band reads as an overlap on those
 * displays and the lane degrades at its own design value — the left marker
 * column would simply vanish at the shipped `--editor-pl`.
 *
 * 0.5px, the same sub-pixel epsilon the geometry service's metric equality uses
 * (`editor-geometry/service.ts#POSITION_EPSILON_PX`). Stated once and applied to
 * BOTH sides' comparisons, because it is a property of the measurement, not of
 * either lane.
 */
export const LANE_MEASUREMENT_EPSILON_PX = 0.5;

/**
 * Does a pod-anchored lane element whose innermost edge sits `inset` px from
 * the pod edge still clear the prose by `MARGINALIA_INNER_PAD`, given the
 * `available` margin on that side? THE lane-regime predicate — the bolt's
 * inboard/cramped fork and the marker grid's show/hide fork are the same
 * question asked about two different slots.
 */
export function laneSlotClearsProse(inset: number, available: number): boolean {
  return available - inset >= MARGINALIA_INNER_PAD - LANE_MEASUREMENT_EPSILON_PX;
}

/**
 * Effective marker COLUMNS on a side. The left grid uses a single column: its
 * inner-left slot is reserved across all paragraphs and headings for the
 * paragraph popout button, so a marker never lands there. Lives here (not in
 * the grid module) because the grid's placement AND the lane-fit inset below
 * both depend on it — two readers, one statement.
 */
export function marginaliaEffectiveCols(side: "left" | "right"): number {
  return side === "left" ? MARGINALIA_EFFECTIVE_COLS_LEFT : MARGINALIA_COLS;
}

/**
 * Container-relative x of the marker grid's col0 on the LEFT side — the `col0`
 * band's offset in {@link LEFT_LANE_BANDS} (= 22, one outer pad in). Named to
 * mirror `MARGINALIA_GRID_X_RIGHT` so `cellAt` reads a GRID_X_<side> constant on
 * both sides instead of restating one side's arithmetic inline — and, since
 * task 670, DERIVED from the same ordered list the chevron column and the
 * margin floor come from rather than from the container's width.
 */
export const MARGINALIA_GRID_X_LEFT = leftLaneOffset("col0");

/** Container-relative x of the marker grid's col0 on `side`. */
export function marginaliaGridX(side: "left" | "right"): number {
  return side === "left" ? MARGINALIA_GRID_X_LEFT : MARGINALIA_GRID_X_RIGHT;
}

/**
 * How far the marker grid's INNERMOST painted edge sits from the pod edge on
 * `side` — the grid's `inset` for {@link laneSlotClearsProse}. Derived from the
 * same col0 offset + effective-column count `cellAt` packs against, so it
 * cannot drift from where the badges actually land:
 *
 *   right — cells run outward from col0, so the innermost edge is col0's LEFT
 *           edge: `WIDTH_RIGHT − GRID_X_RIGHT` = 62 (grid needs ≥ 70px margin).
 *   left  — cells run inward from col0, so the innermost edge is the icon
 *           block's RIGHT edge: `GRID_X_LEFT + blockWidth` = 44 (≥ 52px).
 *
 * The two thresholds differ, and that is the point: the bolt sits INBOARD of
 * the markers, so it tucks at margins where the markers still fit honestly.
 */
export function marginGridInset(side: "left" | "right"): number {
  const cols = marginaliaEffectiveCols(side);
  const blockWidth =
    cols * MARGINALIA_ICON_SIZE + (cols - 1) * MARGINALIA_COL_GAP;
  return side === "left"
    ? marginaliaGridX("left") + blockWidth
    : MARGINALIA_MARGIN_WIDTH_RIGHT - marginaliaGridX("right");
}

/**
 * Is the margin UNMEASURED? The pre-refresh EMPTY viewport frame, a hidden
 * pane, a detached editor — every field of that frame is 0, so the arithmetic
 * is indistinguishable from a zero-width margin. Every lane answer FAILS OPEN
 * on it (the reserved layout, exactly what rendered before any of these
 * predicates existed), because culling the whole lane on the first commit of
 * every pane and on every warm tab switch is a far worse failure than the
 * overlaps these guard.
 */
function laneUnmeasured(available: number | null): boolean {
  return available === null || !Number.isFinite(available);
}

/**
 * Does the marker grid clear the PROSE on `side` at this `available` margin?
 * Task 214's question, and only that one — it says nothing about the other
 * lane elements. Module-private: consumers read {@link resolveMarkerCols},
 * which composes this with the bolt's band so "how much lane does the grid
 * get?" has ONE answer (task 325). Exporting the prose half alone is how a
 * consumer ends up asking the wrong half.
 */
function markerGridClearsProse(
  side: "left" | "right",
  available: number | null,
): boolean {
  if (laneUnmeasured(available)) return true;
  return laneSlotClearsProse(marginGridInset(side), available as number);
}

/**
 * The RIGHT lane RESOLVED at a measured margin — which slot the bolt takes and
 * how many marker columns are left over, as ONE answer in ONE coordinate space
 * (container-relative, origin `podRight − MARGINALIA_MARGIN_WIDTH_RIGHT`).
 *
 * Why this exists (task 325). `RIGHT_LANE_BANDS` makes disjointness STRUCTURAL
 * — sequential non-overlapping bands cannot collide — but that guarantee only
 * ever covered the RESERVED regime, because both cramped fallbacks were
 * computed OUTSIDE the list: the grid asked its own prose-clearance question
 * and packed at the wide-lane column offsets, and the bolt tucked at a fixed
 * pod-offset that knew nothing about the columns. The two thresholds differ
 * (the grid clears the prose down to 70px, the bolt loses its inboard slot
 * below 104px — correct, since the grid sits further outboard), so in the
 * 70–103px band BOTH rendered, on the same pixels: the tucked bolt's band
 * [64, 92] contains col1 [70, 92] exactly. The bolt is a fixed portal above
 * the `pointer-events-auto` cells, so the collision cost col1's CLICKS as well
 * as its pixels.
 *
 * The resolution is ORDERED, outboard → inboard, and states the priority once:
 *
 *  - the SCROLLBAR is never negotiable (it is the pod's own edge chrome);
 *  - the BOLT places first — it is the sole entry to the actions menu (no other
 *    surface reaches `ActionsMenuPanel`) and its 28px body cannot degrade, so
 *    it takes its reserved inboard band where the lane is whole and otherwise
 *    tucks outboard against the scrollbar, floored at the prose edge (045);
 *  - the marker GRID takes the columns that remain ENTIRELY inboard of wherever
 *    the bolt landed, and hides only when none clears the prose (214).
 *
 * Nothing is dropped that does not have to be. In the 70–103 band that leaves
 * the right grid at ONE column (col0 [42, 64], which the tucked bolt abuts but
 * never overlaps) — the same single-column shape the LEFT lane has always had,
 * with the surplus markers riding the "+K" overflow pill that already exists
 * for an over-full grid. And 214's derived threshold is untouched: right cells
 * run OUTWARD from col0, so the grid's innermost painted edge is col0's left
 * edge at ANY column count (see {@link marginGridInset}) — losing col1 cannot
 * move the prose-clearance answer.
 *
 * KNOWN RESIDUAL, stated rather than implied: the orphan re-pin dock is NOT a
 * band. It is flow-positioned at `right: 2` inside the same column, so it
 * overlaps the scrollbar gutter in every regime and the tucked bolt in this
 * one. Pre-existing and independent of the bolt (it predates the tuck), and
 * moving it is a visible chrome relocation in the NORMAL regime — out of scope
 * here, and NOT covered by the disjointness sweep, which asks about cells and
 * the pill.
 */
export interface RightLaneResolution {
  /** Container-relative x of the bolt's LEFT edge at this margin. */
  readonly boltX: number;
  /** True while the bolt holds its reserved inboard band (vs. the tuck). */
  readonly boltInboard: boolean;
  /** Marker columns the grid gets once the bolt has taken its band. 0 hides. */
  readonly markerCols: number;
}

/** How many right marker columns sit ENTIRELY inboard of a bolt at `boltX`?
 *  Derived by walking the same column offsets `cellAt` packs against, so the
 *  count follows automatically from the bolt size, the column width and the
 *  gaps — never a hand-written "one". */
function rightColumnsClearingBolt(boltX: number): number {
  const stride = MARGINALIA_ICON_SIZE + MARGINALIA_COL_GAP;
  let cols = 0;
  for (let col = 0; col < marginaliaEffectiveCols("right"); col++) {
    const cellLeft = marginaliaGridX("right") + col * stride;
    if (cellLeft + MARGINALIA_ICON_SIZE > boltX) break;
    cols++;
  }
  return cols;
}

/** Resolve the right lane at this measured margin. See {@link RightLaneResolution}. */
export function resolveRightLane(available: number | null): RightLaneResolution {
  const reserved: RightLaneResolution = {
    boltX: MARGINALIA_BOLT_X_RIGHT,
    boltInboard: true,
    markerCols: marginaliaEffectiveCols("right"),
  };
  if (laneUnmeasured(available)) return reserved;
  const room = available as number;
  // The bolt's inboard slot is taken only while it clears the prose — asked
  // through the shared lane-regime predicate (214) with the bolt's own inset:
  // its innermost edge is `WIDTH_RIGHT − BOLT_X_RIGHT` = 96 from the pod edge,
  // so this reduces to `available ≥ 104` exactly as the inline comparison it
  // replaced did. In that regime the band list already seats the bolt inboard
  // of both columns, so the grid keeps them.
  if (
    laneSlotClearsProse(
      MARGINALIA_MARGIN_WIDTH_RIGHT - MARGINALIA_BOLT_X_RIGHT,
      room,
    )
  )
    return reserved;
  // CRAMPED — tuck the bolt against the scrollbar, FLOORED at the prose edge so
  // it never overshoots back over the text. The tuck is a fixed lane offset that
  // ignores the margin, so below a ~48px right margin it would land LEFT of the
  // prose edge; the `Math.max` makes prose-clearance structural here too — the
  // bolt slides toward the scrollbar as the margin narrows but stops at the
  // prose edge + INNER_PAD (task 045). At the 48px gutter the two are equal.
  // (The prose edge is `WIDTH_RIGHT − available` in container coordinates.)
  const boltX = Math.max(
    MARGINALIA_BOLT_TUCK_X_RIGHT,
    MARGINALIA_MARGIN_WIDTH_RIGHT - room + MARGINALIA_INNER_PAD,
  );
  return {
    boltX,
    boltInboard: false,
    // Both questions, in order: does any column clear the PROSE, and which of
    // them clear the BOLT. A floored bolt (margin < 48) has already slid over
    // col0 — and the grid is hidden there anyway, since 48 < 70 — so the two
    // guards agree rather than racing.
    markerCols: markerGridClearsProse("right", room)
      ? rightColumnsClearingBolt(boltX)
      : 0,
  };
}

/**
 * The LEFT lane RESOLVED at a measured margin — where the fold-chevron column
 * lands and how many marker columns are left over, as ONE answer in ONE
 * coordinate space (container-relative, origin `podLeft`).
 *
 * Why this exists (task 670). {@link LEFT_LANE_BANDS} makes the lane ORDERED,
 * but ordering alone cannot make disjointness structural here the way
 * `RIGHT_LANE_BANDS` does, because the left lane's two halves are anchored to
 * OPPOSITE edges: the marker grid is pod-anchored and the chevron column is
 * text-anchored, so the bands only abut at ONE margin (Σ = 88). Below it the
 * text half slides onto the pod half; above it a gap opens between them. The
 * band list therefore states the lane, and THIS function resolves it at the
 * margin actually measured.
 *
 * The resolution is ORDERED, inboard → outboard, and states the priority once:
 *
 *  - the fold CHEVRON places first. It is the sole entry to folding a heading
 *    or a source pod, it is text-anchored by requirement (its reach is
 *    em-scaled per block — `block-frame.ts#resolveChevronColumnRight` resolves
 *    the token against the BLOCK's font, so a `\part`-sized heading's column is
 *    wider than a `\subsection`'s), and its 14px body cannot degrade. So it
 *    keeps its column at every margin and the lane's floor is sized to hold it.
 *  - the marker GRID takes the columns that remain ENTIRELY OUTBOARD of the
 *    chevron column, and hides when none does — exactly what
 *    `rightColumnsClearingBolt` does for the bolt on the other side. With the
 *    left grid at one effective column that degradation is all-or-nothing, and
 *    that is the honest answer: an icon under the chevron is not a narrower
 *    grid, it is a stolen click.
 *  - the PROSE-clearance question (214) still binds independently, so a grid
 *    that clears the chevron but not the text still hides.
 *
 * Above the floor nothing degrades: at `available ≥ 88` the chevron sits at or
 * right of col0's inner edge, so `leftColumnsClearingChevron` returns the full
 * column count and the shipped layout is byte-identical to pre-670.
 */
export interface LeftLaneResolution {
  /** Container-relative x of the fold-chevron column's LEFT edge at this
   *  margin (`available − MARGINALIA_CHEVRON_INSET`). */
  readonly chevronX: number;
  /** Marker columns the grid gets once the chevron column is seated. 0 hides. */
  readonly markerCols: number;
}

/** How many left marker columns sit ENTIRELY outboard of a chevron column whose
 *  left edge is at `chevronX`? Derived by walking the same column offsets
 *  `cellAt` packs against, so the count follows automatically from the chevron
 *  width, the column width and the gaps — never a hand-written "one". */
function leftColumnsClearingChevron(chevronX: number): number {
  const stride = MARGINALIA_ICON_SIZE + MARGINALIA_COL_GAP;
  let cols = 0;
  for (let col = 0; col < marginaliaEffectiveCols("left"); col++) {
    const cellLeft = marginaliaGridX("left") + col * stride;
    if (cellLeft + MARGINALIA_ICON_SIZE > chevronX + LANE_MEASUREMENT_EPSILON_PX)
      break;
    cols++;
  }
  return cols;
}

/** Resolve the left lane at this measured margin. See {@link LeftLaneResolution}. */
export function resolveLeftLane(available: number | null): LeftLaneResolution {
  const reserved: LeftLaneResolution = {
    chevronX: MARGINALIA_MIN_MARGIN_LEFT - MARGINALIA_CHEVRON_INSET,
    markerCols: marginaliaEffectiveCols("left"),
  };
  if (laneUnmeasured(available)) return reserved;
  const room = available as number;
  const chevronX = room - MARGINALIA_CHEVRON_INSET;
  return {
    chevronX,
    // Both questions, in order: does any column clear the PROSE (214), and
    // which of them clear the CHEVRON (670). The chevron is the tighter bound
    // at every margin the grid survives, so the two agree rather than racing.
    markerCols: markerGridClearsProse("left", room)
      ? leftColumnsClearingChevron(chevronX)
      : 0,
  };
}

/**
 * Effective marker columns on `side` at this `available` margin — THE answer
 * `computeMarkerPositions` consumes, so no call site re-derives it. `0` means
 * the side renders nothing (cells, "+K" pill and the re-pin dock together).
 *
 * Each side is now its own full ordered resolution — the right negotiating with
 * the selection bolt, the left with the fold-chevron column.
 */
export function resolveMarkerCols(
  side: "left" | "right",
  available: number | null,
): number {
  return side === "right"
    ? resolveRightLane(available).markerCols
    : resolveLeftLane(available).markerCols;
}

/** The COMFORTABLE per-side horizontal gutter the editor caps margins at when
 *  the Code pane is open and compressing the editor. A building block of
 *  SplitWithCode's EDITOR_PANE_COMPRESSED_MIN_PX (≈300px prose + one of these
 *  per side + border) — they are NOT the same number and are deliberately
 *  decoupled (398 is visually tuned). A mechanical layout value, not a pref.
 *  Lives here so the compressed-cap-vs-marker-floor resolution
 *  (`resolveHorizontalMargin`) is a single pure, testable unit. */
export const CODE_VIEW_GUTTER_PX = 48;

/** Everything the marker lane's policy depends on, in one input. Note what is
 *  ABSENT: the presence of a menu bundle. `!!menuBar` used to stand in for "is
 *  this the read-only Library Reader", and it stopped being true of the Reader
 *  the day F#16 gave it one (`library/components/PaperRender.tsx` →
 *  `readerMenuBar`), which is how the floor came to believe something the
 *  renderer had never agreed to (task 671). */
export interface MarginaliaLaneInput {
  /** The master "Show marginalia" view pref. `undefined` = no menu bundle at
   *  all, which means the DEFAULT (on) — never "hide". */
  readonly showMarginalia: boolean | undefined;
  /** Zen reading mode: render-gates editor chrome, marginalia included. */
  readonly zenMode: boolean | undefined;
  /** The Code pane is open AND compressing the editor column. */
  readonly compressX: boolean;
}

/** The lane's policy for one pane: what it PAINTS and what it RESERVES. */
export interface MarginaliaLanePolicy {
  /** Does this pane paint margin markers at all? The marker render gate
   *  returns `[]` when false. */
  readonly hosted: boolean;
  /** Is this pane's horizontal margin FLOORED to the lane width? Implies
   *  `hosted` — a floor for a lane nobody paints is wasted prose width. */
  readonly reserved: boolean;
}

/**
 * THE marker-lane predicate (task 671) — "does this pane host the marker lane,
 * and is its margin floored for it?" — resolved ONCE so the two gates cannot
 * disagree.
 *
 * Before this, `EditorPane` answered the question twice, in two expressions
 * 800 lines apart: the render filter keyed on the master toggle alone, and the
 * floor keyed on `!!menuBar && showMarginalia !== false && !zenMode &&
 * !compressX`. The two extra terms were justified — in five docstrings — by a
 * marker-hiding that was never implemented. Both were wrong in opposite
 * directions:
 *
 *   - ZEN painted every note / todo / cut / report icon while dropping the very
 *     floor that guarantees them room, so narrowing the zen margin degraded
 *     them away (`resolveRightLane`) with no explanation, and walked the LEFT
 *     margin down into the fold-chevron band (task 670).
 *   - The READER did the inverse: `!!menuBar` was written when the Reader had
 *     no menu bundle, so since F#16 it is TRUE there and the Reader has been
 *     forcing 184px of floored margin onto a paper view.
 *
 * Settled, one way, here: **zen hides the markers** (as its own comment always
 * claimed — `EditorLayout`'s zen block, `useZenMode._clamp`), and **the Reader
 * hosts them** (what ships today; read-only markers are useful, and the lane
 * degrades correctly when its margin is narrow). `hosted` is therefore the
 * answer to "will an icon be painted", and `reserved` is `hosted` minus the one
 * exception that is about the FLOOR rather than the markers: a compressed
 * code-split, where the 48px comfort cap deliberately wins and the lane
 * degrades instead of eating the prose column.
 *
 * Pure (no React, no DOM) so the composition is unit-testable away from
 * `EditorPane`.
 */
export function resolveMarginaliaLane({
  showMarginalia,
  zenMode,
  compressX,
}: MarginaliaLaneInput): MarginaliaLanePolicy {
  const hosted = showMarginalia !== false && !zenMode;
  return { hosted, reserved: hosted && !compressX };
}

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
 * `laneReserved=false` there — {@link resolveMarginaliaLane}'s `reserved`):
 * the comfort cap WINS, markers gracefully degrade, and the editor keeps its
 * width instead of losing ~150px+ to an unused lane. So the two paths never
 * both fire — when `compress` is true the floor is inactive, and the `Math.max`
 * only bites in the normal markers-on editor (where `compress` is false). The
 * OTHER way `laneReserved` goes false is that the pane paints no markers at all
 * (the toggle off, or zen) — and since task 671 that is the same predicate the
 * render gate reads, not a second opinion about it.
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
 *  - CRAMPED (a narrowed margin — the compressed code-split's ~48px gutter, or
 *    any hand-dragged narrow margin; lane NOT reserved):
 *    the inboard slot would land `MARGIN_WIDTH_RIGHT − gutter` px back OVER the
 *    prose, so instead tuck the bolt against the scrollbar inside whatever
 *    gutter exists — `podRight − SCROLLBAR_GUTTER − BOLT_SCROLLBAR_GAP − BOLT` —
 *    but FLOORED at the prose edge (`editorRight + INNER_PAD`). That gutter tuck
 *    is a fixed pod-offset that ignores `editorRight`, so below a ~48px margin it
 *    would itself land back over the prose; the floor makes prose-clearance
 *    structural in this branch too, so the bolt degrades toward the scrollbar as
 *    the margin narrows but never starts left of the text (task 045).
 *    The tuck lands ON the lane's outboard marker columns, so the GRID yields
 *    them: `resolveRightLane` hands the grid only the columns entirely inboard
 *    of the bolt (task 325). Both answers come out of that one resolution.
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
  // Both regimes come from the ONE ordered lane resolution, in the container's
  // coordinate space, so the bolt's x and the grid's column count are the same
  // decision read twice — not two formulas that agree only where the lane is
  // whole (task 325). Re-based onto the pod here: the container's left edge is
  // `podRight − MARGINALIA_MARGIN_WIDTH_RIGHT`, so this is byte-identical to
  // the pod arithmetic it replaces at every margin.
  const containerLeft = podRight - MARGINALIA_MARGIN_WIDTH_RIGHT;
  return containerLeft + resolveRightLane(podRight - editorRight).boltX;
}
