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
 * Both the fill and stroke groups are shifted by `(STROKE_INSET, STROKE_INSET)`
 * (a half-pixel) so the 1px stroke, which SVG centres on its path coordinate,
 * lands its OUTER edge on an integer device-boundary instead of bleeding a
 * half-pixel out of the viewport.
 *
 * Because the path is shifted right+down by that half-pixel, the viewport must
 * be 1 CSS px taller AND 1 CSS px wider than the raw path extent, or the right
 * swoop foot (at x = 2*S + tabW → x + 0.5 after the shift) and the bottom
 * stroke (at y = tabH → y + 0.5) would clip against `overflow: hidden`.
 *
 *   svgH = tabH + 1   (the pre-existing vertical gutter — F#8 mirrors it)
 *   svgW = 2*S + tabW + 1   (the new horizontal gutter — F#8)
 *
 * The +1 is a full CSS pixel (2 device px @2×DPR), so it never half-clips at
 * any DPR; only the 0.5 shift is DPR-sensitive, and it is the same technique
 * already proven on the vertical axis.
 */
export const STROKE_INSET = 0.5;

/**
 * F#15 floor — the active tab's body never compresses below this width. Lives
 * here (the pure geometry module) so both the component and the geometry tests
 * share one SSOT and the value can't drift. Re-exported from PanelFolderTab for
 * the strip's reserved-min-width math.
 */
export const ACTIVE_MIN_CONTENT = 116;

export type TabSvgGeometry = {
  /** Viewport / element width including the 1px horizontal stroke gutter. */
  svgW: number;
  /** Viewport / element height including the 1px vertical stroke gutter. */
  svgH: number;
  /** The shared (x, y) translate applied to both fill and stroke groups. */
  inset: number;
};

export function tabSvgGeometry(args: {
  tabW: number;
  tabH: number;
  S?: number;
}): TabSvgGeometry {
  const S = args.S ?? 12;
  return {
    svgW: 2 * S + args.tabW + 1,
    svgH: args.tabH + 1,
    inset: STROKE_INSET,
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
 * Closed path describing the entire tab silhouette. Use for fill, and as
 * stroke for inactive tabs.
 */
export function buildTabFillPath(args: TabPathArgs): string {
  const { tabW, tabH } = args;
  const R = args.R ?? 10;
  const S = args.S ?? 12;
  const tabLeft = S;
  const tabRight = S + tabW;
  return [
    `M ${tabLeft + R} 0`,
    `H ${tabRight - R}`,
    `A ${R} ${R} 0 0 1 ${tabRight} ${R}`,
    `V ${tabH - S}`,
    `A ${S} ${S} 0 0 0 ${tabRight + S} ${tabH}`,
    `H 0`,
    `A ${S} ${S} 0 0 0 ${tabLeft} ${tabH - S}`,
    `V ${R}`,
    `A ${R} ${R} 0 0 1 ${tabLeft + R} 0`,
    `Z`,
  ].join(" ");
}

/**
 * Open path tracing only the visible outline of an active tab — top
 * corners, sides, and swoops — but omitting the bottom edge between the
 * swoop feet. Use as stroke for active tabs so the bottom merges into the
 * canvas's top border without a redundant closing line.
 */
export function buildActiveTabStrokePath(args: TabPathArgs): string {
  const { tabW, tabH } = args;
  const R = args.R ?? 10;
  const S = args.S ?? 12;
  const tabLeft = S;
  const tabRight = S + tabW;
  return [
    `M ${tabRight + S} ${tabH}`,
    `A ${S} ${S} 0 0 1 ${tabRight} ${tabH - S}`,
    `V ${R}`,
    `A ${R} ${R} 0 0 0 ${tabRight - R} 0`,
    `H ${tabLeft + R}`,
    `A ${R} ${R} 0 0 0 ${tabLeft} ${R}`,
    `V ${tabH - S}`,
    `A ${S} ${S} 0 0 1 0 ${tabH}`,
  ].join(" ");
}
