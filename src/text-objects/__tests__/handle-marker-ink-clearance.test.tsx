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
import type { EditorViewportFrame } from "@/lib/editor-geometry/viewport-frame";
import { buildHandleTestFrame } from "./_handle-frame";

// ── Geometry constants shared by every leg ──────────────────────────────────
const EDITOR_LEFT = 200;
const MARGIN_INSET = 22;
const FLOOR = EDITOR_LEFT - MARGIN_INSET;
const GAP_EM = 0.625; // --margin-handle-gap
const TRACK_EM = 1.25; // --margin-track-width
/** `.tiptap ul/ol { padding-left }` — the shipped marker band, pinned against
 *  globals.css by its own leg below. Task 487 widened it 2em → 2.5em: a
 *  container's handle now occupies the marker column of the level ABOVE it, so
 *  the band has to hold the ITEM's handle whole. */
const BAND_EM = 2.5;
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
let frame: EditorViewportFrame;

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
  frame = buildHandleTestFrame({
    editorEl, contentLeft: 260, editorRight: 700, scrollTop: 0, scrollBottom: 800,
    marginInset: MARGIN_INSET, paperEl: column, paperRect: PORTAL_ORIGIN,
  });
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

/** A bullet list nested `depth` levels deep, each level ONE item whose first
 *  child is its paragraph and whose second child is the next level's list —
 *  the schema's own shape. Every level's content edge is one marker band
 *  further in. Returns the innermost list + item and the FULL containing chain
 *  innermost-first, as `blocksAtY` reports it for a pointer on the deepest
 *  row (which is the top row of every level at once: the fixture's rows all
 *  coincide, as they do in a real document's first line). */
function buildNestedList(
  depth: number,
  padLeftPx: number,
  fontSizePx: number,
): { chain: Array<{ uuid: string; el: HTMLElement }>; list: HTMLElement; item: HTMLElement; liLeft: number } {
  const chain: Array<{ uuid: string; el: HTMLElement }> = [];
  let parent: HTMLElement = editorEl;
  let list: HTMLElement | null = null;
  let item: HTMLElement | null = null;
  let liLeft = EDITOR_LEFT;
  for (let d = 1; d <= depth; d++) {
    const listLeft = liLeft;
    liLeft = listLeft + padLeftPx;
    const ul = document.createElement("ul");
    ul.setAttribute("data-uuid", `list${d}`);
    ul.setAttribute("data-text-object-kind", "bulletList");
    ul.style.paddingLeft = `${padLeftPx}px`;
    ul.style.fontSize = `${fontSizePx}px`;
    ul.style.listStyleType = "disc";
    ul.getBoundingClientRect = () => rect(ROW_TOP, ROW_BOTTOM, listLeft);
    const li = document.createElement("li");
    li.setAttribute("data-uuid", `li${d}`);
    li.setAttribute("data-text-object-kind", "listItem");
    const left = liLeft;
    li.getBoundingClientRect = () => rect(ROW_TOP, ROW_BOTTOM, left);
    const p = document.createElement("p");
    p.textContent = `level ${d}`;
    p.style.fontSize = `${fontSizePx}px`;
    p.style.setProperty("--margin-handle-gap", `${GAP_EM}em`);
    p.style.setProperty("--margin-track-width", `${TRACK_EM}em`);
    p.getBoundingClientRect = () => rect(ROW_TOP + 2, ROW_BOTTOM - 2, left);
    li.appendChild(p);
    ul.appendChild(li);
    parent.appendChild(ul);
    chain.unshift({ uuid: `list${d}`, el: ul });
    chain.unshift({ uuid: `li${d}`, el: li });
    parent = li;
    list = ul;
    item = li;
  }
  return { chain, list: list!, item: item!, liLeft };
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
    const bandPx = fontSizePx * BAND_EM; // `.tiptap ul { padding-left: 2.5em }`
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

    for (const depth of [2, 3]) {
      it(`nested list level ${depth} @${fontSizePx}px: the TOP ROW's two handles clear the bullet`, () => {
        // Task 425: a container's handle shows only on its own top row, so a
        // deep top row is exactly where TWO handles must fit between the margin
        // floor and a bullet that sits `depth` bands in. The hover chain is
        // the FULL containing chain (innermost-first); the set rule keeps the
        // inner item + its own list and drops every outer level.
        const { chain, list, item, liLeft } = buildNestedList(depth, bandPx, fontSizePx);
        const ink = resolveMarkerGeometry(item, "listItem", liLeft, 0).inkLeft;
        const painted = hover(chain);
        expect(
          painted.map((p) => p.uuid).sort(),
          "the set rule leaked an outer level onto the inner top row",
        ).toEqual([item.getAttribute("data-uuid"), list.getAttribute("data-uuid")].sort());
        const glyphLeft = fixtureGlyphLeft(liLeft, "•", fontSizePx);
        for (const p of painted) {
          expect(p.left, `${p.uuid}'s handle is in the margin lane`).toBeGreaterThanOrEqual(FLOOR);
          expect(
            clearance(p.left, ink),
            `${p.uuid}'s handle crosses the resolved ink boundary (left ${p.left}, ink ${ink})`,
          ).toBeGreaterThanOrEqual(minClearance);
          expect(
            clearance(p.left, glyphLeft),
            `${p.uuid}'s handle is on the painted bullet (left ${p.left}, glyph ${glyphLeft})`,
          ).toBeGreaterThan(0);
        }
        // The MEASURED bound the task asked for: the band between the floor and
        // the ink widens by one marker band per level (2em each), so two handles
        // (2 × 12px + the 24px same-row target) fit at every depth with room
        // to spare — no "item wins, list dropped" arm is needed in the lane
        // resolver today, and this leg is what would notice if the band ever
        // narrowed enough to need one.
        const li = painted.find((p) => p.uuid === item.getAttribute("data-uuid"))!;
        const ul = painted.find((p) => p.uuid === list.getAttribute("data-uuid"))!;
        expect(ul.left).toBeLessThan(li.left);
        expect(li.left - ul.left).toBeGreaterThan(20);
      });
    }

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
    //
    // RENEGOTIATED (task 487) in ONE respect: the boundary the 0.25px is
    // measured against is named explicitly as the BAND MIDDLE, which is what
    // `inkLeft` resolved to in 2026-08. Since 487 the ink is the MEASURED glyph
    // (see the marker-geometry legs below), so re-reading the historical number
    // off today's `inkLeft` would be comparing two different boundaries. The
    // live half still asks today's question of today's ink.
    const fontSizePx = 19;
    const bandPx = fontSizePx * 1.5;
    const liLeft = EDITOR_LEFT + bandPx;
    const { list, items } = buildList("ul", bandPx, fontSizePx);
    const ink = resolveMarkerGeometry(items[0], "listItem", liLeft, 0).inkLeft;
    const painted = hover([
      { uuid: "li1", el: items[0] },
      { uuid: "list1", el: list },
    ]);
    const li = painted.find((p) => p.uuid === "li1")!;
    const preFixPush = FLOOR + 24; // what the unbounded separation produced
    const bandMiddle = liLeft - bandPx / 2; // the 382-era boundary
    expect(clearance(preFixPush, bandMiddle)).toBeLessThan(1);
    expect(clearance(li.left, ink)).toBeGreaterThanOrEqual(
      fontSizePx * GAP_EM * INK_CLEARANCE_FACTOR,
    );
  });
});

