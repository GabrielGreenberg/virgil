// @vitest-environment jsdom
//
// Task 336 — the grab handle's per-KEYSTROKE cost, measured in the one
// condition every prior probe dropped: **with the mouse ARMED**.
//
// The whole chain is mouse-gated. A synthetic keystroke harness — and any live
// measurement taken with the pointer parked over devtools — leaves the stored
// pointer position null, so the resolver returns `[]` and costs nothing. That
// is why `emitCount`, dispatch time and end-to-end latency all read clean while
// Gabriel felt a list "being watched by large processes": the armed pointer is
// the ordinary condition of use (it rests wherever you last clicked to place
// the caret), and it was the one condition nobody measured in.
//
// Two legs, both driving the REAL component against a REAL `resolveBlockFrame`:
//
//   1. the MODALITY gate — a typing burst with the mouse armed runs the hover
//      resolver ZERO times and reads no geometry; the next real mousemove
//      resolves ONCE;
//   2. the per-placement READ COST — the duplicate reads the list arms paid
//      (a child rect read twice, a target's computed style read twice) are
//      gone. Counted per ELEMENT rather than as a total, so the leg names the
//      duplicate rather than pinning an incidental sum.
//
// Both legs fail on the pre-336 code (measured by reverting each half).

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, act, cleanup } from "@testing-library/react";
import type { Editor } from "@tiptap/react";

// The handle's context imports reach `@/lib/storage`, whose backend pick is a
// raw require the vitest resolver can't follow (the known barrel gotcha).
// Nothing here touches a sidecar.
vi.mock("@/lib/storage", () => {
  const noop = () => undefined;
  return new Proxy(
    {},
    {
      get: (_t, prop) =>
        prop === "__esModule" ? true : prop === "then" ? undefined : noop,
    },
  );
});

// ── The geometry service: `blocksAtY` is the hover resolver's near-zone door,
// and counting its calls IS the "did a keystroke re-resolve hover?" question.
const blocksAtY = vi.fn<(y: number) => Array<{ uuid: string; el: HTMLElement }> | null>();
vi.mock("@/lib/editor-geometry", () => ({
  geomHoverEnabled: () => true,
  getGeometry: () => ({ blocksAtY }),
}));

// The viewport frame (C7). Hand-built rather than measured: jsdom reports zero
// boxes, and the frame's own contract is pinned by its own suite.
const PORTAL_ORIGIN = { top: 100, left: 40 };
vi.mock("@/lib/editor-geometry/use-viewport-frame", () => ({
  useViewportFrame: () => ({ frameRef: { current: frame }, version: 0 }),
}));

// Placement never walks the doc for a hover hit (the scan hands the element
// through), so this defensive fallback must not be reached; a real element
// keeps a reach from being an exception instead of a visible failure.
vi.mock("@/lib/marginalia-blocks", () => ({
  resolveDomForUuid: () => null,
}));

import { TextObjectGrabHandle } from "@/text-objects/TextObjectGrabHandle";
import type { EditorViewportFrame } from "@/lib/editor-geometry/viewport-frame";
import { buildHandleTestFrame } from "./_handle-frame";
import { notePointerInput } from "@/lib/input-modality";

// ── DOM + frame fixtures ────────────────────────────────────────────────────

function rect(
  top: number,
  bottom: number,
  left = 200,
  right = 700,
): DOMRect {
  return {
    top,
    bottom,
    left,
    right,
    width: right - left,
    height: bottom - top,
    x: left,
    y: top,
    toJSON: () => ({}),
  } as DOMRect;
}

let editorEl: HTMLElement;
let listEl: HTMLElement;
let itemEl: HTMLElement;
let itemBodyEl: HTMLElement;

/** Stub an element's rect AND count the read. A per-element own property
 *  shadows any `Element.prototype` instrumentation, so the counter has to live
 *  in the stub itself — otherwise the read-cost leg passes vacuously at zero. */
function stubRect(el: HTMLElement, r: DOMRect) {
  el.getBoundingClientRect = () => {
    rectReads.push(el);
    return r;
  };
}

/** A one-item bulletList: the shape whose hover answer is 2 refs (the item AND
 *  its container), each getting its own `computePlacement`. */
