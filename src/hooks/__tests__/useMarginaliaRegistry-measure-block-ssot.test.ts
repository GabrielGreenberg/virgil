// @vitest-environment jsdom
//
// Measurement-contract for `measureBlock` (task 2026-07-03-012 — unify
// marginalia measurement onto the grab-handle geometry SSOT).
//
// The bug this locks: note marginalia placed ABOVE their target and jumped up
// on a settle re-measure; on divider-on headings they read the wrapper's
// divider margin, and h4–h6 fell through the heading branch entirely. Root
// cause: `measureBlock` forked between `coordsAtPos(pos+1)` (a caret/line top)
// and `getBoundingClientRect().top` (a wrapper border-box top), with a heading
// descent that only matched `h1,h2,h3`. A DOM branch flip between two RAFs
// changed the reference point → the marker jumped.
//
// The fix routes the prose anchor through the SAME SSOT the grab handles use:
// `resolveInlineContextElement` (descends the wrapper to the first-line text
// element, h1–h6 included) + the OPTICAL cap-band center
// (`firstLineRect.top + capTopOffset + capHeight/2`, `block-frame.ts`
// `opticalCenterY`). The grid centers a row-0 icon at `top + lineHeight/2`, so
// storing `top = optical − lineHeight/2` lands the marker on the optical middle
// of the text — pixel-aligned with the grab handle, and branch-independent.
//
// The TEETH here:
//   1. A heading (incl. h4/h6) anchors to the HEADING TEXT, never the wrapper's
//      (divider-carrying) top or the old `coordsAtPos` sentinel.
//   2. The anchor is the resolved element's optical center (uses capTopOffset +
//      capHeight), not its raw border-box top.
//   3. The same logical line measured via a bare element vs a wrapper resolves
//      to the SAME marker center (the anti-jump / branch-independence property).
//
// The storage stub guards the extension-barrel/@/lib/storage import gotcha that
// the sibling registry tests document.
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/storage", () => {
  const STORAGE_FNS = [
    "readSidecar", "readSidecarIfExists", "writeSidecar", "readTex", "writeTex",
    "readDocBundle", "writeDocBundle", "readBib", "writeBib",
    "createDocFromPicker", "createDocInFolder", "pickProjectFolder",
    "registerDocInFolder", "openExistingDocFromPicker", "listDocs", "renameDoc",
    "deleteDocFromIndex", "flushDoc", "drainDoc", "detectBibPackage",
    "readPaperFolder", "getTexFilename", "writePdf", "readPdf", "getPdfFilename",
    "pdfFilenameFromTex", "readFigureSource", "readFigureRaster",
    "writeFigureRaster", "deleteFigureRaster", "readFigureIndex",
    "writeFigureIndex", "getDocWriteHandle", "importFigureFile",
  ];
  const mod: Record<string, unknown> = { isDevStorage: false };
  for (const name of STORAGE_FNS) mod[name] = vi.fn();
  return mod;
});

// Keep `resolveInlineContextElement` REAL (it's the SSOT descent under test),
// but make the font-metric readers deterministic — jsdom has no canvas, so the
// real helpers return 0; the mock lets us assert the optical-center math with
// non-zero offsets in one test.
const capTopOffsetMock = vi.fn<(el: HTMLElement) => number>(() => 0);
const capHeightMock = vi.fn<(el: HTMLElement) => number>(() => 0);
vi.mock("@/lib/text-metrics", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/text-metrics")>();
  return {
    ...actual,
    capTopOffset: (el: HTMLElement) => capTopOffsetMock(el),
    capHeight: (el: HTMLElement) => capHeightMock(el),
  };
});

import { measureBlock } from "@/hooks/useMarginaliaRegistry";
import type { Editor } from "@tiptap/react";

const HOST_RECT = { top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 } as DOMRect;

/** Stub an element's border box with an explicit top/height. */
function withRect<T extends HTMLElement>(el: T, top: number, height: number): T {
  el.getBoundingClientRect = () =>
    ({
      top,
      left: 0,
      right: 100,
      bottom: top + height,
      width: 100,
      height,
      x: 0,
      y: top,
      toJSON() {},
    }) as DOMRect;
  return el;
}

/** A fake editor whose `nodeDOM` returns `dom` and whose `coordsAtPos` returns
 *  a sentinel top — any result equal to it proves the removed caret branch is
 *  still live (RED). */
const COORDS_SENTINEL = 9999;
function fakeEditor(dom: HTMLElement): Editor {
  return {
    view: {
      nodeDOM: () => dom,
      coordsAtPos: () => ({ top: COORDS_SENTINEL, bottom: COORDS_SENTINEL, left: 0, right: 0 }),
    },
  } as unknown as Editor;
}

/** Marker center the grid renders for row 0 = `top + lineHeight/2`. */
function markerCenter(m: { top: number; lineHeight: number }): number {
  return m.top + m.lineHeight / 2;
}

beforeEach(() => {
  capTopOffsetMock.mockReset();
  capHeightMock.mockReset();
  capTopOffsetMock.mockReturnValue(0);
  capHeightMock.mockReturnValue(0);
});