// ---------------------------------------------------------------------------
// Tasks 483 + 487 — the two top-row handles are two CONTROLS.
//
// 483 measured the pre-487 tree live: on a top-level list's top row the LIST
// handle rendered at x 514.5-526.5 and the ITEM handle at 522.25-534.25 — a
// 4.25px overlap, with the LIST winning the z-order across the shared band, so
// a press in the left of the item's box grabbed the list. 487 is Gabriel's
// ruling about the same geometry, and it replaces "push them apart by a
// constant" with a STRUCTURE: each handle sits in the marker column of its own
// level, so two levels are two columns.
//
// The contract is stated in two tiers, because they have different guarantors:
//
//   • DISJOINT (≥ HANDLE_WIDTH between left edges) is the GUARANTEE. It is what
//     makes the press unambiguous — `applyHitCaps` gives each handle a halo
//     half the distance to its neighbour, so once the boxes are disjoint every
//     point in a box is inside that handle's own halo and no other's.
//   • FLUSH UNDER THE BULLET ABOVE is the RULING, and it holds wherever the
//     row has room; a wide `12.` counter eats the room and the outboard pass
//     trades the alignment for the guarantee (asserted separately, so a
//     failure says which of the two gave way).
// ---------------------------------------------------------------------------
describe("tasks 483/487 — two columns, two controls", () => {
  /** Every probe a press could land on: each handle's centre and 2px inside
   *  each edge of its box. Returns the owner each probe resolves to, or null
   *  where it lands in no box / in two. */
  function probeOwners(painted: Array<{ uuid: string; left: number }>) {
    const probes: Array<{ x: number; want: string }> = [];
    for (const p of painted) {
      probes.push({ x: p.left + 2, want: p.uuid });
      probes.push({ x: p.left + HANDLE_WIDTH / 2, want: p.uuid });
      probes.push({ x: p.left + HANDLE_WIDTH - 2, want: p.uuid });
    }
    return probes.map(({ x, want }) => {
      const hits = painted.filter(
        (p) => x >= p.left && x <= p.left + HANDLE_WIDTH,
      );
      return { x, want, got: hits.length === 1 ? hits[0].uuid : null };
    });
  }

  for (const fontSizePx of [19, 28]) {
    const bandPx = fontSizePx * BAND_EM;

    for (const tag of ["ul", "ol"] as const) {
      it(`top-level ${tag} @${fontSizePx}px: the top row's two handles are disjoint boxes`, () => {
        // 12 items, so the ordered list's widest marker is the two-digit `12.`
        // — the case whose ink eats most of the band.
        const { list, items } = buildList(tag, bandPx, fontSizePx, 12);
        const painted = hover([
          { uuid: "li1", el: items[0] },
          { uuid: "list1", el: list },
        ]);
        expect(painted).toHaveLength(2);
        const [outer, inner] = [...painted].sort((a, b) => a.left - b.left);
        expect(
          inner.left - outer.left,
          `the two handles overlap (${outer.uuid} ${outer.left}, ${inner.uuid} ${inner.left})`,
        ).toBeGreaterThanOrEqual(HANDLE_WIDTH);
        for (const probe of probeOwners(painted)) {
          expect(
            probe.got,
            `a press at x=${probe.x} does not resolve to ${probe.want}`,
          ).toBe(probe.want);
        }
      });
    }

    for (const depth of [2, 3]) {
      it(`nested bullet list level ${depth} @${fontSizePx}px: the container is FLUSH under the parent bullet`, () => {
        // Gabriel's ruling, as the one number that states it: the container
        // handle's RIGHT edge lands on the level-above's content edge — the x
        // its bullet ends at, one row up. Under the retired rule the container
        // stepped an arbitrary `--margin-track-width` off its ITEM's band
        // middle, which is neither under that bullet nor a fixed distance from
        // it.
        const { chain, list, liLeft } = buildNestedList(depth, bandPx, fontSizePx);
        const parentContentLeft = liLeft - bandPx;
        const painted = hover(chain);
        const ul = painted.find((p) => p.uuid === list.getAttribute("data-uuid"))!;
        expect(
          ul.left + HANDLE_WIDTH,
          "the container handle is not right-justified under the parent bullet",
        ).toBe(parentContentLeft);
        // …and its item is still a disjoint control beside it.
        const li = painted.find((p) => p.uuid !== ul.uuid)!;
        expect(li.left - ul.left).toBeGreaterThanOrEqual(HANDLE_WIDTH);
      });
    }

    it(`nested ORDERED list @${fontSizePx}px: a wide counter trades alignment for the guarantee`, () => {
      // The one shape where the ruling cannot hold: a two-digit counter's ink
      // reaches so far into the band that the ITEM's handle, capped against it,
      // lands ON the column the container occupies. The inboard push has no
      // lane left to give, so the OUTBOARD pass moves the container further
      // into the free margin — the boxes separate, and the container is no
      // longer flush. Neutering that pass leaves them overlapping.
      const chain: Array<{ uuid: string; el: HTMLElement }> = [];
      const outer = document.createElement("ol");
      outer.setAttribute("data-uuid", "olOuter");
      outer.setAttribute("data-text-object-kind", "orderedList");
      outer.style.paddingLeft = `${bandPx}px`;
      outer.style.fontSize = `${fontSizePx}px`;
      outer.style.listStyleType = "decimal";
      outer.getBoundingClientRect = () => rect(ROW_TOP, ROW_BOTTOM, EDITOR_LEFT);
      const outerLi = document.createElement("li");
      outerLi.setAttribute("data-uuid", "olLiOuter");
      outerLi.setAttribute("data-text-object-kind", "listItem");
      outerLi.getBoundingClientRect = () => rect(ROW_TOP, ROW_BOTTOM, EDITOR_LEFT + bandPx);
      outer.appendChild(outerLi);
      editorEl.appendChild(outer);
      const innerLeft = EDITOR_LEFT + bandPx;
      const inner = document.createElement("ol");
      inner.setAttribute("data-uuid", "olInner");
      inner.setAttribute("data-text-object-kind", "orderedList");
      inner.style.paddingLeft = `${bandPx}px`;
      inner.style.fontSize = `${fontSizePx}px`;
      inner.style.listStyleType = "decimal";
      inner.getBoundingClientRect = () => rect(ROW_TOP, ROW_BOTTOM, innerLeft);
      const liLeft = innerLeft + bandPx;
      for (let i = 0; i < 12; i++) {
        const li = document.createElement("li");
        li.setAttribute("data-uuid", `olLi${i + 1}`);
        li.setAttribute("data-text-object-kind", "listItem");
        li.getBoundingClientRect = () => rect(ROW_TOP, ROW_BOTTOM, liLeft);
        const para = document.createElement("p");
        para.textContent = `row ${i + 1}`;
        para.style.fontSize = `${fontSizePx}px`;
        para.style.setProperty("--margin-handle-gap", `${GAP_EM}em`);
        para.style.setProperty("--margin-track-width", `${TRACK_EM}em`);
        para.getBoundingClientRect = () => rect(ROW_TOP + 2, ROW_BOTTOM - 2, liLeft);
        li.appendChild(para);
        inner.appendChild(li);
        if (i === 0) chain.push({ uuid: "olLi1", el: li });
      }
      outerLi.appendChild(inner);
      chain.push({ uuid: "olInner", el: inner });
      const painted = hover(chain);
      expect(painted).toHaveLength(2);
      const [ul, li] = [...painted].sort((a, b) => a.left - b.left);
      expect(
        li.left - ul.left,
        `a nested two-digit counter left the handles overlapping (${ul.left}, ${li.left})`,
      ).toBeGreaterThanOrEqual(HANDLE_WIDTH);
      for (const probe of probeOwners(painted)) {
        expect(probe.got, `a press at x=${probe.x} is ambiguous`).toBe(probe.want);
      }
    });
  }
});

