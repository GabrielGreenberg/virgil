import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  ACTIVE_MIN_CONTENT,
  MANILA_RADIUS,
  STRIP_SIDE_PAD,
  STROKE_INSET,
  TAB_TOP_GUTTER,
  buildActiveTabStrokePath,
  buildFramePath,
  buildTabFillPath,
  deriveTabWidthFromWrapper,
  firstTabSwoopFootX,
  frameTopCornerStartX,
  recoverNaturalContentWidth,
  tabSvgGeometry,
} from "../folder-path";

// Geometry constants mirrored from PanelFolderTab.tsx (the SSOT home). The
// path builders are pure and parameterised, so the tests pin the same numbers.
const S = 12;
const TAB_H = 32;

// Repo root, up 4 from library/components/panel-tabs/__tests__.
const ROOT = path.resolve(__dirname, "..", "..", "..", "..");

describe("F#8 — clipped-stroke SVG gutter geometry", () => {
  it("adds a 1px HORIZONTAL gutter mirroring the vertical bottom-stroke precedent", () => {
    const tabW = 120;
    const { svgW, svgH } = tabSvgGeometry({ tabW, tabH: TAB_H, S });
    // Vertical height carries BOTH the pre-existing +1 bottom gutter AND the
    // task-087 top gutter, so the bottom stroke fits inside overflow:hidden and
    // the top stroke clears the strip's flush top clip.
    expect(svgH).toBe(TAB_H + 1 + TAB_TOP_GUTTER);
    // Horizontal gutter (F#8, the new bit): width is the raw path extent
    // (2*S + tabW) PLUS 1 so the right swoop foot doesn't bleed past the edge.
    expect(svgW).toBe(2 * S + tabW + 1);
  });

  it("uses a half-pixel stroke inset so the 1px stroke's outer edge lands on an integer device boundary", () => {
    // The 0.5 translate is what makes the +1 gutter necessary AND sufficient:
    // path coord x lands at x + 0.5, the stroke (width 1, centred) spans
    // [x, x+1], so the right foot at (2*S + tabW) occupies [.., +1] — exactly
    // the +1 gutter. No clipping at any DPR (the +1 is a full CSS px).
    expect(STROKE_INSET).toBe(0.5);
    expect(tabSvgGeometry({ tabW: 100, tabH: TAB_H, S }).inset).toBe(STROKE_INSET);
  });

  it("the right swoop foot + half-pixel inset stay strictly inside the widened viewport", () => {
    const tabW = 90;
    const { svgW, inset } = tabSvgGeometry({ tabW, tabH: TAB_H, S });
    // The rightmost ink (the right swoop foot) is at x = 2*S + tabW in path
    // space; after the inset translate it sits at +0.5, and the 1px stroke's
    // outer edge at +1.0. That must be <= svgW (no clip).
    const rightFootOuterEdge = 2 * S + tabW + inset + 0.5;
    expect(rightFootOuterEdge).toBeLessThanOrEqual(svgW);
  });

  it("scales the gutter the same way at every tabW (no per-width drift)", () => {
    for (const tabW of [60, 116, 200, 480]) {
      const { svgW } = tabSvgGeometry({ tabW, tabH: TAB_H, S });
      expect(svgW - (2 * S + tabW)).toBe(1);
    }
  });
});

