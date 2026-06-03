"use client";

/**
 * TextObjectGrabHandle — the single canonical grab handle for every
 * persistent TextObject in Virgil AND for live selections.
 *
 * Mounted once at the editor level (replaces SelectionDragHandle and the
 * per-NodeView grips that lived inside `ParagraphWithTitle` /
 * `HeadingWithLabel` / `createListTitleNodeView` / `TexBlockNodeView` /
 * `ExampleBlock`). Resolves the active TextObject (or selection) on every
 * selectionUpdate / docUpdate / scroll / mousemove, computes its
 * placement via the registry's `decorationSafety`, and dispatches the
 * click + lift gestures through the unified
 * `useDragHandleMenu` + `usePoppedCards` contexts.
 *
 * Discovery model (hover-driven, multi-level):
 *   1. Non-empty TextSelection   → one handle for the SelectionRef
 *      (text-lift gesture; hydrates to a linkedRange on lift).
 *   2. NodeSelection on a TextObject → one handle for the selected node.
 *   3. Mouse over the editor     → one handle for EVERY containing
 *      TextObject from innermost to outermost. Hovering text inside a
 *      `listItem` shows handles for both the listItem AND its parent
 *      `bulletList`. For deeper nesting (graphicsBlock inside listItem),
 *      every level gets a handle, each at its own decorationSafety indent.
 *   4. No mouse position / mouse outside editor + no handle hovered →
 *      no handles. (Cursor-based discovery is intentionally removed —
 *      the handle is a pure hover affordance, like a tooltip.)
 *
 * Rendering: handles portal into `[data-grab-handle-portal]` mounted
 * inside `editor-pane-column` as a sibling of the editor pod. The
 * column placement (rather than inside `paper-render`) is required: the
 * pod has a `clipPath` that clips lateral descendants beyond ±20px,
 * which would silently swallow handles in the gutter (handles sit ~22px
 * left of the content edge). Mounting at the column level: (a) lets
 * handles scroll with the paper (the column is inside the row scroll
 * container); (b) clips them behind the sticky pod caps (top z:30,
 * bottom z:31) which are also column-level siblings sharing the root
 * stacking context against the handle's z:20; (c) clips them at the
 * row scroll container's overflow. Pointer continuity from prose →
 * gutter → handle is native (no portal-to-body decoupling), so the
 * leave-grace timer, `mouseOverHandleRef`, and per-handle enter/leave
 * callbacks that the old portal-to-body model required are all retired.
 */