describe("measureBlock — grab-handle geometry SSOT", () => {
  it("h4 in a divider-carrying heading-wrapper anchors to the HEADING TEXT, not the wrapper top or coordsAtPos", () => {
    // Wrapper sits high (divider margin above the text); the h4 is lower.
    const wrapper = withRect(document.createElement("div"), 200, 90);
    wrapper.className = "heading-wrapper";
    const h4 = withRect(document.createElement("h4"), 240, 30);
    h4.style.lineHeight = "30px";
    h4.style.fontSize = "20px";
    wrapper.appendChild(h4);
    document.body.appendChild(wrapper);

    const m = measureBlock(fakeEditor(wrapper), 1, false, HOST_RECT, "id")!;
    expect(m).not.toBeNull();
    // capTopOffset/capHeight are 0 here → optical center == h4's line-box top.
    expect(markerCenter(m)).toBeCloseTo(240, 3);
    // NOT the wrapper's top (200, the divider chrome) and NOT the caret sentinel.
    expect(markerCenter(m)).not.toBeCloseTo(200, 1);
    expect(m.top).not.toBeCloseTo(COORDS_SENTINEL, 1);

    document.body.removeChild(wrapper);
  });

  it("h6 also resolves through the heading descent (the old h1,h2,h3-only branch missed it)", () => {
    const wrapper = withRect(document.createElement("div"), 100, 60);
    wrapper.className = "heading-wrapper";
    const h6 = withRect(document.createElement("h6"), 120, 22);
    h6.style.lineHeight = "22px";
    wrapper.appendChild(h6);
    document.body.appendChild(wrapper);

    const m = measureBlock(fakeEditor(wrapper), 1, false, HOST_RECT, "id")!;
    expect(markerCenter(m)).toBeCloseTo(120, 3); // the h6's top, not the wrapper's
    expect(m.top).not.toBeCloseTo(COORDS_SENTINEL, 1);

    document.body.removeChild(wrapper);
  });

  it("anchors on the OPTICAL cap-band center (capTopOffset + capHeight/2), not the raw border-box top", () => {
    capTopOffsetMock.mockReturnValue(6);
    capHeightMock.mockReturnValue(10);
    const p = withRect(document.createElement("p"), 300, 48);
    p.style.lineHeight = "24px";
    document.body.appendChild(p);

    const m = measureBlock(fakeEditor(p), 1, false, HOST_RECT, "id")!;
    // optical = 300 + 6 + 10/2 = 311 → marker center sits on the cap band,
    // 11px below the line-box top, exactly where the grab handle sits.
    expect(markerCenter(m)).toBeCloseTo(311, 3);
    expect(capTopOffsetMock).toHaveBeenCalled();
    expect(capHeightMock).toHaveBeenCalled();

    document.body.removeChild(p);
  });

  it("a plain paragraph reads its OWN rect, never the coordsAtPos caret branch", () => {
    const p = withRect(document.createElement("p"), 150, 24);
    p.style.lineHeight = "24px";
    document.body.appendChild(p);

    const m = measureBlock(fakeEditor(p), 1, false, HOST_RECT, "id")!;
    expect(markerCenter(m)).toBeCloseTo(150, 3);
    expect(m.top).not.toBeCloseTo(COORDS_SENTINEL, 1);

    document.body.removeChild(p);
  });

  it("is branch-independent: the same line measured bare vs wrapped resolves to the SAME marker center (anti-jump)", () => {
    capTopOffsetMock.mockReturnValue(4);
    capHeightMock.mockReturnValue(12);

    // Shape A — nodeDOM returns the bare <h2>.
    const bare = withRect(document.createElement("h2"), 500, 40);
    bare.style.lineHeight = "40px";
    document.body.appendChild(bare);
    const a = measureBlock(fakeEditor(bare), 1, false, HOST_RECT, "id")!;

    // Shape B — nodeDOM returns a wrapper whose inner <h2> occupies the SAME line.
    const wrapper = withRect(document.createElement("div"), 470, 70);
    wrapper.className = "heading-wrapper";
    const h2 = withRect(document.createElement("h2"), 500, 40);
    h2.style.lineHeight = "40px";
    wrapper.appendChild(h2);
    document.body.appendChild(wrapper);
    const b = measureBlock(fakeEditor(wrapper), 1, false, HOST_RECT, "id")!;

    // Pre-fix, shape A took the coordsAtPos branch and shape B the wrapper
    // border-box branch → different tops → the settle jump. Now both resolve
    // the h2's optical center: identical.
    expect(markerCenter(a)).toBeCloseTo(markerCenter(b), 3);
    expect(markerCenter(a)).toBeCloseTo(510, 3); // 500 + 4 + 12/2

    document.body.removeChild(bare);
    document.body.removeChild(wrapper);
  });

  it("an atom anchors on its border-box top with a single full-height line (unchanged)", () => {
    const atom = withRect(document.createElement("div"), 80, 44);
    document.body.appendChild(atom);

    const m = measureBlock(fakeEditor(atom), 1, true, HOST_RECT, "id")!;
    expect(m.top).toBeCloseTo(80, 3);
    expect(m.lineHeight).toBeCloseTo(44, 3);
    expect(m.lineCount).toBe(1);
    expect(m.isAtom).toBe(true);

    document.body.removeChild(atom);
  });

  it("a [data-glyph-anchor] override keeps its declared visual top (expex `(n)` / titled pod)", () => {
    // Non-atom container whose own top is high, but a glyph-anchor child
    // declares the visual anchor lower.
    const wrapper = withRect(document.createElement("div"), 10, 120);
    const number = withRect(document.createElement("span"), 34, 20);
    number.setAttribute("data-glyph-anchor", "");
    number.style.lineHeight = "20px";
    wrapper.appendChild(number);
    document.body.appendChild(wrapper);

    const m = measureBlock(fakeEditor(wrapper), 1, false, HOST_RECT, "id")!;
    // Override branch: marker centers on the override's own line box (top 34),
    // NOT the optical-center math and NOT the wrapper top (10).
    expect(m.top).toBeCloseTo(34, 3);
    expect(m.top).not.toBeCloseTo(10, 1);

    document.body.removeChild(wrapper);
  });
});
