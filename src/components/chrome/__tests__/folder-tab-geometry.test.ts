import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  ACTIVE_MIN_CONTENT,
  CAP_INNER,
  CAP_W,
  CAP_W_TUCKED,
  FOLDER_TAB_SEAM_OVERLAP,
  FOLDER_TAB_SWOOP,
  FOLDER_TAB_VARIANTS,
  INK_SHIFT,
  MANILA_RADIUS,
  STRIP_SIDE_PAD,
  STRIP_TOP_HEADROOM,
  STROKE_INSET,
  TAB_TOP_GUTTER,
  middleInsetLeft,
  middleInsetRight,
} from "../folder-tab-geometry";

const R = MANILA_RADIUS;
const S = FOLDER_TAB_SWOOP;

// Repo root, up 4 from src/components/chrome/__tests__.
const ROOT = path.resolve(__dirname, "..", "..", "..", "..");

/**
 * GROUND TRUTH — live DOM capture of the pre-refactor inner ACTIVE tab
 * (first tab, so tuckLeft; wrapper width 206, svg 206×34):
 *
 *   fill   (g translate(0.5,1.5)):
 *     M 32 0 H 183 A 10 10 0 0 1 193 10 V 20 A 12 12 0 0 0 205 32 H 10
 *     A 12 12 0 0 0 22 20 V 10 A 10 10 0 0 1 32 0 Z
 *   stroke (same g, --library-edge, width 1, no bottom edge):
 *     M 205 32 A 12 12 0 0 1 193 20 V 10 A 10 10 0 0 0 183 0 H 32
 *     A 10 10 0 0 0 22 10 V 20 A 12 12 0 0 1 10 32
 *   bridge rect: x 10.5, y 33, w 182.5 (→ right edge 193).
 *
 * The three-piece composition (left cap + middle + right cap) must union to
 * exactly this ink. These tests pin that arithmetic against the constants.
 */
const GT = {
  W: 206,
  svgH: 34,
  // Tab-space feature coordinates from the capture (tuckLeft, untucked right):
  leftFoot: 10, // tucked foot base x
  leftSide: 22, // tucked vertical side x
  leftShoulderEnd: 32, // tucked flat-top start x
  rightShoulderStart: 183,
  rightSide: 193,
  rightFoot: 205,
  bridgeX: 10.5,
  bridgeRight: 193, // 10.5 + 182.5
  bridgeY: 33,
};

