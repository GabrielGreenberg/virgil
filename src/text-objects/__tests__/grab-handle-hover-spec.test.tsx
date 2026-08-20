// @vitest-environment jsdom
//
// Task 394 — Gabriel's grab-handle spec, RENEGOTIATED by its own author, driven
// as a CONTRACT on the real component over a rendered 3-item list AND over the
// nested list he screenshotted.
//
// SPEC POINTS 1-2 ARE UNCHANGED (task 353, verbatim): the FULL-LIST handle is
// visible while the pointer is anywhere over the list; in addition exactly ONE
// item handle shows, the item the pointer is on. Every set-membership leg below
// is 353's, untouched.
//
// WHAT 394 FLIPS is the VERTICAL policy. 353 measured this on a FLAT list and
// concluded the container must anchor to the HOVERED row ("a container and its
// item produce the SAME opticalCenterY"), which the implementation delivered by
// threading a `descendTo` hint into `resolveFirstLineTarget`. On a NESTED list
// that stacks ONE HANDLE PER CONTAINING LEVEL onto a single row — Gabriel's
// screenshot shows three bunched on "locations", the innermost shoved onto the
// bullet glyph. His renegotiated rule:
//
//     Every handle anchors at its OWN block's first visual line, at its own
//     marker-derived X. The hovered (lowest) node contributes exactly one
//     handle, on its own row.
//
// So on the flat list the list handle sits beside ROW 1 — which is the list's
// own first line — and the item handle sits on the hovered row:
//
//     hover item 1   item (202,202)   list (178,202)   ← coincident: 353's
//                                                        separation + 382's cap
//     hover item 2   item (198,242)   list (178,202)   ← distinct rows
//     hover item 3   item (198,282)   list (178,202)   ← distinct rows
//
// Row 1 is a GENUINE coincidence (a list's first line IS its first item's), so
// the 353 same-row separation and the 382 ink cap still govern it — which is
// why item 1's X (202) differs from items 2-3's resting 198. That is the
// separation doing its job, not drift.
//
// These legs assert set membership and PLACEMENT by OWNER (`data-grab-owner-*`),
// never by count — the original mis-filing happened precisely because the only
// way to ask "whose handle is that?" was to eyeball dots.
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
const PORTAL_ORIGIN = { top: 100, left: 40 };
vi.mock("@/lib/editor-geometry/use-viewport-frame", () => ({
  useViewportFrame: () => ({ frameRef: { current: frame }, version: 0 }),
}));
vi.mock("@/lib/marginalia-blocks", () => ({ resolveDomForUuid: () => null }));

import { TextObjectGrabHandle } from "@/text-objects/TextObjectGrabHandle";
import { notePointerInput } from "@/lib/input-modality";

function rect(top: number, bottom: number, left = 200, right = 700): DOMRect {
  return { top, bottom, left, right, width: right - left, height: bottom - top,
    x: left, y: top, toJSON: () => ({}) } as DOMRect;
}
let editorEl: HTMLElement, listEl: HTMLElement;
const items: HTMLElement[] = [];
const ROWS = [ { t: 300, b: 340 }, { t: 340, b: 380 }, { t: 380, b: 420 } ];