describe("task 2026-07-07-087 — symmetric TOP stroke gutter (top-edge outline no longer clipped)", () => {
  it("reserves a full-pixel top gutter so the top stroke clears the SVG's (and strip's) top clip", () => {
    const { insetY, svgH } = tabSvgGeometry({ tabW: 120, tabH: TAB_H, S });
    // The y translate shifts the path down by STROKE_INSET + TAB_TOP_GUTTER, so
    // the top stroke (path y=0 → rendered at insetY, centred, spanning
    // [insetY-0.5, insetY+0.5]) leaves a full TAB_TOP_GUTTER clear ABOVE it.
    expect(insetY).toBe(STROKE_INSET + TAB_TOP_GUTTER);
    const topStrokeOuterEdge = insetY - 0.5; // the stroke's topmost device row
    expect(topStrokeOuterEdge).toBeGreaterThanOrEqual(TAB_TOP_GUTTER);
    // svgH grows by exactly the top gutter over the old (tabH + 1) bottom-only
    // height, so the bottom stroke still fits AND the top gutter is real space.
    expect(svgH).toBe(TAB_H + 1 + TAB_TOP_GUTTER);
  });

  it("keeps the X inset a bare half-pixel — the gutter is a Y-only concern", () => {
    // The horizontal crispness technique is unchanged; only the vertical axis
    // gains the extra top cushion. inset (x) stays STROKE_INSET; insetY (y) adds
    // the gutter. Guards against a future edit collapsing them back to one value.
    const g = tabSvgGeometry({ tabW: 100, tabH: TAB_H, S });
    expect(g.inset).toBe(STROKE_INSET);
    expect(g.insetY).toBe(STROKE_INSET + TAB_TOP_GUTTER);
    expect(g.insetY - g.inset).toBe(TAB_TOP_GUTTER);
  });

  it("the bottom stroke still fits inside svgH after the top shift (no bottom clip regression)", () => {
    const { insetY, svgH } = tabSvgGeometry({ tabW: 90, tabH: TAB_H, S });
    // Bottom ink at path y=TAB_H → rendered at TAB_H + insetY, the 1px stroke's
    // outer (lower) edge at +0.5. That must stay <= svgH (no clip).
    const bottomStrokeOuterEdge = TAB_H + insetY + 0.5;
    expect(bottomStrokeOuterEdge).toBeLessThanOrEqual(svgH);
  });
});

describe("F#15 — flex-compress width inversion", () => {
  it("derives tabW so that svgW(tabW) === the flex-assigned wrapper width (the fixpoint)", () => {
    // The inversion's load-bearing identity: feeding back the laid-out width
    // must produce a tabW whose canvas re-fills exactly that width — otherwise
    // the ResizeObserver oscillates instead of converging.
    const laidOutWidth = 240;
    const tabW = deriveTabWidthFromWrapper({
      laidOutWidth,
      minTabW: ACTIVE_MIN_CONTENT,
      S,
    });
    expect(tabSvgGeometry({ tabW, tabH: TAB_H, S }).svgW).toBe(laidOutWidth);
  });

  it("floors at ACTIVE_MIN_CONTENT and never below — the active tab never compresses past its min", () => {
    // A strip far narrower than the floor still yields the floor body width;
    // past here the strip scrolls (handled by the strip), it does NOT shrink
    // the active tab further or ellipsize its name.
    const tiny = deriveTabWidthFromWrapper({
      laidOutWidth: 40,
      minTabW: ACTIVE_MIN_CONTENT,
      S,
    });
    expect(tiny).toBe(ACTIVE_MIN_CONTENT);

    const zero = deriveTabWidthFromWrapper({
      laidOutWidth: 0,
      minTabW: ACTIVE_MIN_CONTENT,
      S,
    });
    expect(zero).toBe(ACTIVE_MIN_CONTENT);
  });

  it("grows tabW as the wrapper widens (active tab keeps its full name when there's room)", () => {
    const narrow = deriveTabWidthFromWrapper({ laidOutWidth: 200, minTabW: ACTIVE_MIN_CONTENT, S });
    const wide = deriveTabWidthFromWrapper({ laidOutWidth: 400, minTabW: ACTIVE_MIN_CONTENT, S });
    expect(wide).toBeGreaterThan(narrow);
    expect(wide - narrow).toBe(200); // monotonic, 1:1 with wrapper width above the floor
  });

  it("returns an integer tabW (no sub-pixel SVG coords → no half-pixel blur at 2x DPR)", () => {
    const tabW = deriveTabWidthFromWrapper({
      laidOutWidth: 241.7,
      minTabW: ACTIVE_MIN_CONTENT,
      S,
    });
    expect(Number.isInteger(tabW)).toBe(true);
  });

  it("F1 — for a FRACTIONAL flex-assigned width the canvas COVERS the box (svgW >= laidOut) and tabW stays integer", () => {
    // The flex engine hands the wrapper a fractional width. Flooring the
    // remainder (the old behaviour) made svgW up to ~1px NARROWER than the box,
    // leaving a transparent strip on the active tab's right edge. Ceiling the
    // wrapper width before inverting overshoots instead — the <1px overshoot is
    // clipped by overflow:hidden, so there is never a background gap.
    for (const laidOutWidth of [250.7, 199.3, 317.4]) {
      const tabW = deriveTabWidthFromWrapper({
        laidOutWidth,
        minTabW: ACTIVE_MIN_CONTENT,
        S,
      });
      const { svgW } = tabSvgGeometry({ tabW, tabH: TAB_H, S });
      expect(svgW).toBeGreaterThanOrEqual(laidOutWidth); // canvas covers the box
      expect(Number.isInteger(tabW)).toBe(true); // DPR-crisp integer body width
    }
  });

  it("F1 — the integer-input fixpoint still holds (svgW(derive(intLaidOut)) === intLaidOut)", () => {
    // Ceiling an already-integer width is a no-op, so the load-bearing
    // ResizeObserver fixpoint from before is preserved exactly.
    for (const laidOutWidth of [200, 240, 333, 480]) {
      const tabW = deriveTabWidthFromWrapper({
        laidOutWidth,
        minTabW: ACTIVE_MIN_CONTENT,
        S,
      });
      expect(tabSvgGeometry({ tabW, tabH: TAB_H, S }).svgW).toBe(laidOutWidth);
    }
  });
});