describe("ground-truth fidelity — the cap/middle composition reproduces the captured tab ink exactly", () => {
  const v = FOLDER_TAB_VARIANTS.library;
  const left = v.caps.leftTucked; // first tab ⇒ tucked left foot
  const right = v.caps.right;

  it("cap heights and the ink translate match the capture (svg ...×34, g translate(0.5,1.5))", () => {
    expect(v.svgH).toBe(GT.svgH);
    expect(INK_SHIFT.x).toBe(0.5);
    expect(INK_SHIFT.y).toBe(1.5);
  });

  it("the tucked LEFT cap draws the capture's left features at identical coordinates", () => {
    // Cap-local coordinates ARE tab-space coordinates for the left cap
    // (origin at the wrapper's left edge).
    expect(left.width).toBe(33);
    expect(left.fillD).toBe(
      `M ${GT.leftShoulderEnd} 0 A 10 10 0 0 0 ${GT.leftSide} 10 V 20 A 12 12 0 0 1 ${GT.leftFoot} 32 H 33 V 0 Z`,
    );
    expect(left.strokeD).toBe(
      `M ${GT.leftShoulderEnd} 0 A 10 10 0 0 0 ${GT.leftSide} 10 V 20 A 12 12 0 0 1 ${GT.leftFoot} 32`,
    );
  });

  it("the RIGHT cap, offset to the wrapper's right edge, lands the capture's right features exactly", () => {
    expect(right.width).toBe(23);
    // Library variant: cap sits at right:0 ⇒ local x + (W − CAP_W).
    const off = GT.W - right.width; // 183
    // The `M -1 0 H 0` lead-in is the joint re-ink (see the seamless-joint
    // test below); its x<0 half is viewport-clipped, so the first VISIBLE
    // stroke feature is still the capture's shoulder arc at local x=0.
    expect(right.strokeD).toBe(
      `M -1 0 H 0 A 10 10 0 0 1 10 10 V 20 A 12 12 0 0 0 22 32`,
    );
    expect(off + 0).toBe(GT.rightShoulderStart); // shoulder start 183
    expect(off + R).toBe(GT.rightSide); //          vertical side 193
    expect(off + CAP_INNER).toBe(GT.rightFoot); //  foot base 205
  });

  it("the seam-bridge union (left bridge ∪ middle background ∪ right bridge) is contiguous and equals the capture's bridge rect", () => {
    // Left cap bridge, in wrapper space (cap at left:0).
    const leftBridge: [number, number] = [
      left.bridgeX,
      left.bridgeX + left.bridgeW,
    ];
    // Middle background spans [insetLeft, W − insetRight] and reaches the
    // wrapper bottom, forming the bridge across the stretchable span.
    const middle: [number, number] = [
      middleInsetLeft(true),
      GT.W - middleInsetRight(false, v.capRightOverhang),
    ];
    // Right cap bridge (cap at right:0 ⇒ offset W − CAP_W).
    const rightBridge: [number, number] = [
      GT.W - right.width + right.bridgeX,
      GT.W - right.width + right.bridgeX + right.bridgeW,
    ];
    // Contiguity: each segment starts at or before the previous segment ends.
    expect(leftBridge[1]).toBeGreaterThanOrEqual(middle[0]);
    expect(middle[1]).toBeGreaterThanOrEqual(rightBridge[0]);
    // Exact union endpoints === the captured bridge rect [10.5, 193].
    expect(leftBridge[0]).toBe(GT.bridgeX);
    expect(rightBridge[1]).toBe(GT.bridgeRight);
    // And the bridge row is the capture's y = svgH − 1 = 33 (drawn per cap).
    expect(v.svgH - 1).toBe(GT.bridgeY);
  });

  it("the middle's top border overlaps each cap by exactly 1px of identical ink (seamless joint by construction)", () => {
    // Left: cap viewport ends at its width; middle starts 1px inside it.
    expect(middleInsetLeft(true)).toBe(left.width - 1);
    expect(middleInsetLeft(false)).toBe(CAP_W - 1);
    // Right (library, no overhang): cap starts at W − CAP_W; middle ends at
    // W − (CAP_W − 1) — 1px inside the cap.
    expect(middleInsetRight(false, 0)).toBe(CAP_W - 1);
    // The shoulder arc's ink begins STROKE_INSET past the middle's edge, so
    // the overlapped pixel carries the SAME 1px edge band from both pieces.
    expect(STROKE_INSET).toBeLessThan(1);
    // RIGHT-joint paint-order guarantee: the right cap svg paints AFTER the
    // middle div, and its fill's flat top boundary reaches local
    // x∈[0, STROKE_INSET] — overpainting the lower half of the middle's
    // border-top ink there. The stroke (painted last within the cap) must
    // therefore cover the fill's own top-edge lead-in so the joint band is
    // re-inked in edge color: every right strokeD opens with the same
    // `M -1 0 H 0` run its fillD opens with. Dropping this re-creates a
    // half-pixel chip in the top edge at every right shoulder.
    for (const variant of Object.values(FOLDER_TAB_VARIANTS)) {
      for (const art of [variant.caps.right, variant.caps.rightTucked]) {
        expect(art.strokeD.startsWith("M -1 0 H 0 ")).toBe(true);
        expect(art.fillD.startsWith("M -1 0 H 0 ")).toBe(true);
      }
    }
  });
});