import {
  useEffect,
  useRef,
  useState,
  useCallback,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import type { Editor } from "@tiptap/react";
import { NodeSelection, TextSelection } from "@tiptap/pm/state";
import { usePoppedCards } from "@/hooks/usePoppedCards";
import { setCardLiftHandoff, setCardLiftTarget } from "@/components/card-lift";
import {
  beginDropSession,
  cancelDropSession,
  commitDropSession,
} from "@/components/drop-mode/controller";
import { ensureAnchorUuid } from "@/lib/anchor-uuid";
import { hydrateSelectionToTextObject } from "./hydrate-selection";
import { removeTransientAnchor } from "@/links/links";
import { walkAnchorableBlocks } from "@/lib/marginalia-blocks";
import { useDragHandleMenu } from "@/components/editor-layout/card-actions/drag-handle-menu-context";
import { useEditorChrome } from "@/components/editor-layout/chrome-context";
import { viewToggleClasses } from "@/components/editor-layout/chrome-config";
import {
  useEditorViewportCache,
  type EditorViewportCache,
} from "@/hooks/useEditorViewportCache";
import {
  capTopOffset,
  onFontReady,
  resolveInlineContextElement,
} from "@/lib/text-metrics";
import {
  TEXT_OBJECT_REGISTRY,
  isTextObjectKind,
  textObjectPopoutKey,
  capPopoutHeight,
} from "./text-object-registry";
import { computeHandleLeftEdge } from "./handle-layout";
import { LiftedTextOverlay } from "./LiftedTextOverlay";
import type {
  SelectionRef,
  TextObjectKind,
  TextObjectRef,
} from "./types";

const LIFT_THRESHOLD = 5;
/** Vertical offset between the cursor and the spawned float's top edge.
 *  The grip sits inside the float's header, so the cursor lands on the
 *  header (not on the body) after the lift. */
const SPAWN_CURSOR_OFFSET_Y = 16;
/** Issue-13: viewport inset for the released popout's bottom-fit clamp, so a
 *  height-capped lifted popout always lands fully on screen. Mirrors
 *  FloatingCards' auto-fit `adjustedY` margin (20) and the `innerHeight - 40`
 *  fit convention in FloatingPanel — the popout's top and bottom stay at
 *  least this far inside the viewport. */
const SPAWN_FIT_MARGIN = 20;

/** Popout chrome dimensions used by the lifted-overlay path (L1.12).
 *
 *  The lifted-overlay model treats the text content's absolute viewport
 *  position as invariant across ghost → popout overlay → real popout;
 *  chrome grows OUTWARD when modes change, the text never moves. These
 *  constants encode the real popout's chrome so the overlay's outer rect
 *  in popout mode and the `popOutAtRect` spawn rect can both be sized to
 *  produce a body-content rect that lands at exactly the ghost's text
 *  rect.
 *
 *  These mirror the real popout's chrome and MUST stay in sync with:
 *   - `TextObjectFloat.tsx` header `h-6` (24px tall) → POPOUT_HEADER_HEIGHT
 *   - `paragraph-body.tsx`'s `flex-1 overflow-auto px-8 py-4`
 *     (32px horizontal / 16px vertical padding) → POPOUT_BODY_PADDING_X/Y
 *   - the matching `.lifted-text-overlay__body` popout-mode padding rule
 *     in `globals.css` (currently 16px 32px) which mirrors the real body.
 *
 *  L4 cleanup may centralize these via the registry (per-kind chrome) once
 *  the lifted-overlay path generalizes beyond paragraph. */
const POPOUT_HEADER_HEIGHT = 24;
const POPOUT_BODY_PADDING_X = 32;
const POPOUT_BODY_PADDING_Y = 16;
/** Released-popout card border, one side, in px (L3b.3). The real float
 *  (`FloatingPanel` surface="card") is `box-sizing: border-box` with
 *  `border: var(--pod-border)` (1px each side), so its body content rect is
 *  `outerRect − 2*border − 2*padding` per axis — the same 1px-each-side
 *  deficit the lifted overlay has in popout mode. The `popOutAtRect` spawn
 *  below compensates so the released float's body text lands at exactly
 *  `sourceWidth × sourceHeight`, matching the ghost AND the drag-popout
 *  overlay (no re-wrap across the whole gesture). Mirrors
 *  `LiftedTextOverlay.tsx`'s `POPOUT_BORDER` and `--pod-border` width. */
const POPOUT_BORDER = 1;

/**
 * Default initial float size at spawn time. Per-kind overrides live on
 * the registry as `meta.initialFloatSize`; wider kinds (headings,
 * lists, tex blocks) populate it.
 */
const DEFAULT_FLOAT_SIZE: { width: number; height: number } = { width: 360, height: 280 };

function floatSizeFor(kind: TextObjectKind) {
  return TEXT_OBJECT_REGISTRY[kind].initialFloatSize ?? DEFAULT_FLOAT_SIZE;
}

/**
 * Map a `TextObjectRef` to the popout key used by
 * `viewPrefs.poppedOutCards`. Every block-popout key collapses to
 * `textobject:<kind>:<id>` emitted by `textObjectPopoutKey` (Phase D10).
 * Returns null for TextObject kinds whose float body isn't registered
 * yet — the handle still opens the action menu on click, it just
 * doesn't lift.
 *
 * SelectionRef lifts hydrate into `linkedRange` TextObjects at the
 * lift commit (Phase E); after hydration they pass through this
 * function as a normal TextObjectRef.
 */
export function popoutKeyForLift(ref: TextObjectRef): string | null {
  switch (ref.kind) {
    case "paragraph":
    case "heading":
    case "bulletList":
    case "orderedList":
    case "blockquote":
    case "codeBlock":
    // displayMath (L3h, Chip 2): read-only "view & move" lift float.
    case "displayMath":
    // latexComment (L3i, Chip 3): editable atom lift float (decision A).
    case "latexComment":
    // titleField (L3j, Chip 4): editable prose lift float (decision C); its
    // node was promoted into the float schema (the last prose-shaped kind).
    case "titleField":
    // listItem (L3k, Chip 5): the FIRST sub-object lift float — a bespoke
    // list-item-body that wrap-seeds the item in its parent list and writes
    // back only the inner item's range (siblings intact).
    case "listItem":
    // exampleItem (L3l, Chip 6): the LAST sub-object lift float — a bespoke
    // example-item-body, the listItem mirror one wrap level deeper (the full
    // exampleBlock > exampleItemList envelope; inner write-back unwraps two
    // levels, siblings + the parent example intact).
    case "exampleItem":
    case "texBlock":
    case "exampleBlock":
    case "linkedRange":
      return textObjectPopoutKey(ref);
    default:
      return null;
  }
}

interface Placement {
  /** Viewport-x of the handle's left edge. */
  left: number;
  /** Viewport-y of the handle's top edge (sticky-to-top when the source
   *  has scrolled above the viewport). */
  top: number;
  /** The resolved ref the handle represents. */
  ref: TextObjectRef | SelectionRef;
}

function placementsEqual(a: Placement, b: Placement): boolean {
  if (a.left !== b.left || a.top !== b.top) return false;
  return refsEqual(a.ref, b.ref);
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
 * whose DOM "owns" the gutter-X column. Two recurring shapes:
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
  cache: EditorViewportCache,
  clientX: number,
  clientY: number,
): TextObjectRef[] {
  if (!cache.containsHoverZone(clientX, clientY)) return EMPTY_REFS;
  const editorEl = editor.view.dom;
  if (!(editorEl instanceof HTMLElement)) return EMPTY_REFS;

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

  const refs: TextObjectRef[] = [];
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
      refs.push({ kind, id });
      seen.add(id);
    }
  }
  return refs;
}

const EMPTY_REFS: TextObjectRef[] = [];

/**
 * Resolve the source block's DOM element for a `TextObjectRef`. Mirrors
 * the lookup in `computePlacement`: walks `walkAnchorableBlocks` to
 * find the block by uuid, then asks the view for its NodeView DOM. The
 * resulting element is what the lifted-overlay clones at threshold
 * cross. Returns null when the source is missing (concurrent delete) —
 * the lifted-overlay gesture degrades to a popout-release at the
 * overlay's current rect in that case.
 */
