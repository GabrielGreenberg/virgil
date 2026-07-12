/**
 * Folder-tab chrome geometry — the ONE SSOT for the manila folder-tab
 * silhouette shared by BOTH tab strips:
 *
 *   - the OUTER Virgil-bar document/paper/library tabs
 *     (src/components/editor-layout/DocumentFolderTab.tsx), and
 *   - the INNER Library panel tabs
 *     (library/components/panel-tabs/PanelFolderTab.tsx).
 *
 * This module replaces the two forked measured-SVG path builders
 * (library/components/panel-tabs/folder-path.ts and
 * src/components/editor-layout/folder-path.ts — both deleted). The old
 * mechanism measured the tab's laid-out width with ResizeObservers and
 * rebuilt a full-silhouette `d` string per width change; every clip bug in
 * the family (F#8 right-foot clip, the task-087 top-stroke clip, the DPR
 * hairlines) came from re-deriving stroke-vs-clip-edge arithmetic at every
 * measured size.
 *
 * The new mechanism is LAYOUT-DRIVEN: only the tab's WIDTH ever varies, and
 * every curved feature is fixed-size, so the silhouette decomposes into
 *
 *   [ left cap ]  [ stretchable middle ]  [ right cap ]
 *
 * where each cap is a constant SVG (swoop foot + vertical side + top
 * shoulder) drawn ONCE in a constant coordinate space — the half-pixel
 * crispness discipline ({@link INK_SHIFT}) is set here once and is correct
 * forever — and the middle is a plain div (surface background + 1px top
 * border in the edge color) that stretches by layout. No ResizeObserver, no
 * getBoundingClientRect, no `d`-string recomputation, no width/height attrs
 * that track the element.
 *
 * Anatomy (matches the live ground-truth capture of the pre-refactor active
 * tab, svg 206×34 at tab width 206):
 *   - outward {@link FOLDER_TAB_SWOOP}-radius flare FEET at the base corners,
 *   - {@link MANILA_RADIUS}-radius top SHOULDERS,
 *   - a flat top edge inset between the shoulders,
 *   - an OPEN bottom: the stroke omits the base edge, and a 1px fill-colored
 *     bridge row (the caps' bridge rects + the middle's background reaching
 *     the wrapper bottom) fuses the tab into the panel/canvas body below by
 *     z-order (the tab overlaps the body's 1px top border by exactly
 *     {@link FOLDER_TAB_SEAM_OVERLAP}).
 */

/**
 * Manila-folder top-corner radius (px) — the SSOT for the silhouette's
 * rounded top shoulders AND the tuck slide distance (a tucked foot slides
 * inward by exactly this radius so it lands on the body corner's top
 * tangent).
 *
 * This is the numeric twin of the CSS token `--library-manila-radius` in
 * `src/app/globals.css` (task 2026-07-03-013's radius scale), which the
 * panel-body border (`TabbedLibraryPanel`), `NavPod`, and the list/project
 * headers consume for their `border-radius`. The tab SHOULDER arc (this SVG
 * geometry) and the body's CSS `border-radius` corner are two independent
 * corner renderings that must tangent at the join; sourcing both from the
 * same value is what stops them drifting apart and leaving a hairline
 * overshoot at the corner. The drift between the two representations is
 * locked by `src/components/chrome/__tests__/folder-tab-geometry.test.ts`
 * (asserts `${MANILA_RADIUS}px` === the CSS token).
 *
 * Deliberately rounder than the global `--pod-radius` (8): the folder tabs
 * keep their own slightly-rounder manila aesthetic on purpose. Do NOT
 * collapse it to 8 to "unify" — the SSOT is this token, not the pod radius.
 */
export const MANILA_RADIUS = 10;

/** Swoop-foot flare radius (px) — how far each side flares outward at the
 *  base. Path geometry, not a CSS corner (radius-guard allowlisted). */
export const FOLDER_TAB_SWOOP = 12;

