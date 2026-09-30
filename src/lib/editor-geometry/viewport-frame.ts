/**
 * Editor viewport frame — the per-editor cached DOM measurements that are
 * stable across keystrokes: the editor's text edges, the pod rect, the
 * scroll container's viewport band, and the grab-handle portal context.
 *
 * **The frame refreshes on RESIZE, never on scroll** (the service's one RO,
 * window resize, gesture edges). So every field it caches must be
 * SCROLL-STABLE. Horizontal edges and the scroll container's own band are;
 * the VERTICAL edges of anything inside the scroll container are not — they
 * move with every scroll. Such an edge is therefore stored in SCROLL-CONTENT
 * space (viewport top + the scroller's `scrollTop` at measure time) and
 * converted back with the LIVE `scrollTop` at the moment it is asked (task
 * 858: the pod's top/bottom used to be cached as viewport values, so after
 * any scroll the lift gesture's ghost↔popout flip answered "is the cursor in
 * the pod?" against wherever the pod sat at the last resize). `toPortalCoords`
 * reads its column rect live for the same reason.
 *
 * This is `useEditorViewportCache`'s measurement, moved VERBATIM onto the
 * EditorGeometry service (perf Wave 2 C7). The hook was instantiated 4×
 * per pane (LiftHost, TextObjectGrabHandle, PendingChangePill,
 * SelectionActionsMenu), each instance carrying its OWN ResizeObserver on
 * the same two elements plus its own window-resize listener — 8 ROs per
 * pane re-measuring identical geometry. The service now owns ONE frame per
 * editor, refreshed by its single ResizeObserver (editor el + scroll el
 * ride the same observer as the near-zone blocks), its one window-resize
 * listener, and its layout-gesture park. Consumers read it through
 * `useViewportFrame` ([use-viewport-frame.ts](use-viewport-frame.ts)),
 * which preserves the hook's `{ ref, version }` contract.
 *
 * This module is the PURE half: the frame shape, the measurement, and the
 * equality bail. No observers, no state — the service owns the lifecycle.
 */

import { findEditorScrollFor } from "@/components/editor-layout/layout-scroll";
import { resolveMarginEm } from "@/text-objects/block-frame";
import { handleLaneFloor } from "@/text-objects/handle-layout";