function buildListDom() {
  items.length = 0;
  editorEl = document.createElement("div");
  editorEl.className = "ProseMirror";
  Object.defineProperty(editorEl, "offsetHeight", { value: 800, configurable: true });
  editorEl.getBoundingClientRect = () => rect(0, 800, 200, 700);
  listEl = document.createElement("ul");
  listEl.setAttribute("data-uuid", "ul1");
  listEl.setAttribute("data-text-object-kind", "bulletList");
  listEl.getBoundingClientRect = () => rect(300, 420, 230, 700);
  ROWS.forEach((r, i) => {
    const li = document.createElement("li");
    li.setAttribute("data-uuid", `li${i + 1}`);
    li.setAttribute("data-text-object-kind", "listItem");
    li.getBoundingClientRect = () => rect(r.t, r.b, 260, 700);
    const p = document.createElement("p");
    p.textContent = `item ${i + 1}`;
    p.getBoundingClientRect = () => rect(r.t + 2, r.b - 2, 260, 700);
    li.appendChild(p); listEl.appendChild(li); items.push(li);
  });
  editorEl.appendChild(listEl);
  document.body.appendChild(editorEl);
}
let frame: Record<string, unknown>;
function buildFrame() {
  const portal = document.createElement("div");
  portal.setAttribute("data-grab-handle-portal", "");
  const column = document.createElement("div");
  column.appendChild(portal);
  document.body.appendChild(column);
  frame = { editorEl, contentLeft: 260, editorRight: 700, scrollTop: 0, scrollBottom: 800,
    marginInset: 22, paperEl: column, paperRect: PORTAL_ORIGIN,
    containsHoverZone: (x: number, y: number) => x >= 200 && x <= 700 && y >= 0 && y <= 800,
    toPortalCoords: (x: number, y: number) => ({ x: x - PORTAL_ORIGIN.left, y: y - PORTAL_ORIGIN.top }) };
}
let handlers: Record<string, Set<(p: unknown) => void>>;
function fakeEditor(): Editor {
  handlers = { update: new Set(), selectionUpdate: new Set() };
  const itemNode = { type: { name: "listItem" }, attrs: { uuid: "li1" } };
  const resolved = { depth: 1, node: (d: number) => (d === 1 ? itemNode : { type: { name: "doc" }, attrs: {} }), before: () => 0 };
  return { isDestroyed: false, isEditable: true,
    state: { selection: { from: 5, to: 5 }, doc: { resolve: () => resolved } },
    view: { dom: editorEl, coordsAtPos: () => ({ top: 305, bottom: 320, left: 262, right: 263 }), nodeDOM: () => items[0] },
    on: (n: string, f: (p: unknown) => void) => handlers[n]?.add(f),
    off: (n: string, f: (p: unknown) => void) => handlers[n]?.delete(f) } as unknown as Editor;
}
let rafQueue: FrameRequestCallback[] = [];
const flushFrames = () => act(() => { for (let i = 0; i < 4 && rafQueue.length; i++) { const q = rafQueue; rafQueue = []; for (const cb of q) cb(0); } });
beforeEach(() => {
  rafQueue = []; blocksAtY.mockReset(); buildListDom(); buildFrame(); notePointerInput();
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => { rafQueue.push(cb); return rafQueue.length; });
  vi.stubGlobal("cancelAnimationFrame", () => { rafQueue = []; });
});
afterEach(() => { cleanup(); document.body.innerHTML = ""; vi.unstubAllGlobals(); notePointerInput(); });

function hoverRow(i: number) {
  // The resolver's answer for a pointer on row i: that item + its container.
  blocksAtY.mockImplementation(() => [
    { uuid: `li${i + 1}`, el: items[i] },
    { uuid: "ul1", el: listEl },
  ]);
  const editorRef = { current: fakeEditor() };
  render(<TextObjectGrabHandle editorRef={editorRef} />);
  act(() => {
    document.dispatchEvent(new MouseEvent("mousemove", {
      clientX: 400, clientY: (ROWS[i].t + ROWS[i].b) / 2, bubbles: true }));
  });
  flushFrames();
}
function snapshot() {
  return [...document.querySelectorAll<HTMLElement>(".text-object-grab-handle")].map((el) => ({
    left: el.style.left, top: el.style.top,
    ownerUuid: el.getAttribute("data-grab-owner-uuid"),
    ownerKind: el.getAttribute("data-grab-owner-kind"),
  }));
}

