/**
 * SVG path builder for the manila-folder tab shape.
 *
 * Each tab is rendered as one self-contained SVG shape with a continuous
 * border around its full outline (rounded top corners, vertical sides, and
 * convex swoop hooks at the bottom corners flaring outward to a flat base).
 * Active and inactive tabs share the same path geometry; the active variant
 * omits the bottom edge from the stroke so the canvas's top border draws
 * the seam between tab and body.
 *
 * SVG box dimensions are `width = 2*S + tabW`, `height = tabH`. The tab body
 * occupies `x ∈ [S, S + tabW]`; the swoop flare extends from x=0 to x=S on
 * the left and x=S+tabW to x=2*S+tabW on the right, all within the same
 * height.
 */

export type TabPathArgs = {
  /** Tab body width (the narrow part poking up). */
  tabW: number;
  /** Tab body height (top of tab to flat bottom edge between flares). */
  tabH: number;
  /** Top corner radius. */
  R?: number;
  /** Swoop hook size — how far each side flares outward at the base. */
  S?: number;
};

/**
 * SVG canvas geometry for a folder tab (shared by F#8 + F#15).
 *
 * The path's outermost ink lives at x ∈ [0, 2*S + tabW] and y ∈ [0, tabH].
 * The fill and stroke groups are shifted by `(STROKE_INSET, STROKE_INSET +
 * TAB_TOP_GUTTER)` so the 1px stroke, which SVG centres on its path coordinate,
 * lands its OUTER edge on an integer device-boundary instead of bleeding a
 * half-pixel out of the viewport — and, on the y axis, a full pixel BELOW the
 * viewport's top edge (see the top gutter below).
 *
 * Because the path is shifted right+down, the viewport must be taller AND wider
 * than the raw path extent, or the right swoop foot (at x = 2*S + tabW → x + 0.5
 * after the shift) and the bottom stroke (at y = tabH → y + insetY) would clip
 * against `overflow: hidden`:
 *
 *   svgW = 2*S + tabW + 1        (horizontal stroke gutter — F#8)
 *   svgH = tabH + 1 + TAB_TOP_GUTTER   (bottom gutter + symmetric top gutter)
 *
 * The bottom gutter is the pre-existing +1 (the 0.5 shift + the stroke's lower
 * half-pixel). The TOP gutter (task 087) reserves an ADDITIONAL full pixel ABOVE
 * the top stroke so it is never flush at the SVG's — nor the strip's — top clip
 * boundary. The strip bottom-aligns the tabs under `overflowY:hidden` with
 * asymmetric `padding: 0 … 1px` (top 0), so a top stroke flush at y≈0 was being
 * clipped by the strip (worse at DPR 2, which ate the top device row). Reserving
 * the gutter in the geometry SSOT makes the tab self-protecting regardless of
 * the strip's clip — the top edge now gets the same 1px cushion the bottom
 * always had, unifying "both strokes get a gutter" in this one module.
 *
 * Every +1 is a full CSS pixel (2 device px @2×DPR), so it never half-clips at
 * any DPR; only the 0.5 shift is DPR-sensitive, the same technique proven on the
 * horizontal axis.
 */
export const STROKE_INSET = 0.5;

/**
 * Top stroke gutter (px) — the symmetric twin of the tab SVG's pre-existing
 * BOTTOM gutter (the `+1` baked into `svgH`). Reserving a full CSS pixel above
 * the top stroke keeps the active tab's top-edge outline off the strip's flush
 * top clip boundary (`padding-top:0` + `overflowY:hidden`), which was eating it
 * — worst at DPR 2. Lives here in the geometry SSOT so the path shift, the SVG
 * height, the component's fill-bridge / content-overlay offsets, and the tests
 * all read ONE number and can't drift. (Task 2026-07-07-087.)
 */
export const TAB_TOP_GUTTER = 1;

/**
 * Manila-folder top-corner radius (px) — the SSOT for the tab silhouette's
 * rounded top corners. Lives here (the pure geometry module) alongside
 * {@link ACTIVE_MIN_CONTENT}/{@link STROKE_INSET} so the path builders, the
 * component, and the geometry tests all read ONE number and it can't drift.
 *
 * This is the numeric twin of the CSS token `--library-manila-radius` in
 * `src/app/globals.css` (task 2026-07-03-013's radius scale), which the
 * panel-body frame (`TabbedLibraryPanel`), `NavPod`, and the list/project
 * headers consume for their `border-radius`. The tab OUTLINE (this SVG path)
 * and the panel FRAME (CSS rounded-rects) are two independent corner
 * geometries that must tangent at the join; sourcing both from the same value
 * is what stops them drifting apart and leaving a hairline overshoot at the
 * corner. The drift between the two representations is locked by
 * `folder-path.test.ts` (asserts `${MANILA_RADIUS}px` === the CSS token).
 *
 * Deliberately rounder than the global `--pod-radius` (8): the Library tab
 * strip keeps its own slightly-rounder manila aesthetic on purpose. Do NOT
 * collapse it to 8 to "unify" — the SSOT is this token, not the pod radius.
 */
