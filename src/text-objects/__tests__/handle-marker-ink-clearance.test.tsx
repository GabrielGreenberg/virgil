// @vitest-environment jsdom
//
// Task 382 — **a grab handle never paints on the row's marker glyph.**
//
// Gabriel's screenshot: a top-level bullet list, hovering item 1, with the
// ITEM's handle sitting directly on the `•`. Nothing failed — the placement was
// well-formed and the geometry was self-consistent. What was missing was a
// bound: three passes each held their own idea of where the bullet is (the
// band-MIDDLE anchor in `block-frame.ts`, the px floor in `handle-layout.ts`,
// and task 353's same-row separation push), and only the first of them knew the
// glyph existed at all. The push had no upper bound, so on a top-level list —
// where the container handle is clamped ON the floor and the 24px separation
// therefore has to come out of the item's side — it walked the item handle into
// the half of the band the anchor exists to keep it out of.
//
// The fix is one LANE per handle: `[floor … cap]`, cap derived from the row's
// `BlockFrame.inkLeft`. Two things follow, and both are asserted here:
//
//   • the SEPARATION may push only within the lane (the reported defect), and
//   • the RESTING position is capped too — a wide `10.` marker reaches further
//     left than the band-middle anchor assumes, so an ordered list collided
//     before any push. That is why `inkLeft` takes the MEASURED marker string
//     width when it reads further left than the heuristic (`text-metrics`
//     `measureTextWidth`, never a hardcoded px), and why `min` keeps a
//     measurement a one-way TIGHTENING.
//
// Every geometry leg drives the REAL component over a REAL `resolveBlockFrame`
// with a REAL marker band (inline `padding-left` — jsdom reports it), at TWO
// editor font sizes, because the em/px unit mix (band in em, floor/handle/gap
// in px) is the root of the intermittency the report describes.
//
// The clearance bar is stated, not implied: a handle's right edge must stay at
// least `gapPx * INK_CLEARANCE_FACTOR` left of the ink. "Doesn't quite
// intersect" is not the contract — at the reported geometry the pre-fix box
// ended 0.25px short of the band middle, so a bare non-intersection assertion
// would have passed on the very screenshot that produced this task.
//
// Every defect leg fails on the pre-fix behaviour (measured by neutering the
// cap in `resolveHandleLane` and in `applySameRowSeparation` in turn).

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, act, cleanup } from "@testing-library/react";
import type { Editor } from "@tiptap/react";

vi.mock("@/lib/storage", () => {
  const noop = () => undefined;
  return new Proxy({}, { get: (_t, p) => (p === "__esModule" ? true : p === "then" ? undefined : noop) });
});
const blocksAtY = vi.fn<(y: number) => Array<{ uuid: string; el: HTMLElement }> | null>();
vi.mock("@/lib/editor-geometry", () => ({
  geomHoverEnabled: () => true,
  getGeometry: () => ({ blocksAtY }),
}));
const PORTAL_ORIGIN = { top: 0, left: 0 };
vi.mock("@/lib/editor-geometry/use-viewport-frame", () => ({
  useViewportFrame: () => ({ frameRef: { current: frame }, version: 0 }),
}));
vi.mock("@/lib/marginalia-blocks", () => ({ resolveDomForUuid: () => null }));

import { TextObjectGrabHandle } from "@/text-objects/TextObjectGrabHandle";
import { notePointerInput } from "@/lib/input-modality";
import { clearCapTopCache } from "@/lib/text-metrics";
import {
  HANDLE_WIDTH,
  INK_CLEARANCE_FACTOR,
  resolveHandleLane,
} from "@/text-objects/handle-layout";
import { resolveMarkerGeometry } from "@/text-objects/block-frame";

// ── Geometry constants shared by every leg ──────────────────────────────────
const EDITOR_LEFT = 200;
const MARGIN_INSET = 22;
const FLOOR = EDITOR_LEFT - MARGIN_INSET;
const GAP_EM = 0.625; // --margin-handle-gap
const TRACK_EM = 1.25; // --margin-track-width
const ROW_TOP = 300;
const ROW_BOTTOM = 340;

