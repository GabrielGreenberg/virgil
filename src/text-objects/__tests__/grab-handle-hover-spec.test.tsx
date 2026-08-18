// @vitest-environment jsdom
//
// Task 353 — Gabriel's grab-handle spec, driven as a CONTRACT on the real
// component over a rendered 3-item list.
//
// His spec, verbatim: the FULL-LIST handle is always visible while the pointer
// is anywhere over the list; in addition exactly ONE item handle shows, the
// item the pointer is on; and the two must read as two distinct controls.
//
// WHAT THE BUG ACTUALLY WAS — neither of the two hypotheses the task offered
// (a stale placement that failed to clear, or overlapping bands). Measured on
// the real component, the hover SET was already correct at every row: item +
// its container, exactly as the spec asks. What was wrong was the container's
// PLACEMENT. `resolveFirstLineTarget` descends a container to its FIRST
// grabbable child, so the list handle was pinned to row 1 forever:
//
//     hover item 1   item (198,202)   list (178,202)   ← same row: the "blob"
//     hover item 2   item (198,242)   list (178,202)   ← list stuck at row 1
//     hover item 3   item (198,282)   list (178,202)   ← same
//
// So the handle Gabriel read as "item 1's, lighting on the wrong row" was the
// LIST's handle, sitting where item 1 happens to be. That also answers the
// screenshot-3 question: the full-list handle IS painted on lower-row hovers —
// at row 1, far from the pointer.
//
// The descent's own stated goal is "a container and its item produce the SAME
// opticalCenterY by construction", which held only for row 1. Descending to
// the HOVERED item restores it for every row.
//
// These legs assert set membership by OWNER (`data-grab-owner-*`, added by this
// task), never by count — the mis-filing happened precisely because the only
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

    it(`hovering item ${i + 1}: both handles sit on the HOVERED row`, () => {
      // The defect: the list handle stayed at row 1 while the item's moved.
      hoverRow(i);
      const owners = OWNERS();
      const item = owners.find((o) => o.uuid === `li${i + 1}`)!;
      const list = owners.find((o) => o.uuid === "ul1")!;
      expect(list.top, "the list handle is pinned to another row").toBe(item.top);
    });

    it(`hovering item ${i + 1}: the two read as two controls`, () => {
      hoverRow(i);
      const owners = OWNERS();
      const item = owners.find((o) => o.uuid === `li${i + 1}`)!;
      const list = owners.find((o) => o.uuid === "ul1")!;
      // Handles are 12px wide, so this is a real void between the boxes rather
      // than two glyphs touching.
      expect(Math.abs(item.left - list.left)).toBeGreaterThanOrEqual(24);
      // Stacking ORDER, stated once: the container sits OUTBOARD of its item.
      expect(list.left).toBeLessThan(item.left);
    });
  }

  it("X alignment is consistent across the items of one list", () => {
    // The drift visible between Gabriel's screenshots.
    const lefts: number[] = [];
    for (const i of [0, 1, 2]) {
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