export interface EditorViewportFrame {
  editorEl: HTMLElement | null;
  /** editorRect.left + paddingLeft — the editor's left text edge. */
  contentLeft: number;
  /** editorRect.right - paddingRight — the editor's right text edge. The
   *  name placement readers use (SelectionActionsMenu, Marginalia);
   *  `hoverZoneRight` is the same value under the hover zone's name. */
  editorRight: number;
  scrollParent: HTMLElement | null;
  scrollTop: number;
  scrollBottom: number;
  /** Pixels read from --margin-col-handle-inset on the editor element — the
   *  narrow-viewport FLOOR for handle placement (`editorColumnLeft −
   *  marginInset`), applied in src/text-objects/handle-layout.ts. (Handles
   *  otherwise hug each block's measured marker via block-frame.ts; this is
   *  just the off-screen-left clamp.) Read here so JS and CSS share one knob —
   *  and read through `resolveMarginEm`, the one `--margin-*` interpreter, so
   *  the knob's px / em / rem spelling is the stylesheet's business (task 661). */
  marginInset: number;
  /** `.ProseMirror`'s own rect.left — the editor COLUMN's outside-left edge
   *  (`contentLeft` minus the editor's padding-left). The reference the
   *  grab-handle lane's floor is measured from (`handle-layout.ts#handleLaneFloor`),
   *  published here so the handle placement and {@link hoverZoneLeft} read ONE
   *  measurement of it rather than each taking their own
   *  `getBoundingClientRect` — which also drops one forced-layout read per
   *  placed handle per hover frame. */
  editorColumnLeft: number;
  /** Left edge of the grab-handle hover zone — the horizontal stripe
   *  where hovering reveals a TextObject's grab handle. So the user can move
   *  the cursor from the prose into the margin toward the handle without the
   *  resolver dropping hover.
   *
   *  Task 526: this IS the handle lane's outboard bound
   *  (`handle-layout.ts#handleLaneFloor`), read from the same expression the
   *  placement floors on — the zone that REVEALS a handle is exactly the lane
   *  a handle may OCCUPY. It was a private `contentLeft − marginInset − 8`
   *  constant, and the two tables disagreed: `marginInset` is the
   *  narrow-viewport FLOOR inset, not the handle's resting reach, and the
   *  handle's reach is em-scaled per block plus a `1.8em` hit halo — so at the
   *  shipped defaults a `\section` heading's target already stuck ~7px out of
   *  the zone, and hovering there CLEARED the handle. */
  hoverZoneLeft: number;
  /** Right edge of the hover zone — equal to `editorRight`. Handle is
   *  on the left; no widening on the right. */
  hoverZoneRight: number;
  /** Left edge of `.editor-pane-pod` — the pod's OUTER rect, including
   *  the white padding around the text column. Used by the lifted-overlay
   *  predicate so "popout mode" activates at the white-pod → manila
   *  transition, not at the text → white-padding transition inside the
   *  pod. Falls back to `rect.left` if the pod walk fails (defensive). */
  podLeft: number;
  /** Right edge of `.editor-pane-pod`. See `podLeft`. */
  podRight: number;
  /** Top edge of `.editor-pane-pod` in SCROLL-CONTENT space (viewport top
   *  + the scroll container's `scrollTop` at measure time) — scroll-stable,
   *  so it may be cached (see the module header). Not a viewport Y:
   *  subtract the live `scrollParent.scrollTop` to get one. When the pod
   *  walk fails it falls back to the scroll band, which does not scroll, and
   *  is stored with a zero offset. */
  podTopInScroll: number;
  /** Bottom edge of `.editor-pane-pod`, same space as `podTopInScroll`. */
  podBottomInScroll: number;
  /** True iff `(x, y)` falls inside the editor POD's outer rect — i.e.
   *  the `.editor-pane-pod` wrapper around the text column, which
   *  includes the pod's white padding. Sibling of `containsHoverZone`.
   *  Used by the lifted-overlay gesture to decide ghost-mode vs
   *  popout-mode: cursor inside the pod (anywhere in the white area,
   *  including the padding around text) → ghost; cursor crossing the
   *  pod's outer edge into the manila column → popout. Matches the
   *  user's mental model of the boundary as the white-pod → manila
   *  transition, not the text → white-padding transition. Predicate
   *  name is retained for diff minimisation; semantics widened from
   *  text content rect → editor pod outer rect (L1.7).
   *
   *  The vertical test is answered against the pod's CURRENT position: the
   *  cached content-space edges are converted with the live
   *  `scrollParent.scrollTop` (one scalar read — no rect read per move). */
  containsContentZone(x: number, y: number): boolean;
  /** The `[data-editor-col="true"]` (editor-pane-column) element that
   *  serves as the grab-handle portal's positioning context. The portal
   *  div lives as a column-level sibling of the pod (NOT inside the
   *  pod) so it escapes the pod's `clipPath` that would otherwise clip
   *  handles in the margin. Handles render as absolute-positioned
   *  children of `[data-grab-handle-portal]` inside this column; the
   *  rect's top-left is the origin for converting viewport coords to
   *  portal-relative coords. Null when the column isn't mounted yet.
   *  (Name stays `paperEl` for diff minimization; semantically this is
   *  the column.) Its rect is NOT cached — the column scrolls, so
   *  `toPortalCoords` reads it live. */
  paperEl: HTMLElement | null;
  /** True iff `(x, y)` falls inside the hover-active rectangle for this
   *  editor. Y is bounded by the scroll parent's visible region. */
  containsHoverZone(x: number, y: number): boolean;
  /** Convert viewport coords to portal-relative coords (inside the
   *  `editor-pane-column` containing block — the portal lives at column
   *  level, not inside paper-render). Returns the input unchanged if
   *  the column isn't mounted yet — handles render in viewport coords
   *  as a fallback until paperEl resolves. */
  toPortalCoords(viewportX: number, viewportY: number): { x: number; y: number };
}

const DEFAULT_MARGIN_INSET = 22;
/** Em base used only if the editor's own `font-size` is unreadable (SSR / a
 *  stub declaration). The shipped token is a px literal, so this rung is
 *  forward-compat: it is what makes the token's SPELLING a free variable. */