const OWNERS = () =>
  [...document.querySelectorAll<HTMLElement>(".text-object-grab-handle")].map((el) => ({
    uuid: el.getAttribute("data-grab-owner-uuid"),
    kind: el.getAttribute("data-grab-owner-kind"),
    left: parseFloat(el.style.left),
    top: parseFloat(el.style.top),
  }));

describe("Gabriel's spec, as a contract", () => {
  for (const i of [0, 1, 2]) {
    it(`hovering item ${i + 1}: the full-list handle + ONLY that item's`, () => {
      hoverRow(i);
      const owners = OWNERS();
      expect(
        owners.map((o) => o.uuid).sort(),
        "the wrong set of handles is painted",
      ).toEqual([`li${i + 1}`, "ul1"].sort());
      // …and no OTHER item's handle, stated as its own assertion so a failure
      // names the sibling rather than a count.
      const strangers = owners.filter(
        (o) => o.kind === "listItem" && o.uuid !== `li${i + 1}`,
      );
      expect(strangers, "a non-hovered item's handle is lit").toEqual([]);
    });

    it(`hovering item ${i + 1}: each handle sits on its OWN structure's row`, () => {
      // Task 394's whole point. The item handle tracks the pointer; the LIST
      // handle stays beside the LIST's first line, whichever row is hovered —
      // so the gutter reads as a structural breadcrumb instead of a pile.
      hoverRow(i);
      const owners = OWNERS();
      const item = owners.find((o) => o.uuid === `li${i + 1}`)!;
      const list = owners.find((o) => o.uuid === "ul1")!;
      // Each row's optical center is its inner <p>'s top (jsdom reports a zero
      // cap-band offset), in portal coords (viewport − PORTAL_ORIGIN.top).
      const rowTop = (n: number) => ROWS[n].t + 2 - PORTAL_ORIGIN.top;
      expect(item.top, "the item handle is not on the hovered row").toBe(rowTop(i));
      expect(list.top, "the list handle left its own first row").toBe(rowTop(0));
    });

    it(`hovering item ${i + 1}: the container stays OUTBOARD of the item`, () => {
      hoverRow(i);
      const owners = OWNERS();
      const item = owners.find((o) => o.uuid === `li${i + 1}`)!;
      const list = owners.find((o) => o.uuid === "ul1")!;
      // Stacking ORDER, stated once and true at every row: the container's
      // marker-derived slot is one track-width outboard of its item's.
      expect(list.left).toBeLessThan(item.left);
      if (i === 0) {
        // Row 1 is a GENUINE coincidence — the list's own first line IS item
        // 1's — so 353's separation still applies: handles are 12px wide, so
        // this is a real void between the boxes rather than two glyphs
        // touching.
        expect(list.top).toBe(item.top);
        expect(Math.abs(item.left - list.left)).toBeGreaterThanOrEqual(24);
      } else {
        // Distinct rows: nothing to separate, so no push, and the item keeps
        // its resting slot.
        expect(Math.abs(list.top - item.top)).toBeGreaterThan(16);
      }
    });
  }

  it("X alignment is consistent across the items of one list", () => {
    // The drift visible between Gabriel's screenshots. Rows 2-3 are the RESTING
    // slot; row 1 is excluded here and pinned by the leg above, because there
    // the same-row separation legitimately pushes the item inboard.
    const lefts: number[] = [];
    for (const i of [1, 2]) {
      hoverRow(i);
      lefts.push(OWNERS().find((o) => o.uuid === `li${i + 1}`)!.left);
      cleanup();
      document.body.innerHTML = "";
      buildListDom();
      buildFrame();
    }
    expect(new Set(lefts).size, `item handle X drifted: ${lefts.join(", ")}`).toBe(1);
  });

  it("the container handle stays OUT of the margin lane", () => {
    // The separation pushes the INNER handle inboard precisely because the
    // outer one is already on `editorColumnLeft - marginInset` and must not be
    // taken further out.
    hoverRow(1);
    const list = OWNERS().find((o) => o.uuid === "ul1")!;
    expect(list.left).toBeGreaterThanOrEqual(200 - 22);
  });
});

