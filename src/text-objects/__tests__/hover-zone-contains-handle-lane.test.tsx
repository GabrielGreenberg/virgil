// @vitest-environment jsdom
//
// Task 526 — the HOVER ZONE contains the HANDLE LANE, at every configuration.
//
// Two things in the left margin answer one question — how far left does a grab
// handle reach? — and before this task they answered it from different tables.
// The handle's extent is EM-SCALED per block (`markerLeft − 0.625em − 12`, plus
// a `1.8 × --editor-font-size` hit/hover halo centred on the box); the zone
// that KEEPS THAT HANDLE ALIVE was a fixed `contentLeft − 22 − 8` px constant,
// whose own docstring named the premise that expired ("the handle (~10px wide)
// sits comfortably inside"). Leaving the zone nulls `mousePosRef` and the
// resolver returns `EMPTY_RESOLVED`, so the handle VANISHES as the user reaches
// for it — at the shipped defaults for every `\section` heading, and one notch
// up the font-size slider for every paragraph in the document.
//
// WHY NO SUITE COULD SEE IT. Every grab-handle fixture in the repo hand-stubbed
// its own untyped frame with its own `containsHoverZone`, and each chose a zone
// WIDER than production can produce (`x >= 200` against a `contentLeft` of 260
// — a 60px leftward zone where production's was 30). A handle escaping its zone
// was unrepresentable in all of them, and `viewport-frame.test.ts` never
// mentioned `hoverZone` at all. Those fixtures now build through
// `_handle-frame.ts`, which DERIVES the zone from the same `handleLaneFloor`
// production reads, so the stub can no longer mask this.
//
// WHAT THIS SUITE DRIVES. The REAL `computeViewportFrame` (so the zone is a
// measurement, not a number), the REAL `resolveHandleLane`, and the REAL
// `resolveChevronColumnRight`, swept over the font-size slider's ACTUAL range ×
// every heading level the app can render. The halo's own width is a CSS fact
// this layer cannot read, so it is modelled here and the model is pinned to
// `globals.css` by the census at the bottom — a leg that fails if the shipped
// expression moves out from under it.
//
// AND THE LEG WITH TEETH: the two resolvers were never the part that could
// misbehave — `applyHitCaps`, the ONE writer of the number the halo is actually
// drawn from, is. Nothing anywhere drove it: measured on this branch, deleting
// its outboard fold left all 666 tests in `src/text-objects` + `src/lib/
// editor-geometry` GREEN while the chevron went back under a `\part` heading's
// halo and the halo went back out of the zone. So the last describe renders the
// REAL `TextObjectGrabHandle` over a REAL heading row with a REAL measured
// frame and reads `--margin-handle-hit-cap` off the DOM — the containment is a
// claim about what SHIPS, not about what the model says should ship.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, act, cleanup } from "@testing-library/react";
import type { Editor } from "@tiptap/react";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { EditorViewportFrame } from "@/lib/editor-geometry/viewport-frame";
import { computeViewportFrame } from "@/lib/editor-geometry/viewport-frame";

// ── Mocks for the component describe ────────────────────────────────────────
// `blocksAtY` is the ONE input the hover resolve takes that jsdom cannot
// answer (it is the geometry service's own near-zone index). Everything else —
// the frame, the block frame, the lane, the cap — is real.
vi.mock("@/lib/storage", () => {
  const noop = () => undefined;
  return new Proxy(
    {},
    { get: (_t, p) => (p === "__esModule" ? true : p === "then" ? undefined : noop) },
  );
});
const blocksAtY =
  vi.fn<(y: number) => Array<{ uuid: string; el: HTMLElement }> | null>();
vi.mock("@/lib/editor-geometry", () => ({
  geomHoverEnabled: () => true,
  getGeometry: () => ({ blocksAtY }),
}));
vi.mock("@/lib/editor-geometry/use-viewport-frame", () => ({
  useViewportFrame: () => ({ frameRef: { current: liveFrame }, version: 0 }),
}));
vi.mock("@/lib/marginalia-blocks", () => ({ resolveDomForUuid: () => null }));