function buildListDom() {
  editorEl = document.createElement("div");
  editorEl.className = "ProseMirror";
  Object.defineProperty(editorEl, "offsetHeight", { value: 800, configurable: true });
  stubRect(editorEl, rect(0, 800, 200, 700));

  listEl = document.createElement("ul");
  listEl.setAttribute("data-uuid", "ul1");
  listEl.setAttribute("data-text-object-kind", "bulletList");
  stubRect(listEl, rect(300, 340, 230, 700));

  itemEl = document.createElement("li");
  itemEl.setAttribute("data-uuid", "li1");
  itemEl.setAttribute("data-text-object-kind", "listItem");
  stubRect(itemEl, rect(300, 340, 260, 700));

  itemBodyEl = document.createElement("p");
  itemBodyEl.textContent = "a bulleted line";
  stubRect(itemBodyEl, rect(302, 338, 260, 700));

  itemEl.appendChild(itemBodyEl);
  listEl.appendChild(itemEl);
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
  frame = buildHandleTestFrame({
    editorEl,
    contentLeft: 260,
    editorRight: 700,
    scrollTop: 0,
    scrollBottom: 800,
    paperEl: column,
    paperRect: PORTAL_ORIGIN,
  });
}

// ── A fake editor whose events this suite can fire by hand ──────────────────

type Handler = (payload: unknown) => void;
let handlers: Record<string, Set<Handler>>;

function fakeEditor(): Editor {
  handlers = { update: new Set(), selectionUpdate: new Set() };
  // `doc.resolve` answers a one-level chain whose depth-1 node is the list item
  // — enough for the SELECTION branch (branch 1) to resolve a containing text
  // object and for `resolveSelectionChromeAnchor` to read its anchor.
  const itemNode = { type: { name: "listItem" }, attrs: { uuid: "li1" } };
  // A real `ResolvedPos` always carries `parent` / `parentOffset` / `sameParent`
  // — the whole-block predicate (task 482) reads them to tell a PARTIAL text
  // lift from a selection that covers one block outright. The paragraph here is
  // 20 wide and the fixture's selection is 4-9, i.e. genuinely partial, so this
  // suite's selection branch still resolves a SelectionRef.
  const paragraph = { isTextblock: true, content: { size: 20 } };
  const resolved = (pos: number) => ({
    pos,
    depth: 1,
    parent: paragraph,
    parentOffset: pos - 3,
    sameParent: () => true,
    node: (d: number) => (d === 1 ? itemNode : { type: { name: "doc" }, attrs: {} }),
    before: () => 0,
  });
  return {
    isDestroyed: false,
    isEditable: true,
    state: { selection: { from: 5, to: 5 }, doc: { resolve: (p: number) => resolved(p) } },
    view: {
      dom: editorEl,
      coordsAtPos: () => ({ top: 305, bottom: 320, left: 262, right: 263 }),
      nodeDOM: () => itemEl,
    },
    on: (name: string, fn: Handler) => handlers[name]?.add(fn),
    off: (name: string, fn: Handler) => handlers[name]?.delete(fn),
  } as unknown as Editor;
}

/** One keystroke: the raw keydown the modality SSOT reads, plus the two editor
 *  events a real character emits. */
function typeChar(k = "a") {
  act(() => {
    document.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true }));
    for (const fn of handlers.update) fn({ transaction: { docChanged: true } });
    for (const fn of handlers.selectionUpdate) fn({});
  });
}

function moveMouse(x = 400, y = 320) {
  act(() => {
    document.dispatchEvent(
      new MouseEvent("mousemove", { clientX: x, clientY: y, bubbles: true }),
    );
  });
}

// ── RAF queue ───────────────────────────────────────────────────────────────

let rafQueue: FrameRequestCallback[] = [];
const flushFrames = () =>
  act(() => {
    for (let i = 0; i < 4 && rafQueue.length; i += 1) {
      const q = rafQueue;
      rafQueue = [];
      for (const cb of q) cb(0);
    }
  });

// ── Read instrumentation ────────────────────────────────────────────────────

const realComputed = window.getComputedStyle;
let rectReads: Element[] = [];
let styleReads: Element[] = [];
const countOf = (log: Element[], el: Element) =>
  log.filter((e) => e === el).length;

beforeEach(() => {
  rafQueue = [];
  rectReads = [];
  styleReads = [];
  blocksAtY.mockReset();
  buildListDom();
  buildFrame();
  notePointerInput();
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    rafQueue.push(cb);
    return rafQueue.length;
  });
  vi.stubGlobal("cancelAnimationFrame", () => {
    rafQueue = [];
  });
  window.getComputedStyle = function (this: Window, el: Element, pseudo?: string | null) {
    styleReads.push(el);
    return realComputed.call(window, el, pseudo ?? undefined);
  } as typeof window.getComputedStyle;
});

afterEach(() => {
  cleanup();
  window.getComputedStyle = realComputed;
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
  notePointerInput();
});

function mountArmed() {
  blocksAtY.mockImplementation(() => [
    { uuid: "li1", el: itemEl },
    { uuid: "ul1", el: listEl },
  ]);
  const editorRef = { current: fakeEditor() };
  render(<TextObjectGrabHandle editorRef={editorRef} />);
  // Arm the pointer where the user left it after clicking into the list.
  moveMouse();
  flushFrames();
}