/** A per-character width model for the canvas stub — jsdom has no real 2D
 *  context, so `measureTextWidth` would return "no opinion" and the measured
 *  half of the ink boundary would never be exercised. Ratios are em fractions
 *  in the ballpark of a serif text face; nothing here depends on their exact
 *  values, only on a two-digit counter being materially wider than a bullet. */
const CHAR_EM: Record<string, number> = { "•": 0.35, ".": 0.28 };
const DIGIT_EM = 0.55;
/** The gap this fixture's "browser" leaves between a marker's ink and the
 *  item's content edge. Deliberately spelled here as well as in `block-frame`:
 *  the fixture IS the world the production code estimates, so a leg that
 *  asserted against the code's own estimate could not tell a good estimate from
 *  a bad one — the shape the codebase calls "an approximation deciding its own
 *  eligibility". Every geometry leg therefore checks TWO things: the stated
 *  contract (clear of the resolved `inkLeft`) and the reality behind it (clear
 *  of where this fixture actually paints the glyph). */
const FIXTURE_TRAIL_EM = 0.25;
function modelTextWidth(text: string, fontSizePx: number): number {
  let w = 0;
  for (const ch of text) {
    w += (/[0-9]/.test(ch) ? DIGIT_EM : (CHAR_EM[ch] ?? 0.5)) * fontSizePx;
  }
  return w;
}
function stubCanvas() {
  const ctx = {
    font: "16px serif",
    measureText(text: string) {
      const fs = parseFloat(/(\d+(?:\.\d+)?)px/.exec(this.font)?.[1] ?? "16");
      return {
        width: modelTextWidth(text, fs),
        actualBoundingBoxAscent: fs * 0.7,
        fontBoundingBoxAscent: fs * 0.9,
        fontBoundingBoxDescent: fs * 0.2,
      } as unknown as TextMetrics;
    },
  };
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
    ctx as unknown as CanvasRenderingContext2D,
  );
}

function rect(top: number, bottom: number, left: number, right = 700): DOMRect {
  return { top, bottom, left, right, width: right - left, height: bottom - top,
    x: left, y: top, toJSON: () => ({}) } as DOMRect;
}

let editorEl: HTMLElement;
let frame: Record<string, unknown>;

function buildEditor() {
  editorEl = document.createElement("div");
  editorEl.className = "ProseMirror";
  Object.defineProperty(editorEl, "offsetHeight", { value: 800, configurable: true });
  editorEl.getBoundingClientRect = () => rect(0, 800, EDITOR_LEFT);
  document.body.appendChild(editorEl);
  const portal = document.createElement("div");
  portal.setAttribute("data-grab-handle-portal", "");
  const column = document.createElement("div");
  column.appendChild(portal);
  document.body.appendChild(column);
  frame = {
    editorEl, contentLeft: 260, editorRight: 700, scrollTop: 0, scrollBottom: 800,
    marginInset: MARGIN_INSET, paperEl: column, paperRect: PORTAL_ORIGIN,
    containsHoverZone: (x: number, y: number) => x >= EDITOR_LEFT && x <= 700 && y >= 0 && y <= 800,
    toPortalCoords: (x: number, y: number) => ({ x, y }),
  };
}

/** A one-item list with a REAL marker band. `padLeftPx` is the band; the item's
 *  content edge sits at `EDITOR_LEFT + padLeftPx`, exactly as a top-level list
 *  lays out (`ul` content box starts at the editor column). */
function buildList(
  tag: "ul" | "ol",
  padLeftPx: number,
  fontSizePx: number,
  itemCount = 1,
): { list: HTMLElement; items: HTMLElement[] } {
  const list = document.createElement(tag);
  list.setAttribute("data-uuid", "list1");
  list.setAttribute("data-text-object-kind", tag === "ul" ? "bulletList" : "orderedList");
  list.style.paddingLeft = `${padLeftPx}px`;
  list.style.fontSize = `${fontSizePx}px`;
  list.style.listStyleType = tag === "ul" ? "disc" : "decimal";
  list.getBoundingClientRect = () => rect(ROW_TOP, ROW_BOTTOM, EDITOR_LEFT);
  const liLeft = EDITOR_LEFT + padLeftPx;
  const items: HTMLElement[] = [];
  for (let i = 0; i < itemCount; i++) {
    const li = document.createElement("li");
    li.setAttribute("data-uuid", `li${i + 1}`);
    li.setAttribute("data-text-object-kind", "listItem");
    li.getBoundingClientRect = () => rect(ROW_TOP + i * 40, ROW_BOTTOM + i * 40, liLeft);
    const p = document.createElement("p");
    p.textContent = `item ${i + 1}`;
    p.style.fontSize = `${fontSizePx}px`;
    p.style.setProperty("--margin-handle-gap", `${GAP_EM}em`);
    p.style.setProperty("--margin-track-width", `${TRACK_EM}em`);
    p.getBoundingClientRect = () => rect(ROW_TOP + 2 + i * 40, ROW_BOTTOM - 2 + i * 40, liLeft);
    li.appendChild(p);
    list.appendChild(li);
    items.push(li);
  }
  editorEl.appendChild(list);
  return { list, items };
}

