import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Contracts for the LAYOUT-DRIVEN folder-tab chrome (successor of
 * folder-path.test.ts, whose ~40 path-math assertions pinned the deleted
 * measured-SVG mechanism). The geometry/ink contracts now live in
 * src/components/chrome/__tests__/folder-tab-geometry.test.ts against the
 * SSOT; THIS file pins the library-side wiring:
 *   - both strips share the ONE chrome module (no forked geometry),
 *   - the chrome constructs no measurement machinery,
 *   - the body is an unframed sheet on the manila-radius token,
 *   - no --topbar-border in library sources.
 */

// Repo root, up 4 from library/components/panel-tabs/__tests__.
const ROOT = path.resolve(__dirname, "..", "..", "..", "..");

const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");

describe("one shared folder-tab implementation (the forks are dead)", () => {
  it("both folder-path forks are deleted", () => {
    expect(
      existsSync(path.join(ROOT, "library/components/panel-tabs/folder-path.ts")),
    ).toBe(false);
    expect(
      existsSync(path.join(ROOT, "src/components/editor-layout/folder-path.ts")),
    ).toBe(false);
  });

  it("the inner tab wrapper renders the shared FolderTabChrome + geometry SSOT", () => {
    const inner = read("library/components/panel-tabs/PanelFolderTab.tsx");
    expect(inner).toContain('from "@/components/chrome/FolderTabChrome"');
    expect(inner).toContain('from "@/components/chrome/folder-tab-geometry"');
    expect(inner).toContain("<FolderTabChrome");
    expect(inner).toContain('variant="library"');
  });

  it("both wrappers round their layout-owned width UP to a whole CSS px (calc-size) — fractional max-content widths would put the right cap's baked half-pixel stroke off device-pixel phase", () => {
    // The retired forks guaranteed integer tab widths (Math.ceil of a
    // measurement); the layout-driven successors reproduce that with
    // calc-size(max-content, round(up, size, 1px)) — Chromium 129+, and
    // Virgil is Chromium-only (FSA). Dropping this softens the active tab's
    // right edge to two ~50%-alpha columns at DPR 1 whenever the label's
    // text metrics land on a fraction.
    const inner = read("library/components/panel-tabs/PanelFolderTab.tsx");
    const outer = read("src/components/editor-layout/ActiveBarTab.tsx");
    for (const src of [inner, outer]) {
      expect(src).toContain(
        'width: "calc-size(max-content, round(up, size, 1px))"',
      );
    }
  });

  it("the chrome is measurement-free: no ResizeObserver / getBoundingClientRect anywhere in the tab-chrome sources", () => {
    for (const rel of [
      "library/components/panel-tabs/PanelFolderTab.tsx",
      "src/components/editor-layout/ActiveBarTab.tsx",
      "src/components/chrome/FolderTabChrome.tsx",
      "src/components/chrome/folder-tab-geometry.ts",
    ]) {
      // Match the CALL forms (comments may name the retired mechanism).
      const src = read(rel);
      expect(src, `${rel} must not measure`).not.toContain(
        "new ResizeObserver",
      );
      expect(src, `${rel} must not measure`).not.toContain(
        ".getBoundingClientRect()",
      );
    }
  });
});