/**
 * Half-pixel ink shift (x axis). SVG centres a 1px stroke on its path
 * coordinate; shifting the whole drawing by 0.5 lands the stroke's outer
 * edge on an integer device boundary instead of bleeding half a pixel out of
 * the viewport — crisp at DPR 1 and 2. Applied INSIDE the constant caps (see
 * {@link INK_SHIFT}), where it is set once and correct forever.
 */
export const STROKE_INSET = 0.5;

/**
 * Top stroke gutter (px) — a full CSS pixel of reserved air INSIDE each
 * cap's viewport, ABOVE the top stroke, so the top-edge outline is never
 * flush against its own SVG clip boundary (the pre-task-087 top-stroke
 * eater, worst at DPR 2). The middle piece mirrors it: its top offset is
 * this same constant, so the CSS border-top ink and the caps' shoulder
 * stroke ink occupy the same 1px band. Both tab strips inherit it — the
 * outer Virgil-bar tabs previously had a ZERO-cushion top stroke (the
 * unfixed fork this module retires).
 */
export const TAB_TOP_GUTTER = 1;

/**
 * The active tab's seam overlap (px): the tab wrapper carries
 * `marginBottom: -FOLDER_TAB_SEAM_OVERLAP` so its bottom fill row (the caps'
 * bridge rects + the middle's background) overlaps — and therefore covers —
 * exactly the body/canvas 1px top border under the active tab. Fusion is by
 * z-order (strip above body) + layout, correct at every width including
 * mid-drag; nothing measures the panel to "reconcile" the seam.
 */
export const FOLDER_TAB_SEAM_OVERLAP = 1;

/**
 * Real top headroom (px) the INNER library tab strip reserves above the
 * tallest tab (`paddingTop`), so stroke ink is never adjacent to the strip's
 * `overflow: hidden` clip boundary at ANY DPR. Combined with
 * {@link TAB_TOP_GUTTER} the top ink sits ≥ (STRIP_TOP_HEADROOM +
 * TAB_TOP_GUTTER) CSS px inside the strip clip — the ink-cushion invariant,
 * unit-tested against these constants. (The OUTER Virgil-bar strip has no
 * overflow clip; its cushion is the in-cap TAB_TOP_GUTTER.)
 */
export const STRIP_TOP_HEADROOM = 2;

/**
 * The inner tab strip's horizontal padding (px), on BOTH sides — the SSOT
 * for how far the library tabs are inset from the panel's edge. The panel
 * body insets by the SAME constant (`margin: 0 STRIP_SIDE_PAD px` in
 * TabbedLibraryPanel), so the body's rounded top corners begin exactly under
 * the outermost tabs' swoop feet (the task-047 "no wing" invariant) — a
 * layout relationship, not a measured one.
 */
export const STRIP_SIDE_PAD = 4;

/**
 * F#15 floor — the active library tab's content region never compresses
 * below this width (the wrapper's `minWidth` is
 * `2*FOLDER_TAB_SWOOP + ACTIVE_MIN_CONTENT + 1`). Below the floor the strip
 * scrolls; it never ellipsizes the active tab.
 */
export const ACTIVE_MIN_CONTENT = 116;

/**
 * Horizontal ink span of one cap: foot flare (S) + shoulder (R). The
 * stretchable middle is inset by exactly this much from the wrapper edge
 * (untucked), so cap art and middle border overlap by the 1px the cap
 * viewport adds ({@link CAP_W}) — an overlap of IDENTICAL ink (same 1px edge
 * band, same fill), so the joint is seamless with zero coordination.
 */
export const CAP_INNER = FOLDER_TAB_SWOOP + MANILA_RADIUS; // 22

/**
 * Cap SVG viewport width: the ink span + 1px. The +1 is the F#8 horizontal
 * stroke cushion (the outermost foot stroke, half-pixel shifted, inks its
 * final column at [CAP_INNER, CAP_INNER+1] on the outer side) AND the 1px
 * overlap into the middle's zone on the inner side.
 */
export const CAP_W = CAP_INNER + 1; // 23

/**
 * Tucked-cap viewport width: a tucked side slides its whole art inward by
 * {@link MANILA_RADIUS} (task 053 — the foot lands ON the body corner's top
 * tangent instead of poking past it), leaving the outer R px of the
 * footprint transparent so the body's rounded corner shows through.
 */