export const MANILA_RADIUS = 10;

/**
 * F#15 floor — the active tab's body never compresses below this width. Lives
 * here (the pure geometry module) so both the component and the geometry tests
 * share one SSOT and the value can't drift. Re-exported from PanelFolderTab for
 * the strip's reserved-min-width math.
 */
export const ACTIVE_MIN_CONTENT = 116;

/**
 * The tab strip's horizontal padding (px), on BOTH sides — the SSOT for how far
 * the tabs are inset from the panel's edge. Lives here (the pure geometry
 * module) so the strip AND the body-frame drawer read ONE number and can't
 * drift. Consumed by {@link PanelTabStrip} (its `padding`) and by the body
 * frame's horizontal inset in {@link TabbedLibraryPanel}.
 *
 * This inset is the whole reason the body-frame's rounded top corners used to
 * grow "wings": the body ran full-width (corner at panel-x 0) while the tabs
 * were inset by this pad, so a rounded top-left corner arced out in the bare
 * gutter LEFT of the first tab (task e63ee738 squared the corners to hide it).
 * Task 047 instead insets the body frame by exactly this pad, so the corner arc
 * BEGINS under the first tab's swoop foot — {@link frameTopCornerStartX} ===
 * {@link firstTabSwoopFootX} — and there is no gutter to wing into.
 */
export const STRIP_SIDE_PAD = 4;

/**
 * Panel-x of the FIRST tab's LEFT swoop foot (its outermost fill ink). The tab
 * wrapper sits flush against the strip's left padding ({@link STRIP_SIDE_PAD}),
 * and the fill path's left swoop foot is at local x=0 shifted right by the
 * half-pixel {@link STROKE_INSET}. This is the x the body-frame's top-left
 * corner must tuck under so it never wings into the gutter.
 */
export function firstTabSwoopFootX(pad: number = STRIP_SIDE_PAD): number {
  return pad + STROKE_INSET;
}

/**
 * Panel-x where the body-frame's rounded top corner begins (its leftmost ink).
 * The body is inset horizontally by {@link STRIP_SIDE_PAD} and its frame path is
 * stroked with the same {@link STROKE_INSET} half-pixel, so this MUST equal
 * {@link firstTabSwoopFootX} — the unit-tested "no-wing" invariant (task 047):
 * the corner lives UNDER the first tab's swoop, never in the 4px gutter.
 */
export function frameTopCornerStartX(pad: number = STRIP_SIDE_PAD): number {
  return pad + STROKE_INSET;
}

/**
 * Closed path for the tabbed panel BODY frame — a rounded rectangle whose four
 * corners share {@link MANILA_RADIUS} with the tab silhouette (so tab arc and
 * frame arc are tangent at the join by construction, never a hairline overshoot
 * from two slightly-different radii). Task 047 promotes the body's outline from
 * a CSS `border` into this single SVG-stroke owner.
 *
 * `w`/`h` are the body's measured CSS box. The path is drawn inset by
 * {@link STROKE_INSET} on all sides — (i,i) → (w−i, h−i) — so the 1px stroke,
 * which SVG centres on its coordinate, lands its OUTER edge on the box edge
 * (the same half-pixel crispness technique the tab paths use). The frame's
 * horizontal tuck under the tab swoop feet (the "no-wing" property) comes from
 * the body being laid out inset by {@link STRIP_SIDE_PAD}; this builder just
 * draws the rounded rect that fills that already-inset box.
 */
export function buildFramePath(args: {
  w: number;
  h: number;
  r?: number;
  strokeInset?: number;
}): string {
  const r = args.r ?? MANILA_RADIUS;
  const i = args.strokeInset ?? STROKE_INSET;
  const x0 = i;
  const y0 = i;
  const x1 = args.w - i;
  const y1 = args.h - i;
  // Clamp the radius so a very short/narrow body can't produce a self-crossing
  // path (arcs would overlap if 2*r exceeded the box). Manila bodies are always
  // far larger than 2*MANILA_RADIUS, but the guard keeps the path valid at any
  // transient measured size (e.g. a 0-height first paint).
  const rr = Math.max(0, Math.min(r, (x1 - x0) / 2, (y1 - y0) / 2));
  return [
    `M ${x0 + rr} ${y0}`,
    `H ${x1 - rr}`,
    `A ${rr} ${rr} 0 0 1 ${x1} ${y0 + rr}`,
    `V ${y1 - rr}`,
    `A ${rr} ${rr} 0 0 1 ${x1 - rr} ${y1}`,
    `H ${x0 + rr}`,
    `A ${rr} ${rr} 0 0 1 ${x0} ${y1 - rr}`,
    `V ${y0 + rr}`,
    `A ${rr} ${rr} 0 0 1 ${x0 + rr} ${y0}`,
    `Z`,
  ].join(" ");
}

