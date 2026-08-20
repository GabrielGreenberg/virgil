"use client";

/**
 * TextObjectGrabHandle — the single canonical grab handle for every
 * persistent TextObject in Virgil AND for live selections.
 *
 * Mounted once at the editor level (replaces SelectionDragHandle and the
 * per-NodeView grips that lived inside `ParagraphWithTitle` /
 * `HeadingWithLabel` / `createListTitleNodeView` / `TexBlockNodeView` /
 * `ExampleBlock`). Resolves the active TextObject (or selection) on every
 * selectionUpdate / docUpdate / scroll / mousemove, computes its placement
 * from the canonical `block-frame.ts` geometry (the MEASURED `markerLeft` it
 * hugs + the optical center it sits on), and dispatches the click + lift
 * gestures through the unified `useDragHandleMenu` + `usePoppedCards` contexts.
 *
 * Discovery model (hover-driven, multi-level):
 *   1. Non-empty TextSelection   → one handle for the SelectionRef
 *      (text-lift gesture; hydrates to a linkedRange on lift).
 *   2. NodeSelection on a TextObject → one handle for the selected node.
 *   3. Mouse over the editor     → one handle for EVERY containing
 *      TextObject from innermost to outermost. Hovering text inside a
 *      `listItem` shows handles for both the listItem AND its parent
 *      `bulletList`. For deeper nesting (graphicsBlock inside listItem),
 *      every level gets a handle, each hugging its own block's marker.
 *   4. No mouse position / mouse outside editor + no handle hovered →
 *      no handles. (Cursor-based discovery is intentionally removed —
 *      the handle is a pure hover affordance, like a tooltip.)
 *
 * Modality (task 336): branch 3 is the only POINTER-derived branch, so it is
 * answered only while the user is in POINTER modality. A keystroke hides the
 * handle until the next real `mousemove` re-arms it — the standard editor
 * behaviour, and the reason a keystroke no longer re-runs a hover hit-test at
 * a pointer that never moved. Branches 1/2 are SELECTION-derived and keep
 * answering on `selectionUpdate` (a shift-arrow selection must move its
 * handle). The rule lives in `@/lib/input-modality`, not here.
 *
 * Rendering: handles portal into `[data-grab-handle-portal]` mounted
 * inside `editor-pane-column` as a sibling of the editor pod. The
 * column placement (rather than inside `paper-render`) is required: the
 * pod has a `clipPath` that clips lateral descendants beyond ±20px,
 * which would silently swallow handles in the margin (handles sit ~22px
 * left of the content edge). Mounting at the column level: (a) lets
 * handles scroll with the paper (the column is inside the row scroll
 * container); (b) clips them behind the sticky pod caps (top z:30,
 * bottom z:31) which are also column-level siblings sharing the root
 * stacking context against the handle's z:20; (c) clips them at the
 * row scroll container's overflow. Pointer continuity from prose →
 * margin → handle is native (no portal-to-body decoupling), so the
 * leave-grace timer, `mouseOverHandleRef`, and per-handle enter/leave
 * callbacks that the old portal-to-body model required are all retired.
 */