import { TextObjectGrabHandle } from "@/text-objects/TextObjectGrabHandle";
import { notePointerInput } from "@/lib/input-modality";
import { clearCapTopCache } from "@/lib/text-metrics";
import {
  HANDLE_WIDTH,
  resolveHandleLane,
  handleLaneFloor,
} from "@/text-objects/handle-layout";
import { resolveChevronColumnRight } from "@/text-objects/block-frame";
import { FOLD_CHEVRON_NODE_TYPES } from "@/lib/node-attr-sets";

/** The frame the mocked `useViewportFrame` hands the component — set by the
 *  component legs to the REAL `computeViewportFrame` of their own fixture. */
let liveFrame: EditorViewportFrame | null = null;

const CSS = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../../app/globals.css"),
  "utf8",
);

// ---------------------------------------------------------------------------
// The shipped geometry, read from the shipped defaults.
// ---------------------------------------------------------------------------

const ROOT_FONT_PX = 16;
/** `--editor-pl` — the editor column's own padding-left at the shipped default. */
const EDITOR_PAD_LEFT = 88;
/** `--margin-col-handle-inset`. */
const MARGIN_INSET = 22;
const EDITOR_LEFT = 300;
const EDITOR_RIGHT = 900;
const CONTENT_LEFT = EDITOR_LEFT + EDITOR_PAD_LEFT;
/** `--margin-handle-gap: 0.625em`, resolved per block. */
const HANDLE_GAP_EM = 0.625;
/** `--margin-handle-hit-pad: calc(var(--editor-font-size) * 1.8)`. */
const HIT_PAD_FACTOR = 1.8;
/** `--margin-col-chevron` / `--margin-col-chevron-width`. */
const CHEVRON_OFFSET = -44;
const CHEVRON_WIDTH = 14;

/** The font-size slider's REAL range (`preferences-tree.ts`: min .85, max 1.4,
 *  step .05) — twelve stops, of which the shipped default (0.95) is one. */
const FONT_SLIDER_REM: number[] = [];
for (let v = 0.85; v <= 1.4 + 1e-9; v += 0.05) {
  FONT_SLIDER_REM.push(Math.round(v * 100) / 100);
}

/**
 * Every block kind whose handle can reach into the margin, with the font its
 * `--margin-handle-gap` resolves against. Heading sizes are `rem` (so they do
 * NOT track the body slider — which is half of why the two tables diverged:
 * raising the slider grows the HALO while a heading's gap stays put), and h1's
 * own stepper reaches 3.0rem (`FontsDialog.tsx`), which is the widest gap the
 * app can produce.
 */
const BLOCKS: {
  label: string;
  kind: string;
  fontPx: (editorFontPx: number) => number;
}[] = [
  { label: "paragraph", kind: "paragraph", fontPx: (f) => f },
  { label: "h0 \\part (2.1rem)", kind: "heading", fontPx: () => 2.1 * ROOT_FONT_PX },
  { label: "h1 \\section (1.75rem)", kind: "heading", fontPx: () => 1.75 * ROOT_FONT_PX },
  { label: "h1 at the stepper max (3.0rem)", kind: "heading", fontPx: () => 3.0 * ROOT_FONT_PX },
  { label: "h2 (1.35rem)", kind: "heading", fontPx: () => 1.35 * ROOT_FONT_PX },
  { label: "h3 (1.15rem)", kind: "heading", fontPx: () => 1.15 * ROOT_FONT_PX },
  { label: "h4 (inherited 1rem)", kind: "heading", fontPx: () => ROOT_FONT_PX },
  { label: "h5 (1rem)", kind: "heading", fontPx: () => ROOT_FONT_PX },
  { label: "h6 (0.95rem)", kind: "heading", fontPx: () => 0.95 * ROOT_FONT_PX },
  { label: "texBlock source pod", kind: "texBlock", fontPx: (f) => f },
  { label: "forestBlock source pod", kind: "forestBlock", fontPx: (f) => f },
];