const DEFAULT_MARGIN_INSET_EM_BASE_PX = 16;

export const EMPTY_VIEWPORT_FRAME: EditorViewportFrame = {
  editorEl: null,
  contentLeft: 0,
  editorRight: 0,
  scrollParent: null,
  scrollTop: 0,
  scrollBottom: 0,
  marginInset: DEFAULT_MARGIN_INSET,
  editorColumnLeft: 0,
  hoverZoneLeft: 0,
  hoverZoneRight: 0,
  podLeft: 0,
  podRight: 0,
  podTopInScroll: 0,
  podBottomInScroll: 0,
  containsContentZone: () => false,
  paperEl: null,
  containsHoverZone: () => false,
  toPortalCoords: (x, y) => ({ x, y }),
};

/**
 * Measure the frame for `editorEl`. Pure read pass — one `getComputedStyle`
 * + 3 `getBoundingClientRect` + one `scrollTop` + two `closest()` walks. Returns `null` when
 * the editor is hidden (keep-alive `display:none` → `offsetHeight === 0`)
 * or detached — the caller keeps its previous frame, which is the correct
 * stale-geometry defense (the hook's highest-leverage guard, retained):
 * a hidden editor's rects all collapse to 0×0 and committing them would
 * cascade garbage into the margin-bolt / grab-handle / in-text followers.
 *
 * The scroll container resolves via `findEditorScrollFor` — the app's
 * canonical "which scroll owns this view" SSOT (row scroll for the main
 * pane, the mirror's own scroll for a split pane) — replacing the hook's
 * private `findScrollParent` walk. Semantic delta, deliberate: a doc
 * shorter than its viewport used to resolve NO scroll parent and fall back
 * to the window band {0, innerHeight}; it now resolves the row scroll and
 * uses its rect, which bounds the hover/cull band to the editor row —
 * strictly tighter and correct (the old window band admitted Y values over
 * the app chrome).
 */