describe("body — an unframed sheet on the manila-radius token (measured SVG frame deleted)", () => {
  const body = read("library/components/TabbedLibraryPanel.tsx");

  it("the sheet has depth instead of an outline, on var(--library-manila-radius)", () => {
    expect(body).not.toMatch(/border: "1px solid/);
    expect(body).toContain('boxShadow: "var(--card-shadow-ambient)"');
    expect(body).toContain("var(--library-manila-radius)");
  });

  it("the frame RO + park/reconcile protocol is gone", () => {
    expect(body).not.toContain("new ResizeObserver");
    expect(body).not.toContain("frameBox");
    expect(body).not.toContain("buildFramePath");
    expect(body).not.toContain("isLayoutGestureActive");
  });

  it("the body inset still reads the STRIP_SIDE_PAD SSOT (no-wing relationship intact)", () => {
    expect(body).toContain("STRIP_SIDE_PAD");
  });
});

describe("strip wiring — ink cushion + seam by construction", () => {
  const strip = read("library/components/panel-tabs/PanelTabStrip.tsx");

  it("the strip reserves real top headroom (STRIP_TOP_HEADROOM) and keeps the 1px seam padding/margin pair", () => {
    expect(strip).toContain("STRIP_TOP_HEADROOM");
    expect(strip).toContain("${STRIP_SIDE_PAD}px 1px");
    expect(strip).toContain("marginBottom: -1");
  });

  it("the active tab overlaps the body border by exactly the seam constant", () => {
    const folder = read("library/components/panel-tabs/PanelFolderTab.tsx");
    expect(folder).toContain("marginBottom: -FOLDER_TAB_SEAM_OVERLAP");
  });

  it("F#15 flex contract survives: active resists (0 0 auto), backgrounds yield (1 1 auto)", () => {
    const folder = read("library/components/panel-tabs/PanelFolderTab.tsx");
    expect(folder).toContain('flex: "0 0 auto"'); // active resists
    expect(strip).toContain('flex: "1 1 auto"'); // backgrounds yield
  });

  it("the flush-right tuck observer stays parked on the pane-drag bus (the ONE justified RO)", () => {
    // The single surviving ResizeObserver in the tab chrome's orbit: the
    // flush-right tuck depends on sibling-width sums CSS can't express. It
    // must stay equality-bailed + parked — via the shared parkDuringLayoutGesture
    // helper (the doctrine forbids hand-rolled isLayoutGestureActive() parks).
    expect(strip).toContain("ResizeObserver");
    expect(strip).toContain("parkDuringLayoutGesture");
    expect(strip).not.toContain("isLayoutGestureActive");
  });
});

/**
 * THE SEAM ROW HAS ONE PAINTER (task 2026-08-09-324).
 *
 * The strip deliberately overlaps the sheet's top row (`marginBottom: -1` + a 1px bottom
 * padding) so its ACTIVE-TAB CHILD can cover the row under the tab's own
 * footprint — which means the strip is a CLIP/POSITIONING box, never a PAINT
 * box: CSS backgrounds fill the padding box, so an opaque field on the strip
 * erases the border across the FULL panel width (under the inactive tabs, in
 * the inter-tab gaps, along the tail, and through the swoop-foot valleys that
 * `bridgeSpan: "body"` leaves unbridged precisely so the border can show
 * there). That is what shipped from task 048 until 324: the outline looked
 * "spotty" because the only surviving ink was what paints INSIDE the strip
 * above its own background — the active tab's three-piece chrome.
 *
 * Why the existing legs above could not catch it: they assert the border
 * STRING exists in source ("the page outline is a 1px --library-edge
 * border"), which stayed true for a year in which that border never painted a
 * single pixel of its top edge. A string is not a render.
 *
 * The generalized invariant, stated so a re-introduction ANYWHERE in the tab
 * chrome fails rather than only the one line 324 deleted: an element that
 * carries a NEGATIVE bottom margin (i.e. it deliberately overlaps a
 * page-edge row) must not declare an opaque background. Both of today's
 * seam-overlapping boxes satisfy it — the strip (transparent) and the active
 * tab's wrapper (no background at all; its FolderTabChrome children do the
 * painting, and their footprint IS the tab).
 */
const TAB_CHROME_FAMILY = [
  "library/components/panel-tabs/PanelTabStrip.tsx",
  "library/components/panel-tabs/PanelFolderTab.tsx",
  "library/components/TabbedLibraryPanel.tsx",
  "src/components/chrome/FolderTabChrome.tsx",
] as const;

/** Every `style={{ … }}` JSX prop in `src`, as brace-balanced source blocks.
 *  BLOCK-scoped on purpose: a line-scoped grep cannot tell which element a
 *  `background:` belongs to, and "which element declares it" is the whole
 *  question here. */
function styleBlocks(src: string): string[] {
  const blocks: string[] = [];
  const OPEN = "style={{";
  let from = 0;
  for (;;) {
    const start = src.indexOf(OPEN, from);
    if (start === -1) break;
    let depth = 0;
    let i = start + OPEN.length - 2; // at the first '{' of the object literal
    for (; i < src.length; i++) {
      if (src[i] === "{") depth++;
      else if (src[i] === "}") {
        depth--;
        if (depth === 0) break;
      }
    }
    blocks.push(src.slice(start, i + 1));
    from = i + 1;
  }
  return blocks;
}

/** A background declaration that would PAINT (anything but transparent/none).
 *  `backgroundColor` and the shorthand both count; a conditional expression
 *  counts too, since one of its branches paints. Comments are stripped first —
 *  these blocks carry long prose ABOUT backgrounds, and a census that reads
 *  its own explanation as an offender teaches people to delete the
 *  explanation. */
function opaqueBackgroundDecls(block: string): string[] {
  const code = block
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^[ \t]*\/\/.*$/gm, "");
  const hits: string[] = [];
  const re = /\bbackground(?:Color)?:\s*([^\n]*)/g;
  for (const m of code.matchAll(re)) {
    const value = m[1].trim().replace(/,$/, "");
    if (/^"(transparent|none)"$/.test(value)) continue;
    hits.push(m[0].trim());
  }
  return hits;
}