// ---------------------------------------------------------------------------
// The real frame, measured.
// ---------------------------------------------------------------------------

let editorEl: HTMLElement;
let tokenEl: HTMLElement;

function rect(left: number, right: number): DOMRect {
  return {
    top: 0, bottom: 800, left, right, width: right - left, height: 800,
    x: left, y: 0, toJSON: () => ({}),
  } as DOMRect;
}

beforeEach(() => {
  editorEl = document.createElement("div");
  editorEl.className = "ProseMirror";
  editorEl.style.paddingLeft = `${EDITOR_PAD_LEFT}px`;
  editorEl.style.paddingRight = "72px";
  editorEl.style.setProperty("--margin-col-handle-inset", `${MARGIN_INSET}px`);
  Object.defineProperty(editorEl, "offsetHeight", { value: 800, configurable: true });
  editorEl.getBoundingClientRect = () => rect(EDITOR_LEFT, EDITOR_RIGHT + 72);
  document.body.appendChild(editorEl);

  // The element the chevron-column tokens are read from — `resolveBlockFrame`
  // reads them off the block's own computed style, and both are `:root` px
  // literals that inherit.
  tokenEl = document.createElement("div");
  tokenEl.style.setProperty("--margin-col-chevron", `${CHEVRON_OFFSET}px`);
  tokenEl.style.setProperty("--margin-col-chevron-width", `${CHEVRON_WIDTH}px`);
  document.body.appendChild(tokenEl);
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
  blocksAtY.mockReset();
  clearCapTopCache();
  liveFrame = null;
});

function measuredFrame() {
  const frame = computeViewportFrame(editorEl);
  expect(frame, "computeViewportFrame refused the fixture editor").not.toBeNull();
  return frame!;
}

/**
 * The lane a handle of this kind takes on a markerless row (paragraph, heading,
 * source pod — `markerLeft === contentLeft`, no marker column occupied), driven
 * through the REAL resolvers.
 */
function laneFor(kind: string, blockFontPx: number, floorRef: number) {
  const chevronRight = resolveChevronColumnRight(
    getComputedStyle(tokenEl),
    kind,
    CONTENT_LEFT,
  );
  return {
    chevronRight,
    lane: resolveHandleLane({
      markerLeft: CONTENT_LEFT,
      gapPx: HANDLE_GAP_EM * blockFontPx,
      editorColumnLeft: floorRef,
      baselineInset: MARGIN_INSET,
      inkLeft: CONTENT_LEFT,
      columnRight: null,
      chevronRight,
    }),
  };
}

/**
 * The handle's RENDERED EXTENT — box plus hit/hover halo — modelled from the
 * shipped CSS (`.text-object-grab-handle::before`, pinned by the census below):
 * a `max(12px, min(--margin-handle-hit-pad, 2 × --margin-handle-hit-cap))` band
 * centred on the 12px box, with the cap being what `applyHitCaps` writes for a
 * lone handle — the distance from the dots' centre to the lane's outboard
 * bound.
 */
function renderedExtent(laneLeft: number, laneMinLeft: number, hitPadPx: number) {
  const centre = laneLeft + HANDLE_WIDTH / 2;
  const cap = Math.max(0, centre - laneMinLeft);
  const width = Math.max(HANDLE_WIDTH, Math.min(hitPadPx, cap * 2));
  return { left: centre - width / 2, right: centre + width / 2 };
}

/** The RETIRED rule, reimplemented locally so the defect legs fail for the
 *  reason they name rather than by re-parameterising the live one:
 *  `contentLeft − marginInset − HOVER_MARGIN_PAD`, where the pad was 8. */
function retiredHoverZoneLeft(contentLeft: number): number {
  return contentLeft - MARGIN_INSET - 8;
}

// ---------------------------------------------------------------------------