// ---------------------------------------------------------------------------
// Task 394 — the NESTED shape Gabriel screenshotted. This is the fixture no
// pre-394 suite had: every grab-handle suite in the repo drives a FLAT list,
// where a container has exactly one containing level and "one handle per level
// on the hovered row" is indistinguishable from "one handle". The defect needs
// FOUR containing levels to be representable at all.
//
//   ulOuter                                   rows 300-460
//     liA   "outer item one"                  rows 300-340
//     liB   "outer item two"                  rows 340-460
//       <p>                                   rows 340-380  ← liB's own line
//       ulInner                               rows 380-460
//         liC "Ordinary objects"              rows 380-420
//         liD "locations"                     rows 420-460  ← hovered
// ---------------------------------------------------------------------------

const NEST = {
  outerList: { t: 300, b: 460, left: 230 },
  liA: { t: 300, b: 340, left: 260 },
  liB: { t: 340, b: 460, left: 260 },
  liBp: { t: 340, b: 380, left: 260 },
  innerList: { t: 380, b: 460, left: 260 },
  liC: { t: 380, b: 420, left: 290 },
  liD: { t: 420, b: 460, left: 290 },
};
/** Portal-space top a level's handle must take: its own first line's box top. */
const nestTop = (r: { t: number }) => r.t + 2 - PORTAL_ORIGIN.top;

let nestEls: Record<string, HTMLElement>;

function buildNestedDom() {
  editorEl = document.createElement("div");
  editorEl.className = "ProseMirror";
  Object.defineProperty(editorEl, "offsetHeight", { value: 800, configurable: true });
  editorEl.getBoundingClientRect = () => rect(0, 800, 200, 700);

  const mk = (
    tag: string,
    uuid: string | null,
    kind: string | null,
    r: { t: number; b: number; left: number },
  ) => {
    const el = document.createElement(tag);
    if (uuid) el.setAttribute("data-uuid", uuid);
    if (kind) el.setAttribute("data-text-object-kind", kind);
    el.getBoundingClientRect = () => rect(r.t, r.b, r.left, 700);
    return el;
  };
  // A list item's first-line target is its DIRECT inner <p> (text-metrics
  // `descendListItem`), so each <li> gets one whose rect is its own first row.
  const withPara = (li: HTMLElement, r: { t: number; b: number; left: number }) => {
    const para = document.createElement("p");
    para.getBoundingClientRect = () => rect(r.t + 2, r.b - 2, r.left, 700);
    li.appendChild(para);
    return li;
  };

  const outerList = mk("ul", "ulOuter", "bulletList", NEST.outerList);
  const liA = withPara(mk("li", "liA", "listItem", NEST.liA), NEST.liA);
  const liB = mk("li", "liB", "listItem", NEST.liB);
  const liBp = document.createElement("p");
  liBp.getBoundingClientRect = () => rect(NEST.liBp.t + 2, NEST.liBp.b - 2, NEST.liBp.left, 700);
  liB.appendChild(liBp);
  const innerList = mk("ul", "ulInner", "bulletList", NEST.innerList);
  const liC = withPara(mk("li", "liC", "listItem", NEST.liC), NEST.liC);
  const liD = withPara(mk("li", "liD", "listItem", NEST.liD), NEST.liD);
  innerList.append(liC, liD);
  liB.appendChild(innerList);
  outerList.append(liA, liB);
  editorEl.appendChild(outerList);
  document.body.appendChild(editorEl);
  nestEls = { outerList, liA, liB, innerList, liC, liD };
}