function resolveAnchorDom(
  editor: Editor,
  ref: TextObjectRef,
): HTMLElement | null {
  const block = walkAnchorableBlocks(editor).find((b) => b.uuid === ref.id);
  if (!block) return null;
  const node = editor.state.doc.nodeAt(block.pos);
  if (!node || node.type.name !== ref.kind) return null;
  const dom = editor.view.nodeDOM(block.pos);
  return dom instanceof HTMLElement ? dom : null;
}

/**
 * Live state for an in-flight lifted-overlay gesture. The parent
 * (`TextObjectGrabHandle`) holds one of these as React state while the
 * gesture is active; mutating it during the gesture is done via
 * `setOverlay({...})` so React renders the overlay with the new cursor
 * coords + mode. The `cardKey` is captured at threshold-cross so
 * `onUp` can spawn the popout without re-resolving.
 */
interface OverlayState {
  ref: TextObjectRef;
  cardKey: string;
  /** Null for a mark-backed range kind (`linkedRange`, L3f-2) — the overlay
   *  renders `ghostContent` (the extracted range) instead of cloning an
   *  anchor element. Non-null for every element kind. */
  anchorDom: HTMLElement | null;
  /** Overridden ghost content (L3-Headings). Resolved once at threshold
   *  cross via `meta.renderGhost?.(anchorDom, editor, ref)` — heading's
   *  whole-section clone. Null for kinds without the hook (or a lone
   *  heading), in which case the overlay clones `anchorDom`. Threaded to
   *  `LiftedTextOverlay` as a prop so the overlay stays kind-agnostic. */
  ghostContent: HTMLElement | null;
  /** Cursor offset within the source's rendered rect — fixed for the
   *  gesture's lifetime so the source visual stays "stuck" to the user's
   *  grab point. */
  grabOffsetX: number;
  grabOffsetY: number;
  /** Source rect captured ONCE at threshold-cross. */
  sourceWidth: number;
  sourceHeight: number;
  /** Live cursor coords, updated every mousemove. */
  cursorX: number;
  cursorY: number;
  /** Live chrome mode, flipped by `containsContentZone(cursor)`. */
  mode: "ghost" | "popout";
  /** Header label for the overlay's popout-mode chrome. Resolved at
   *  threshold cross via `meta.computeLabel?.(editor, ref) ?? meta.label`
   *  (L3a) so per-level / per-variant overrides (heading → "Chapter" /
   *  "Section" / "Subsection") match the real popout's
   *  `setHeaderLabel` at release handoff. Pinned for the gesture — the
   *  attrs that drove the computation can't change mid-gesture since
   *  the user holds the mouse. */
  label: string;
  /** View-toggle class tokens (dividers / hide-* / divider-width) for the
   *  overlay ROOT, so the drag ghost honors the same show/hide state the
   *  page shows. Built from `viewToggleClasses(menuBar)` — the ONE source
   *  the page column and every float body also consume (Issue-12) — and
   *  pinned at threshold cross (toggle state can't change mid-gesture since
   *  the user holds the mouse, same rationale as `label`). */
  viewToggleCls: string;
}

/**
 * Compute placement for a single ref. Pins the handle's left edge to
 * the source block's gutter via `computeHandleLeftEdge`; pins the top
 * edge to the range's first-line top (clamped to the editor scroll
 * container's top when scrolled above the viewport).
 *
 * Returns null when the ref isn't visible (off-screen, source missing,
 * or coords lookup fails).
 */