/** The expex shape: a block whose `(n)` sits left of its first item's `a.`,
 *  both MEASURED marker spans on one row. */
function buildExample(fontSizePx: number, numberLeft: number, itemMarkerLeft: number) {
  const block = document.createElement("div");
  block.setAttribute("data-uuid", "ex1");
  block.setAttribute("data-text-object-kind", "exampleBlock");
  block.getBoundingClientRect = () => rect(ROW_TOP, ROW_BOTTOM, numberLeft);
  const num = document.createElement("span");
  num.className = "expex-number";
  num.getBoundingClientRect = () => rect(ROW_TOP, ROW_BOTTOM, numberLeft, numberLeft + 20);
  block.appendChild(num);
  const item = document.createElement("div");
  item.setAttribute("data-uuid", "exi1");
  item.setAttribute("data-text-object-kind", "exampleItem");
  item.getBoundingClientRect = () => rect(ROW_TOP, ROW_BOTTOM, itemMarkerLeft);
  const mark = document.createElement("span");
  mark.className = "expex-item-marker";
  mark.getBoundingClientRect = () => rect(ROW_TOP, ROW_BOTTOM, itemMarkerLeft, itemMarkerLeft + 14);
  item.appendChild(mark);
  const p = document.createElement("p");
  p.textContent = "an example";
  p.style.fontSize = `${fontSizePx}px`;
  p.style.setProperty("--margin-handle-gap", `${GAP_EM}em`);
  p.style.setProperty("--margin-track-width", `${TRACK_EM}em`);
  p.getBoundingClientRect = () => rect(ROW_TOP + 2, ROW_BOTTOM - 2, itemMarkerLeft + 24);
  item.appendChild(p);
  block.appendChild(item);
  editorEl.appendChild(block);
  return { block, item };
}

let handlers: Record<string, Set<(p: unknown) => void>>;
function fakeEditor(): Editor {
  handlers = { update: new Set(), selectionUpdate: new Set() };
  const resolved = { depth: 0, node: () => ({ type: { name: "doc" }, attrs: {} }), before: () => 0 };
  return { isDestroyed: false, isEditable: true,
    state: { selection: { from: 5, to: 5 }, doc: { resolve: () => resolved } },
    view: { dom: editorEl, coordsAtPos: () => ({ top: 305, bottom: 320, left: 262, right: 263 }), nodeDOM: () => null },
    on: (n: string, f: (p: unknown) => void) => handlers[n]?.add(f),
    off: (n: string, f: (p: unknown) => void) => handlers[n]?.delete(f) } as unknown as Editor;
}

let rafQueue: FrameRequestCallback[] = [];
const flushFrames = () =>
  act(() => {
    for (let i = 0; i < 4 && rafQueue.length; i++) {
      const q = rafQueue; rafQueue = [];
      for (const cb of q) cb(0);
    }
  });

beforeEach(() => {
  rafQueue = [];
  blocksAtY.mockReset();
  clearCapTopCache();
  stubCanvas();
  buildEditor();
  notePointerInput();
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => { rafQueue.push(cb); return rafQueue.length; });
  vi.stubGlobal("cancelAnimationFrame", () => { rafQueue = []; });
});
afterEach(() => {
  cleanup(); document.body.innerHTML = ""; vi.unstubAllGlobals(); vi.restoreAllMocks();
  clearCapTopCache(); notePointerInput();
});