export function computeViewportFrame(
  editorEl: HTMLElement,
): EditorViewportFrame | null {
  if (!editorEl.isConnected || editorEl.offsetHeight === 0) return null;
  const cs = window.getComputedStyle(editorEl);
  const rect = editorEl.getBoundingClientRect();
  const padLeft = parseFloat(cs.paddingLeft) || 0;
  const padRight = parseFloat(cs.paddingRight) || 0;
  const scrollParent = findEditorScrollFor(editorEl);
  const scrollRect = scrollParent
    ? scrollParent.getBoundingClientRect()
    : { top: 0, bottom: window.innerHeight };
  const contentLeft = rect.left + padLeft;
  const editorRight = rect.right - padRight;
  const scrollTop = scrollRect.top;
  const scrollBottom = scrollRect.bottom;
  // Through the ONE `--margin-*` interpreter (task 661), not a hand `parseFloat`:
  // a custom property's `em` is NOT resolved by `getComputedStyle` (it returns
  // the literal "1.375em"), and `parseFloat` answers `1.375` — a finite,
  // positive number that passes a naive guard and silently collapses this
  // distance to nothing. It is the grab-handle placement FLOOR *and* the left
  // edge of the hover zone that reveals the handle (task 526, `handleLaneFloor`),
  // so the collapse would clamp handles onto the prose and make the strip that
  // keeps them alive vanish as the user reached for one. The em base is the
  // editor's own font — the same `cs` this frame already holds, so no extra read.
  const marginInset = resolveMarginEm(
    cs,
    parseFloat(cs.fontSize) || DEFAULT_MARGIN_INSET_EM_BASE_PX,
    "--margin-col-handle-inset",
    DEFAULT_MARGIN_INSET,
  );
  // Task 526 — ONE expression, read by the placement floor and by the zone.
  // See `handleLaneFloor`'s docstring for the two-table bug this retires.
  const editorColumnLeft = rect.left;
  const hoverZoneLeft = handleLaneFloor(editorColumnLeft, marginInset);
  const hoverZoneRight = editorRight;
  // `.editor-pane-pod` is the outer pod wrapper around the text
  // column (white surface + chrome). The lifted-overlay gesture's
  // mode-flip predicate (containsContentZone) reads THIS rect, not
  // the ProseMirror text content rect, so popout mode engages at
  // the white-pod → manila transition rather than at the inner
  // text → white-padding edge inside the pod. Defensive fallback
  // to the editor's own rect if the pod walk fails (early mount,
  // unexpected DOM, etc.).
  const podEl =
    (editorEl.closest(".editor-pane-pod") as HTMLElement | null) ?? null;
  const podRect = podEl?.getBoundingClientRect();
  const podLeft = podRect?.left ?? rect.left;
  const podRight = podRect?.right ?? rect.right;
  // Vertical pod edges → scroll-content space (task 858). Only a pod that
  // lives inside a resolved scroller moves with it; the band fallback does
  // not scroll, so it carries no offset.
  const podScrolls = podRect != null && scrollParent != null;
  const scrollOffsetAt = (): number =>
    podScrolls ? scrollParent!.scrollTop : 0;
  const measuredOffset = scrollOffsetAt();
  const podTopInScroll = (podRect?.top ?? scrollTop) + measuredOffset;
  const podBottomInScroll = (podRect?.bottom ?? scrollBottom) + measuredOffset;
  // `editor-pane-column` is the positioning context for the grab-
  // handle portal. The portal lives at column level (sibling of the
  // pod) so it escapes the pod's `clipPath` that clips lateral
  // descendants beyond ±20px (the handle sits ~22px left of the
  // pod's content edge, in the margin). Walk from the editorEl up
  // — same direction as the scroll resolve — to find it.
  const paperEl =
    (editorEl.closest('[data-editor-col="true"]') as HTMLElement | null) ??
    null;

  // Capture the values in helper closures so callers always see the frame
  // they were handed — the object identity changes per committed refresh,
  // and the closures are regenerated alongside the data fields.
  const containsHoverZone = (x: number, y: number): boolean =>
    x >= hoverZoneLeft &&
    x <= hoverZoneRight &&
    y >= scrollTop &&
    y <= scrollBottom;
  const containsContentZone = (x: number, y: number): boolean => {
    if (x < podLeft || x > podRight) return false;
    const yInScroll = y + scrollOffsetAt();
    return yInScroll >= podTopInScroll && yInScroll <= podBottomInScroll;
  };
  // Read the column rect fresh per call: it changes on scroll
  // (the column moves inside the row scroll container), and the
  // frame only refreshes on resize. Cheap — one
  // getBoundingClientRect per RAF (called from computePlacement,
  // not from mousemove).
  const toPortalCoords = (viewportX: number, viewportY: number) => {
    if (!paperEl) return { x: viewportX, y: viewportY };
    const live = paperEl.getBoundingClientRect();
    return { x: viewportX - live.left, y: viewportY - live.top };
  };

  return {
    editorEl,
    contentLeft,
    editorRight,
    scrollParent,
    scrollTop,
    scrollBottom,
    marginInset,
    editorColumnLeft,
    hoverZoneLeft,
    hoverZoneRight,
    podLeft,
    podRight,
    podTopInScroll,
    podBottomInScroll,
    containsContentZone,
    paperEl,
    containsHoverZone,
    toPortalCoords,
  };
}

/** The refresh equality bail — true when every measured field matches, so
 *  the service skips the commit (no version bump, no notify) and consumer
 *  effects don't re-run on a no-op refresh. Field-for-field the hook's
 *  own bail. */
export function viewportFramesEqual(
  a: EditorViewportFrame,
  b: EditorViewportFrame,
): boolean {
  return (
    a.editorEl === b.editorEl &&
    a.contentLeft === b.contentLeft &&
    a.editorRight === b.editorRight &&
    a.scrollParent === b.scrollParent &&
    a.scrollTop === b.scrollTop &&
    a.scrollBottom === b.scrollBottom &&
    a.marginInset === b.marginInset &&
    a.editorColumnLeft === b.editorColumnLeft &&
    a.podLeft === b.podLeft &&
    a.podRight === b.podRight &&
    a.podTopInScroll === b.podTopInScroll &&
    a.podBottomInScroll === b.podBottomInScroll &&
    a.paperEl === b.paperEl
  );
}