describe("cap/frame corner tangency (tasks 047 + 053, re-expressed against the SSOT)", () => {
  it("the tab shoulder arc and the body's border-radius read ONE radius: MANILA_RADIUS === --library-manila-radius", () => {
    const globals = readFileSync(path.join(ROOT, "src/app/globals.css"), "utf8");
    const m = globals.match(/--library-manila-radius:\s*(\d+(?:\.\d+)?)px\s*;/);
    expect(m, "--library-manila-radius must be defined in globals.css").not.toBeNull();
    expect(Number(m![1])).toBe(MANILA_RADIUS);
  });

  it("every cap's arcs carry the SSOT radii (shoulder R, foot S) — no bare literals to drift", () => {
    for (const variant of Object.values(FOLDER_TAB_VARIANTS)) {
      for (const art of Object.values(variant.caps)) {
        expect(art.strokeD).toContain(`A ${R} ${R} 0`);
        expect(art.strokeD).toContain(`A ${S} ${S} 0`);
        expect(art.fillD).toContain(`A ${R} ${R} 0`);
        expect(art.fillD).toContain(`A ${S} ${S} 0`);
      }
    }
  });

  it("a tucked cap slides its art inward by exactly MANILA_RADIUS, landing the foot on the body corner's top tangent", () => {
    const { caps } = FOLDER_TAB_VARIANTS.library;
    // The tuck slide IS the corner radius — that identity is what makes the
    // foot land on the corner's top tangent (the corner's horizontal extent
    // is MANILA_RADIUS from the body edge).
    expect(caps.leftTucked.width - caps.left.width).toBe(MANILA_RADIUS);
    expect(caps.rightTucked.width - caps.right.width).toBe(MANILA_RADIUS);
    // Tucked foot base at x = R (the corner's top tangent), full swoop radius
    // preserved (same foot shape as untucked — task 053).
    expect(caps.leftTucked.strokeD).toContain(`A ${S} ${S} 0 0 1 ${R} `);
    // The tucked bridge starts at R + STROKE_INSET so the corner arc's ink
    // stays exposed under the tucked foot.
    expect(caps.leftTucked.bridgeX).toBe(MANILA_RADIUS + STROKE_INSET);
  });

  it("the body inset and the strip padding read one STRIP_SIDE_PAD (the no-wing layout relationship)", () => {
    const strip = readFileSync(
      path.join(ROOT, "library/components/panel-tabs/PanelTabStrip.tsx"),
      "utf8",
    );
    const body = readFileSync(
      path.join(ROOT, "library/components/TabbedLibraryPanel.tsx"),
      "utf8",
    );
    expect(strip).toContain("STRIP_SIDE_PAD");
    expect(body).toContain("STRIP_SIDE_PAD");
    expect(STRIP_SIDE_PAD).toBe(4);
  });
});

describe("open-bottom seam — exactly 1px overlap, by construction", () => {
  it("every stroke path is OPEN (no Z, no base edge): the bottom seam is the body's border, covered only under the tab", () => {
    for (const variant of Object.values(FOLDER_TAB_VARIANTS)) {
      for (const art of Object.values(variant.caps)) {
        expect(art.strokeD).not.toContain("Z");
        // The stroke ends at the foot's base (y = tabH) — sides + shoulder +
        // foot only; the base run between the feet is never drawn.
        expect(art.strokeD.trimEnd().endsWith(` ${variant.tabH}`)).toBe(true);
        // The fill IS closed (a complete silhouette surface).
        expect(art.fillD).toContain("Z");
      }
    }
  });

  it("the seam overlap is exactly 1 CSS px: bridge row = the wrapper's last row = the overlapped body-border row", () => {
    expect(FOLDER_TAB_SEAM_OVERLAP).toBe(1);
    for (const variant of Object.values(FOLDER_TAB_VARIANTS)) {
      // The bridge rect (y = svgH − 1, height 1) is the single row that the
      // wrapper's −1px bottom margin pushes over the body's top border.
      expect(variant.svgH - 1 + FOLDER_TAB_SEAM_OVERLAP).toBe(variant.svgH);
    }
  });

  it("a 'body'-span bridge leaves the foot valleys unbridged; a 'full'-span bridge covers the whole footprint", () => {
    const lib = FOLDER_TAB_VARIANTS.library.caps; // body span
    const top = FOLDER_TAB_VARIANTS.topbar.caps; // full span
    // Inner tabs: bridge starts at the vertical side (x = S) — the valley
    // [0, S) shows the body's top border (task 053 "feet land on the page").
    expect(lib.left.bridgeX).toBe(S);
    expect(lib.right.bridgeX + lib.right.bridgeW).toBe(R); // ends at the side
    // Outer tabs: full cover of the topbar border across the footprint,
    // never past it (the overhang is subtracted on the right).
    expect(top.left.bridgeX).toBe(0);
    expect(top.left.bridgeW).toBe(CAP_W);
    expect(top.right.bridgeX).toBe(0);
    expect(top.right.bridgeW).toBe(
      CAP_W - FOLDER_TAB_VARIANTS.topbar.capRightOverhang,
    );
  });
});