/** Hover a row and return every painted handle, keyed by owner uuid. */
function hover(levels: Array<{ uuid: string; el: HTMLElement }>, y = (ROW_TOP + ROW_BOTTOM) / 2) {
  blocksAtY.mockImplementation(() => levels);
  const editorRef = { current: fakeEditor() };
  render(<TextObjectGrabHandle editorRef={editorRef} />);
  act(() => {
    document.dispatchEvent(new MouseEvent("mousemove", { clientX: 400, clientY: y, bubbles: true }));
  });
  flushFrames();
  return [...document.querySelectorAll<HTMLElement>(".text-object-grab-handle")].map((el) => ({
    uuid: el.getAttribute("data-grab-owner-uuid")!,
    left: parseFloat(el.style.left),
  }));
}

/** The clearance a handle at `left` leaves before `inkLeft` — the number the
 *  contract is stated in. Negative means the box is ON the ink. */
function clearance(left: number, inkLeft: number): number {
  return inkLeft - (left + HANDLE_WIDTH);
}

/** Where THIS FIXTURE paints a list marker's glyph: right-aligned a trailing
 *  space short of the item's content edge. The independent reality the legs
 *  check the resolved boundary against. */
function fixtureGlyphLeft(liLeft: number, markerText: string, fontSizePx: number): number {
  return liLeft - fontSizePx * FIXTURE_TRAIL_EM - modelTextWidth(markerText, fontSizePx);
}

describe("a handle never paints on the row's marker ink", () => {
  // Two font sizes: the band is em and the floor / gap-min / handle width are
  // px, which is exactly why the report reads as intermittent.
  for (const fontSizePx of [19, 28]) {
    const bandPx = fontSizePx * 2; // `.tiptap ul { padding-left: 2em }`
    const gapPx = fontSizePx * GAP_EM;
    const minClearance = gapPx * INK_CLEARANCE_FACTOR;

    it(`bullet list @${fontSizePx}px: both handles clear the bullet`, () => {
      const { list, items } = buildList("ul", bandPx, fontSizePx);
      const ink = resolveMarkerGeometry(items[0], "listItem", EDITOR_LEFT + bandPx, 0).inkLeft;
      const painted = hover([
        { uuid: "li1", el: items[0] },
        { uuid: "list1", el: list },
      ]);
      expect(painted.map((p) => p.uuid).sort()).toEqual(["li1", "list1"]);
      const glyphLeft = fixtureGlyphLeft(EDITOR_LEFT + bandPx, "•", fontSizePx);
      for (const p of painted) {
        expect(
          clearance(p.left, ink),
          `${p.uuid}'s handle crosses the resolved ink boundary (left ${p.left}, ink ${ink})`,
        ).toBeGreaterThanOrEqual(minClearance);
        expect(
          clearance(p.left, glyphLeft),
          `${p.uuid}'s handle is on the painted bullet (left ${p.left}, glyph ${glyphLeft})`,
        ).toBeGreaterThan(0);
      }
    });

    it(`bullet list @${fontSizePx}px: the two still read as two controls`, () => {
      // Task 353's goal survives the cap: at a 2em band the everyday list
      // reaches (or all but reaches) the 24px target with the handle clear.
      const { list, items } = buildList("ul", bandPx, fontSizePx);
      const painted = hover([
        { uuid: "li1", el: items[0] },
        { uuid: "list1", el: list },
      ]);
      const li = painted.find((p) => p.uuid === "li1")!;
      const ul = painted.find((p) => p.uuid === "list1")!;
      expect(ul.left).toBeLessThan(li.left);
      expect(li.left - ul.left).toBeGreaterThan(20);
    });

    it(`ordered list @${fontSizePx}px: a two-digit marker is cleared too`, () => {
      // The RESTING position collides here, before any separation push: `10.`
      // reaches well left of the band middle the anchor assumes.
      const { list, items } = buildList("ol", bandPx, fontSizePx, 12);
      const ink = resolveMarkerGeometry(items[0], "listItem", EDITOR_LEFT + bandPx, 0).inkLeft;
      const painted = hover([
        { uuid: "li1", el: items[0] },
        { uuid: "list1", el: list },
      ]);
      const glyphLeft = fixtureGlyphLeft(EDITOR_LEFT + bandPx, "12.", fontSizePx);
      for (const p of painted) {
        expect(
          clearance(p.left, ink),
          `${p.uuid}'s handle crosses the resolved ink boundary (left ${p.left}, ink ${ink})`,
        ).toBeGreaterThanOrEqual(minClearance);
        // The leg with teeth for the MEASURED half: with the band-middle
        // heuristic answering alone, the resolved boundary is ~12px right of
        // where a two-digit counter actually starts.
        expect(
          clearance(p.left, glyphLeft),
          `${p.uuid}'s handle is on the painted "12." (left ${p.left}, glyph ${glyphLeft})`,
        ).toBeGreaterThan(0);
      }
      // …and every handle is still ON SCREEN: the floor outranks the cap.
      for (const p of painted) expect(p.left).toBeGreaterThanOrEqual(FLOOR);
    });

    it(`expex row @${fontSizePx}px: each handle clears its OWN measured marker`, () => {
      const numberLeft = EDITOR_LEFT + 10;
      const itemMarkerLeft = numberLeft + fontSizePx * 1.5;
      const { block, item } = buildExample(fontSizePx, numberLeft, itemMarkerLeft);
      const painted = hover([
        { uuid: "exi1", el: item },
        { uuid: "ex1", el: block },
      ]);
      const inks: Record<string, number> = { ex1: numberLeft, exi1: itemMarkerLeft };
      for (const p of painted) {
        expect(
          clearance(p.left, inks[p.uuid]),
          `${p.uuid}'s handle is on its own marker (left ${p.left})`,
        ).toBeGreaterThanOrEqual(minClearance);
      }
    });
  }

  it("the REPORTED geometry: the pre-382 push ended 0.25px short of the band middle", () => {
    // The screenshot's own numbers (19px prose, the 1.5em band this shipped
    // with). The point of the leg is the BAR: a bare "doesn't intersect"
    // assertion passes on the pre-fix position, which is why the contract is
    // stated as a clearance.
    const fontSizePx = 19;
    const { list, items } = buildList("ul", fontSizePx * 1.5, fontSizePx);
    const ink = resolveMarkerGeometry(items[0], "listItem", EDITOR_LEFT + fontSizePx * 1.5, 0).inkLeft;
    const painted = hover([
      { uuid: "li1", el: items[0] },
      { uuid: "list1", el: list },
    ]);
    const li = painted.find((p) => p.uuid === "li1")!;
    const preFixPush = FLOOR + 24; // what the unbounded separation produced
    expect(clearance(preFixPush, ink)).toBeLessThan(1);
    expect(clearance(li.left, ink)).toBeGreaterThanOrEqual(
      fontSizePx * GAP_EM * INK_CLEARANCE_FACTOR,
    );
  });
});