describe("active-tab-always-attached invariant (F#8 seam ↔ F#15 attach guarantee)", () => {
  it("the active stroke path OMITS the bottom edge so the tab merges into the body seam", () => {
    const d = buildActiveTabStrokePath({ tabW: 120, tabH: TAB_H, R: 10, S });
    // The active stroke is an OPEN path: it must not close back to the start
    // (no `Z`) — the missing bottom edge IS the 1px seam the body's top border
    // fills. This is what guarantees the active tab stays attached.
    expect(d).not.toContain("Z");
    // It ends at the LEFT swoop foot (x=0, y=tabH), having traced top + sides,
    // rather than drawing the bottom edge back across.
    expect(d.trimEnd().endsWith(`0 ${TAB_H}`)).toBe(true);
  });

  it("the inactive/fill path IS closed (a full silhouette, bottom edge included)", () => {
    const d = buildTabFillPath({ tabW: 120, tabH: TAB_H, R: 10, S });
    // The fill (and inactive stroke) closes the silhouette so an inactive tab
    // reads as a complete shape sitting ON the strip, not merged into a body.
    expect(d).toContain("Z");
  });

  it("the bottom seam spans the full body width at every compression level", () => {
    // At the floor and above, the active path's bottom feet stay at x=0 and
    // x = 2*S + tabW (the swoop extremes) — the fill rect that bridges the seam
    // (width svgW) always covers that span, so the tab never detaches.
    for (const tabW of [ACTIVE_MIN_CONTENT, 160, 320]) {
      const d = buildActiveTabStrokePath({ tabW, tabH: TAB_H, R: 10, S });
      // Path starts at the RIGHT swoop foot (tabRight + S = 2*S + tabW, tabH)
      // and ends at the LEFT swoop foot (0, tabH) — the two extremes of the
      // bottom seam, with the bottom edge itself omitted (the body fills it).
      expect(d.startsWith(`M ${2 * S + tabW} ${TAB_H}`)).toBe(true);
      expect(d.trimEnd().endsWith(`0 ${TAB_H}`)).toBe(true);
    }
  });
});

describe("MANILA_RADIUS — one corner-radius SSOT for the tab OUTLINE + panel FRAME (task 2026-07-03-014)", () => {
  it("the path builders default their top-corner radius to MANILA_RADIUS (no bare literal)", () => {
    // The tab silhouette's rounded top corners come from the SSOT, not a
    // duplicated `?? 10`. Omitting R must render the SAME arc as passing
    // MANILA_RADIUS explicitly — otherwise the tab outline could drift from the
    // frame's --library-manila-radius.
    const tabW = 140;
    expect(buildTabFillPath({ tabW, tabH: TAB_H, S })).toBe(
      buildTabFillPath({ tabW, tabH: TAB_H, R: MANILA_RADIUS, S }),
    );
    expect(buildActiveTabStrokePath({ tabW, tabH: TAB_H, S })).toBe(
      buildActiveTabStrokePath({ tabW, tabH: TAB_H, R: MANILA_RADIUS, S }),
    );
    // And the default arc must literally carry the SSOT radius value.
    expect(buildTabFillPath({ tabW, tabH: TAB_H, S })).toContain(
      `A ${MANILA_RADIUS} ${MANILA_RADIUS} 0 0 1`,
    );
  });

  it("MANILA_RADIUS matches the CSS token --library-manila-radius in globals.css (no numeric↔CSS drift)", () => {
    // The tab OUTLINE (this SVG geometry, numeric MANILA_RADIUS) and the panel
    // FRAME (CSS `border-radius: var(--library-manila-radius)` on the body,
    // NavPod, and the list/project headers) are two independent corner
    // geometries that must tangent at the join. Binding them to ONE value is
    // the deep fix for the "tab outline overruns the pod corner" overshoot
    // class — this guard fails the build if the two representations diverge.
    const globals = readFileSync(path.join(ROOT, "src/app/globals.css"), "utf8");
    const m = globals.match(/--library-manila-radius:\s*(\d+(?:\.\d+)?)px\s*;/);
    expect(m, "--library-manila-radius must be defined in globals.css").not.toBeNull();
    expect(Number(m![1])).toBe(MANILA_RADIUS);
  });
});