export const CAP_W_TUCKED = CAP_W + MANILA_RADIUS; // 33

/**
 * The one ink translate applied to every cap's fill+stroke groups:
 * x = {@link STROKE_INSET} (half-pixel crispness), y = STROKE_INSET +
 * {@link TAB_TOP_GUTTER} (crispness + the reserved top cushion). The top
 * stroke ink therefore occupies the band [TAB_TOP_GUTTER, TAB_TOP_GUTTER+1]
 * — exactly where the middle div (top: TAB_TOP_GUTTER, border-top 1px) puts
 * its border ink.
 */
export const INK_SHIFT = {
  x: STROKE_INSET,
  y: STROKE_INSET + TAB_TOP_GUTTER,
} as const;

/** One constant cap artwork: a fixed-size SVG drawn once. */
export interface FolderTabCapArt {
  /** SVG viewport width (height is the variant's svgH). */
  width: number;
  /** Closed fill silhouette for this cap (fill = tab surface color). */
  fillD: string;
  /** OPEN outline stroke — shoulder → side → foot, NO base edge (the open
   *  bottom is what lets the tab merge into the body). */
  strokeD: string;
  /** The 1px seam-bridge row (y = svgH − 1): fill-colored, covering the
   *  body's top border under this cap's share of the tab base. */
  bridgeX: number;
  bridgeW: number;
}

export interface FolderTabCapSet {
  left: FolderTabCapArt;
  leftTucked: FolderTabCapArt;
  right: FolderTabCapArt;
  rightTucked: FolderTabCapArt;
}

export type FolderTabVariant = "library" | "topbar";

export interface FolderTabVariantSpec {
  /** Tab body height (top of tab to the flat base between the feet). */
  tabH: number;
  /** Wrapper/cap height: tabH + 1px bottom stroke gutter + TAB_TOP_GUTTER. */
  svgH: number;
  /** Edge color for stroke + middle border-top. CSS var so theming works.
   *  Library chrome MUST ride --library-edge (task 048); the top bar keeps
   *  its own warm --topbar-border. */
  strokeVar: string;
  /** Content row inset from the wrapper's left edge (the foot flare). */
  contentInsetLeft: number;
  /** Content row inset from the wrapper's right edge. The library variant
   *  carries the F#8 +1 INSIDE its footprint (historical inner-tab box:
   *  svgW = 2S + tabW + 1); the topbar variant keeps its historical
   *  2S + content footprint and pokes the cap out instead (see
   *  capRightOverhang) so the inline↔folder pixel-stability contract
   *  (ACTIVE_TAB_*_SHIFT_PX / InlineTabLabel padding) is untouched. */
  contentInsetRight: number;
  /** How far the right cap's viewport extends PAST the wrapper's right edge
   *  (px). 0 when the +1 stroke cushion is part of the footprint (library);
   *  1 for the topbar variant, whose footprint historically excluded the
   *  cushion — the previously-clipped outer half-pixel of the right foot
   *  stroke now renders into the inter-tab gap instead of being cut off. */
  capRightOverhang: number;
  /** Seam-bridge span: "body" bridges only the flat-body run so the body's
   *  top border shows in the swoop valleys (inner tabs, task 053); "full"
   *  bridges the entire base including the feet (outer tabs' historical
   *  full-width cover of the topbar border). */
  bridgeSpan: "body" | "full";
  caps: FolderTabCapSet;
}

const R = MANILA_RADIUS;
const S = FOLDER_TAB_SWOOP;

/**
 * Build the four constant cap artworks for a tab height. Computed ONCE at
 * module load per variant — never per render, never per width, never from a
 * measurement. The `d` strings are constants in cap-local coordinates; the
 * ground-truth full-tab paths are exactly the union of these caps plus the
 * middle's straight border (locked by folder-tab-geometry.test.ts).
 */