describe("the shipped marker band", () => {
  it("`.tiptap ul/ol` is 2em — the width every geometry leg above assumes", () => {
    // The other half of task 382, and the half no component test can see: at
    // the 1.5em this shipped with, the everyday top-level list cannot hold both
    // the 24px separation and a clear bullet, so the cap fired on the common
    // case instead of being the rare-case net. Reverting the band would leave
    // every geometry leg above passing against a width the app no longer has.
    const here = dirname(fileURLToPath(import.meta.url));
    // src/text-objects/__tests__ → src/app/globals.css
    const css = readFileSync(join(here, "../..", "app/globals.css"), "utf8");
    const RULES: Array<[string, RegExp]> = [
      [".tiptap ul", /\.tiptap ul\s*\{[^}]*?padding-left:\s*([\d.]+)em/],
      [".tiptap ol", /\.tiptap ol\s*\{[^}]*?padding-left:\s*([\d.]+)em/],
    ];
    for (const [sel, re] of RULES) {
      const m = re.exec(css);
      expect(m, `no em padding-left found for ${sel}`).not.toBeNull();
      expect(parseFloat(m![1]), `${sel} marker band`).toBeGreaterThanOrEqual(2);
    }
  });
});

describe("resolveMarkerGeometry — the anchor and the ink boundary", () => {
  it("a measured marker IS its own ink (nothing is estimated)", () => {
    const { item } = buildExample(19, 210, 240);
    const g = resolveMarkerGeometry(item, "exampleItem", 300, 20);
    expect(g.inkLeft).toBe(g.markerLeft);
  });

  it("a bullet keeps the band-middle anchor: the measurement doesn't loosen it", () => {
    const { items } = buildList("ul", 38, 19);
    const g = resolveMarkerGeometry(items[0], "listItem", EDITOR_LEFT + 38, 0);
    expect(g.markerLeft).toBe(EDITOR_LEFT + 38 - 19); // band middle
    expect(g.inkLeft).toBe(g.markerLeft); // a `•` fits in the right half
  });

  it("a wide `12.` TIGHTENS the boundary past the band middle", () => {
    const { items } = buildList("ol", 38, 19, 12);
    const g = resolveMarkerGeometry(items[0], "listItem", EDITOR_LEFT + 38, 0);
    expect(g.markerLeft).toBe(EDITOR_LEFT + 38 - 19);
    expect(g.inkLeft).toBeLessThan(g.markerLeft);
  });

  it("`list-style-type: none` puts the ink at the item's own content edge", () => {
    const { items, list } = buildList("ul", 38, 19);
    list.style.listStyleType = "none";
    const g = resolveMarkerGeometry(items[0], "listItem", EDITOR_LEFT + 38, 0);
    expect(g.inkLeft).toBe(EDITOR_LEFT + 38 - 19); // the band middle still bounds it
  });

  it("an un-modeled counter style assumes the WHOLE band is ink", () => {
    const { items, list } = buildList("ol", 38, 19, 3);
    list.style.listStyleType = "lower-roman";
    const g = resolveMarkerGeometry(items[0], "listItem", EDITOR_LEFT + 38, 0);
    expect(g.inkLeft).toBe(EDITOR_LEFT); // band left = li.left − padding
  });

  it("a markerless container shares its first item's ink (same row, same line)", () => {
    const { list, items } = buildList("ol", 38, 19, 12);
    const item = resolveMarkerGeometry(items[0], "listItem", EDITOR_LEFT + 38, 0);
    const container = resolveMarkerGeometry(list, "orderedList", EDITOR_LEFT + 38, 24);
    expect(container.inkLeft).toBe(item.inkLeft);
    // …while its ANCHOR steps one track-width further out.
    expect(container.markerLeft).toBe(item.markerLeft - 24);
  });

  it("no canvas ⇒ no opinion: the band-middle heuristic answers alone", () => {
    vi.restoreAllMocks(); // drop the canvas stub — `getContext` returns null
    clearCapTopCache();
    const { items } = buildList("ol", 38, 19, 12);
    const g = resolveMarkerGeometry(items[0], "listItem", EDITOR_LEFT + 38, 0);
    expect(g.inkLeft).toBe(g.markerLeft);
  });
});