export type TabSvgGeometry = {
  /** Viewport / element width including the 1px horizontal stroke gutter. */
  svgW: number;
  /**
   * Viewport / element height including BOTH vertical stroke gutters — the
   * pre-existing +1 bottom gutter and the {@link TAB_TOP_GUTTER} top gutter.
   */
  svgH: number;
  /** The X translate applied to both fill and stroke groups (half-pixel crispness). */
  inset: number;
  /**
   * The Y translate applied to both fill and stroke groups: {@link STROKE_INSET}
   * PLUS {@link TAB_TOP_GUTTER}, so the top stroke sits a full pixel below the
   * viewport's top edge (never flush at the strip's top clip boundary).
   */
  insetY: number;
};

export function tabSvgGeometry(args: {
  tabW: number;
  tabH: number;
  S?: number;
}): TabSvgGeometry {
  const S = args.S ?? 12;
  return {
    svgW: 2 * S + args.tabW + 1,
    svgH: args.tabH + 1 + TAB_TOP_GUTTER,
    inset: STROKE_INSET,
    insetY: STROKE_INSET + TAB_TOP_GUTTER,
  };
}

/**
 * Flex-driven width inversion (F#15). Given the width the flex layout actually
 * assigned to the tab wrapper, derive the inner tab-body width `tabW` to feed
 * the path builders. `tabW = clamp(min, laidOut − 2*S − gutter)`.
 *
 * The `+1` gutter that {@link tabSvgGeometry} adds to `svgW` is subtracted back
 * out here so the drawn shape COVERS the wrapper the flex engine sized. We
 * `Math.ceil` the measured wrapper width before inverting (`tabW = ceil(laidOut)
 * − 2*S − 1`), so for an integer `laidOut` the fixpoint still holds exactly
 * (`svgW(tabW) === laidOut`), and for a FRACTIONAL `laidOut` it rounds UP so
 * `svgW(tabW) >= laidOut` — the canvas slightly overshoots the box and the
 * strip's `overflow: hidden` clips the harmless <1px overshoot. (The earlier
 * `Math.floor` of the fractional remainder UNDER-filled the box, leaving a thin
 * transparent strip on the active tab's right edge where the strip background
 * showed through.) Below the floor the tab pins at `minTabW` and the strip
 * scrolls (never ellipsizes the active tab — that's the F#15 attach guarantee).
 *
 * Pure + side-effect-free: never write the result back to the wrapper width
 * (flex owns it) — that's the ResizeObserver feedback-loop trap.
 */
export function deriveTabWidthFromWrapper(args: {
  laidOutWidth: number;
  minTabW: number;
  S?: number;
}): number {
  const S = args.S ?? 12;
  // svgW = 2*S + tabW + 1  ⇒  tabW = ceil(laidOut) − 2*S − 1.
  // Ceil the (possibly fractional, flex-assigned) wrapper width before
  // inverting, keeping tabW an integer (DPR crispness) while guaranteeing
  // svgW(tabW) >= laidOut — the canvas always COVERS the box (overshoot
  // clipped by overflow:hidden), never under-fills it. For integer laidOut
  // this is identical to the old floor, preserving the fixpoint.
  const fromWrapper = Math.ceil(args.laidOutWidth) - 2 * S - 1;
  return Math.max(args.minTabW, fromWrapper);
}

/**
 * Recover the active tab's INTRINSIC (uncompressed) content width from a
 * width-clamped overlay measurement (F#15 / task 088).
 *
 * The active tab's content overlay is pinned to the assigned body width
 * (`svgW − 2*S − 1` === the current `tabW`) with `overflow:hidden`, and its
 * ONE flexible child — the title span — shrinks (with a text-overflow ellipsis)
 * to fit. So the overlay's OWN `scrollWidth` latches at ≈ the clamped width and
 * cannot report the tab's *natural* width; feeding it back as the flex
 * preferred size pins `naturalTabW ≈ tabW`, so the active tab can never grow
 * past its `ACTIVE_MIN_CONTENT` floor — the reported "C…" bug.
 *
 * The fix reads the intrinsic width off the title span instead: its
 * `scrollWidth` is the un-clipped text width even while it renders ellipsized.
 * The natural content width is then the overlay minus the title's SHRUNK box
 * plus the title's FULL box:
 *
 *   natural = overlayClientWidth − titleClientWidth + titleScrollWidth
 *
 * This is INDEPENDENT of how compressed the tab currently is (the clamp
 * cancels): `overlayClientWidth − titleClientWidth` is the fixed chrome +
 * padding (a constant), and `titleScrollWidth` is the constant intrinsic text
 * width — so the same true natural width is recovered at any compression level,
 * giving the ResizeObserver a stable fixpoint instead of the self-referential
 * latch. Pure so both the component and the geometry tests share one SSOT.
 */