function buildCapSet(args: {
  tabH: number;
  bridgeSpan: "body" | "full";
  capRightOverhang: number;
}): FolderTabCapSet {
  const { tabH, bridgeSpan, capRightOverhang } = args;

  // LEFT cap, untucked. Local space: foot outer edge at x=0, vertical side
  // at x=S, shoulder ending at x=S+R on the flat top (y=0). Fill closes out
  // to x=CAP_W so it overlaps the middle's background by 1px.
  const left: FolderTabCapArt = {
    width: CAP_W,
    fillD: [
      `M ${CAP_INNER} 0`,
      `A ${R} ${R} 0 0 0 ${S} ${R}`,
      `V ${tabH - S}`,
      `A ${S} ${S} 0 0 1 0 ${tabH}`,
      `H ${CAP_W}`,
      `V 0`,
      `Z`,
    ].join(" "),
    strokeD: [
      `M ${CAP_INNER} 0`,
      `A ${R} ${R} 0 0 0 ${S} ${R}`,
      `V ${tabH - S}`,
      `A ${S} ${S} 0 0 1 0 ${tabH}`,
    ].join(" "),
    // "body": bridge from the vertical side (x=S) inward — the foot valley
    // [0, S) is left unbridged so the body's top border shows under it.
    // "full": bridge the whole cap footprint (feet included).
    bridgeX: bridgeSpan === "body" ? S : 0,
    bridgeW: bridgeSpan === "body" ? CAP_W - S : CAP_W,
  };

  // LEFT cap, tucked (task 053): the same art slid inward by R. The exposed
  // [0, R) strip is transparent — the body's rounded top-left corner shows
  // through, and the foot lands on that corner's top tangent. The bridge
  // starts at R + STROKE_INSET so the corner's arc ink stays exposed
  // (ground-truth bridge x = 10.5).
  const leftTucked: FolderTabCapArt = {
    width: CAP_W_TUCKED,
    fillD: [
      `M ${CAP_INNER + R} 0`,
      `A ${R} ${R} 0 0 0 ${S + R} ${R}`,
      `V ${tabH - S}`,
      `A ${S} ${S} 0 0 1 ${R} ${tabH}`,
      `H ${CAP_W_TUCKED}`,
      `V 0`,
      `Z`,
    ].join(" "),
    strokeD: [
      `M ${CAP_INNER + R} 0`,
      `A ${R} ${R} 0 0 0 ${S + R} ${R}`,
      `V ${tabH - S}`,
      `A ${S} ${S} 0 0 1 ${R} ${tabH}`,
    ].join(" "),
    bridgeX: R + STROKE_INSET,
    bridgeW: CAP_W_TUCKED - (R + STROKE_INSET),
  };

  // RIGHT cap, untucked. Local space: shoulder starts at x=0 on the flat
  // top, vertical side at x=R, foot outer edge at x=CAP_INNER (its stroke's
  // outer half inks the final viewport column [CAP_INNER, CAP_W] — the F#8
  // cushion). NOTE the joint-overlap mechanism: the 1px overlap with the
  // middle comes from the MIDDLE reaching 1px into this cap's footprint
  // (middleInsetRight = CAP_INNER − overhang, i.e. CAP_W − 1 inside the
  // viewport) — the fill's x∈[−1, 0) lead-in is CLIPPED by the viewport
  // (viewBox starts at 0) and renders nothing on its own.
  const right: FolderTabCapArt = {
    width: CAP_W,
    fillD: [
      `M -1 0`,
      `H 0`,
      `A ${R} ${R} 0 0 1 ${R} ${R}`,
      `V ${tabH - S}`,
      `A ${S} ${S} 0 0 0 ${CAP_INNER} ${tabH}`,
      `H -1`,
      `Z`,
    ].join(" "),
    // The stroke opens with the SAME top-edge lead-in as the fill
    // (`M -1 0 H 0`, likewise viewport-clipped for x<0). Within a cap the
    // paint order is fill → bridge → stroke, but the cap svg as a whole
    // paints AFTER the middle div — so without this run the cap's fill
    // would overpaint the lower half of the middle's border-top ink across
    // the 0.5px joint band (local x∈[0, STROKE_INSET]), chipping the top
    // edge at every right shoulder. Re-inking that band from the stroke
    // (painted last) makes the joint genuinely "identical ink at any paint
    // order" — the composed union matches the ground-truth single-path
    // stroke everywhere.
    strokeD: [
      `M -1 0`,
      `H 0`,
      `A ${R} ${R} 0 0 1 ${R} ${R}`,
      `V ${tabH - S}`,
      `A ${S} ${S} 0 0 0 ${CAP_INNER} ${tabH}`,
    ].join(" "),
    // "body": bridge ends at the vertical side (x=R). "full": bridge to the
    // wrapper's right edge — the viewport minus the overhang, so the bridge
    // never paints past the tab's footprint into the inter-tab gap.
    bridgeX: 0,
    bridgeW: bridgeSpan === "body" ? R : CAP_W - capRightOverhang,
  };

  // RIGHT cap, tucked: same art in a wider viewport; the exposed strip on
  // the right shows the body's top-right corner. Bridge ends at
  // width − (R + STROKE_INSET), mirroring leftTucked.
  const rightTucked: FolderTabCapArt = {
    width: CAP_W_TUCKED,
    fillD: right.fillD,
    strokeD: right.strokeD,
    bridgeX: 0,
    bridgeW: CAP_W_TUCKED - (R + STROKE_INSET),
  };

  return { left, leftTucked, right, rightTucked };
}