describe("the hover zone CONTAINS the handle lane", () => {
  it("its left edge IS the lane floor — one expression, not two tables", () => {
    const frame = measuredFrame();
    expect(frame.editorColumnLeft).toBe(EDITOR_LEFT);
    expect(frame.hoverZoneLeft).toBe(
      handleLaneFloor(frame.editorColumnLeft, frame.marginInset),
    );
    expect(frame.hoverZoneRight).toBe(frame.editorRight);
  });

  for (const editorFontRem of FONT_SLIDER_REM) {
    const editorFontPx = editorFontRem * ROOT_FONT_PX;
    const hitPadPx = HIT_PAD_FACTOR * editorFontPx;
    for (const block of BLOCKS) {
      it(`@${editorFontRem}rem · ${block.label}: the whole rendered handle is inside the zone`, () => {
        const frame = measuredFrame();
        const { lane } = laneFor(block.kind, block.fontPx(editorFontPx), frame.editorColumnLeft);
        const extent = renderedExtent(lane.left, lane.minLeft, hitPadPx);

        expect(
          extent.left,
          `the handle's leftmost rendered pixel (${extent.left.toFixed(2)}) is ` +
            `outside the hover zone (${frame.hoverZoneLeft.toFixed(2)}) — hovering ` +
            `it CLEARS the hover and the handle vanishes`,
        ).toBeGreaterThanOrEqual(frame.hoverZoneLeft);
        expect(extent.right).toBeLessThanOrEqual(frame.hoverZoneRight);
        // …and hovering anywhere on it answers the predicate, which is what
        // "contained" has to mean for the resolver that reads it.
        expect(frame.containsHoverZone(extent.left, 400)).toBe(true);
        expect(frame.containsHoverZone(extent.right, 400)).toBe(true);
      });
    }
  }

  it("DEFECT: the retired fixed-px zone fails the sweep it was shipped under", () => {
    // Both halves of the pre-526 tree, reimplemented locally so this fails for
    // the reason it names: the zone was the constant AND the halo had no
    // outboard bound (the lane's floor was the raw `editorColumnLeft − inset`,
    // ~110px out, so the cap could never bind).
    const frame = measuredFrame();
    const escapes: string[] = [];
    for (const editorFontRem of FONT_SLIDER_REM) {
      const editorFontPx = editorFontRem * ROOT_FONT_PX;
      const haloHalf = (HIT_PAD_FACTOR * editorFontPx) / 2;
      for (const block of BLOCKS) {
        const gapPx = HANDLE_GAP_EM * block.fontPx(editorFontPx);
        const preLeft = Math.max(
          CONTENT_LEFT - gapPx - HANDLE_WIDTH,
          handleLaneFloor(frame.editorColumnLeft, MARGIN_INSET),
        );
        const extentLeft = preLeft + HANDLE_WIDTH / 2 - haloHalf;
        if (extentLeft < retiredHoverZoneLeft(frame.contentLeft)) {
          escapes.push(`${editorFontRem}rem · ${block.label}`);
        }
      }
    }
    // The reported members: every heading at the shipped default, and every
    // block once the slider passes 0.984rem.
    expect(escapes.length).toBeGreaterThan(0);
    expect(escapes.some((e) => e.startsWith("0.95rem · h1 \\section"))).toBe(true);
    expect(escapes.some((e) => e.startsWith("1rem · paragraph"))).toBe(true);
  });

  it("CONTROL: the shipped default paragraph was inside the retired zone — by 0.8px", () => {
    // The knife-edge that made this look fine: nothing declared the
    // relationship, so it held by luck at exactly one point in a 12-step range.
    const frame = measuredFrame();
    const editorFontPx = 0.95 * ROOT_FONT_PX;
    const { lane } = laneFor("paragraph", editorFontPx, frame.editorColumnLeft);
    const extent = renderedExtent(lane.left, lane.minLeft, HIT_PAD_FACTOR * editorFontPx);
    const slack = extent.left - retiredHoverZoneLeft(frame.contentLeft);
    expect(slack).toBeGreaterThan(0);
    expect(slack).toBeLessThan(1);
  });
});