describe("the shipped marker band", () => {
  it(`\`.tiptap ul/ol\` is ${BAND_EM}em — the width every geometry leg above assumes`, () => {
    // RENEGOTIATED (task 487). This leg pinned 2em, the width task 382 widened
    // to from 1.5em. Gabriel's placement ruling widens it again — a container's
    // handle occupies the marker column of the level ABOVE it, so the band has
    // to hold the ITEM's handle whole rather than merely leave room for a push.
    // The half no component test can see is the same: reverting the band would
    // leave every geometry leg above passing against a width the app no longer
    // has.
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
      expect(parseFloat(m![1]), `${sel} marker band`).toBeGreaterThanOrEqual(BAND_EM);
    }
  });

  it("…and it satisfies the FITS inequality the ruling rests on", () => {
    // The band must hold one row's geometry: the marker's own ink, its trailing
    // space, the uniform handle gap, the 12px handle box, and a seam. Below
    // that the ITEM handle spills out of its band into the column the CONTAINER
    // handle occupies — which is exactly the ~4px overlap task 483 measured on
    // the pre-487 2em band at the shipped 15.2px prose font (measured here from
    // the same per-character model the geometry legs run against).
    const PROSE_FONT_PX = 15.2; // --editor-font-size, the shipped default
    const bulletInk = modelTextWidth("•", PROSE_FONT_PX);
    const need =
      bulletInk +
      PROSE_FONT_PX * FIXTURE_TRAIL_EM +
      PROSE_FONT_PX * GAP_EM +
      HANDLE_WIDTH;
    expect(
      BAND_EM * PROSE_FONT_PX,
      `the ${BAND_EM}em band does not hold one row's handle geometry`,
    ).toBeGreaterThan(need);
    // …and the retired 2em band does NOT — the defect, stated as a number.
    expect(2 * PROSE_FONT_PX).toBeLessThan(need);
  });
});