describe("the seam row has ONE painter — the body's top border (task 324)", () => {
  const strip = read("library/components/panel-tabs/PanelTabStrip.tsx");

  it("the strip states its NON-ownership explicitly (background transparent), not by omission", () => {
    // Affirmative, because the next person's instinct on a seam problem is to
    // give the strip a field again. An omitted property says nothing; this
    // says "the row below is not mine to paint" and carries the comment.
    expect(strip).toContain('background: "transparent"');
    expect(
      strip,
      "the strip must not paint the library field — its parent already does, " +
        "and here it erases the body's top border row (task 324)",
    ).not.toContain('background: "var(--library-bg)"');
  });

  it("no seam-overlapping element in the tab-chrome family declares an opaque background", () => {
    const offenders: string[] = [];
    let seamBlocks = 0;
    for (const rel of TAB_CHROME_FAMILY) {
      for (const block of styleBlocks(read(rel))) {
        if (!/\bmarginBottom:\s*-/.test(block)) continue; // not a seam overlap
        seamBlocks++;
        for (const decl of opaqueBackgroundDecls(block)) {
          offenders.push(`${rel}: ${decl}`);
        }
      }
    }
    // Non-vacuity floor: the strip and the active tab's wrapper. Without it a
    // rename of `marginBottom` (or a move to a stylesheet) would empty the
    // loop and report green — the shape this whole describe exists to catch.
    expect(
      seamBlocks,
      "expected to find the seam-overlapping boxes (strip + active tab wrapper)",
    ).toBeGreaterThanOrEqual(2);
    expect(
      offenders,
      `An element that overlaps the body's border row so a CHILD can paint it ` +
        `must paint nothing itself — backgrounds fill the padding box, so this ` +
        `erases the page outline across the whole panel width (task 324). ` +
        `Offender(s): ${offenders.join(" | ")}`,
    ).toEqual([]);
  });

  it("the retired strip-wide inset baseline shadow stays dead (one painter, not two)", () => {
    // Task 048 deleted `boxShadow: inset 0 -1px 0 var(--topbar-border)`, the
    // only thing that had ever painted a continuous baseline — and being an
    // INSET shadow it painted above the strip's own background, which is why
    // the baseline looked continuous before 048 and had no owner after. The
    // tempting fix is to re-add it re-toned; that is rejected on purpose: it makes TWO painters own the same device row
    // (shadow + body border), coinciding only at integer layout positions —
    // the sub-pixel double-line class task 050 spent a cycle killing.
    expect(strip).not.toMatch(/boxShadow:\s*["`]inset 0 -1px/);
  });

  it("the bridge stays off the foot valleys — the unbridged valleys now really do show the border", () => {
    // folder-tab-geometry leaves the swoop-foot valleys unbridged ON THE
    // ASSUMPTION the body border shows through them (task 053's tuck
    // illusion). That assumption was false while the strip painted over the
    // row; 324 makes it true. Bridging them would paper over the valleys with
    // tab fill instead of letting the page outline run.
    const geometry = read("src/components/chrome/folder-tab-geometry.ts");
    expect(geometry).toMatch(/bridgeX: S,\n\s*bridgeW: CAP_W - S,/);
  });
});

// Recursively collect library-surface source files (excluding tests) whose
// contents include `needle`. Used to enforce that no library-surface chrome
// consumes the top-bar token after the task-048 re-pairing. Walks BOTH homes
// of the library surface: the library/ subsystem AND src/components/library
// (the Virgil-side pods injected into it — MyPapersPod & co). The old guard
// scoped to library/ only, which is how MyPapersPod's --topbar-border
// escaped it (plan §P2: this extension closes that hole).
const LIBRARY_SURFACE_ROOTS = ["library", "src/components/library"];

function libFilesContaining(needle: string): string[] {
  const hits: string[] = [];
  for (const root of LIBRARY_SURFACE_ROOTS) {
    const dir = path.join(ROOT, root);
    const entries = readdirSync(dir, { recursive: true }) as string[];
    for (const entry of entries) {
      const rel = String(entry);
      if (rel.includes("__tests__")) continue; // tests reference the token in prose
      if (!/\.(tsx?|css)$/.test(rel)) continue; // skips directories + non-source
      const content = readFileSync(path.join(dir, rel), "utf8");
      if (content.includes(needle)) hits.push(`${root}/${rel}`);
    }
  }
  return hits;
}

describe("library edges (task 2026-07-05-048)", () => {
  it("no library-surface chrome consumes --topbar-border", () => {
    // The strip seam, tab stroke, body/page border, and NavPod all used to draw
    // their edge in the top-bar token --topbar-border. The Library's surfaces
    // are unframed now; this guard fails the build if any library source
    // re-grabs the top-bar token.
    const offenders = libFilesContaining("var(--topbar-border)");
    expect(
      offenders,
      `Library surfaces take no top-bar edge (task 048). ` +
        `Offending file(s): ${offenders.join(", ")}`,
    ).toEqual([]);
  });
});
