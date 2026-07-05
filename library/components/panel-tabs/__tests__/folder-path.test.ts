import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  ACTIVE_MIN_CONTENT,
  MANILA_RADIUS,
  STROKE_INSET,
  buildActiveTabStrokePath,
  buildTabFillPath,
  deriveTabWidthFromWrapper,
  tabSvgGeometry,
} from "../folder-path";

// Geometry constants mirrored from PanelFolderTab.tsx (the SSOT home). The
// path builders are pure and parameterised, so the tests pin the same numbers.
const S = 12;
const TAB_H = 32;

// Repo root, up 4 from library/components/panel-tabs/__tests__.
const ROOT = path.resolve(__dirname, "..", "..", "..", "..");

describe("F#8 — clipped-stroke SVG gutter geometry", () => {
  it("adds a 1px HORIZONTAL gutter mirroring the vertical svgH = TAB_H + 1 precedent", () => {
    const tabW = 120;
    const { svgW, svgH } = tabSvgGeometry({ tabW, tabH: TAB_H, S });
    // Vertical gutter (pre-existing): height is tabH + 1 so the bottom stroke
    // fits inside overflow:hidden.
    expect(svgH).toBe(TAB_H + 1);
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