function makeVariant(args: {
  tabH: number;
  strokeVar: string;
  contentInsetRight: number;
  capRightOverhang: number;
  bridgeSpan: "body" | "full";
}): FolderTabVariantSpec {
  return {
    tabH: args.tabH,
    // +1 bottom stroke gutter (the base stroke's lower half-pixel) + the top
    // cushion. The bottom ink's outer edge lands exactly ON svgH — inside the
    // viewport (locked by the ink-cushion test).
    svgH: args.tabH + 1 + TAB_TOP_GUTTER,
    strokeVar: args.strokeVar,
    contentInsetLeft: S,
    contentInsetRight: args.contentInsetRight,
    capRightOverhang: args.capRightOverhang,
    bridgeSpan: args.bridgeSpan,
    caps: buildCapSet({
      tabH: args.tabH,
      bridgeSpan: args.bridgeSpan,
      capRightOverhang: args.capRightOverhang,
    }),
  };
}

/**
 * The two strips' named variants. Heights, paddings, edge tokens and seam
 * spans differ; every curve, cushion and crispness constant is shared.
 */
export const FOLDER_TAB_VARIANTS: Record<FolderTabVariant, FolderTabVariantSpec> = {
  /** Inner Library panel tabs (PanelFolderTab). Historical box:
   *  svgW = 2S + tabW + 1, svgH = 34, stroke --library-edge. */
  library: makeVariant({
    tabH: 32,
    strokeVar: "var(--library-edge, #b3c0c4)",
    contentInsetRight: S + 1, // the F#8 +1 lives inside the footprint
    capRightOverhang: 0,
    bridgeSpan: "body",
  }),
  /** Outer Virgil-bar tabs (DocumentFolderTab). Historical box:
   *  svgW = 2S + tabW (no +1 — preserved for inline↔folder pixel parity),
   *  stroke --topbar-border. */
  topbar: makeVariant({
    tabH: 30,
    strokeVar: "var(--topbar-border, #d5d3ce)",
    contentInsetRight: S,
    capRightOverhang: 1, // the F#8 cushion pokes out instead
    bridgeSpan: "full",
  }),
};

/** Middle-piece inset from the wrapper's LEFT edge. Tucking slides the cap
 *  art inward by R, so the middle starts R further right. */
export function middleInsetLeft(tucked: boolean): number {
  return CAP_INNER + (tucked ? MANILA_RADIUS : 0);
}

/** Middle-piece inset from the wrapper's RIGHT edge. The cap overlaps the
 *  middle by 1px of identical ink; a right-overhanging cap (topbar) sits 1px
 *  further out, so the middle follows it to keep the same 1px overlap. */
export function middleInsetRight(tucked: boolean, capRightOverhang: number): number {
  return CAP_INNER - capRightOverhang + (tucked ? MANILA_RADIUS : 0);
}