import {
  useEffect,
  useRef,
  useState,
  useCallback,
  type CSSProperties,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import type { Editor } from "@tiptap/react";
import { NodeSelection, TextSelection } from "@tiptap/pm/state";
import { usePoppedCards } from "@/hooks/usePoppedCards";
import { ensureAnchorUuid } from "@/lib/anchor-uuid";
import { hydrateSelectionToTextObject } from "./hydrate-selection";
import { resolveDomForUuid } from "@/lib/marginalia-blocks";
import { useDragHandleMenu } from "@/components/editor-layout/card-actions/drag-handle-menu-context";
import { type EditorViewportFrame } from "@/lib/editor-geometry";
import { useViewportFrame } from "@/lib/editor-geometry/use-viewport-frame";
import { geomHoverEnabled, getGeometry } from "@/lib/editor-geometry";
import { onFontReady, opticalCenterY } from "@/lib/text-metrics";
import {
  isTypingModality,
  notePointerInput,
  subscribeInputModality,
} from "@/lib/input-modality";
import { parkDuringLayoutGesture } from "@/lib/pane-resize";
import {
  isMissedRelease,
  isPrimaryDragStart,
} from "@/lib/pane-resize/pointer-invariants";
import { LAYOUT_SITE_GRAB_HANDLE } from "@/lib/layout-gesture-probe";
import {
  TEXT_OBJECT_REGISTRY,
  isTextObjectKind,
  textObjectPopoutKey,
} from "./text-object-registry";
import { resolveBlockFrame } from "./block-frame";
import { resolveHandleLane, resolveHandleMarkerLeft } from "./handle-layout";
import { useLiftHost } from "./LiftHost";
import type {
  SelectionRef,
  TextObjectKind,
  TextObjectRef,
} from "./types";

const LIFT_THRESHOLD = 5;
/** Half the grab-handle glyph's height. The six-dot SVG is 14px tall with
 *  its dot-cluster centered at the SVG midpoint, and the CSS now centers
 *  that glyph on `placement.top` (see `.text-object-grab-handle` in
 *  globals.css). For `block-top` kinds — framed visual blocks with no first
 *  text line — pinning the glyph a half-glyph below the block's top edge
 *  reproduces the pre-unification flex-start visual under the new centered
 *  box. (chip 4 owns figure chrome; this keeps block-top byte-for-byte.) */
const HANDLE_GLYPH_HALF = 7;

/**
 * Map a `TextObjectRef` to the popout key used by
 * `viewPrefs.poppedOutCards` — the canonical `textobject:<kind>:<id>`
 * emitted by `textObjectPopoutKey` (Phase D10). All 16 graspable kinds
 * lift (L4a retired the per-kind staging switch that used to gate this),
 * so every ref resolves to a key. The `| null` return is kept as a
 * defensive contract for callers — it is never produced here.
 *
 * SelectionRef lifts hydrate into `linkedRange` TextObjects at the
 * lift commit (Phase E); after hydration they pass through this
 * function as a normal TextObjectRef.
 */
export function popoutKeyForLift(ref: TextObjectRef): string | null {
  return textObjectPopoutKey(ref);
}

interface Placement {
  /** Viewport-x of the handle's left edge. */
  left: number;
  /** Viewport-y of the handle's top edge (sticky-to-top when the source
   *  has scrolled above the viewport). */
  top: number;
  /** The resolved ref the handle represents. */
  ref: TextObjectRef | SelectionRef;
  /** Chip 3: half-width cap (px) for the hit/hover halo — half the distance to
   *  the nearest handle on the SAME visual row, or null when no near sibling
   *  shares the row. Threaded to the handle as the inline
   *  `--margin-handle-hit-cap` so two close nested handles (e.g. a bullet
   *  container + its first item, ~19px apart) get halos that meet at the
   *  midpoint and stay independently grabbable. Derived from the resolved
   *  placements ({@link applyHitCaps}), never from a doc walk. */
  hitCapPx: number | null;
  /**
   * Task 382: the furthest-right `left` this handle may take — its lane's
   * inboard bound, derived from the row's `BlockFrame.inkLeft` in
   * `resolveHandleLane`. {@link applySameRowSeparation} pushes within it; it is
   * NOT rendered, so it is deliberately absent from {@link placementsEqual}
   * (a change to the bound that leaves every rendered position where it was
   * must not cost a re-render).
   */
  maxLeft: number;
}

/**
 * A ref paired with its pre-resolved block DOM element, threaded from the
 * discovery path into `computePlacement` so placement never re-resolves the
 * block by walking the doc. `el` is populated for TextObjectRefs (the hover
 * scan already holds the element; a NodeSelection resolves it via
 * `nodeDOM`); it's null for a text SelectionRef, whose block `computePlacement`
 * resolves via the PM ancestor chain (O(depth)).
 */
interface ResolvedRef {
  ref: TextObjectRef | SelectionRef;
  el: HTMLElement | null;
}

function placementsEqual(a: Placement, b: Placement): boolean {
  if (a.left !== b.left || a.top !== b.top || a.hitCapPx !== b.hitCapPx) {
    return false;
  }
  return refsEqual(a.ref, b.ref);
}

/**
 * Same-row epsilon (px) for the chip-3 hit-halo sibling clamp. Two handles
 * share a visual row when their optical-center tops match within this band.
 * Nested container + item handles on the same row are computed from ONE block
 * frame (the container resolves through to its first item), so their tops are
 * equal by construction — the band only absorbs the small mismatch between a
 * text-top and a block-top anchor on the same line. It stays well below a full
 * line height, so handles on DIFFERENT rows (a container resolving to item 1
 * while the cursor hovers item 3, ≥1 line apart) are never treated as
 * same-row, and the {@link applyHitCaps} `min` only ever clamps a genuinely
 * overlapping pair.
 */
const SAME_ROW_EPS = 16;

/**
 * Chip 3: set each placement's hit-halo cap from the resolved sibling
 * geometry — half the horizontal distance to the nearest handle on the same
 * visual row (or null when none shares the row). Both the halo and the dots
 * are centered on `left + 6` (every handle box is 12px wide), so the
 * left-edge distance IS the dots-center distance; capping each halo's
 * half-width at half of it makes two close nested handles meet at the
 * midpoint with no overlap, so neither swallows the other.
 *
 * KEYSTROKE SANCTITY: operates only on the freshly-built per-hover
 * `placements` array (≤ a handful of entries — one per containing TextObject
 * level), so it's O(handles²) ≈ O(1), never a doc walk. It runs on the same
 * hover/scroll/RAF placement schedule as the rest of this component (the
 * docChanged-gated `update` subscriber is a sanctioned cheap subscriber in
 * AGENTS.md), adding no doc-proportional work.
 */
/**
 * Minimum CENTER-to-center distance between two handles that share a visual
 * row (task 353). Handles are {@link HANDLE_WIDTH}=12 wide, so this leaves a
 * 12px void between the boxes — the gap reads as "two controls" rather than as
 * one wide glyph.
 *
 * It is a TARGET, not a guarantee: since task 382 the push that realizes it is
 * bounded by each handle's lane (`maxLeft`), so on a row whose marker band is
 * too narrow to hold both this gap and a clear bullet, the row gets whatever
 * separation fits. Gabriel reported the pre-353 row-1 spacing (20px
 * center-to-center = an 8px void) as "one unreadable blob", so this is
 * deliberately wider than that and no wider than it has to be — and the
 * `.tiptap ul/ol` marker band was widened to 2em in the same task so the
 * everyday top-level list reaches it without hitting the cap.
 */
const MIN_SAME_ROW_GAP_PX = 24;

/**
 * Task 353: keep same-row handles far enough apart to read as separate
 * controls, by pushing each INNER handle inboard.
 *
 * Bounded inboard by each placement's own lane (`maxLeft`, task 382) — the
 * pre-382 push had no upper bound at all and walked a top-level list's ITEM
 * handle onto the bullet glyph, which is the one thing margin chrome may never
 * do. The cap outranks the gap.
 *
 * Why inboard rather than outboard, which is what "stack the container further
 * out" would suggest: the outermost handle is already sitting ON the floor.
 * `computeHandleLeftEdge` clamps at `editorColumnLeft − marginInset`, and a
 * container's marker is left of its item's, so the container's proposed left
 * is normally BELOW the floor and gets clamped there — measured, the list
 * handle lands exactly on it. There is no room further out, and taking some
 * would push into the margin lane the lane-regime predicate governs. So the
 * outermost position is fixed and the inner ones give way.
 *
 * Runs AFTER every placement is computed (a single compute cannot see its
 * siblings) and BEFORE {@link applyHitCaps}, so the halo caps are derived from
 * the positions actually rendered rather than from pre-separation ones.
 *
 * KEYSTROKE SANCTITY: same contract as `applyHitCaps` — operates on the
 * freshly-built per-hover array (one entry per containing level, so a handful),
 * O(handles log handles), no DOM read and no doc walk.
 */
function applySameRowSeparation(placements: Placement[]): void {
  const rows: Placement[][] = [];
  for (const p of placements) {
    const row = rows.find((r) => Math.abs(r[0].top - p.top) <= SAME_ROW_EPS);
    if (row) row.push(p);
    else rows.push([p]);
  }
  for (const row of rows) {
    if (row.length < 2) continue;
    // Outermost (smallest left) keeps its floored slot; each next one is
    // pushed to at least MIN_SAME_ROW_GAP_PX inboard of the one before it —
    // but never past its own lane's `maxLeft` (task 382), so a push can't walk
    // a handle onto the bullet the row's anchor exists to clear. When the two
    // conflict the CAP wins: sub-24 spacing reads as a blob, and a blob over
    // the user's own text reads as a bug.
    row.sort((a, b) => a.left - b.left);
    for (let i = 1; i < row.length; i++) {
      const wanted = row[i - 1].left + MIN_SAME_ROW_GAP_PX;
      if (row[i].left < wanted) {
        // `max` with the current position keeps this a PUSH: a lane whose cap
        // already sits left of the resting slot (a wide `10.` marker on a
        // narrow viewport, where the floor outranked the cap) must not be
        // dragged further out by the separation pass.
        row[i].left = Math.max(row[i].left, Math.min(wanted, row[i].maxLeft));
      }
    }
  }
}

function applyHitCaps(placements: Placement[]): void {
  for (let i = 0; i < placements.length; i++) {
    let nearest = Infinity;
    for (let j = 0; j < placements.length; j++) {
      if (i === j) continue;
      if (Math.abs(placements[i].top - placements[j].top) > SAME_ROW_EPS) {
        continue;
      }
      const d = Math.abs(placements[i].left - placements[j].left);
      if (d < nearest) nearest = d;
    }
    placements[i].hitCapPx = Number.isFinite(nearest) ? nearest / 2 : null;
  }
}

function placementArrayEqual(a: Placement[], b: Placement[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (!placementsEqual(a[i], b[i])) return false;
  }
  return true;
}

function refsEqual(
  a: TextObjectRef | SelectionRef,
  b: TextObjectRef | SelectionRef,
): boolean {
  if (a === b) return true;
  if (a.kind !== b.kind) return false;
  if (a.kind === "selection" && b.kind === "selection") {
    return a.from === b.from && a.to === b.to && a.paragraphId === b.paragraphId;
  }
  if (a.kind !== "selection" && b.kind !== "selection") {
    return a.id === b.id;
  }
  return false;
}

/** Stable React key for a placement's ref. */
function refKey(ref: TextObjectRef | SelectionRef): string {
  if (ref.kind === "selection") {
    return `selection:${ref.paragraphId}:${ref.from}-${ref.to}`;
  }
  return `${ref.kind}:${ref.id}`;
}

/**
 * Hit-test the mouse position against the editor's DOM to find every
 * TextObject whose visual row contains the cursor, ordered innermost
 * first.
 *
 * Principle — **a text-object's visual row is its bounding rect's Y
 * range**. The refs for a hover are exactly the text-objects whose Y
 * range contains `clientY`, with `clientX` already inside the row's X
 * hover zone (gated upstream by `cache.containsHoverZone`).
 *
 * Why Y-axis containment rather than `elementFromPoint` + closest walk:
 * the point-hit-test silently misses anchorables nested in a container
 * whose DOM "owns" the margin-X column. Two recurring shapes:
 *
 *   - **listItem under `<ul>`**: with `list-style-position: outside`,
 *     `::marker` renders in the `<ul>`'s padding zone, the `<li>`'s box
 *     starts past it. `elementFromPoint(contentLeft, listItemY)` lands
 *     on the `<ul>`, so `closest('[data-uuid]')` returns the ul and the
 *     `<li>` is never resolved.
 *
 *   - **exampleItem inside `.expex-block`**: the block is
 *     `display: grid; grid-template-columns: 1.5em 1fr`. Column 1
 *     holds the `(1)` marker top-aligned; below it column 1 is empty.
 *     `elementFromPoint(contentLeft, exampleItemY)` lands on
 *     `.expex-block` directly — the exampleItem and any inner
 *     paragraph are skipped.
 *
 * The Y-scan is DOM-quirk-independent, kind-agnostic (any [data-uuid]
 * element resolves), and atom-block-correct (a texBlock / displayMath /
 * graphicsBlock wrapper's rect contains clientY just like a paragraph's).
 * Inline atoms (footnote/citation) have no `UUID_ATTR_SPEC` and never
 * receive `data-uuid`, so the scan won't false-match them.
 *
 * Performance: visible-region bound via `cache.scrollTop` /
 * `cache.scrollBottom` — off-screen blocks bail before the
 * Y-containment check. For typical viewports ~20-50 visible blocks
 * regardless of doc size; one `getBoundingClientRect` per candidate.
 *
 * Sort: `(rect.top desc, rect.bottom asc)` produces innermost-first.
 * When ranges nest, the narrower-Y range is the inner one. More
 * robust than parentElement-depth: `.expex-item-list` is
 * `display: contents` (no rect, no contribution).
 */
function resolveTextObjectsAtMouse(
  editor: Editor,
  cache: EditorViewportFrame,
  clientX: number,
  clientY: number,
): ResolvedRef[] {
  if (!cache.containsHoverZone(clientX, clientY)) return EMPTY_RESOLVED;
  const editorEl = editor.view.dom;
  if (!(editorEl instanceof HTMLElement)) return EMPTY_RESOLVED;

  // Wave-2 C1: answer from the editor-geometry service's near-zone cache —
  // one host-rect read + arithmetic on cached bands, ZERO per-block DOM
  // reads, already innermost-first. This was the diagnosis's S2/D1 site:
  // an O(doc) `querySelectorAll("[data-uuid]")` + getBoundingClientRect per
  // candidate (cull AFTER the read — 1,063 rect reads per frame at 2,883
  // blocks), re-run per hover RAF and, via the armed mousePosRef, per
  // KEYSTROKE for the whole typing session. `null` (engine off / hidden /
  // nothing observed) falls through to the legacy scan; kill-switch
  // `virgil:geom-hover = "off"`.
  if (geomHoverEnabled()) {
    const hits = getGeometry(editor)?.blocksAtY(clientY);
    if (hits) {
      const refs: ResolvedRef[] = [];
      for (const { uuid, el } of hits) {
        const kind = el.getAttribute("data-text-object-kind");
        if (kind && isTextObjectKind(kind) && kind !== "linkedRange") {
          refs.push({ ref: { kind, id: uuid }, el });
        }
      }
      return refs;
    }
  }

  const candidates = editorEl.querySelectorAll<HTMLElement>("[data-uuid]");
  const matches: Array<{ el: HTMLElement; top: number; bottom: number }> = [];
  const scrollTop = cache.scrollTop;
  const scrollBottom = cache.scrollBottom;
  for (const el of candidates) {
    const rect = el.getBoundingClientRect();
    if (rect.bottom < scrollTop || rect.top > scrollBottom) continue;
    if (clientY < rect.top || clientY > rect.bottom) continue;
    matches.push({ el, top: rect.top, bottom: rect.bottom });
  }
  // Innermost-first via rect containment. Nested ranges → narrower Y
  // range is the inner one. Sort by larger top first, then by smaller
  // bottom on tie, so a child ((top=T1, bottom=B1) with T1>=Touter and
  // B1<=Bouter) lands before its parent.
  matches.sort((a, b) => {
    if (a.top !== b.top) return b.top - a.top;
    return a.bottom - b.bottom;
  });

  const refs: ResolvedRef[] = [];
  const seen = new Set<string>();
  for (const { el } of matches) {
    const id = el.getAttribute("data-uuid");
    const kind = el.getAttribute("data-text-object-kind");
    if (
      id &&
      kind &&
      isTextObjectKind(kind) &&
      kind !== "linkedRange" &&
      !seen.has(id)
    ) {
      // Carry the resolved element through to placement — no doc walk to
      // re-find it. This IS the block's node DOM (the `data-uuid`/
      // `data-text-object-kind` decoration sits on the node's outer DOM,
      // == `editor.view.nodeDOM(pos)`).
      refs.push({ ref: { kind, id }, el });
      seen.add(id);
    }
  }
  return refs;
}

const EMPTY_RESOLVED: ResolvedRef[] = [];

/**
 * Compute placement for a single ref. Pins the handle's LEFT edge to the
 * source block's margin via `computeHandleLeftEdge` (X is unchanged by the
 * chrome-geometry unification — chip 2 owns the horizontal axis). Pins the
 * handle glyph's VERTICAL center to the block's optical (cap-band) center
 * via the canonical block frame, so every affordance on a row — a container
 * and its first item, the future drop indicator — aligns by construction.
 *
 * `preEl` is the block's DOM element pre-resolved by the discovery path
 * (hover scan / node selection); when present, placement uses it directly
 * and NEVER walks the doc. For a text selection (`preEl` null) the block is
 * resolved via the PM ancestor chain (O(depth)).
 *
 * Returns null when the ref isn't visible (off-screen, source missing, or
 * coords lookup fails).
 */
function computePlacement(
  editor: Editor,
  cache: EditorViewportFrame,
  ref: TextObjectRef | SelectionRef,
  preEl: HTMLElement | null,
): Placement | null {
  // Keep-alive: a hidden (display:none) editor has offsetHeight 0 and all
  // block rects collapse to 0×0, so any placement would be garbage. Bail before
  // any geometry read. (F6's viewport cache also stops refreshing while hidden,
  // so the hover zone self-clears — this is the explicit defense.)
  if (!cache.editorEl || cache.editorEl.offsetHeight === 0) return null;
  let anchorDom: HTMLElement | null = null;
  // For a selection, the handle aligns to the SELECTION's first line, not
  // the containing block's — captured here as a viewport-y, null otherwise.
  let selectionFirstLineTop: number | null = null;

  if (ref.kind === "selection") {
    // Resolve the containing TextObject via the PM ancestor chain
    // (O(depth)), then its DOM via `nodeDOM`; read the selection start's
    // coords for the first-line anchor.
    const $from = editor.state.doc.resolve(ref.from);
    let blockNodePos = -1;
    for (let d = $from.depth; d >= 0; d--) {
      const node = $from.node(d);
      if (!isTextObjectKind(node.type.name) || node.type.name === "linkedRange") continue;
      if (!(node.attrs?.uuid as string | null)) continue;
      blockNodePos = d === 0 ? 0 : $from.before(d);
      break;
    }
    if (blockNodePos < 0) return null;
    try {
      const fromCoords = editor.view.coordsAtPos(ref.from);
      if (fromCoords.top > 0) selectionFirstLineTop = fromCoords.top;
      const dom = editor.view.nodeDOM(blockNodePos);
      if (dom instanceof HTMLElement) anchorDom = dom;
    } catch {
      return null;
    }
  } else {
    // TextObjectRef: the hover scan / node selection already resolved the
    // element. The O(1) uuid lookup is a defensive fallback (it resolves the
    // SAME `[data-uuid]` node DOM the decoration sits on).
    anchorDom = preEl ?? resolveDomForUuid(editor, ref.id);
  }
  if (!anchorDom) return null;

  // The anchor DOM's rect is the authoritative visible bounds of the block
  // (coordsAtPos returns {0,0} for some multi-line block kinds). Bail when
  // the source is fully scrolled out so we don't pay measurement cost; CSS
  // `overflow: hidden` on the scroll container handles real clipping.
  const anchorRect = anchorDom.getBoundingClientRect();
  if (anchorRect.bottom < cache.scrollTop) return null;
  if (anchorRect.top > cache.scrollBottom) return null;

  // Canonical per-block geometry — ONE resolve feeds BOTH axes (markerLeft +
  // gapPx for X, opticalCenterY for Y), so the handle, a container + its first
  // item, and the future drop indicator align to the SAME numbers by
  // construction.
  const frame = resolveBlockFrame(anchorDom, editor, cache);

  // ---- Horizontal: hug the block's MEASURED marker one uniform gap left ----
  // BOTH a TextObject handle and a SELECTION handle hug the block's `markerLeft`
  // (text / bullet band / `(n)` / `a.`): the selection handle is a positional
  // REPLACEMENT of its containing block's text-object handle — it takes the same
  // gutter slot (task 092), via `resolveHandleMarkerLeft`. For a markerless
  // block `markerLeft === contentLeft`, so this is a no-op for plain paragraphs;
  // for a marker-bearing block it keeps the selection grip in the gutter left of
  // the bullet instead of over it. computeHandleLeftEdge then applies the shared
  // em gap + handle width and floors at the editor column so a deeply-indented
  // block on a narrow viewport never pushes the handle off-screen-left.
  // (editorColumnLeft is the .ProseMirror outside-left edge; the floor inset is
  // --margin-col-handle-inset via cache.marginInset.)
  // The resolve returns the whole LANE (task 382): its `maxLeft` is how far
  // inboard the same-row separation below may push this handle before its box
  // would reach the row's `inkLeft` — the bullet / `(n)` / prose it labels.
  const editorColumnLeft = editor.view.dom.getBoundingClientRect().left;
  const lane = resolveHandleLane({
    markerLeft: resolveHandleMarkerLeft(
      frame,
      ref.kind === "selection" ? "selection" : "text-object",
    ),
    gapPx: frame.gapPx,
    editorColumnLeft,
    baselineInset: cache.marginInset,
    inkLeft: frame.inkLeft,
  });
  const left = lane.left;

  // ---- Vertical: the Y the handle glyph's CENTER lands on ----
  // The CSS centers the dots on `placement.top` (see `.text-object-grab-handle`
  // in globals.css). Each kind declares its anchor via `meta.chromeAnchor`:
  //   • text-top → the optical (cap-band) center of THIS block's OWN first
  //     VISUAL line, from the canonical block frame. A container (`bulletList`
  //     / `orderedList` / `exampleBlock`) resolves THROUGH to its first
  //     grabbable child, because that child's first line IS the container's
  //     own — a `<ul>` has no text line. So a container's handle sits beside
  //     its structure's TOP row whichever row the pointer is on (task 394's
  //     hierarchical arrangement), and it coincides with an item's handle only
  //     where the two genuinely share a line — row 1 — which is exactly where
  //     `applySameRowSeparation` and the 382 ink cap take over.
  //   • block-top → framed visual kinds (tex pod, % comment, math, graphic,
  //     figure) have no first text line; pin the glyph a half-glyph below the
  //     block's top edge (pre-unification visual; chip 4 owns figure chrome).
  const anchor: "text-top" | "block-top" =
    ref.kind === "selection"
      ? resolveSelectionChromeAnchor(editor, ref.from)
      : TEXT_OBJECT_REGISTRY[ref.kind].chromeAnchor;
  let dotsCenterY: number;
  if (anchor === "block-top") {
    dotsCenterY = anchorRect.top + HANDLE_GLYPH_HALF;
  } else if (ref.kind === "selection") {
    const baseTop = selectionFirstLineTop ?? anchorRect.top;
    // Same optical cap-band center as the text-object branch, via the shared
    // `opticalCenterY` primitive. Read the font target from the ONE block frame
    // (`frame.target` = `resolveFirstLineTarget(anchorDom)`) rather than
    // re-descending: a selection's `anchorDom` is always a leaf/item text
    // object (never a container kind), so `frame.target` equals the old
    // `resolveInlineContextElement(anchorDom)` by construction.
    dotsCenterY = opticalCenterY(baseTop, frame.target);
  } else {
    dotsCenterY = frame.opticalCenterY;
  }

  // Convert viewport coords → portal-relative coords. The portal mounts
  // inside `editor-pane-column` (column-level sibling of the pod — escapes
  // the pod's clipPath that would otherwise clip handles in the margin) as
  // an absolute-positioned child. The sticky pod caps (z:30/31) cover
  // handles when they overlap on scroll.
  const portal = cache.toPortalCoords(left, dotsCenterY);
  // hitCapPx is filled by applyHitCaps once the full placement set is built —
  // it needs every sibling's position, which a single-ref compute can't see.
  // `maxLeft` rides in the SAME portal space as `left` (the transform is a pure
  // translation), so the separation can compare them directly.
  return {
    left: portal.x,
    top: portal.y,
    ref,
    hitCapPx: null,
    maxLeft: portal.x + (lane.maxLeft - left),
  };
}

/** For SelectionRef (kind === null), resolve the containing
 *  TextObject's chromeAnchor by walking the PM ancestor chain. Selections
 *  inherently span text, so default to "text-top" when no containing
 *  TextObject resolves. */
function resolveSelectionChromeAnchor(
  editor: Editor,
  from: number,
): "text-top" | "block-top" {
  try {
    const $from = editor.state.doc.resolve(from);
    for (let d = $from.depth; d >= 0; d--) {
      const node = $from.node(d);
      const name = node.type.name;
      if (!isTextObjectKind(name) || name === "linkedRange") continue;
      if (!(node.attrs?.uuid as string | null)) continue;
      return TEXT_OBJECT_REGISTRY[name].chromeAnchor;
    }
  } catch {
    // fall through to default
  }
  return "text-top";
}

interface Props {
  editorRef: RefObject<Editor | null>;
}

export function TextObjectGrabHandle({ editorRef }: Props) {
  const popped = usePoppedCards();
  const [placements, setPlacements] = useState<Placement[]>([]);
  // The post-threshold lifted-overlay core lives in the shared `LiftHost`
  // (src/text-objects/LiftHost.tsx) — it owns the overlay state + render and
  // the window listeners. The grab handle keeps only the SHELL: the
  // `is-pressed` toggle, the 5px threshold gate, the click→menu fallback, and
  // the SelectionRef→TextObjectRef hydration. At threshold-cross it hands off
  // to `host.beginLift({terminalPolicy:"grab", …})`.
  const liftHost = useLiftHost();
  const liftHostRef = useRef(liftHost);
  useEffect(() => {
    liftHostRef.current = liftHost;
  }, [liftHost]);

  // Mouse position drives the hover-based discovery path. null when the
  // mouse hasn't moved over the editor or has left the hover zone.
  // Since handles render inside the scroll container (post-Phase 6),
  // pointer continuity from prose → margin → handle is preserved by the
  // browser — no leave-grace timer needed.
  const mousePosRef = useRef<{ clientX: number; clientY: number } | null>(null);

  // Track the editor instance currently subscribed-to so we don't double-
  // subscribe across re-renders.
  const subscribedEditorRef = useRef<Editor | null>(null);
  // RAF handle for coalescing high-frequency events (selection, doc,
  // mousemove) into one placement compute per frame.
  const rafRef = useRef<number>(0);
  // Stable indirection so the listener-install effect (deps: []) can
  // call the latest schedule closure without re-attaching listeners on
  // every viewport-cache version bump. Populated by the schedule-setup
  // effect below.
  const scheduleRefRef = useRef<() => void>(() => {});

  const { frameRef: cacheRef, version: cacheVersion } = useViewportFrame(
    editorRef.current,
  );

  // ---------------------------------------------------------------------------
  // Click / lift gesture
  //
  // Each rendered handle binds its own mousedown. The shared `beginGesture`
  // closes over a captured ref (one per handle), so a click/drag dispatches
  // to the right kind without consulting the resolver again.
  // ---------------------------------------------------------------------------

  const poppedRef = useRef(popped);
  useEffect(() => {
    poppedRef.current = popped;
  }, [popped]);
  const dragHandleMenu = useDragHandleMenu();
  const dragHandleMenuRef = useRef(dragHandleMenu);
  useEffect(() => {
    dragHandleMenuRef.current = dragHandleMenu;
  }, [dragHandleMenu]);

  const beginGesture = useCallback((
    downEv: MouseEvent,
    handleEl: HTMLDivElement,
    startRef: TextObjectRef | SelectionRef,
  ) => {
    // The engine's start gate (SSOT, never re-derived).
    if (!isPrimaryDragStart(downEv)) return;
    downEv.preventDefault();
    downEv.stopPropagation();
    const editor = editorRef.current;
    if (!editor) return;
    // For TextObjectRefs, derive the tentative popout key up front. If
    // already popped we still allow click-to-open-menu; just no lift.
    if (startRef.kind !== "selection") {
      const tentativeKey = popoutKeyForLift(startRef);
      if (tentativeKey && poppedRef.current?.isPopped(tentativeKey)) {
        // tentativeKey check below in the drag branch reuses this.
      }
    }
    handleEl.classList.add("is-pressed");
    const startX = downEv.clientX;
    const startY = downEv.clientY;
    let triggered = false;

    const onMove = (mv: MouseEvent) => {
      if (triggered) return;
      // Missed-release failsafe (task 185/333) — PRE-threshold only, which is
      // this handler's exclusive ownership window: once the threshold is
      // crossed the gesture belongs to `LiftHost`, which carries its own
      // `isMissedRelease` bail. Without this, a swallowed mouseup left the
      // detector armed and the user's next stray movement lifted the block
      // out of the document from a press they had already released.
      if (isMissedRelease(mv)) {
        cleanup();
        return;
      }
      const dx = mv.clientX - startX;
      const dy = mv.clientY - startY;
      if (dx * dx + dy * dy < LIFT_THRESHOLD * LIFT_THRESHOLD) return;
      triggered = true;

      // Threshold crossed → this is a LIFT, not a click. Resolve the ref
      // (hydrating a live selection into a transient `linkedRange`), derive
      // the popout key, then hand the POST-THRESHOLD core off to the shared
      // `LiftHost` (overlay state + render + window listeners live there).
      // The grab handle's job ends at handoff: `cleanup()` removes its own
      // listeners + the `is-pressed` press visual (the user looks at the
      // ghost during the drag, not the handle), and the host runs the lift
      // to completion via its OWN mousemove/mouseup/mouseleave listeners.
      let ref: TextObjectRef;
      if (startRef.kind === "selection") {
        const docSize = editor.state.doc.content.size;
        const safeFrom = Math.max(0, Math.min(startRef.from, docSize));
        const safeTo = Math.max(0, Math.min(startRef.to, docSize));
        if (safeFrom >= safeTo) {
          cleanup();
          return;
        }
        // Plain selection grab → a TRANSIENT (cardless, invisible) range
        // handle: this is gesture input, not an annotation, so it must
        // leave no side-panel card and no highlight. The transient mark is
        // stripped when its popout closes (useTransientAnchorCleanup).
        const hydrated = hydrateSelectionToTextObject(
          editor.view,
          safeFrom,
          safeTo,
          { transient: true },
        );
        if (!hydrated) {
          cleanup();
          return;
        }
        ref = hydrated;
      } else {
        ref = startRef;
      }

      const cardKey = popoutKeyForLift(ref);
      if (!cardKey) {
        cleanup();
        return;
      }
      if (poppedRef.current?.isPopped(cardKey)) {
        cleanup();
        return;
      }

      const host = liftHostRef.current;
      // Tear down the grab handle's own pre-threshold listeners + press
      // visual BEFORE handing off — the host installs its own listeners and
      // owns the gesture from here. (No LiftHost mounted → no lift; the click
      // fallback in `onUp` never fires because we already crossed threshold,
      // so a missing host degrades to a no-op lift, which is acceptable: the
      // host is always present under EditorPane.)
      cleanup();
      // `terminalPolicy: "grab"` = the legacy grab-handle terminal behavior
      // (ghost-over-content → move; ghost-out-of-content → popout spawn).
      // `origin` is the mousemove coords at threshold cross — the cursor IS
      // on the block, so the host derives the in-hand grab offset from it.
      host?.beginLift({
        ref,
        cardKey,
        origin: { x: mv.clientX, y: mv.clientY },
        terminalPolicy: "grab",
      });
    };

    const onUp = () => {
      // No drag → treat as a click and open the action menu for the captured
      // ref. (Once `triggered` flips, `onMove` has already handed off to the
      // host and called `cleanup()`, removing this listener — so this only
      // ever runs for the pre-threshold click.)
      if (triggered) return;
      const open = dragHandleMenuRef.current?.open;
      if (open) {
        if (startRef.kind !== "selection") {
          const ed = editorRef.current;
          if (ed && !startRef.id) {
            cleanup();
            return;
          }
        }
        const rect = handleEl.getBoundingClientRect();
        open(startRef, rect);
      }
      cleanup();
    };
    const cleanup = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      handleEl.classList.remove("is-pressed");
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, [editorRef]);

  // Click-to-ensure-anchor-uuid fast path is wired through `beginGesture`'s
  // !startRef.id check above. Keep the import alive for clarity.
  void ensureAnchorUuid;

  // ---------------------------------------------------------------------------
  // Resolution + placement loop
  // ---------------------------------------------------------------------------

  useEffect(() => {
    let prevEditor: Editor | null = null;
    const cleanupListeners = () => {
      if (prevEditor) {
        prevEditor.off("selectionUpdate", onSelectionUpdate);
        prevEditor.off("update", onDocUpdate);
      }
      // Mousemove was attached document-wide (not on the editor DOM) so
      // the hover zone could include the margin to the left of content.
      // Detach the global listener whenever the editor instance changes.
      document.removeEventListener("mousemove", onMouseMove);
    };

    /**
     * Resolve the refs (each paired with its pre-resolved block DOM, so
     * placement never walks the doc) the schedule should render handles for.
     * Order (first match wins, except for hover which returns multiple):
     *   1. Non-empty TextSelection → [SelectionRef] (el null — resolved by
     *      the PM ancestor walk in computePlacement)
     *   2. NodeSelection on TextObject → [TextObjectRef + nodeDOM]
     *   3. Mouse hover over editor → [innermost..outermost + scanned el]
     *   4. Nothing → []
     */
    const resolveActiveRefs = (editor: Editor): ResolvedRef[] => {
      const sel = editor.state.selection;
      // 1. Non-empty TextSelection — text-lift gesture.
      if (sel.from !== sel.to && !(sel instanceof NodeSelection)) {
        const $from = editor.state.doc.resolve(sel.from);
        let paragraphId: string | null = null;
        for (let d = $from.depth; d >= 0; d--) {
          const node = $from.node(d);
          if (!isTextObjectKind(node.type.name) || node.type.name === "linkedRange") continue;
          const uuid = node.attrs?.uuid as string | null;
          if (uuid) {
            paragraphId = uuid;
            break;
          }
        }
        if (paragraphId) {
          return [{
            ref: {
              kind: "selection",
              from: sel.from,
              to: sel.to,
              paragraphId,
            },
            el: null,
          }];
        }
      }
      // 2. NodeSelection on a TextObject (atom blocks chiefly).
      if (sel instanceof NodeSelection) {
        const node = sel.node;
        const name = node.type.name;
        if (
          isTextObjectKind(name) &&
          name !== "linkedRange" &&
          (node.attrs?.uuid as string | null)
        ) {
          // O(1) DOM resolve: sel.from is the position right before the node.
          const nodeDom = editor.view.nodeDOM(sel.from);
          return [{
            ref: { kind: name as TextObjectKind, id: node.attrs.uuid as string },
            el: nodeDom instanceof HTMLElement ? nodeDom : null,
          }];
        }
      }
      // 3. Mouse hover — every containing TextObject level via Y-axis
      // containment scan over the editor's [data-uuid] decorations.
      //
      // THE ONE POINTER-DERIVED BRANCH, so it is answered only in POINTER
      // modality (task 336). The physical pointer is armed for the whole
      // session — it rests wherever the user last clicked to place the caret —
      // and this component subscribes to docChanged AND selectionUpdate, so
      // before the gate every keystroke re-ran the hover hit-test plus one
      // `computePlacement` per containing level at a pointer that never moved.
      // While the user types, the handle HIDES (branches 1/2 still answer: a
      // selection handle is selection-derived, not pointer-derived); the next
      // real `mousemove` re-arms it. See `@/lib/input-modality`.
      const mouse = isTypingModality() ? null : mousePosRef.current;
      if (mouse) {
        return resolveTextObjectsAtMouse(
          editor,
          cacheRef.current,
          mouse.clientX,
          mouse.clientY,
        );
      }
      // 4. No fallback (cursor-based discovery removed).
      return [];
    };

    const schedule = () => {
      const editor = editorRef.current;
      if (!editor || editor.isDestroyed) {
        setPlacements((p) => (p.length === 0 ? p : []));
        return;
      }
      // Read-only surfaces (the Library Reader) have nothing draggable, so
      // the grab handle is pure clutter in the margin. Yield ZERO placements
      // when the editor isn't editable — mirrors `Marginalia.tsx`, which gates
      // its drag affordance on `editor.isEditable`. O(1), no doc walk, so it
      // doesn't regress keystroke sanctity. (Decision D-2: gate here in the
      // shared layer rather than adding a chrome flag, so a future Reader that
      // wants handles just passes `editable={true}`.)
      if (!editor.isEditable) {
        setPlacements((p) => (p.length === 0 ? p : []));
        return;
      }
      const resolved = resolveActiveRefs(editor);
      // Task 394 — HIERARCHICAL placement: every level anchors at its OWN
      // block's first visual line, so the hovered row carries exactly one
      // handle and each containing level sits beside the top of the structure
      // it grabs. The hover SET is unchanged (innermost-first, every containing
      // level: task 353 spec points 1-2), so travelling UP the gutter toward a
      // container's handle keeps the pointer inside that container and the
      // handle alive. `computePlacement` therefore takes no per-hover hint —
      // see `resolveFirstLineTarget` in block-frame.ts for the retired one.
      const next: Placement[] = [];
      for (const { ref, el } of resolved) {
        const p = computePlacement(editor, cacheRef.current, ref, el);
        if (p) next.push(p);
      }
      // Chip 3: resolve each handle's hit-halo cap from the full set's sibling
      // geometry (so close nested handles don't overlap) — must run after every
      // placement is computed, since a single compute can't see its siblings.
      // Separation FIRST, then the halo caps — the caps must be derived from
      // the positions actually rendered (task 353).
      applySameRowSeparation(next);
      applyHitCaps(next);
      setPlacements((prev) => (placementArrayEqual(prev, next) ? prev : next));
    };
    const scheduleRaf = () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = 0;
        schedule();
      });
    };
    scheduleRefRef.current = scheduleRaf;

    // DECLARATIONS, not consts: `cleanupListeners` (above) detaches all three
    // of these, and it runs from `ensureSubscribed` — which `poll()` calls
    // SYNCHRONOUSLY inside this effect body. With `const`, a mount whose
    // `editorRef.current` is already non-null (a warm keep-alive re-mount)
    // reached the detach while they were still in the temporal dead zone and
    // threw out of the effect, taking the whole handle with it. Hoisting is the
    // fix that doesn't reorder the effect. Identity is preserved for the
    // `editor.off(...)` pairs by construction.
    function onSelectionUpdate() {
      scheduleRaf();
    }
    function onDocUpdate({
      transaction,
    }: {
      transaction: import("@tiptap/pm/state").Transaction;
    }) {
      if (!transaction.docChanged) return;
      scheduleRaf();
    }

    const ensureSubscribed = () => {
      const editor = editorRef.current;
      if (editor === subscribedEditorRef.current) return;
      cleanupListeners();
      subscribedEditorRef.current = editor;
      prevEditor = editor;
      if (editor) {
        editor.on("selectionUpdate", onSelectionUpdate);
        editor.on("update", onDocUpdate);
      }
      // Hover zone now extends into the margin to the left of the
      // editor content (so the user can travel from text to the
      // margin-anchored handle without losing hover). The
      // viewport-cache `containsHoverZone` predicate gates the actual
      // hover effect inside `onMouseMove`. A single document listener
      // is enough — no separate mouseleave handler is needed because
      // zone exit is detected inside `onMouseMove` itself.
      if (editor) {
        document.addEventListener("mousemove", onMouseMove);
      }
    };

    let pollAttempts = 0;
    const poll = () => {
      ensureSubscribed();
      schedule();
      if (!editorRef.current && pollAttempts < 30) {
        pollAttempts += 1;
        window.setTimeout(poll, 50);
      }
    };
    poll();

    // FOUT: when web fonts swap in mid-session, the cap-top cache holds
    // values measured against the fallback font. The metrics module
    // clears its own cache on `document.fonts.ready`; we also need to
    // re-run placement so visible handles snap to the corrected cap-top.
    // `onFontReady` returns a disposer — called in this effect's cleanup so a
    // fresh closure per mount doesn't retain the torn-down editor graph.
    const disposeFontReady = onFontReady(() => scheduleRaf());

    const onScroll = () => {
      // Scroll re-schedules placement (block rects change in clientY
      // space). The DOM-walk resolver re-runs from scratch each frame;
      // no separate cache to invalidate.
      scheduleRaf();
    };
    // Parked, not suppressed (task 317). A grab handle only exists while the
    // pointer is in the margin hover zone, and an OS window drag delivers no
    // pointer events to the page — so during that gesture there is nothing on
    // screen to look detached. The scroll path stays live.
    const gesturePark = parkDuringLayoutGesture(
      scheduleRaf,
      LAYOUT_SITE_GRAB_HANDLE,
    );
    const onResize = () => {
      gesturePark.fire();
    };
    // A declaration for the same hoisting reason as `onDocUpdate` above.
    function onMouseMove(e: MouseEvent) {
      // A REAL pointer event: restore pointer modality, so the hover branch
      // becomes answerable again after a typing burst (task 336). Reported
      // BEFORE the hover-zone check — a move that leaves the zone is pointer
      // input too, and it must be able to clear a stale handle. O(1), and it
      // notifies only on the flip edge, so a 240 Hz move stream costs one
      // boolean compare per event.
      notePointerInput();
      // Always-on tracking: hover is the primary discovery mechanism, so
      // the position must update during text selection / node selection
      // too. (The resolver prioritizes selection/node refs above hover,
      // so the array won't surprise during an active gesture.)
      // Outside the row hover zone → clear immediately. With handles
      // rendered inside the scroll container, pointer continuity from
      // prose → margin → handle is native; no grace timer needed.
      const cache = cacheRef.current;
      if (!cache.containsHoverZone(e.clientX, e.clientY)) {
        if (mousePosRef.current !== null) {
          mousePosRef.current = null;
          gesturePark.fire();
        }
        return;
      }
      mousePosRef.current = { clientX: e.clientX, clientY: e.clientY };
      // Through the park (perf Wave 2): the resolver behind this RAF is the
      // O(doc) `[data-uuid]` rect sweep, and a CONTENT drag keeps the
      // pointer moving for its whole duration — mid-gesture the handle sits
      // invisible under the drag ghost, so re-resolving per frame is pure
      // waste. Parked moves stash latest-wins and settle in ONE resolve at
      // the gesture's end edge; outside a gesture `fire()` runs inline and
      // hover behaves exactly as before.
      gesturePark.fire();
    }
    const onDocSelectionChange = () => {
      const editor = editorRef.current;
      if (!editor || editor.isDestroyed) return;
      // Sync PM's selection from the DOM (matches SelectionDragHandle's
      // logic for the Reader's contenteditable=false case).
      const view = editor.view;
      const domSel = window.getSelection();
      if (!domSel || domSel.rangeCount === 0) {
        scheduleRaf();
        return;
      }
      const range = domSel.getRangeAt(0);
      if (range.collapsed) {
        scheduleRaf();
        return;
      }
      const dom = view.dom as Node;
      if (
        !dom.contains(range.startContainer) ||
        !dom.contains(range.endContainer)
      ) {
        return;
      }
      try {
        const a = view.posAtDOM(range.startContainer, range.startOffset, 1);
        const b = view.posAtDOM(range.endContainer, range.endOffset, -1);
        if (a < 0 || b < 0) return;
        const pmFrom = Math.min(a, b);
        const pmTo = Math.max(a, b);
        if (pmFrom === pmTo) return;
        const cur = view.state.selection;
        if (cur.from === pmFrom && cur.to === pmTo) {
          scheduleRaf();
          return;
        }
        const tr = view.state.tr.setSelection(
          TextSelection.create(view.state.doc, pmFrom, pmTo),
        );
        view.dispatch(tr);
      } catch {
        scheduleRaf();
      }
    };

    // Modality FLIPS only — never per event (task 336). The first keystroke of
    // a burst schedules ONE resolve, which yields no hover refs and so hides
    // the handle; the rest of the burst schedules nothing from here. The flip
    // back to pointer rides the same `onMouseMove` that already schedules, so
    // the two coalesce into one RAF.
    const unsubModality = subscribeInputModality(() => scheduleRaf());

    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onResize);
    // DOM listeners (mousemove, mouseleave) attach via `ensureSubscribed`
    // so they re-attach if the editor instance is created late or swapped.
    const editorForGate = editorRef.current;
    const installSelectionChange =
      editorForGate !== null && !editorForGate.isEditable;
    if (installSelectionChange) {
      document.addEventListener("selectionchange", onDocSelectionChange);
    }
    return () => {
      cleanupListeners();
      disposeFontReady();
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = 0;
      }
      subscribedEditorRef.current = null;
      prevEditor = null;
      unsubModality();
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onResize);
      gesturePark.dispose();
      if (installSelectionChange) {
        document.removeEventListener("selectionchange", onDocSelectionChange);
      }
    };
  }, [editorRef]);

  // Recompute placement when the viewport cache version bumps (editor
  // resize, sidebar toggle). The portal target is resolved inline at
  // render time from `cacheRef.current.paperEl` — both the target and
  // the coord conversion read from the same cache snapshot in the same
  // render, eliminating the timing race where the portal pointed at
  // document.body while placements were already in portal-relative
  // coords.
  useEffect(() => {
    scheduleRefRef.current();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cacheVersion]);

  if (typeof document === "undefined") return null;
  // The lifted-overlay ghost render moved to the shared `LiftHost`; the grab
  // handle now renders only its margin handles, so it bails when there are no
  // placements (no overlay state lives here anymore).
  if (placements.length === 0) return null;
  // Resolve the portal target INLINE from the same cacheRef.current
  // snapshot that computePlacement (called above via schedule) used
  // for toPortalCoords. This guarantees that whenever placements are
  // in portal-relative coords, the portal target is the portal div
  // (not document.body) — eliminating the prior race where a state-
  // backed portalRoot lagged the cache by one render and handles
  // briefly portaled to body with portal-relative coords (resulting
  // in handles rendering far off-screen). `paperEl` here is the
  // editor-pane-column (renamed in comment only — see cache
  // JSDoc); the portal div is a column-level sibling of the pod.
  // Fallback to document.body covers the pre-mount window where the
  // column isn't resolved yet; in that case toPortalCoords identity-
  // fallbacks too, so coords are viewport, which is correct against
  // body when body scroll is 0 (Virgil's doc never scrolls — only the
  // inner [data-virgil-row-scroll] does).
  const livePortalRoot =
    cacheRef.current.paperEl?.querySelector(
      "[data-grab-handle-portal]",
    ) as HTMLElement | null ?? null;
  return createPortal(
    <>
      {placements.map((p) => (
        <GrabHandleRender
          key={refKey(p.ref)}
          placement={p}
          onBeginGesture={beginGesture}
        />
      ))}
    </>,
    livePortalRoot ?? document.body,
  );
}