describe("ink-cushion invariant — stroke ink ≥ 1 CSS px from every clip boundary, at any DPR, by construction", () => {
  it("top: a full-pixel gutter INSIDE each cap viewport (the task-087 class, now structural)", () => {
    expect(TAB_TOP_GUTTER).toBeGreaterThanOrEqual(1);
    // Top stroke band = [INK_SHIFT.y − 0.5, INK_SHIFT.y + 0.5]; its top edge
    // sits exactly TAB_TOP_GUTTER inside the viewport.
    expect(INK_SHIFT.y - 0.5).toBe(TAB_TOP_GUTTER);
  });

  it("bottom: the base stroke's outer edge lands exactly ON svgH — inside the viewport (never clipped)", () => {
    for (const variant of Object.values(FOLDER_TAB_VARIANTS)) {
      const bottomInkOuterEdge = variant.tabH + INK_SHIFT.y + 0.5;
      expect(bottomInkOuterEdge).toBeLessThanOrEqual(variant.svgH);
      expect(variant.svgH).toBe(variant.tabH + 1 + TAB_TOP_GUTTER);
    }
  });

  it("right: the outer foot stroke's final column fits the cap viewport (the F#8 class, now structural)", () => {
    // Foot base at local CAP_INNER; ink outer edge = CAP_INNER + 0.5 + 0.5.
    const rightInkOuterEdge = CAP_INNER + INK_SHIFT.x + 0.5;
    expect(rightInkOuterEdge).toBeLessThanOrEqual(CAP_W);
    expect(CAP_W_TUCKED).toBe(CAP_W + MANILA_RADIUS);
  });

  it("inner strip: real top headroom (≥ 2px padding) stacks with the in-cap gutter — ink ≥ 3px from the strip's overflow clip", () => {
    expect(STRIP_TOP_HEADROOM).toBeGreaterThanOrEqual(2);
    expect(STRIP_TOP_HEADROOM + TAB_TOP_GUTTER).toBeGreaterThanOrEqual(3);
    // And the seam spill row stays INSIDE the strip's clip box: the strip's
    // 1px bottom padding hosts exactly the FOLDER_TAB_SEAM_OVERLAP row.
    expect(FOLDER_TAB_SEAM_OVERLAP).toBe(1);
  });

  it("outer strip: the topbar tab's top ink clears the bar's top edge by ≥ 1px (WCO/installed-PWA strip-edge safe)", () => {
    const globals = readFileSync(path.join(ROOT, "src/app/globals.css"), "utf8");
    const m = globals.match(/--bar-base-h:\s*(\d+)px\s*;/);
    expect(m, "--bar-base-h must be defined in globals.css").not.toBeNull();
    const barContentH = Number(m![1]) - 1; // minus the bar's 1px border-b
    const v = FOLDER_TAB_VARIANTS.topbar;
    // Bottom-aligned tab: margin-box = svgH − seam overlap; its top offset
    // from the bar's content top, plus the in-cap gutter, is the top ink's
    // clearance from the bar's top edge.
    const tabMarginBox = v.svgH - FOLDER_TAB_SEAM_OVERLAP;
    const topInkClearance = barContentH - tabMarginBox + TAB_TOP_GUTTER;
    expect(topInkClearance).toBeGreaterThanOrEqual(1);
  });
});

describe("variant parameterization — named differences only, one geometry", () => {
  const lib = FOLDER_TAB_VARIANTS.library;
  const top = FOLDER_TAB_VARIANTS.topbar;

  it("heights: library 32 / topbar 30; both derive svgH from the shared gutters", () => {
    expect(lib.tabH).toBe(32);
    expect(top.tabH).toBe(30);
    expect(lib.svgH).toBe(34);
    expect(top.svgH).toBe(32);
  });

  it("edge tokens: library rides --library-edge, topbar rides --topbar-border (never crossed)", () => {
    expect(lib.strokeVar).toContain("--library-edge");
    expect(lib.strokeVar).not.toContain("--topbar-border");
    expect(top.strokeVar).toContain("--topbar-border");
  });

  it("footprint policy: library carries the F#8 +1 inside its box; topbar overhangs it (inline↔folder pixel parity preserved)", () => {
    expect(lib.contentInsetLeft).toBe(S);
    expect(lib.contentInsetRight).toBe(S + 1);
    expect(lib.capRightOverhang).toBe(0);
    expect(top.contentInsetLeft).toBe(S);
    expect(top.contentInsetRight).toBe(S);
    expect(top.capRightOverhang).toBe(1);
    // Ground-truth wrapper width = content + insets: 206 = 181 + 25.
    expect(lib.contentInsetLeft + lib.contentInsetRight).toBe(25);
  });

  it("the F#15 reserved floor survives: ACTIVE_MIN_CONTENT + flares + the +1 cushion", () => {
    expect(ACTIVE_MIN_CONTENT).toBe(116);
    expect(2 * S + ACTIVE_MIN_CONTENT + 1).toBe(141);
  });
});