describe("resolveHandleLane — the three bounds and their precedence", () => {
  const base = { gapPx: 12, editorColumnLeft: EDITOR_LEFT, baselineInset: MARGIN_INSET };

  it("the anchor answers when it is inside the lane", () => {
    const lane = resolveHandleLane({ ...base, markerLeft: 400, inkLeft: 400 });
    expect(lane.left).toBe(400 - 12 - HANDLE_WIDTH);
  });

  it("the ink cap binds the RESTING position, not only a push", () => {
    // A marker whose ink reaches further left than its anchor (a wide counter).
    const lane = resolveHandleLane({ ...base, markerLeft: 400, inkLeft: 370 });
    expect(lane.left).toBeLessThan(400 - 12 - HANDLE_WIDTH);
    expect(lane.left + HANDLE_WIDTH).toBeLessThanOrEqual(370);
  });

  it("the floor OUTRANKS the cap: an unreachable handle is worse than a tight one", () => {
    const lane = resolveHandleLane({ ...base, markerLeft: FLOOR - 100, inkLeft: FLOOR - 100 });
    expect(lane.left).toBe(FLOOR);
    expect(lane.maxLeft).toBe(FLOOR);
  });

  it("maxLeft leaves exactly the stated clearance before the ink", () => {
    const lane = resolveHandleLane({ ...base, markerLeft: 400, inkLeft: 400 });
    expect(lane.maxLeft + HANDLE_WIDTH).toBe(400 - 12 * INK_CLEARANCE_FACTOR);
  });
});