interface GrabHandleRenderProps {
  placement: Placement;
  onBeginGesture: (ev: MouseEvent, el: HTMLDivElement, ref: TextObjectRef | SelectionRef) => void;
}

function GrabHandleRender({
  placement,
  onBeginGesture,
}: GrabHandleRenderProps) {
  const elRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = elRef.current;
    if (!el) return;
    const handler = (ev: MouseEvent) => {
      onBeginGesture(ev, el, placement.ref);
    };
    el.addEventListener("mousedown", handler);
    return () => {
      el.removeEventListener("mousedown", handler);
    };
  }, [placement.ref, onBeginGesture]);
  // `position: absolute` against the `[data-grab-handle-portal]` wrapper
  // (which is itself absolute inside the editor-pane-column — escapes the
  // pod's clipPath that clips lateral descendants of the pod past ±20px). The
  // wrapper has `pointer-events: none` to let prose clicks pass through; each
  // handle re-enables pointer events on itself.
  const style: CSSProperties = {
    position: "absolute",
    left: placement.left,
    top: placement.top,
    pointerEvents: "auto",
  };
  // Chip 3: when a near same-row sibling exists, clamp the hit-halo's
  // half-width (see `.text-object-grab-handle::before` in globals.css) to half
  // the gap so two close nested handles don't overlap. Absent → the CSS
  // default (effectively unbounded) keeps the full em-scaled pad.
  if (placement.hitCapPx != null) {
    (style as Record<string, string | number>)["--margin-handle-hit-cap"] =
      `${placement.hitCapPx}px`;
  }
  return (
    <div
      ref={elRef}
      className="text-object-grab-handle"
      style={style}
      data-hint="Drag to pop out, click for actions"
      // Task 353: the handle names its OWNER in the DOM. Without this a
      // rendered handle was identifiable only by its React key, so the only way
      // to ask "whose handle is that?" was to eyeball dots on a screenshot —
      // which is exactly how this bug was first mis-filed as "item 1's handle
      // lights on item 2" when the row-1 handle belonged to the LIST. Two
      // consumers: the spec suites assert set membership by owner rather than
      // by count, and a screenshot can be diagnosed from the inspector.
      data-grab-owner-kind={placement.ref.kind}
      data-grab-owner-uuid={
        placement.ref.kind === "selection" ? null : placement.ref.id
      }
      aria-hidden="true"
    >
      <svg width="10" height="14" viewBox="0 0 10 14" fill="currentColor">
        <circle cx="3" cy="2" r="1.2" />
        <circle cx="7" cy="2" r="1.2" />
        <circle cx="3" cy="7" r="1.2" />
        <circle cx="7" cy="7" r="1.2" />
        <circle cx="3" cy="12" r="1.2" />
        <circle cx="7" cy="12" r="1.2" />
      </svg>
    </div>
  );
}