describe("task 2026-07-05-047 — body-frame corner tucks under the tab swoop foot (no wing)", () => {
  it("frameTopCornerStartX === firstTabSwoopFootX — the no-wing geometric invariant", () => {
    // The body frame is laid out inset by STRIP_SIDE_PAD and its outline path is
    // stroked with the same half-pixel STROKE_INSET as the tab silhouette, so
    // its rounded TOP corner BEGINS exactly at the first tab's left swoop foot —
    // never in the bare gutter beside the tabs (the "wing" e63ee738 squared the
    // corners to hide). Binding both to the one STRIP_SIDE_PAD SSOT is what makes
    // "no wing" a durable invariant instead of an owed pixel-eyeball.
    expect(frameTopCornerStartX()).toBe(firstTabSwoopFootX());
    expect(frameTopCornerStartX()).toBe(STRIP_SIDE_PAD + STROKE_INSET);
  });

  it("the strip padding AND the body-frame inset both consume the STRIP_SIDE_PAD SSOT (can't drift)", () => {
    // If either side re-hardcodes the inset, the frame corner drifts off the
    // swoop foot and the wing returns. Guard that both sources read the symbol.
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
  });

  it("buildFramePath is a closed rounded rect with all four corners at MANILA_RADIUS (tangent to the tab arcs)", () => {
    const d = buildFramePath({ w: 320, h: 480 });
    expect(d).toContain("Z"); // closed page silhouette
    // Exactly four corner arcs, each at the SSOT radius — so the frame arc and
    // the tab-outline arc are provably one curvature, never a hairline overshoot.
    const arcs = d.match(
      new RegExp(`A ${MANILA_RADIUS} ${MANILA_RADIUS} 0 0 1`, "g"),
    );
    expect(arcs).toHaveLength(4);
    // The path's leftmost/topmost ink sits at the half-pixel STROKE_INSET, so in
    // panel space (body inset by STRIP_SIDE_PAD) the corner lands on the swoop
    // foot: STROKE_INSET + STRIP_SIDE_PAD === firstTabSwoopFootX().
    expect(d.startsWith(`M ${STROKE_INSET + MANILA_RADIUS} ${STROKE_INSET}`)).toBe(
      true,
    );
  });

  it("tuckLeft slides the left side in by R with a FULL-radius swoop (task 053) — same foot shape as untucked, repositioned", () => {
    const S = 12;
    const R = 10;
    const untucked = buildTabFillPath({ tabW: 116, tabH: TAB_H, R, S });
    const tucked = buildTabFillPath({ tabW: 116, tabH: TAB_H, R, S, tuckLeft: true });
    // Untucked: the left foot flares to the tab-box edge (x=0) with the full
    // swoop radius S up to the vertical side at x=S.
    expect(untucked).toContain(`H 0 A ${S} ${S} 0 0 0 ${S} ${TAB_H - S}`);
    // Tucked: foot at x=R (the body corner's top), the SAME full radius S up to
    // a vertical side shifted right by R (x=S+R) — the foot is the same shape as
    // the right foot, just moved onto the corner, NOT a shrunken hook.
    expect(tucked).toContain(`H ${R} A ${S} ${S} 0 0 0 ${S + R} ${TAB_H - S}`);
    // The whole left side slides in by R: the top-left corner + top-edge start.
    expect(tucked.startsWith(`M ${S + 2 * R} 0`)).toBe(true);
    expect(tucked).toContain(`A ${R} ${R} 0 0 1 ${S + 2 * R} 0`);
    // The RIGHT foot is untouched when only tuckLeft is set (interior/exposed).
    expect(tucked).toContain(`A ${S} ${S} 0 0 0 ${2 * S + 116} ${TAB_H}`);
  });

  it("tuckRight mirrors the slide onto the right side; both sides slide in with full radius", () => {
    const S = 12;
    const R = 10;
    const both = buildTabFillPath({ tabW: 80, tabH: TAB_H, R, S, tuckLeft: true, tuckRight: true });
    // Right foot pulled in to (2S+tabW) − R, still full radius S.
    expect(both).toContain(`A ${S} ${S} 0 0 0 ${2 * S + 80 - R} ${TAB_H}`);
    // Left foot pulled in to x=R, full radius S.
    expect(both).toContain(`H ${R} A ${S} ${S} 0 0 0 ${S + R} ${TAB_H - S}`);
  });

  it("the active stroke path slides the same way (task 053) so the visible outline matches the fill", () => {
    const S = 12;
    const R = 10;
    const stroke = buildActiveTabStrokePath({ tabW: 116, tabH: TAB_H, R, S, tuckLeft: true });
    // Left swoop of the OPEN active stroke ends at the tucked foot (x=R) with the
    // full radius S — identical flare to an untucked foot.
    expect(stroke.trimEnd().endsWith(`A ${S} ${S} 0 0 1 ${R} ${TAB_H}`)).toBe(true);
  });

  it("clamps the radius on a degenerate (tiny) measured box so the path never self-crosses", () => {
    // A 0-height first paint or a very narrow panel must still yield a valid,
    // non-self-intersecting closed path (2*R would otherwise exceed the box).
    const d = buildFramePath({ w: 6, h: 6 });
    expect(d).toContain("Z");
    expect(d).not.toContain("NaN");
    // radius clamped to (6 − 2*0.5)/2 = 2.5.
    expect(d).toContain("A 2.5 2.5");
  });
});

