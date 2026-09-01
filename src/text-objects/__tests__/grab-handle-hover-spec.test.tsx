// @vitest-environment jsdom
//
// Task 425 — Gabriel's grab-handle spec, RENEGOTIATED a third time by its own
// author, driven as a CONTRACT on the real component over a rendered 3-item
// list AND over a nested list.
//
// THE SET (task 425, Gabriel 2026-08-22, superseding 353 points 1-2 and 394):
//
//     If you are at the top row of a list of nested items, you get two
//     handles — one for the item, one for the list. If you are not at the
//     top row, you get one — for that item. The same rule applies up and
//     down the hierarchy.
//
// So the hovered item ALWAYS has its handle; a container has one ONLY when
// the hovered line is that container's own top row — structurally, its first
// ITEM (a wrapped first item hovered on its second visual line still counts).
// The visible set is ≤2 by construction, and it is decided at the SET level
// (`restrictToTopRowSet` → `isTopRowOf`), never by computing every level's
// placement and discarding the ones off the hovered row.
//
// 353's set legs ("the full-list handle + ONLY that item's", on EVERY row) are
// RENEGOTIATED below with the reason at the site: they pinned the list handle
// on rows 2-3, which this rule says is wrong. 394's PLACEMENT is untouched —
// each level at its own first line — because under this rule a container's
// first line IS the hovered row whenever its handle shows at all.
//
// WHAT 394 FLIPPED was the VERTICAL policy. 353 measured this on a FLAT list and
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
// So on the flat list, under 425's set on top of 394's placement:
//
//     hover item 1   item (202,202)   list (178,202)   ← row 1 IS the list's
//                                                        top row: two handles,
//                                                        353's separation +
//                                                        382's cap govern
//     hover item 2   item (198,242)   — no list handle —
//     hover item 3   item (198,282)   — no list handle —
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
import type { EditorViewportFrame } from "@/lib/editor-geometry/viewport-frame";
import { buildHandleTestFrame } from "./_handle-frame";
import { notePointerInput } from "@/lib/input-modality";
import { HANDLE_WIDTH } from "@/text-objects/handle-layout";

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
let frame: EditorViewportFrame;
function buildFrame() {
  const portal = document.createElement("div");
  portal.setAttribute("data-grab-handle-portal", "");
  const column = document.createElement("div");
  column.appendChild(portal);
  document.body.appendChild(column);
  frame = buildHandleTestFrame({ editorEl, contentLeft: 260, editorRight: 700,
    scrollTop: 0, scrollBottom: 800, paperEl: column, paperRect: PORTAL_ORIGIN });
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

/** Portal-space top of flat row n: its inner <p>'s top (jsdom reports a zero
 *  cap-band offset), viewport − PORTAL_ORIGIN.top. */
const rowTop = (n: number) => ROWS[n].t + 2 - PORTAL_ORIGIN.top;

describe("Gabriel's spec, as a contract", () => {
  it("hovering item 1 (the list's top row): item 1's handle + the list's", () => {
    hoverRow(0);
    const owners = OWNERS();
    expect(
      owners.map((o) => o.uuid).sort(),
      "the wrong set of handles is painted",
    ).toEqual(["li1", "ul1"].sort());
    const item = owners.find((o) => o.uuid === "li1")!;
    const list = owners.find((o) => o.uuid === "ul1")!;
    // Both on row 1 — the list's own first line IS item 1's (394's placement).
    expect(item.top, "the item handle is not on the hovered row").toBe(rowTop(0));
    expect(list.top, "the list handle left its own first row").toBe(rowTop(0));
    // Stacking ORDER: the container's marker-derived slot is one track-width
    // outboard of its item's, and 353's separation still applies on this
    // genuinely shared row: handles are 12px wide, so this is a real void
    // between the boxes rather than two glyphs touching.
    expect(list.left).toBeLessThan(item.left);
    expect(Math.abs(item.left - list.left)).toBeGreaterThanOrEqual(24);
  });

  for (const i of [1, 2]) {
    it(`hovering item ${i + 1} (not the top row): ONLY that item's handle`, () => {
      // RENEGOTIATED (task 425). Task 353's leg here read "the full-list
      // handle + ONLY that item's" and asserted `[li${i+1}, ul1]` — the list
      // handle on EVERY row. Gabriel's 2026-08-22 rule: off the top row you
      // get ONE handle, the item's; to grab the list you go to row 1. The
      // defect the old leg pinned as the contract was the extra handle.
      hoverRow(i);
      const owners = OWNERS();
      expect(
        owners.map((o) => o.uuid),
        "the wrong set of handles is painted",
      ).toEqual([`li${i + 1}`]);
      expect(
        owners.find((o) => o.uuid === "ul1"),
        "the list handle is lit on a row that is not the list's top row",
      ).toBeUndefined();
      // …and no OTHER item's handle, stated as its own assertion so a failure
      // names the sibling rather than a count.
      const strangers = owners.filter(
        (o) => o.kind === "listItem" && o.uuid !== `li${i + 1}`,
      );
      expect(strangers, "a non-hovered item's handle is lit").toEqual([]);
      // The item handle is on the hovered row, at its RESTING slot — there is
      // nothing on the row to separate from.
      const item = owners[0];
      expect(item.top, "the item handle is not on the hovered row").toBe(rowTop(i));
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
    // RENEGOTIATED (task 487) in BOTH of its halves.
    //
    // Its premise was the pre-487 anchor: "the separation pushes the INNER
    // handle inboard precisely because the outer one is already on
    // `editorColumnLeft - marginInset` and must not be taken further out."
    // Under Gabriel's placement ruling a container no longer steps an arbitrary
    // `--margin-track-width` off its item's band and so no longer normally
    // clamps at the floor — it takes the marker column of the level above (or,
    // with no such column, the ordinary gutter slot). The floor is still the
    // bound; the outer handle simply is not usually sitting on it, which is
    // exactly the room task 487's OUTBOARD pass spends.
    //
    // Its ARITHMETIC was also wrong, and passed by coincidence: `OWNERS().left`
    // is read off `style.left`, i.e. PORTAL space, while `200 - 22` is the
    // floor in VIEWPORT space. On the pre-487 tree the container landed at
    // portal 178 exactly (band middle 260 − track 20 − gap 10 − width 12 = 218
    // viewport, − the portal origin's 40), so a bound that was 40px too strict
    // was satisfied by equality. The floor is converted here, once, from the
    // same two numbers the fixture declares.
    hoverRow(0);
    const owners = OWNERS();
    const list = owners.find((o) => o.uuid === "ul1")!;
    const item = owners.find((o) => o.uuid === "li1")!;
    const floorPortal = 200 - 22 - PORTAL_ORIGIN.left; // editorLeft − inset
    expect(
      list.left,
      "the container handle was taken outboard of the narrow-viewport floor",
    ).toBeGreaterThanOrEqual(floorPortal);
    // …and the thing the floor exists to protect on this row: the two handles
    // are still two DISJOINT boxes (task 483 — the guarantee under 353's 24px
    // target), so no press in either box is ambiguous.
    expect(item.left - list.left).toBeGreaterThanOrEqual(HANDLE_WIDTH);
  });
});

// ---------------------------------------------------------------------------
// Task 425 — "top row" is STRUCTURAL (the list's first ITEM), not geometric
// (the first visual line). A two-line first item hovered on its SECOND visual
// line still shows item 1 + the list, both placed at item 1's first line — one
// visual row above the pointer. This is the fixture that separates the
// structural reading from the tempting pixel-equality one (compute every
// level's placement, keep the ones whose Y equals the innermost's): on a
// wrapped first item the two readings DIFFER, and only the structural one
// matches Gabriel's rule.
// ---------------------------------------------------------------------------
describe("task 425 — a wrapped first item is still the list's top row", () => {
  const WRAP_ROWS = [ { t: 300, b: 380 }, { t: 380, b: 420 }, { t: 420, b: 460 } ];

  function buildWrappedListDom() {
    items.length = 0;
    editorEl = document.createElement("div");
    editorEl.className = "ProseMirror";
    Object.defineProperty(editorEl, "offsetHeight", { value: 800, configurable: true });
    editorEl.getBoundingClientRect = () => rect(0, 800, 200, 700);
    listEl = document.createElement("ul");
    listEl.setAttribute("data-uuid", "ul1");
    listEl.setAttribute("data-text-object-kind", "bulletList");
    listEl.getBoundingClientRect = () => rect(300, 460, 230, 700);
    WRAP_ROWS.forEach((r, i) => {
      const li = document.createElement("li");
      li.setAttribute("data-uuid", `li${i + 1}`);
      li.setAttribute("data-text-object-kind", "listItem");
      li.getBoundingClientRect = () => rect(r.t, r.b, 260, 700);
      const p = document.createElement("p");
      p.textContent = i === 0 ? "a first item long enough to wrap onto a second line" : `item ${i + 1}`;
      p.getBoundingClientRect = () => rect(r.t + 2, r.b - 2, 260, 700);
      li.appendChild(p); listEl.appendChild(li); items.push(li);
    });
    editorEl.appendChild(listEl);
    document.body.appendChild(editorEl);
  }

  beforeEach(() => {
    document.body.innerHTML = "";
    buildWrappedListDom();
    buildFrame();
    notePointerInput();
  });

  it("hovering item 1's SECOND visual line paints item 1 + the list, both at item 1's first line", () => {
    blocksAtY.mockImplementation(() => [
      { uuid: "li1", el: items[0] },
      { uuid: "ul1", el: listEl },
    ]);
    render(<TextObjectGrabHandle editorRef={{ current: fakeEditor() }} />);
    // y=360: inside item 1 (300-380) but on its second visual line (~340-380).
    movePointerTo(360);
    const owners = OWNERS();
    expect(owners.map((o) => o.uuid).sort()).toEqual(["li1", "ul1"].sort());
    const firstLine = WRAP_ROWS[0].t + 2 - PORTAL_ORIGIN.top;
    expect(owners.find((o) => o.uuid === "li1")!.top, "the item handle left its first line").toBe(firstLine);
    expect(owners.find((o) => o.uuid === "ul1")!.top, "the list handle left the list's first line").toBe(firstLine);
  });

  it("hovering item 2 (the row directly under the wrapped item) paints item 2 only", () => {
    blocksAtY.mockImplementation(() => [
      { uuid: "li2", el: items[1] },
      { uuid: "ul1", el: listEl },
    ]);
    render(<TextObjectGrabHandle editorRef={{ current: fakeEditor() }} />);
    movePointerTo(400);
    expect(OWNERS().map((o) => o.uuid)).toEqual(["li2"]);
  });
});

// ---------------------------------------------------------------------------
// Task 394's NESTED shape, now swept per row under task 425's set. This is the
// fixture no pre-394 suite had: every grab-handle suite in the repo drove a
// FLAT list, where a container has exactly one containing level and the three
// statements of the rule (353 / 394 / 425) differ only on row 1's X. Under 425
// the nested fixture is what separates the rules: 394 painted FOUR handles on
// three rows when liD was hovered; 425 paints ONE.
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

describe("task 425 — nested list: a container's handle only on its own top row", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    buildNestedDom();
    buildFrame();
    blocksAtY.mockImplementation((y: number) => chainAt(y));
    notePointerInput();
  });

  it("hovering liA (the outer list's top row) paints liA + ulOuter, both on that row", () => {
    render(<TextObjectGrabHandle editorRef={{ current: fakeEditor() }} />);
    movePointerTo(320);
    const owners = OWNERS();
    expect(owners.map((o) => o.uuid).sort()).toEqual(["liA", "ulOuter"].sort());
    const by = (uuid: string) => owners.find((o) => o.uuid === uuid)!;
    expect(by("liA").top).toBe(nestTop(NEST.liA));
    expect(by("ulOuter").top, "outer list left its own first row").toBe(nestTop(NEST.liA));
    expect(by("ulOuter").left, "the container is not outboard of its item").toBeLessThan(by("liA").left);
  });

  it("hovering liB's own line (outer row 2, not a top row) paints liB only", () => {
    render(<TextObjectGrabHandle editorRef={{ current: fakeEditor() }} />);
    movePointerTo(360);
    const owners = OWNERS();
    expect(owners.map((o) => o.uuid)).toEqual(["liB"]);
    expect(owners[0].top).toBe(nestTop(NEST.liBp));
  });

  it("hovering liC (the INNER list's top row) paints liC + ulInner — never liB, never ulOuter", () => {
    render(<TextObjectGrabHandle editorRef={{ current: fakeEditor() }} />);
    movePointerTo(400);
    const owners = OWNERS();
    expect(
      owners.map((o) => o.uuid).sort(),
      "the wrong set of handles is painted",
    ).toEqual(["liC", "ulInner"].sort());
    // Named separately so a failure says WHICH outer level leaked rather than
    // reporting a count: liC is the inner list's top row and NOT the outer
    // item's (liB's own line is its paragraph) nor the outer list's (liA).
    expect(owners.find((o) => o.uuid === "liB"), "the outer ITEM leaked onto the inner top row").toBeUndefined();
    expect(owners.find((o) => o.uuid === "ulOuter"), "the outer LIST leaked onto the inner top row").toBeUndefined();
    const by = (uuid: string) => owners.find((o) => o.uuid === uuid)!;
    expect(by("liC").top).toBe(nestTop(NEST.liC));
    expect(by("ulInner").top, "inner list left its own first row").toBe(nestTop(NEST.liC));
    expect(by("ulInner").left).toBeLessThan(by("liC").left);
  });

  it("hovering the deepest item (liD, inner row 2) paints ONE handle", () => {
    // RENEGOTIATED (task 425). Task 394's leg here read "hovering the deepest
    // item paints FOUR handles at FOUR distinct rows" — outer list, outer item,
    // inner list, item — each at its own first line. Gabriel's 2026-08-22
    // rule: off a top row you get ONE handle, the hovered item's. Inverted,
    // this is the canary: it FAILS on the 394 tree.
    render(<TextObjectGrabHandle editorRef={{ current: fakeEditor() }} />);
    movePointerTo(440);
    const owners = OWNERS();
    expect(owners.map((o) => o.uuid), "the wrong set of handles is painted").toEqual(["liD"]);
    expect(owners[0].top, "the hovered item is not on the hovered row").toBe(nestTop(NEST.liD));
  });

  it("the set is decided STRUCTURALLY: non-qualifying levels are never PLACED", () => {
    // The deepFix's whole point versus the surgical one ("compute every
    // level's placement, keep the ones on the hovered row"): placement is a
    // rect-reading operation, and `computePlacement` must run ≤2 times per
    // hover. Placing ulOuter reads liA's first-line rect (its own top row);
    // placing liB reads liBp's. Hovering liD, neither may be read at all.
    const liAPara = nestEls.liA.querySelector("p")!;
    const readA = vi.fn(liAPara.getBoundingClientRect);
    liAPara.getBoundingClientRect = readA;
    const liBPara = nestEls.liB.querySelector(":scope > p") as HTMLElement;
    const readB = vi.fn(liBPara.getBoundingClientRect);
    liBPara.getBoundingClientRect = readB;
    render(<TextObjectGrabHandle editorRef={{ current: fakeEditor() }} />);
    movePointerTo(440);
    expect(OWNERS().map((o) => o.uuid)).toEqual(["liD"]);
    expect(readA, "ulOuter's placement was computed and discarded").not.toHaveBeenCalled();
    expect(readB, "liB's placement was computed and discarded").not.toHaveBeenCalled();
  });

  it("travelling UP from a deep row: the list handle appears only on ARRIVAL at its top row", () => {
    // RENEGOTIATED (task 425). Task 394's leg here read "travelling UP to a
    // container's handle keeps that handle alive, in place" — the outer list
    // handle stayed lit the whole way up from liD. That property is GIVEN UP
    // deliberately: hovering row 3 shows no list handle; to grab the list you
    // go to row 1. What survives is that the handle, once you arrive, sits
    // where 394 put it — the list's own top row, outboard of its first item.
    render(<TextObjectGrabHandle editorRef={{ current: fakeEditor() }} />);
    movePointerTo(440);
    expect(OWNERS().find((o) => o.uuid === "ulOuter"), "outer list lit on a deep row").toBeUndefined();

    // Up through the inner list's top row: the INNER list, not the outer.
    movePointerTo(400);
    expect(OWNERS().find((o) => o.uuid === "ulOuter"), "outer list lit on the inner top row").toBeUndefined();
    expect(OWNERS().find((o) => o.uuid === "ulInner")).toBeTruthy();

    // …and on to the outer list's own top row, where its handle lives.
    movePointerTo(320);
    const arrived = OWNERS().find((o) => o.uuid === "ulOuter")!;
    expect(arrived, "the outer list handle is missing on arrival").toBeTruthy();
    expect(arrived.top).toBe(nestTop(NEST.liA));
  });
});