function computePlacement(
  editor: Editor,
  cache: EditorViewportCache,
  ref: TextObjectRef | SelectionRef,
): Placement | null {
  let from = -1;
  let to = -1;
  let blockNodePos = -1;

  if (ref.kind === "selection") {
    from = ref.from;
    to = ref.to;
    const $from = editor.state.doc.resolve(from);
    for (let d = $from.depth; d >= 0; d--) {
      const node = $from.node(d);
      if (!isTextObjectKind(node.type.name) || node.type.name === "linkedRange") continue;
      if (!(node.attrs?.uuid as string | null)) continue;
      blockNodePos = d === 0 ? 0 : $from.before(d);
      break;
    }
  } else {
    const block = walkAnchorableBlocks(editor).find(
      (b) => b.uuid === ref.id,
    );
    if (block) {
      const node = editor.state.doc.nodeAt(block.pos);
      if (node && node.type.name === ref.kind) {
        from = block.pos + (block.isAtom ? 0 : 1);
        to = block.pos + node.nodeSize - (block.isAtom ? 0 : 1);
        blockNodePos = block.pos;
      }
    }
  }
  if (from < 0 || blockNodePos < 0) return null;

  let fromCoords: { left: number; top: number; bottom: number };
  let toCoords: { top: number; bottom: number };
  let anchorDom: HTMLElement | null = null;
  try {
    fromCoords = editor.view.coordsAtPos(from);
    toCoords = editor.view.coordsAtPos(to);
    const dom = editor.view.nodeDOM(blockNodePos);
    if (dom instanceof HTMLElement) anchorDom = dom;
  } catch {
    return null;
  }
  if (!anchorDom) return null;

  // Use the anchor DOM's rect for the visibility check rather than the
  // coordsAtPos values, which return {0, 0} for some multi-line block
  // kinds (exampleBlock with deep content tree). The DOM rect is the
  // authoritative visible bounds of the block. CSS `overflow: hidden`
  // on the scroll container handles the actual clipping; we still
  // bail when the source is fully scrolled out so we don't pay
  // measurement cost.
  const anchorRect = anchorDom.getBoundingClientRect();
  if (anchorRect.bottom < cache.scrollTop) return null;
  if (anchorRect.top > cache.scrollBottom) return null;

  const kind: TextObjectKind | null =
    ref.kind === "selection" ? null : ref.kind;
  const meta = kind ? TEXT_OBJECT_REGISTRY[kind] : null;
  // editorColumnLeft is the .ProseMirror element's outside-left edge —
  // the floor we clamp sub-object handles against on narrow viewports.
  // baselineInset is read from --gutter-col-handle-inset (via the
  // cache) so JS placement and CSS chrome share one source.
  const editorColumnLeft = editor.view.dom.getBoundingClientRect().left;
  const baselineInset = cache.gutterInset;
  const left = meta
    ? computeHandleLeftEdge({
        elDOM: anchorDom,
        kind: kind as TextObjectKind,
        node: editor.state.doc.nodeAt(blockNodePos) ?? undefined,
        editorColumnLeft,
        baselineInset,
        meta,
      })
    : anchorDom.getBoundingClientRect().left - baselineInset;

  // Top edge: every kind declares its vertical anchor via
  // `meta.chromeAnchor`. "text-top" routes through `measureHandleAnchorTop`
  // for TextObjectRefs (override → resolveInlineContextElement + capTopOffset),
  // and for SelectionRef we compute the same offset directly on the
  // resolved inline-context element. "block-top" uses the wrapper's
  // visual top edge — for framed visual kinds (tex pod, % comment, math,
  // graphic, figure) where there's no "first line of prose" to align with.
  const anchor: "text-top" | "block-top" = meta
    ? meta.chromeAnchor
    : resolveSelectionChromeAnchor(editor, from);
  let candidateTop: number;
  if (ref.kind === "selection") {
    if (anchor === "text-top") {
      const baseTop = fromCoords.top > 0 ? fromCoords.top : anchorRect.top;
      const target = resolveInlineContextElement(anchorDom);
      candidateTop = baseTop + capTopOffset(target);
    } else {
      candidateTop = anchorRect.top;
    }
  } else {
    const measured = measureHandleAnchorTop(anchorDom, anchor);
    candidateTop = measured ?? (fromCoords.top > 0 ? fromCoords.top : anchorRect.top);
  }
  // Convert from viewport coords (what getBoundingClientRect /
  // coordsAtPos / measureHandleAnchorTop return) to portal-relative
  // coords. The portal mounts inside `editor-pane-column` (column-level
  // sibling of the pod — escapes the pod's clipPath that would
  // otherwise clip handles in the gutter) as an absolute-positioned
  // child, so handles need their `top`/`left` relative to the column's
  // content box. The sticky pod caps (z:30/31) cover handles when they
  // overlap on scroll — no more Math.max(candidateTop, scrollTop)
  // clamp, which was a portal-to-body workaround that produced the
  // "sticky to viewport top" behavior.
  const portal = cache.toPortalCoords(left, candidateTop);
  return { left: portal.x, top: portal.y, ref };
}

/**
 *  Measure the top edge that the grab handle should align to for a given
 *  anchorDom + chromeAnchor mode.
 *
 *    - `block-top` (texBlock, latexComment, displayMath, graphicsBlock,
 *      figureBlock): the wrapper's visual top edge IS the visual anchor —
 *      no font math needed. Returns `anchorDom.getBoundingClientRect().top`.
 *
 *    - `text-top` (paragraph, heading, blockquote, codeBlock, listItem,
 *      exampleItem, titleField): handle should align with the GLYPH
 *      cap-top of the first rendered line, not the line-box top.
 *      Resolution:
 *        1. `[data-glyph-anchor]` — NodeView's "visual top" override for
 *           compound containers (exampleBlock points to `.expex-number`,
 *           a text-bearing chip).
 *        2. `resolveInlineContextElement(anchorDom)` — descend any wrapper
 *           NodeView to the actual first-line text-bearing element.
 *      Then return `target.getBoundingClientRect().top + capTopOffset(target)`,
 *      where `capTopOffset` is a font-metric-aware helper that recovers
 *      the half-leading + (ascent − capHeight) offset dynamically from
 *      the rendered font. No hardcoded per-kind constants.
 *
 *  Returns the viewport-y coord.
 */