// Recursively collect library/ source files (excluding tests) whose contents
// include `needle`. Used to enforce that no library-surface chrome consumes the
// top-bar token after the task-048 re-pairing.
function libFilesContaining(needle: string): string[] {
  const libDir = path.join(ROOT, "library");
  const entries = readdirSync(libDir, { recursive: true }) as string[];
  const hits: string[] = [];
  for (const entry of entries) {
    const rel = String(entry);
    if (rel.includes("__tests__")) continue; // tests reference the token in prose
    if (!/\.(tsx?|css)$/.test(rel)) continue; // skips directories + non-source
    const content = readFileSync(path.join(libDir, rel), "utf8");
    if (content.includes(needle)) hits.push(rel);
  }
  return hits;
}

describe("library edge token — --library-edge re-pairing (task 2026-07-05-048)", () => {
  it("--library-edge is defined in globals.css and DERIVED from --library-bg (can't drift to a warm-on-cool clash)", () => {
    const globals = readFileSync(path.join(ROOT, "src/app/globals.css"), "utf8");
    const m = globals.match(/--library-edge:\s*([^;]+);/);
    expect(m, "--library-edge must be defined in globals.css").not.toBeNull();
    // The deep fix: --library-edge's VALUE references var(--library-bg), so it
    // is a function of the library surface — it tracks whichever --library-bg is
    // live (the descriptive #eae7e2 or the promoted cool #ddeaee) and can never
    // re-introduce the warm-taupe-on-cool clash task 048 removed. Defining it as
    // a literal color (like the retired --topbar-border pairing) would fail this.
    expect(m![1]).toContain("var(--library-bg)");
  });

  it("no library-surface chrome consumes --topbar-border (every library edge rides --library-edge)", () => {
    // The strip seam, tab stroke, body/page frame, and NavPod all used to draw
    // their edge in the top-bar token --topbar-border, which clashed over the
    // library field. Task 048 re-pointed them at --library-edge; this guard
    // fails the build if any library source re-grabs the top-bar token.
    const offenders = libFilesContaining("var(--topbar-border)");
    expect(
      offenders,
      `Library edges must derive from --library-edge, not the top-bar token ` +
        `--topbar-border (task 048). Offending file(s): ${offenders.join(", ")}`,
    ).toEqual([]);
  });
});

