/**
 * Editor viewport frame — the per-editor cached DOM measurements that are
 * stable across keystrokes: the editor's text edges, the pod rect, the
 * scroll container's viewport band, and the grab-handle portal context.
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

export interface EditorViewportFrame {
  editorEl: HTMLElement | null;
  /** editorRect.left + paddingLeft — the editor's left text edge. */
  contentLeft: number;
  /** editorRect.right - paddingRight — the editor's right text edge.
   *  Aliased as `hoverZoneRight`; kept separate for callers that already
   *  read this name. */
  editorRight: number;
  scrollParent: HTMLElement | null;
  scrollTop: number;
  scrollBottom: number;
  /** Pixels read from --margin-col-handle-inset on the editor element — the
   *  narrow-viewport FLOOR for handle placement (`editorColumnLeft −
   *  marginInset`), applied in src/text-objects/handle-layout.ts. (Handles
   *  otherwise hug each block's measured marker via block-frame.ts; this is
   *  just the off-screen-left clamp.) Read here so JS and CSS share one knob. */
  marginInset: number;
  /** Left edge of the grab-handle hover zone — the horizontal stripe
   *  where hovering reveals a TextObject's grab handle. Extends leftward
   *  from `contentLeft` by `marginInset` (where the handle lives) plus a
   *  small cushion. So the user can move the cursor from the prose into
   *  the margin toward the handle without the resolver dropping hover. */
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
  /** Top edge of `.editor-pane-pod`. See `podLeft`. */
  podTop: number;
  /** Bottom edge of `.editor-pane-pod`. See `podLeft`. */
  podBottom: number;
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
   *  text content rect → editor pod outer rect (L1.7). */
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
   *  the column.) */
  paperEl: HTMLElement | null;
  /** Top/left of `paperEl` in viewport coords; used by
   *  `toPortalCoords` so callers don't re-read getBoundingClientRect
   *  per RAF. Updated on the same refresh path as the other rects. */
  paperRect: { top: number; left: number };
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
/** Cushion added to the hover zone's leftward extent so the handle
 *  (~10px wide) sits comfortably inside. */
const HOVER_MARGIN_PAD = 8;

export const EMPTY_VIEWPORT_FRAME: EditorViewportFrame = {
  editorEl: null,
  contentLeft: 0,
  editorRight: 0,
  scrollParent: null,
  scrollTop: 0,
  scrollBottom: 0,
  marginInset: DEFAULT_MARGIN_INSET,
  hoverZoneLeft: 0,
  hoverZoneRight: 0,
  podLeft: 0,
  podRight: 0,
  podTop: 0,
  podBottom: 0,
  containsContentZone: () => false,
  paperEl: null,
  paperRect: { top: 0, left: 0 },
  containsHoverZone: () => false,
  toPortalCoords: (x, y) => ({ x, y }),
};

/**
 * Measure the frame for `editorEl`. Pure read pass — one `getComputedStyle`
 * + 4 `getBoundingClientRect` + two `closest()` walks. Returns `null` when
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
  const insetRaw = cs.getPropertyValue("--margin-col-handle-inset").trim();
  const parsedInset = parseFloat(insetRaw);
  const marginInset =
    Number.isFinite(parsedInset) && parsedInset > 0
      ? parsedInset
      : DEFAULT_MARGIN_INSET;
  const hoverZoneLeft = contentLeft - marginInset - HOVER_MARGIN_PAD;
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
  const podTop = podRect?.top ?? scrollTop;
  const podBottom = podRect?.bottom ?? scrollBottom;
  // `editor-pane-column` is the positioning context for the grab-
  // handle portal. The portal lives at column level (sibling of the
  // pod) so it escapes the pod's `clipPath` that clips lateral
  // descendants beyond ±20px (the handle sits ~22px left of the
  // pod's content edge, in the margin). Walk from the editorEl up
  // — same direction as the scroll resolve — to find it.
  const paperEl =
    (editorEl.closest('[data-editor-col="true"]') as HTMLElement | null) ??
    null;
  const paperBound = paperEl?.getBoundingClientRect();
  const paperTop = paperBound?.top ?? 0;
  const paperLeft = paperBound?.left ?? 0;

  // Capture the values in helper closures so callers always see the frame
  // they were handed — the object identity changes per committed refresh,
  // and the closures are regenerated alongside the data fields.
  const containsHoverZone = (x: number, y: number): boolean =>
    x >= hoverZoneLeft &&
    x <= hoverZoneRight &&
    y >= scrollTop &&
    y <= scrollBottom;
  const containsContentZone = (x: number, y: number): boolean =>
    x >= podLeft && x <= podRight && y >= podTop && y <= podBottom;
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
    hoverZoneLeft,
    hoverZoneRight,
    podLeft,
    podRight,
    podTop,
    podBottom,
    containsContentZone,
    paperEl,
    paperRect: { top: paperTop, left: paperLeft },
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
    a.podLeft === b.podLeft &&
    a.podRight === b.podRight &&
    a.podTop === b.podTop &&
    a.podBottom === b.podBottom &&
    a.paperEl === b.paperEl &&
    a.paperRect.top === b.paperRect.top &&
    a.paperRect.left === b.paperRect.left
  );
}