function measureHandleAnchorTop(
  anchorDom: HTMLElement,
  chromeAnchor: "text-top" | "block-top",
): number | null {
  if (chromeAnchor === "block-top") {
    return anchorDom.getBoundingClientRect().top;
  }
  const override = anchorDom.querySelector(
    "[data-glyph-anchor]",
  ) as HTMLElement | null;
  const target = override ?? resolveInlineContextElement(anchorDom);
  return target.getBoundingClientRect().top + capTopOffset(target);
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
  // Lifted-overlay gesture state (L1 of the Lifted-Overlay refactor;
  // paragraph only — gated by `meta.liftMode === "lifted-overlay"`).
  // Non-null while a lifted-overlay drag is in flight; null otherwise.
  // The 15 instant-popout kinds never touch this state.
  const [overlay, setOverlay] = useState<OverlayState | null>(null);

  // Mouse position drives the hover-based discovery path. null when the
  // mouse hasn't moved over the editor or has left the hover zone.
  // Since handles render inside the scroll container (post-Phase 6),
  // pointer continuity from prose → gutter → handle is preserved by the
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

  const { cacheRef, version: cacheVersion } = useEditorViewportCache(
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

  // View-toggle classes (dividers / hide-* / divider-width) for the drag
  // ghost overlay. Built from the SAME `viewToggleClasses(menuBar)` source
  // the page column and every float body consume (Issue-12); `menuBar`
  // reaches here via `useEditorChrome()` because the grab handle renders
  // inside EditorPane's `EditorChromeProvider`. Mirrored into a ref (same
  // idiom as `poppedRef` / `dragHandleMenuRef`) so the imperative lift
  // gesture can pin the live value on the overlay at threshold-cross.
  const chrome = useEditorChrome();
  const viewToggleClsRef = useRef(viewToggleClasses(chrome.menuBar));
  useEffect(() => {
    viewToggleClsRef.current = viewToggleClasses(chrome.menuBar);
  }, [chrome.menuBar]);

  const beginGesture = useCallback((
    downEv: MouseEvent,
    handleEl: HTMLDivElement,
    startRef: TextObjectRef | SelectionRef,
  ) => {
    if (downEv.button !== 0) return;
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
    // Live overlay state mirrored as a local closure variable so the
    // mousemove handler can mutate cursor / mode without a state-read
    // through React. We still call `setOverlay({...})` to publish to
    // the renderer; the local copy is the source of truth between
    // events. Stays null on the instant-popout path.
    let liveOverlay: OverlayState | null = null;

    const onMove = (mv: MouseEvent) => {
      if (!triggered) {
        const dx = mv.clientX - startX;
        const dy = mv.clientY - startY;
        if (dx * dx + dy * dy < LIFT_THRESHOLD * LIFT_THRESHOLD) return;
        triggered = true;

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

        // Dispatch on `meta.liftMode`. Paragraph (L1) takes the
        // lifted-overlay path; the other 15 kinds keep instant-popout.
        const meta = TEXT_OBJECT_REGISTRY[ref.kind];
        const liftMode = meta.liftMode ?? "instant-popout";

        if (liftMode === "lifted-overlay") {
          // Capture source rect ONCE at threshold cross (never re-read);
          // mount the overlay; mousemove now drives cursor + mode until
          // release. Paragraph/heading/list/example/texBlock are element
          // kinds (anchorDom present); linkedRange is a mark-backed RANGE.
          const anchorDom = resolveAnchorDom(editor, ref);
          // L3f-2: a mark-backed RANGE kind (`linkedRange`) has no single
          // anchor element — `resolveAnchorDom` is null BY DESIGN. Instead of
          // bailing, drive the overlay from the registry hooks with
          // `anchorDom=null`: `renderGhost` extracts the marked range's DOM,
          // `liftSourceRect` unions its client rects. The element path
          // (anchorDom present) is byte-for-byte unchanged: `liftRect` still
          // defaults to `anchorDom.getBoundingClientRect()`, `ghostContent` is
          // null unless the kind defines `renderGhost`, and it never takes the
          // range-only bail clause below (isRange === false).
          const isRange = meta.isRange === true;
          // L3-Headings: two kind-agnostic registry hooks each replace one
          // hardcoded assumption about a lifted ghost — that its content is
          // exactly `anchorDom` and its rect exactly anchorDom's bounding
          // rect. `liftSourceRect` overrides the captured source rect;
          // `renderGhost` overrides the cloned content. Heading uses both
          // (the WHOLE SECTION); linkedRange uses both (the marked RANGE).
          // Resolved HERE at the parent (editor / meta / ref / cache all in
          // scope) and threaded down as props, so `LiftedTextOverlay` stays
          // kind-agnostic — no registry import, no editor prop — exactly as
          // L3a moved label resolution out of the overlay. Absent on a kind
          // (or null for a lone heading) → the defaults stand, so the prior
          // lifted kinds are byte-identical. ONE capture site: the (possibly
          // capped) sourceHeight feeds both the ghost AND the popOutAtRect
          // spawn, so the released popout opens at the same height. `liftRect`
          // is a structural {left,top,width,height} OR a DOMRect — both expose
          // those four; read only those. For a range there is no anchorDom
          // default, so the hook must resolve (null → the bail below).
          const liftRect =
            meta.liftSourceRect?.(anchorDom, editor, ref, cacheRef.current) ??
            anchorDom?.getBoundingClientRect() ??
            null;
          const ghostContent = meta.renderGhost?.(anchorDom, editor, ref) ?? null;
          if (!liftRect || (isRange && !ghostContent)) {
            // Fall back to the legacy cursor-centered spawn so the gesture
            // still produces a popout instead of silently dropping: an element
            // whose DOM vanished at threshold (decision §9 — no rect), or a
            // range whose mark/DOM couldn't be resolved (no rect, or a null
            // ghost that would mount empty). Element kinds always have a rect
            // here, so for them this is IDENTICAL to the prior `!anchorDom`
            // bail — it only fires on a concurrent delete.
            const { width, height } = floatSizeFor(ref.kind);
            const legacySpawn = {
              x: Math.round(mv.clientX - width / 2),
              y: Math.round(mv.clientY - SPAWN_CURSOR_OFFSET_Y),
              width,
              height,
            };
            poppedRef.current?.popOutAtRect(cardKey, legacySpawn);
            cleanup();
            return;
          }
          // Issue-13: cap the captured source height to a viewport fraction
          // (POPOUT_MAX_VH) at this SINGLE capture site, so EVERY lifted kind's
          // ghost AND released popout fit on screen (the float body scrolls the
          // overflow). A MAX, not a floor: short content (liftRect.height <
          // cap) is unchanged. Because this one capped height feeds both the
          // ghost (overlay sized to sourceHeight) and the popOutAtRect spawn
          // (height = sourceHeight + chrome), the two stay identical — no size
          // jump on release (the L1.12 text-stays-still / chrome-grows-outward
          // invariant holds). Left/top/width untouched, so the grab offset is
          // unchanged.
          const cappedSourceHeight = capPopoutHeight(
            liftRect.height,
            window.innerHeight,
          );
          const initialMode = cacheRef.current.containsContentZone(
            mv.clientX,
            mv.clientY,
          )
            ? "ghost"
            : "popout";
          // L3a: per-instance label override via the registry. Heading
          // maps node.attrs.level → "Chapter" / "Section" / "Subsection"
          // so the overlay's popout-mode header matches the real popout
          // at handoff (rather than the static "Heading"). Other kinds
          // either don't define computeLabel or return null, in which
          // case we fall through to `meta.label`.
          const computed = meta.computeLabel?.(editor, ref) ?? null;
          const label = computed ?? meta.label;
          liveOverlay = {
            ref,
            cardKey,
            anchorDom,
            ghostContent,
            grabOffsetX: mv.clientX - liftRect.left,
            grabOffsetY: mv.clientY - liftRect.top,
            sourceWidth: liftRect.width,
            sourceHeight: cappedSourceHeight,
            cursorX: mv.clientX,
            cursorY: mv.clientY,
            mode: initialMode,
            label,
            viewToggleCls: viewToggleClsRef.current,
          };
          setOverlay(liveOverlay);
          // Start a drop session ALONGSIDE the overlay. `inPlace: true`
          // skips markSourceFloat (no popout exists to dim during the
          // ghost gesture); `externalCommit: true` skips the
          // controller's own mouseup so this handler's `onUp` can
          // decide between commit (ghost release) and cancel (popout
          // release). The controller's hit-test + Indicator render
          // run for the full gesture lifetime; in popout mode the
          // hit-test resolves to null and the Indicator hides
          // automatically.
          beginDropSession({
            cardKey,
            origin: { x: mv.clientX, y: mv.clientY },
            inPlace: true,
            externalCommit: true,
          });
          // Do NOT cleanup — onMove continues to drive the overlay,
          // and onUp commits via the drop session (ghost) or cancels
          // the session + spawns the popout (popout) based on terminal
          // mode.
          // cardLiftHandoff/cardLiftTarget intentionally NOT emitted
          // on this path: the popout (if it spawns) lands at the
          // overlay's terminal rect, so there's no in-flight handoff
          // animation to perform.
          return;
        }

        // Instant-popout path (legacy — 15 non-paragraph kinds).
        const { width, height } = floatSizeFor(ref.kind);
        const spawn = {
          x: Math.round(mv.clientX - width / 2),
          y: Math.round(mv.clientY - SPAWN_CURSOR_OFFSET_Y),
          width,
          height,
        };
        const wrapperRect = handleEl.getBoundingClientRect();
        setCardLiftTarget({
          cardKey,
          rect: {
            left: wrapperRect.left,
            top: wrapperRect.top,
            width: wrapperRect.width,
            height: wrapperRect.height,
          },
        });
        window.setTimeout(() => setCardLiftTarget(null), 150);
        setCardLiftHandoff({
          cardKey,
          clientX: mv.clientX,
          clientY: mv.clientY,
          width,
          height,
        });
        poppedRef.current?.popOutAtRect(cardKey, spawn);
        cleanup();
        return;
      }

      // Triggered + lifted-overlay path → drive overlay cursor + mode.
      if (liveOverlay) {
        const inContent = cacheRef.current.containsContentZone(
          mv.clientX,
          mv.clientY,
        );
        liveOverlay = {
          ...liveOverlay,
          cursorX: mv.clientX,
          cursorY: mv.clientY,
          mode: inContent ? "ghost" : "popout",
        };
        setOverlay(liveOverlay);
      }
    };

    // Document-leave forces popout mode (decision §8) — the same
    // defensive pattern the drop-mode controller uses. If the user
    // drags off the document entirely, the gesture lands as a popout
    // at release (rather than the ambiguous ghost state).
    const onDocLeave = (ev: MouseEvent) => {
      if (ev.relatedTarget != null) return;
      if (!liveOverlay) return;
      liveOverlay = { ...liveOverlay, mode: "popout" };
      setOverlay(liveOverlay);
    };

    const onUp = async (upEv: MouseEvent) => {
      // No drag → treat as a click and open the action menu for the
      // captured ref.
      if (!triggered) {
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
        return;
      }

      // Triggered on lifted-overlay path — commit the popout (popout
      // mode) or the drop-mode placement (ghost mode).
      if (liveOverlay) {
        const {
          ref,
          cardKey,
          grabOffsetX,
          grabOffsetY,
          sourceWidth,
          sourceHeight,
          cursorX,
          cursorY,
          mode,
        } = liveOverlay;
        // Final mode read uses the up-event coords (slightly more
        // accurate than the last mousemove if the user released between
        // frames). Falls back to the live state when the up event
        // happens to land in the same zone.
        const finalMode = cacheRef.current.containsContentZone(
          upEv.clientX,
          upEv.clientY,
        )
          ? "ghost"
          : mode === "popout"
            ? "popout"
            : "ghost";
        if (finalMode === "popout") {
          // Cancel the drop session that was started at threshold
          // cross — the gesture's terminal action is a popout spawn,
          // not a doc move, so the controller's listeners and the
          // Indicator (already hidden in popout mode because no
          // placement resolves outside the pod) need to tear down.
          cancelDropSession();
          // L1.12: spawn the real popout with chrome-inclusive coords so
          // its body-content rect (after subtracting the header height
          // and body padding) lands at exactly the text rect the overlay
          // was holding. Without this offset the popout's header eats
          // 24px from the top of the rect, the body padding eats 16/32
          // from each axis, and the body content lands shifted (32, 40)
          // from where the ghost's text was — a visible jump on release.
          // L3b.3: also compensate the float's 1px card border on each axis
          // (box-sizing: border-box eats it from the body content area, the
          // same deficit the overlay had), so the released float's body text
          // is sourceWidth × sourceHeight — matching the ghost AND the
          // drag-popout overlay, with no re-wrap on release.
          const overlayHeight =
            sourceHeight +
            POPOUT_HEADER_HEIGHT +
            2 * POPOUT_BODY_PADDING_Y +
            2 * POPOUT_BORDER;
          // Issue-13: clamp the spawn Y so the (now height-capped) window's
          // bottom stays on screen. Mirrors FloatingCards' auto-fit
          // `adjustedY` clamp (Math.max(20, Math.min(top, innerHeight −
          // height − 20))) and the `innerHeight - 40` fit convention in
          // FloatingPanel. With sourceHeight ≤ ~55% viewport (the capture cap)
          // plus 58px chrome, a valid Y always exists; Math.max keeps the top
          // on screen if the grab point sat near the viewport bottom.
          const spawnY = Math.max(
            SPAWN_FIT_MARGIN,
            Math.min(
              Math.round(
                cursorY -
                  grabOffsetY -
                  POPOUT_HEADER_HEIGHT -
                  POPOUT_BODY_PADDING_Y -
                  POPOUT_BORDER,
              ),
              window.innerHeight - SPAWN_FIT_MARGIN - overlayHeight,
            ),
          );
          const overlayRect = {
            x: Math.round(
              cursorX - grabOffsetX - POPOUT_BODY_PADDING_X - POPOUT_BORDER,
            ),
            y: spawnY,
            width: sourceWidth + 2 * POPOUT_BODY_PADDING_X + 2 * POPOUT_BORDER,
            height: overlayHeight,
          };
          poppedRef.current?.popOutAtRect(cardKey, overlayRect);
        } else {
          // Ghost-mode release: commit the move via the drop-mode
          // placement engine. The session was started at threshold
          // cross with `externalCommit: true`, so it didn't install
          // its own mouseup — this handler drives the commit. If
          // the placement is null (cursor not over a block) OR the
          // spec's classifyDrop returns "no-op" (insertPos inside
          // source), commitDropSession ends the session silently
          // with no doc change.
          await commitDropSession();
          // L3f-2: strip the transient (cardless, invisible) anchor minted
          // for a plain selection grab now that its move committed. On an
          // actual move the marked text was deleted (the mark went with it)
          // and the inserted copy was already stripped (text-range-move);
          // on a no-op drop (self-drop / no placement) the mark still sits
          // on the source range, so this removes it. GUARDED: a no-op unless
          // the mark is truly transient, so a grab that reused a REAL
          // annotation's range never deletes that note/highlight/cut/revision.
          // (L3f-1 deferred this move/cancel cleanup; popout-close is handled
          // by the `useTransientAnchorCleanup` poppedOutCards watcher.)
          if (ref.kind === "linkedRange") {
            removeTransientAnchor(editor, ref.id);
          }
        }
        liveOverlay = null;
        setOverlay(null);
      }
      cleanup();
    };
    const cleanup = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      document.documentElement.removeEventListener("mouseleave", onDocLeave);
      handleEl.classList.remove("is-pressed");
      // Defensive: if the gesture aborted mid-overlay without
      // committing (e.g. cleanup() called between threshold-cross and
      // onUp on the lifted-overlay path), clear the overlay state so
      // it doesn't ghost on screen.
      if (liveOverlay) {
        // L3f-2: cancel/abort path (Escape mid-gesture, programmatic abort)
        // for a plain selection grab — strip its transient anchor so it
        // doesn't litter. GUARDED (no-op unless truly transient), so a grab
        // that reused a real annotation never deletes it. The committed
        // (move) and popout paths already nulled `liveOverlay` before
        // calling cleanup, so they don't double-handle here: move strips via
        // the onUp branch above, popout-close via the watcher.
        if (liveOverlay.ref.kind === "linkedRange") {
          removeTransientAnchor(editor, liveOverlay.ref.id);
        }
        liveOverlay = null;
        setOverlay(null);
      }
      // Defensive: end any drop session this gesture started.
      // `cancelDropSession` is idempotent — a no-op when no session is
      // active (committed-path, instant-popout path, or short-circuit
      // before threshold cross). Catches the Escape-mid-gesture case
      // (controller cancels itself) where the gesture handler then
      // races to cleanup with the session already gone, and the
      // post-threshold short-circuit return paths (e.g. cardKey
      // null, anchorDom missing) that arrive before the session is
      // ever started.
      cancelDropSession();
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    document.documentElement.addEventListener("mouseleave", onDocLeave);
  }, [editorRef, cacheRef]);

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
      // the hover zone could include the gutter to the left of content.
      // Detach the global listener whenever the editor instance changes.
      document.removeEventListener("mousemove", onMouseMove);
    };

    /**
     * Resolve the array of refs the schedule should render handles for.
     * Order (first match wins, except for hover which returns multiple):
     *   1. Non-empty TextSelection → [SelectionRef]
     *   2. NodeSelection on TextObject → [TextObjectRef]
     *   3. Mouse hover over editor → [innermost..outermost TextObjectRefs]
     *   4. Nothing → []
     */
    const resolveActiveRefs = (
      editor: Editor,
    ): Array<TextObjectRef | SelectionRef> => {
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
            kind: "selection",
            from: sel.from,
            to: sel.to,
            paragraphId,
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
          return [{ kind: name as TextObjectKind, id: node.attrs.uuid as string }];
        }
      }
      // 3. Mouse hover — every containing TextObject level via Y-axis
      // containment scan over the editor's [data-uuid] decorations.
      const mouse = mousePosRef.current;
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
      const refs = resolveActiveRefs(editor);
      const next: Placement[] = [];
      for (const r of refs) {
        const p = computePlacement(editor, cacheRef.current, r);
        if (p) next.push(p);
      }
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

    const onSelectionUpdate = () => scheduleRaf();
    const onDocUpdate = ({
      transaction,
    }: {
      transaction: import("@tiptap/pm/state").Transaction;
    }) => {
      if (!transaction.docChanged) return;
      scheduleRaf();
    };

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
      // Hover zone now extends into the gutter to the left of the
      // editor content (so the user can travel from text to the
      // gutter-anchored handle without losing hover). The
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
    onFontReady(() => scheduleRaf());

    const onScroll = () => {
      // Scroll re-schedules placement (block rects change in clientY
      // space). The DOM-walk resolver re-runs from scratch each frame;
      // no separate cache to invalidate.
      scheduleRaf();
    };
    const onResize = () => {
      scheduleRaf();
    };
    const onMouseMove = (e: MouseEvent) => {
      // Always-on tracking: hover is the primary discovery mechanism, so
      // the position must update during text selection / node selection
      // too. (The resolver prioritizes selection/node refs above hover,
      // so the array won't surprise during an active gesture.)
      // Outside the row hover zone → clear immediately. With handles
      // rendered inside the scroll container, pointer continuity from
      // prose → gutter → handle is native; no grace timer needed.
      const cache = cacheRef.current;
      if (!cache.containsHoverZone(e.clientX, e.clientY)) {
        if (mousePosRef.current !== null) {
          mousePosRef.current = null;
          scheduleRaf();
        }
        return;
      }
      mousePosRef.current = { clientX: e.clientX, clientY: e.clientY };
      scheduleRaf();
    };
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
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = 0;
      }
      subscribedEditorRef.current = null;
      prevEditor = null;
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onResize);
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
  if (placements.length === 0 && !overlay) return null;
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
  return (
    <>
      {overlay && (
        <LiftedTextOverlay
          ref={overlay.ref}
          anchorDom={overlay.anchorDom}
          ghostContent={overlay.ghostContent}
          grabOffsetX={overlay.grabOffsetX}
          grabOffsetY={overlay.grabOffsetY}
          sourceWidth={overlay.sourceWidth}
          sourceHeight={overlay.sourceHeight}
          cursorX={overlay.cursorX}
          cursorY={overlay.cursorY}
          mode={overlay.mode}
          label={overlay.label}
          viewToggleCls={overlay.viewToggleCls}
        />
      )}
      {placements.length > 0 &&
        createPortal(
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
        )}
    </>
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
  return (
    <div
      ref={elRef}
      className="text-object-grab-handle"
      // `position: absolute` against the `[data-grab-handle-portal]`
      // wrapper (which is itself absolute inside the editor-pane-column
      // — escapes the pod's clipPath that clips lateral descendants of
      // the pod past ±20px). The wrapper has `pointer-events: none` to
      // let prose clicks pass through; each handle re-enables pointer
      // events on itself.
      style={{
        position: "absolute",
        left: placement.left,
        top: placement.top,
        pointerEvents: "auto",
      }}
      title="Drag to pop out, click for actions"
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