describe("resolveMarkerGeometry — the anchor and the ink boundary", () => {
  it("a measured marker IS its own ink (nothing is estimated)", () => {
    const { item } = buildExample(19, 210, 240);
    const g = resolveMarkerGeometry(item, "exampleItem", 300, 20);
    expect(g.inkLeft).toBe(g.markerLeft);
  });

  it("a bullet's MEASURED glyph is both its anchor and its ink", () => {
    // RENEGOTIATED (task 487). This leg read "a bullet keeps the band-middle
    // anchor: the measurement doesn't loosen it", pinning `markerLeft` at
    // `li.left − padding/2`. The band middle was always a STAND-IN for a glyph
    // the `::marker` pseudo gives no rect for, and its justification ("the
    // glyph stays in the band's right half") is a fact about a 2em band, not
    // about the marker: at the 2.5em the ruling requires it drifts steadily
    // further left of the bullet, detaching the item's handle from the very
    // thing it labels. Where the string CAN be measured, the measurement is the
    // answer for both fields — and it is still conservative (it subtracts a
    // trailing-space allowance).
    const { items } = buildList("ul", 38, 19);
    const g = resolveMarkerGeometry(items[0], "listItem", EDITOR_LEFT + 38, 0);
    expect(g.markerLeft).toBe(fixtureGlyphLeft(EDITOR_LEFT + 38, "•", 19));
    expect(g.inkLeft).toBe(g.markerLeft);
    // …and it reads RIGHT of the retired band middle, which is the whole point:
    // the handle hugs the bullet instead of hovering in the empty band.
    expect(g.markerLeft).toBeGreaterThan(EDITOR_LEFT + 38 - 19);
  });

  it("a wide `12.` reads further left than a bullet — one number, measured", () => {
    // RENEGOTIATED (task 487): the old leg asserted the anchor stayed at the
    // band middle while the INK tightened past it. Anchor and ink are one
    // number now, so what it says is that the wide counter moves BOTH.
    const { items } = buildList("ol", 38, 19, 12);
    const g = resolveMarkerGeometry(items[0], "listItem", EDITOR_LEFT + 38, 0);
    expect(g.markerLeft).toBe(g.inkLeft);
    expect(g.inkLeft).toBe(fixtureGlyphLeft(EDITOR_LEFT + 38, "12.", 19));
    expect(g.inkLeft).toBeLessThan(EDITOR_LEFT + 38 - 19); // past the band middle
  });

  it("`list-style-type: none` puts the ink at the item's own content edge", () => {
    // RENEGOTIATED (task 487) to match this leg's own TITLE: pre-487 the `min`
    // against the band middle overrode the "nothing renders in the band"
    // answer, so the assertion said band middle while the name said content
    // edge. With the measurement answering alone, the two agree.
    const { items, list } = buildList("ul", 38, 19);
    list.style.listStyleType = "none";
    const g = resolveMarkerGeometry(items[0], "listItem", EDITOR_LEFT + 38, 0);
    expect(g.inkLeft).toBe(EDITOR_LEFT + 38);
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
    // RENEGOTIATED (task 487). The old second half read "…while its ANCHOR
    // steps one track-width further out" — the retired rule. A container has no
    // marker of its own, so it OCCUPIES the marker column of the level above
    // instead of stepping an arbitrary token off its item's. This fixture's
    // list is TOP-LEVEL (nothing above it carries a marker column), so there is
    // no column to occupy and it falls back to the ordinary gutter slot: its
    // own content edge, exactly as a paragraph's handle does.
    expect(container.columnRight).toBeNull();
    expect(container.markerLeft).toBe(EDITOR_LEFT);
  });

  it("a NESTED container occupies the marker column of the level above", () => {
    // Gabriel's ruling (task 487), as geometry: the container's handle is
    // right-justified to the level-above's content edge — which for a
    // block-level list IS the list's own left — so it lands directly under the
    // parent row's bullet.
    const { list, item, liLeft } = buildNestedList(2, 38, 19);
    const g = resolveMarkerGeometry(list, "bulletList", liLeft, 24);
    expect(g.columnRight).toBe(liLeft - 38); // the parent li's content edge
    expect(g.inkLeft).toBe(
      resolveMarkerGeometry(item, "listItem", liLeft, 0).inkLeft,
    );
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
  const base = {
    gapPx: 12,
    editorColumnLeft: EDITOR_LEFT,
    baselineInset: MARGIN_INSET,
    columnRight: null,
    // Task 526: these legs are about the three bounds ABOVE the chevron rung —
    // a row with no reserved chevron column, which is every non-heading block.
    chevronRight: null,
  };

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

  it("a COLUMN anchor is FLUSH RIGHT — no gap, that is what 'under the bullet' means", () => {
    // Task 487: the two readings of the anchor. A block with a marker hugs it
    // one gap out; a container OCCUPIES the empty column above, right-justified
    // to its inner edge. The gap is what separates a handle from ink, and there
    // is no ink in that column on this row.
    const lane = resolveHandleLane({ ...base, markerLeft: 400, inkLeft: 400, columnRight: 360 });
    expect(lane.left).toBe(360 - HANDLE_WIDTH);
    // …and `markerLeft` is ignored entirely when a column is declared, so the
    // two readings can never be blended into a third.
    const other = resolveHandleLane({ ...base, markerLeft: 999, inkLeft: 400, columnRight: 360 });
    expect(other.left).toBe(lane.left);
  });

  it("minLeft is the floor — the room the OUTBOARD pass may take", () => {
    const lane = resolveHandleLane({ ...base, markerLeft: 400, inkLeft: 400 });
    expect(lane.minLeft).toBe(FLOOR);
  });
});