const handleCount = () =>
  document.querySelectorAll(".text-object-grab-handle").length;

describe("the grab handle answers hover from POINTER input only (task 336)", () => {
  it("a typing burst with the mouse ARMED runs the hover resolver ZERO times", () => {
    mountArmed();
    expect(handleCount(), "the armed hover shows a handle per containing level").toBe(2);
    expect(blocksAtY).toHaveBeenCalledTimes(1);

    blocksAtY.mockClear();
    rectReads = [];
    styleReads = [];

    for (let i = 0; i < 30; i += 1) typeChar();
    flushFrames();

    expect(
      blocksAtY,
      "30 keystrokes at a pointer that never moved must re-resolve hover ZERO times",
    ).toHaveBeenCalledTimes(0);
    expect(
      rectReads.filter((e) => e === itemEl || e === listEl || e === itemBodyEl),
      "…and read no block geometry at all",
    ).toEqual([]);
    expect(
      styleReads.filter((e) => e === itemEl || e === listEl || e === itemBodyEl),
      "…nor any block's computed style",
    ).toEqual([]);
    expect(handleCount(), "the handle hides while typing, like every editor's").toBe(0);
  });

  it("the NEXT real mousemove re-arms it — once, not once per event", () => {
    mountArmed();
    for (let i = 0; i < 5; i += 1) typeChar();
    flushFrames();
    expect(handleCount()).toBe(0);

    blocksAtY.mockClear();
    moveMouse(410, 320);
    flushFrames();
    expect(blocksAtY, "the pointer speaks → exactly one resolve").toHaveBeenCalledTimes(1);
    expect(handleCount()).toBe(2);

    // A move stream costs one resolve per FRAME, not one per event.
    blocksAtY.mockClear();
    for (let i = 0; i < 8; i += 1) moveMouse(410 + i, 320);
    flushFrames();
    expect(blocksAtY).toHaveBeenCalledTimes(1);
  });

  it("a SELECTION handle still answers on selectionUpdate — the gate is scoped to hover", () => {
    // Branch 1 is selection-derived, not pointer-derived: a shift-arrow
    // selection must keep moving its handle while the user types.
    blocksAtY.mockImplementation(() => []);
    const editor = fakeEditor();
    const editorRef = { current: editor };
    render(<TextObjectGrabHandle editorRef={editorRef} />);

    // Typing modality on, then a real (non-empty) selection appears — a
    // shift-arrow extension, which is keyboard-driven and must still move its
    // handle.
    typeChar();
    (editor as unknown as { state: { selection: { from: number; to: number } } }).state.selection =
      { from: 4, to: 9 };
    act(() => {
      for (const fn of handlers.selectionUpdate) fn({});
    });
    flushFrames();
    expect(
      handleCount(),
      "a selection handle is SELECTION-derived: typing modality must not suppress it",
    ).toBe(1);
    // …and it got there without the pointer-derived branch, which is the only
    // caller of `blocksAtY`.
    expect(blocksAtY).not.toHaveBeenCalled();
  });
});

describe("per-placement read cost for a LIST hover (task 336)", () => {
  it("reads the item's rect and the target's computed style ONCE per placement", () => {
    blocksAtY.mockImplementation(() => [
      { uuid: "li1", el: itemEl },
      { uuid: "ul1", el: listEl },
    ]);
    const editorRef = { current: fakeEditor() };
    render(<TextObjectGrabHandle editorRef={editorRef} />);
    rectReads = [];
    styleReads = [];
    moveMouse();
    flushFrames();
    expect(handleCount()).toBe(2);

    // The `<li>`'s rect is read three times across the pass, each for a
    // different question: its own placement's visibility bail, its own
    // bullet-band anchor, and its container's INK boundary (post-487 the list
    // takes its own border-box left as the marker reference and reads the
    // child's rect only for `inkLeft` — the shared row's marker band, the line
    // neither handle may cross; pre-487 that same read served the retired
    // track-width step off the child's band). Pre-336 it was FOUR — the
    // container arm read it for `childLeft` and then again inside
    // `bulletBandAnchor`, which it reached through a `closest("ul, ol")` walk
    // back to the very element it was called from.
    expect(
      countOf(rectReads, itemEl),
      "the item's rect is read once per question, never twice for one",
    ).toBe(3);

    // Both placements resolve to the SAME first-line target (a container
    // resolves through to its first item's line), and each placement reads that
    // target's computed style ONCE — the em margin tokens and the optical
    // cap-band metrics now share the one read.
    expect(
      countOf(styleReads, itemBodyEl),
      "the first-line target's computed style: one read per placement",
    ).toBe(2);
  });
});