describe("task 2026-07-07-088 — active tab shows its FULL title; backgrounds ellipsize first", () => {
  // Model the active tab's content overlay: it is width-CLAMPED to the assigned
  // body width with overflow:hidden, and the ONE flexible child (the title span)
  // shrinks to fit, so the OVERLAY's own scrollWidth latches at the clamp. These
  // constants stand in for a concrete layout: fixed chrome (pin/icon/close +
  // padding + gaps) consumes CHROME px; the title's un-clipped text is TITLE px.
  const CHROME = 60;
  const TITLE = 180;
  // The true natural content width the flex preferred size must request.
  const INTRINSIC = CHROME + TITLE;

  it("recovers the SAME intrinsic width at ANY compression level (the clamp cancels — no latch)", () => {
    // At any clamped overlay width `w`, the title span shrinks to (w − CHROME)
    // and clips; its scrollWidth stays the full TITLE. The recovery formula must
    // return INTRINSIC regardless of w — this width-independence is exactly what
    // breaks the old self-referential latch (naturalTabW ≈ current tabW).
    for (const overlayClientWidth of [116, 150, 200, INTRINSIC, 300]) {
      const titleClientWidth = Math.max(0, overlayClientWidth - CHROME);
      const natural = recoverNaturalContentWidth({
        overlayClientWidth,
        titleClientWidth,
        titleScrollWidth: TITLE,
      });
      expect(natural).toBe(INTRINSIC);
    }
  });

  it("un-latches a floored measurement: floor-width overlay still recovers the full title width", () => {
    // The reported bug: the active tab sits at its ACTIVE_MIN_CONTENT floor and
    // renders "C…". At the floor the title is heavily clipped, but its
    // scrollWidth is still the full text — so recovery returns the full
    // INTRINSIC (> floor), letting the tab grow on the next frame.
    const titleClientWidth = Math.max(0, ACTIVE_MIN_CONTENT - CHROME);
    const natural = recoverNaturalContentWidth({
      overlayClientWidth: ACTIVE_MIN_CONTENT,
      titleClientWidth,
      titleScrollWidth: TITLE,
    });
    expect(natural).toBe(INTRINSIC);
    expect(natural).toBeGreaterThan(ACTIVE_MIN_CONTENT);
  });

  it("is a no-op when the title already fits (no deficit → natural === overlay width)", () => {
    // When there's room the span shows in full (clientWidth === scrollWidth), so
    // recovery returns the overlay width unchanged — the fixpoint is stable and
    // the tab neither grows nor shrinks spuriously.
    const overlayClientWidth = INTRINSIC;
    const natural = recoverNaturalContentWidth({
      overlayClientWidth,
      titleClientWidth: TITLE,
      titleScrollWidth: TITLE,
    });
    expect(natural).toBe(overlayClientWidth);
  });

  it("the OLD overlay-scrollWidth read would have latched (regression contrast)", () => {
    // Documents WHY the fix is needed: a clamped overlay with a shrunk child has
    // no overflow, so overlay.scrollWidth === its clamped width — feeding that
    // back pins naturalTabW to the current width and the tab can never grow.
    const clampedOverlayScrollWidth = ACTIVE_MIN_CONTENT; // latched, not INTRINSIC
    expect(clampedOverlayScrollWidth).toBeLessThan(INTRINSIC);
  });

  it("SECONDARY — the active tab resists shrink (flex 0 0 auto); backgrounds yield first (flex 1 1 auto)", () => {
    // Flex shrink is distributed ∝ (shrink × basis), so with EQUAL shrink the
    // larger-basis active tab absorbed MORE of the squeeze and starved first —
    // the inversion of intent. The active tab must be flex-shrink:0 so it holds
    // its full title while backgrounds (shrink 1) ellipsize to their floor; past
    // the floor the F#15 scroll effect keeps the active visible.
    const folder = readFileSync(
      path.join(ROOT, "library/components/panel-tabs/PanelFolderTab.tsx"),
      "utf8",
    );
    const strip = readFileSync(
      path.join(ROOT, "library/components/panel-tabs/PanelTabStrip.tsx"),
      "utf8",
    );
    expect(folder).toContain('flex: "0 0 auto"'); // active resists
    expect(strip).toContain('flex: "1 1 auto"'); // backgrounds yield
  });

  it("the active title span is tagged for the un-clipped intrinsic-width read (data-tab-title)", () => {
    // The measurement in PanelFolderTab reads the intrinsic width off the ONE
    // flexible child via [data-tab-title]; the strip must tag the active span,
    // and the component must query the same attribute — bind both ends so they
    // can't drift.
    const folder = readFileSync(
      path.join(ROOT, "library/components/panel-tabs/PanelFolderTab.tsx"),
      "utf8",
    );
    const strip = readFileSync(
      path.join(ROOT, "library/components/panel-tabs/PanelTabStrip.tsx"),
      "utf8",
    );
    expect(strip).toContain("data-tab-title");
    expect(folder).toContain("data-tab-title");
  });
});