export function recoverNaturalContentWidth(args: {
  overlayClientWidth: number;
  titleClientWidth: number;
  titleScrollWidth: number;
}): number {
  return (
    args.overlayClientWidth - args.titleClientWidth + args.titleScrollWidth
  );
}

/**
 * Foot-tuck geometry (task 053). An OUTER swoop foot that lands on the body's
 * rounded top corner (the first tab's LEFT foot, or a flush-right last tab's
 * RIGHT foot) pokes past the corner and opens the reported notch: the body's
 * top corner recedes inward by {@link MANILA_RADIUS}, while the foot flares all
 * the way to the tab-box edge and meets the base with a HORIZONTAL tangent
 * against the body's VERTICAL edge below — a 90° mismatch.
 *
 * The tuck slides that whole side of the tab INWARD by exactly `R` — the top
 * corner, the vertical side, AND the swoop foot all shift, so the foot lands on
 * the body corner's TOP (both horizontal-tangent there) and the swoop flows
 * into the corner arc. Crucially the swoop keeps its FULL radius `S`, so the
 * tucked foot is the SAME shape as an untucked/interior foot — just repositioned
 * — not a shrunken hook. Interior feet (between tabs) are NEVER tucked; they
 * interlock with the neighbouring tab's foot, not a body corner.
 */
type FootTuck = {
  /** Tuck the LEFT side onto the body's top-left corner. */
  tuckLeft?: boolean;
  /** Tuck the RIGHT side onto the body's top-right corner. */
  tuckRight?: boolean;
};

/**
 * Closed path describing the entire tab silhouette. Use for fill, and as
 * stroke for inactive tabs.
 */
export function buildTabFillPath(args: TabPathArgs & FootTuck): string {
  const { tabW, tabH } = args;
  const R = args.R ?? MANILA_RADIUS;
  const S = args.S ?? 12;
  const tabLeft = S;
  const tabRight = S + tabW;
  // Slide the tucked side inward by R (full swoop radius preserved).
  const lShift = args.tuckLeft ? R : 0;
  const rShift = args.tuckRight ? R : 0;
  const lFootX = lShift; //           left foot
  const lEdgeX = tabLeft + lShift; //  left vertical side
  const lCornerX = tabLeft + R + lShift; // top edge's left end (after TL corner)
  const rFootX = tabRight + S - rShift; //  right foot
  const rEdgeX = tabRight - rShift; //      right vertical side
  const rCornerX = tabRight - R - rShift; // top edge's right end (before TR corner)
  return [
    `M ${lCornerX} 0`,
    `H ${rCornerX}`,
    `A ${R} ${R} 0 0 1 ${rEdgeX} ${R}`,
    `V ${tabH - S}`,
    `A ${S} ${S} 0 0 0 ${rFootX} ${tabH}`,
    `H ${lFootX}`,
    `A ${S} ${S} 0 0 0 ${lEdgeX} ${tabH - S}`,
    `V ${R}`,
    `A ${R} ${R} 0 0 1 ${lCornerX} 0`,
    `Z`,
  ].join(" ");
}

/**
 * Open path tracing only the visible outline of an active tab — top
 * corners, sides, and swoops — but omitting the bottom edge between the
 * swoop feet. Use as stroke for active tabs so the bottom merges into the
 * canvas's top border without a redundant closing line.
 */
export function buildActiveTabStrokePath(args: TabPathArgs & FootTuck): string {
  const { tabW, tabH } = args;
  const R = args.R ?? MANILA_RADIUS;
  const S = args.S ?? 12;
  const tabLeft = S;
  const tabRight = S + tabW;
  const lShift = args.tuckLeft ? R : 0;
  const rShift = args.tuckRight ? R : 0;
  const lFootX = lShift;
  const lEdgeX = tabLeft + lShift;
  const lCornerX = tabLeft + R + lShift;
  const rFootX = tabRight + S - rShift;
  const rEdgeX = tabRight - rShift;
  const rCornerX = tabRight - R - rShift;
  return [
    `M ${rFootX} ${tabH}`,
    `A ${S} ${S} 0 0 1 ${rEdgeX} ${tabH - S}`,
    `V ${R}`,
    `A ${R} ${R} 0 0 0 ${rCornerX} 0`,
    `H ${lCornerX}`,
    `A ${R} ${R} 0 0 0 ${lEdgeX} ${R}`,
    `V ${tabH - S}`,
    `A ${S} ${S} 0 0 1 ${lFootX} ${tabH}`,
  ].join(" ");
}