describe("the fold chevron stays clickable — the margin is ONE lane", () => {
  const chevronBox = {
    left: CONTENT_LEFT + CHEVRON_OFFSET,
    right: CONTENT_LEFT + CHEVRON_OFFSET + CHEVRON_WIDTH,
  };

  for (const editorFontRem of FONT_SLIDER_REM) {
    const editorFontPx = editorFontRem * ROOT_FONT_PX;
    const hitPadPx = HIT_PAD_FACTOR * editorFontPx;
    for (const block of BLOCKS.filter((b) => FOLD_CHEVRON_NODE_TYPES.has(b.kind))) {
      it(`@${editorFontRem}rem · ${block.label}: no rendered handle covers the 14px chevron`, () => {
        const frame = measuredFrame();
        const { chevronRight, lane } = laneFor(
          block.kind,
          block.fontPx(editorFontPx),
          frame.editorColumnLeft,
        );
        expect(chevronRight).toBe(chevronBox.right);
        const extent = renderedExtent(lane.left, lane.minLeft, hitPadPx);
        expect(
          extent.left,
          `the handle's rendered extent reaches ${extent.left.toFixed(2)}, ` +
            `inside the chevron column [${chevronBox.left}, ${chevronBox.right}] — ` +
            `clicking the chevron would open the block menu instead of folding`,
        ).toBeGreaterThanOrEqual(chevronBox.right);
      });
    }
  }

  it("DEFECT: without the chevron rung, a widened zone puts live handle over the chevron", () => {
    // The pre-fix refutation of this collision was "no handle exists while the
    // pointer is on the chevron" — which depended on the very constant the
    // zone half of this task removes. Reimplement the pre-526 lane (floor
    // only, no chevron occupant) and the halo it produced.
    const frame = measuredFrame();
    const offenders: string[] = [];
    for (const editorFontRem of FONT_SLIDER_REM) {
      const editorFontPx = editorFontRem * ROOT_FONT_PX;
      const hitPadPx = HIT_PAD_FACTOR * editorFontPx;
      for (const block of BLOCKS.filter((b) => FOLD_CHEVRON_NODE_TYPES.has(b.kind))) {
        const floor = handleLaneFloor(frame.editorColumnLeft, MARGIN_INSET);
        const gapPx = HANDLE_GAP_EM * block.fontPx(editorFontPx);
        const preLeft = Math.max(CONTENT_LEFT - gapPx - HANDLE_WIDTH, floor);
        const extent = renderedExtent(preLeft, floor, hitPadPx);
        if (extent.left < chevronBox.right) {
          offenders.push(`${editorFontRem}rem · ${block.label}`);
        }
      }
    }
    expect(offenders.length).toBeGreaterThan(0);
    expect(offenders.some((o) => o.includes("h1 \\section"))).toBe(true);
  });

  it("CONTROL: a prose row reserves no column, so it keeps its full halo", () => {
    const frame = measuredFrame();
    // At the slider max the unconditional reservation would have taken 10px per
    // side from every paragraph in the document for a chevron that is not there.
    const editorFontPx = 1.4 * ROOT_FONT_PX;
    const { chevronRight, lane } = laneFor("paragraph", editorFontPx, frame.editorColumnLeft);
    expect(chevronRight).toBeNull();
    const extent = renderedExtent(lane.left, lane.minLeft, HIT_PAD_FACTOR * editorFontPx);
    expect(extent.right - extent.left).toBeCloseTo(HIT_PAD_FACTOR * editorFontPx, 6);
  });

  it("CONTROL: a heading's handle still hugs its own text where there is room", () => {
    // The chevron rung is a FLOOR, not a shift: only a gap wide enough to reach
    // the column moves anything, which at the shipped heading sizes is `\\part`
    // alone.
    const frame = measuredFrame();
    const h3 = laneFor("heading", 1.15 * ROOT_FONT_PX, frame.editorColumnLeft).lane;
    expect(h3.left).toBe(CONTENT_LEFT - HANDLE_GAP_EM * 1.15 * ROOT_FONT_PX - HANDLE_WIDTH);
    const h0 = laneFor("heading", 2.1 * ROOT_FONT_PX, frame.editorColumnLeft).lane;
    expect(h0.left).toBe(chevronBox.right);
  });
});

