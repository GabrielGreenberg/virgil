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