/** The containing chain the Y-scan returns, innermost-first, for a pointer Y. */
function chainAt(y: number): Array<{ uuid: string; el: HTMLElement }> {
  const hit = (uuid: string, key: string, r: { t: number; b: number }) =>
    y >= r.t && y <= r.b ? [{ uuid, el: nestEls[key] }] : [];
  return [
    ...hit("liD", "liD", NEST.liD),
    ...hit("liC", "liC", NEST.liC),
    ...hit("ulInner", "innerList", NEST.innerList),
    ...hit("liB", "liB", NEST.liB),
    ...hit("liA", "liA", NEST.liA),
    ...hit("ulOuter", "outerList", NEST.outerList),
  ];
}

function movePointerTo(y: number) {
  act(() => {
    document.dispatchEvent(
      new MouseEvent("mousemove", { clientX: 400, clientY: y, bubbles: true }),
    );
  });
  flushFrames();
}

describe("task 394 — nested list: handles arrange hierarchically", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    buildNestedDom();
    buildFrame();
    blocksAtY.mockImplementation((y: number) => chainAt(y));
    notePointerInput();
  });

  it("hovering the deepest item paints FOUR handles at FOUR distinct rows", () => {
    render(<TextObjectGrabHandle editorRef={{ current: fakeEditor() }} />);
    movePointerTo(440);
    const owners = OWNERS();
    expect(
      owners.map((o) => o.uuid).sort(),
      "the wrong set of handles is painted",
    ).toEqual(["liB", "liD", "ulInner", "ulOuter"].sort());

    const by = (uuid: string) => owners.find((o) => o.uuid === uuid)!;
    // Each level beside its OWN structure's first visual line. This is the
    // whole renegotiation: pre-394 every one of these read nestTop(NEST.liD).
    expect(by("ulOuter").top, "outer list left its own first row").toBe(nestTop(NEST.liA));
    expect(by("liB").top, "outer item left its own first row").toBe(nestTop(NEST.liBp));
    expect(by("ulInner").top, "inner list left its own first row").toBe(nestTop(NEST.liC));
    expect(by("liD").top, "the hovered item is not on the hovered row").toBe(nestTop(NEST.liD));

    // …and no two of them share a visual row, so nothing bunches.
    const tops = owners.map((o) => o.top).sort((a, b) => a - b);
    for (let i = 1; i < tops.length; i++) {
      expect(tops[i] - tops[i - 1], `handles bunched at ${tops[i]}`).toBeGreaterThan(16);
    }
  });

  it("outer levels sit further LEFT, by their own indent", () => {
    render(<TextObjectGrabHandle editorRef={{ current: fakeEditor() }} />);
    movePointerTo(440);
    const by = (uuid: string) => OWNERS().find((o) => o.uuid === uuid)!;
    // The gutter reads outward-in: outer list < outer item < inner list < item.
    expect(by("ulOuter").left).toBeLessThan(by("liB").left);
    expect(by("liB").left).toBeLessThan(by("ulInner").left);
    expect(by("ulInner").left).toBeLessThan(by("liD").left);
  });

  it("travelling UP to a container's handle keeps that handle alive, in place", () => {
    // The UX risk of distributing vertically, and the reason this leg drives
    // ONE mounted component across two pointer positions rather than two
    // renders: the user aims at a handle that is rows away from the text they
    // were hovering, and the pointer crosses rows on the way.
    render(<TextObjectGrabHandle editorRef={{ current: fakeEditor() }} />);
    movePointerTo(440);
    const before = OWNERS().find((o) => o.uuid === "ulOuter")!;

    // Up through the inner list's first row…
    movePointerTo(400);
    expect(
      OWNERS().find((o) => o.uuid === "ulOuter"),
      "the outer list handle vanished mid-travel",
    ).toBeTruthy();

    // …and on to the outer list's own first row, where its handle lives.
    movePointerTo(320);
    const after = OWNERS().find((o) => o.uuid === "ulOuter")!;
    expect(after, "the outer list handle vanished on arrival").toBeTruthy();
    expect({ top: after.top, left: after.left }).toEqual({
      top: before.top,
      left: before.left,
    });
  });
});