describe("census — the models this suite carries are the shipped CSS", () => {
  it("the halo is a centred `max(12px, min(pad, 2 × cap))` band", () => {
    expect(CSS).toMatch(
      /\.text-object-grab-handle::before\s*\{[^}]*width:\s*max\(\s*12px,\s*min\(var\(--margin-handle-hit-pad\),\s*calc\(var\(--margin-handle-hit-cap\)\s*\*\s*2\)\)\s*\)/,
    );
    expect(CSS).toMatch(
      /\.text-object-grab-handle::before\s*\{[^}]*transform:\s*translate\(-50%,\s*-50%\)/,
    );
  });

  it("the hit pad is 1.8 × the editor font", () => {
    expect(CSS).toMatch(
      /--margin-handle-hit-pad:\s*calc\(var\(--editor-font-size[^)]*\)\s*\*\s*1\.8\)/,
    );
  });

  it("the handle box is 12px, matching HANDLE_WIDTH", () => {
    expect(CSS).toMatch(/\.text-object-grab-handle\s*\{[^}]*width:\s*12px/);
    expect(HANDLE_WIDTH).toBe(12);
  });

  it("both fold chevrons read ONE column token pair", () => {
    for (const sel of [".heading-fold-chevron", ".source-pod-fold-chevron"]) {
      const block = new RegExp(`\\${sel}\\s*\\{[^}]*\\}`).exec(CSS)?.[0];
      expect(block, `${sel} rule not found`).toBeTruthy();
      expect(block).toMatch(/left:\s*var\(--margin-col-chevron,/);
      expect(block).toMatch(/width:\s*var\(--margin-col-chevron-width,/);
    }
    expect(CSS).toMatch(/--margin-col-chevron:\s*-44px/);
    expect(CSS).toMatch(/--margin-col-chevron-width:\s*14px/);
  });

  it("the retired hover-zone constant is gone", () => {
    const frameSrc = readFileSync(
      join(
        dirname(fileURLToPath(import.meta.url)),
        "../../lib/editor-geometry/viewport-frame.ts",
      ),
      "utf8",
    );
    // The zone must be the lane's own expression, and the private cushion the
    // premise died with must not come back.
    expect(frameSrc).toMatch(/hoverZoneLeft = handleLaneFloor\(/);
    expect(frameSrc).not.toMatch(/const HOVER_MARGIN_PAD/);
  });
});

// ---------------------------------------------------------------------------
// The leg with teeth — the REAL component, the REAL frame, the number the
// halo is actually drawn from.
// ---------------------------------------------------------------------------
//
// Everything above models `applyHitCaps`' output. Nothing above (and, before
// task 526, nothing in the repo at all) READS it: `hitCapPx` had zero
// behavioural coverage, so its outboard fold — the single line that keeps a
// large heading's halo off the fold chevron and inside the hover zone — was
// deletable in silence with the whole suite green (measured). These legs render
// the shipped component over a REAL `computeViewportFrame` and read
// `--margin-handle-hit-cap` back off the DOM.

describe("the SHIPPED handle's halo is capped at its lane — read off the DOM", () => {
  /** Build a real column → editor → heading tree and measure it for real. */
  function buildHeadingFixture(headingFontPx: number, editorFontRem: number) {
    const column = document.createElement("div");
    column.setAttribute("data-editor-col", "true");
    column.getBoundingClientRect = () => rect(0, 2000);
    const portal = document.createElement("div");
    portal.setAttribute("data-grab-handle-portal", "");
    column.appendChild(portal);

    const ed = document.createElement("div");
    ed.className = "ProseMirror";
    ed.style.paddingLeft = `${EDITOR_PAD_LEFT}px`;
    ed.style.paddingRight = "72px";
    ed.style.setProperty("--margin-col-handle-inset", `${MARGIN_INSET}px`);
    ed.style.setProperty(
      "--editor-font-size",
      `${editorFontRem * ROOT_FONT_PX}px`,
    );
    Object.defineProperty(ed, "offsetHeight", { value: 800, configurable: true });
    ed.getBoundingClientRect = () => rect(EDITOR_LEFT, EDITOR_RIGHT + 72);
    column.appendChild(ed);

    // The heading block. Markerless (`markerLeft === contentLeft`), and its
    // own border-box left IS the chevron's positioning origin — which is what
    // production's `.heading-wrapper` is.
    const h = document.createElement("h1");
    h.setAttribute("data-uuid", "h-1");
    h.setAttribute("data-text-object-kind", "heading");
    h.textContent = "A section";
    h.style.fontSize = `${headingFontPx}px`;
    h.style.setProperty("--margin-handle-gap", `${HANDLE_GAP_EM}em`);
    h.style.setProperty("--margin-col-chevron", `${CHEVRON_OFFSET}px`);
    h.style.setProperty("--margin-col-chevron-width", `${CHEVRON_WIDTH}px`);
    h.getBoundingClientRect = () => ({
      top: 300, bottom: 340, left: CONTENT_LEFT, right: EDITOR_RIGHT,
      width: EDITOR_RIGHT - CONTENT_LEFT, height: 40,
      x: CONTENT_LEFT, y: 300, toJSON: () => ({}),
    }) as DOMRect;
    Object.defineProperty(h, "getClientRects", {
      value: () => [h.getBoundingClientRect()],
      configurable: true,
    });
    ed.appendChild(h);
    document.body.appendChild(column);
    return { column, ed, h };
  }

  function fakeEditor(ed: HTMLElement): Editor {
    const resolved = {
      depth: 0,
      node: () => ({ type: { name: "doc" }, attrs: {} }),
      before: () => 0,
    };
    return {
      isDestroyed: false,
      isEditable: true,
      state: { selection: { from: 5, to: 5 }, doc: { resolve: () => resolved } },
      view: {
        dom: ed,
        coordsAtPos: () => ({ top: 305, bottom: 320, left: CONTENT_LEFT, right: CONTENT_LEFT + 1 }),
        nodeDOM: () => null,
      },
      on: () => undefined,
      off: () => undefined,
    } as unknown as Editor;
  }

  /** Hover the heading row and return the SHIPPED handle's rendered extent,
   *  derived from the two values the component actually wrote to the DOM. */
  function paintedExtent(h: HTMLElement, ed: HTMLElement, hitPadPx: number) {
    blocksAtY.mockImplementation(() => [{ uuid: "h-1", el: h }]);
    let raf: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
      raf.push(cb);
      return raf.length;
    });
    vi.stubGlobal("cancelAnimationFrame", () => { raf = []; });
    notePointerInput();
    const editorRef = { current: fakeEditor(ed) };
    render(<TextObjectGrabHandle editorRef={editorRef} />);
    act(() => {
      document.dispatchEvent(
        new MouseEvent("mousemove", { clientX: 400, clientY: 320, bubbles: true }),
      );
    });
    act(() => {
      for (let i = 0; i < 4 && raf.length; i++) {
        const q = raf;
        raf = [];
        for (const cb of q) cb(0);
      }
    });
    const el = document.querySelector<HTMLElement>(".text-object-grab-handle");
    expect(el, "the component painted no handle for the hovered heading").toBeTruthy();
    const left = parseFloat(el!.style.left);
    const capRaw = el!.style.getPropertyValue("--margin-handle-hit-cap");
    // `null`/absent means UNBOUNDED — the CSS default (999px), i.e. the full pad.
    const cap = capRaw ? parseFloat(capRaw) : Infinity;
    // The shipped `::before`: a `max(12px, min(pad, 2 × cap))` band centred on
    // the box. Pinned to `globals.css` by the census above.
    const centre = left + HANDLE_WIDTH / 2;
    const width = Math.max(HANDLE_WIDTH, Math.min(hitPadPx, cap * 2));
    return { left: centre - width / 2, right: centre + width / 2, cap, boxLeft: left };
  }

  const chevronRightX = CONTENT_LEFT + CHEVRON_OFFSET + CHEVRON_WIDTH;

  // The two ends of the range plus the shipped default — enough to cross the
  // knife-edge in both directions without rendering 132 React trees.
  for (const editorFontRem of [0.85, 0.95, 1.4]) {
    for (const [label, headingFontPx] of [
      ["h1 \\section (1.75rem)", 1.75 * ROOT_FONT_PX],
      ["h0 \\part (2.1rem)", 2.1 * ROOT_FONT_PX],
      ["h1 at the stepper max (3.0rem)", 3.0 * ROOT_FONT_PX],
    ] as [string, number][]) {
      it(`@${editorFontRem}rem · ${label}: the painted halo clears the chevron AND stays in the zone`, () => {
        const { ed, h } = buildHeadingFixture(headingFontPx, editorFontRem);
        const frame = computeViewportFrame(ed);
        expect(frame).not.toBeNull();
        liveFrame = frame;
        const hitPadPx = HIT_PAD_FACTOR * editorFontRem * ROOT_FONT_PX;
        const extent = paintedExtent(h, ed, hitPadPx);

        expect(
          extent.left,
          `the SHIPPED halo reaches ${extent.left.toFixed(2)}, inside the chevron ` +
            `column (right edge ${chevronRightX}) — clicking the chevron would open ` +
            `the block menu instead of folding`,
        ).toBeGreaterThanOrEqual(chevronRightX);
        expect(
          extent.left,
          `the SHIPPED halo reaches ${extent.left.toFixed(2)}, outside the hover ` +
            `zone (${frame!.hoverZoneLeft}) — hovering it CLEARS the hover`,
        ).toBeGreaterThanOrEqual(frame!.hoverZoneLeft);
        expect(frame!.containsHoverZone(extent.left, 320)).toBe(true);
      });
    }
  }

  it("the cap the component wrote IS the distance from the dots to the lane bound", () => {
    // Not a restatement: this is what makes the modelled legs above speak for
    // the shipped component. `applyHitCaps` folds the lane's outboard bound
    // into the SAME `--margin-handle-hit-cap` the sibling clamp writes, so
    // there is one number and one CSS expression, not two.
    const { ed, h } = buildHeadingFixture(2.1 * ROOT_FONT_PX, 1.4);
    const frame = computeViewportFrame(ed);
    liveFrame = frame;
    const extent = paintedExtent(h, ed, HIT_PAD_FACTOR * 1.4 * ROOT_FONT_PX);
    const { lane } = laneFor("heading", 2.1 * ROOT_FONT_PX, frame!.editorColumnLeft);
    expect(extent.boxLeft).toBe(lane.left);
    expect(extent.cap).toBeCloseTo(lane.left + HANDLE_WIDTH / 2 - lane.minLeft, 6);
  });

  it("CONTROL: a prose row's handle is left UNCAPPED — the full em halo", () => {
    // The kind gate is what buys this: an unconditional reservation would take
    // ~10px per side from every paragraph in the document, at the slider max,
    // for a chevron that is not there.
    const { ed, h } = buildHeadingFixture(1.4 * ROOT_FONT_PX, 1.4);
    h.setAttribute("data-text-object-kind", "paragraph");
    const frame = computeViewportFrame(ed);
    liveFrame = frame;
    const hitPadPx = HIT_PAD_FACTOR * 1.4 * ROOT_FONT_PX;
    const extent = paintedExtent(h, ed, hitPadPx);
    // A lone prose handle sits ~21px off its text, and the lane floor is ~110px
    // out, so the outboard cap cannot bind: the halo is the full pad.
    expect(extent.right - extent.left).toBeCloseTo(hitPadPx, 6);
    expect(extent.left).toBeGreaterThanOrEqual(frame!.hoverZoneLeft);
  });
});
