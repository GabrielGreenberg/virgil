// @vitest-environment jsdom
//
// Task 1444 — a grab-handle press has named ENDINGS beyond its own events.
//
// `beginGesture` arms window mousemove/mouseup on a handle press. It used to
// end only on mouseup, the threshold hand-off, or the missed-release
// failsafe, so nothing ended a held press when its handle unmounted (the
// block deleted/moved under it), the editor went away, or the user pressed
// Escape. A later stray release then opened the action menu over a DETACHED
// handle (zero rect → viewport top-left corner), and a later move could lift
// from a destroyed editor. Each leg below presses, ends the press by one of
// those routes, then proves a release opens no menu and a move lifts nothing.
// The accepting controls (a plain click opens the menu; a held drag lifts)
// prove the legs are not passing vacuously.
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
vi.mock("@/lib/editor-geometry/use-viewport-frame", async () => {
  const { EMPTY_VIEWPORT_FRAME } = await import("@/lib/editor-geometry/viewport-frame");
  return {
    // Faithful to the real hook's one relevant property: the frame is a
    // function of the editor it is handed. A null editor gets the EMPTY frame.
    useViewportFrame: (editor: Editor | null) => ({
      frameRef: { current: editor ? frame : EMPTY_VIEWPORT_FRAME },
      version: 0,
    }),
  };
});
vi.mock("@/lib/marginalia-blocks", () => ({ resolveDomForUuid: () => null }));

const menuOpen = vi.fn();
const beginLift = vi.fn();
vi.mock("@/components/editor-layout/card-actions/drag-handle-menu-context", () => ({
  useDragHandleMenu: () => ({ open: menuOpen, close: () => undefined }),
}));
vi.mock("@/text-objects/LiftHost", () => ({ useLiftHost: () => ({ beginLift }) }));

import { TextObjectGrabHandle } from "@/text-objects/TextObjectGrabHandle";
import type { EditorViewportFrame } from "@/lib/editor-geometry/viewport-frame";
import { buildHandleTestFrame } from "./_handle-frame";
import { notePointerInput } from "@/lib/input-modality";

function rect(top: number, bottom: number, left = 200, right = 700): DOMRect {
  return { top, bottom, left, right, width: right - left, height: bottom - top,
    x: left, y: top, toJSON: () => ({}) } as DOMRect;
}
let editorEl: HTMLElement, paraEl: HTMLElement;
let frame: EditorViewportFrame;

function buildDom() {
  editorEl = document.createElement("div");
  editorEl.className = "ProseMirror";
  Object.defineProperty(editorEl, "offsetHeight", { value: 800, configurable: true });
  editorEl.getBoundingClientRect = () => rect(0, 800, 200, 700);
  paraEl = document.createElement("p");
  paraEl.setAttribute("data-uuid", "p1");
  paraEl.setAttribute("data-text-object-kind", "paragraph");
  paraEl.textContent = "hello";
  paraEl.getBoundingClientRect = () => rect(300, 340, 260, 700);
  editorEl.appendChild(paraEl);
  document.body.appendChild(editorEl);
  const portal = document.createElement("div");
  portal.setAttribute("data-grab-handle-portal", "");
  const column = document.createElement("div");
  column.appendChild(portal);
  document.body.appendChild(column);
  frame = buildHandleTestFrame({ editorEl, contentLeft: 260, editorRight: 700,
    scrollTop: 0, scrollBottom: 800, paperEl: column, paperRect: { top: 100, left: 40 } });
}

type Handlers = Record<string, Set<(p: unknown) => void>>;
function fakeEditor(opts: { editable?: boolean } = {}): Editor & { handlers: Handlers } {
  const handlers: Handlers = { update: new Set(), selectionUpdate: new Set() };
  const node = { type: { name: "paragraph" }, attrs: { uuid: "p1" } };
  const resolved = { depth: 1, node: (d: number) => (d === 1 ? node : { type: { name: "doc" }, attrs: {} }), before: () => 0 };
  return { handlers, isDestroyed: false, isEditable: opts.editable ?? true,
    state: { selection: { from: 2, to: 2 }, doc: { resolve: () => resolved } },
    view: { dom: editorEl, coordsAtPos: () => ({ top: 305, bottom: 320, left: 262, right: 263 }), nodeDOM: () => paraEl },
    on: (n: string, f: (p: unknown) => void) => handlers[n]?.add(f),
    off: (n: string, f: (p: unknown) => void) => handlers[n]?.delete(f) } as unknown as Editor & { handlers: Handlers };
}

let rafQueue: FrameRequestCallback[] = [];
const flushFrames = () => act(() => { for (let i = 0; i < 4 && rafQueue.length; i++) { const q = rafQueue; rafQueue = []; for (const cb of q) cb(0); } });
const handleCount = () => document.querySelectorAll(".text-object-grab-handle").length;
const hover = () => act(() => {
  document.dispatchEvent(new MouseEvent("mousemove", { clientX: 400, clientY: 320, bubbles: true }));
});

beforeEach(() => {
  rafQueue = []; blocksAtY.mockReset(); buildDom(); notePointerInput();
  blocksAtY.mockImplementation(() => [{ uuid: "p1", el: paraEl }]);
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => { rafQueue.push(cb); return rafQueue.length; });
  vi.stubGlobal("cancelAnimationFrame", () => { rafQueue = []; });
});
afterEach(() => { cleanup(); document.body.innerHTML = ""; vi.unstubAllGlobals(); vi.useRealTimers(); vi.restoreAllMocks(); notePointerInput(); });
const handleEl = () => document.querySelector(".text-object-grab-handle") as HTMLElement | null;
const press = () => act(() => {
  handleEl()!.dispatchEvent(new MouseEvent("mousedown", { clientX: 250, clientY: 310, button: 0, buttons: 1, bubbles: true }));
});
const release = () => act(() => { window.dispatchEvent(new MouseEvent("mouseup", { clientX: 250, clientY: 310 })); });
const moveFar = () => act(() => { window.dispatchEvent(new MouseEvent("mousemove", { clientX: 270, clientY: 330, buttons: 1 })); });

function mountWithHandle(ed = fakeEditor()) {
  const r = render(<TextObjectGrabHandle editor={ed} />);
  hover();
  flushFrames();
  expect(handleCount()).toBe(1);
  return { ...r, ed };
}

describe("a grab-handle press ends on unmount, editor swap/loss and Escape (task 1444)", () => {
  beforeEach(() => { menuOpen.mockReset(); beginLift.mockReset(); });

  it("control: a plain click opens the menu; a held drag lifts", () => {
    mountWithHandle();
    press();
    expect(handleEl()!.classList.contains("is-pressed")).toBe(true);
    release();
    expect(menuOpen).toHaveBeenCalledTimes(1);
    press();
    moveFar();
    expect(beginLift).toHaveBeenCalledTimes(1);
  });

  it("the pressed handle UNMOUNTING ends the press — a later release opens nothing, a later move lifts nothing", () => {
    const { ed } = mountWithHandle();
    press();
    const pressed = handleEl()!;
    // The block leaves under the held press: the next resolve finds nothing.
    blocksAtY.mockImplementation(() => []);
    act(() => { for (const fn of ed.handlers.update) fn({ transaction: { docChanged: true } }); });
    flushFrames();
    expect(handleCount(), "the pressed handle unmounted").toBe(0);
    expect(pressed.classList.contains("is-pressed"), "press visual removed").toBe(false);
    release();
    moveFar();
    expect(menuOpen, "no menu at the viewport corner").not.toHaveBeenCalled();
    expect(beginLift).not.toHaveBeenCalled();
  });

  it("Escape mid-press CANCELS it, and claims the key", () => {
    mountWithHandle();
    press();
    const esc = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
    act(() => { window.dispatchEvent(esc); });
    expect(esc.defaultPrevented, "Escape claimed by the press").toBe(true);
    expect(handleEl()!.classList.contains("is-pressed")).toBe(false);
    release();
    moveFar();
    expect(menuOpen).not.toHaveBeenCalled();
    expect(beginLift).not.toHaveBeenCalled();
    // …and with no press live, Escape is not claimed.
    const idle = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
    act(() => { window.dispatchEvent(idle); });
    expect(idle.defaultPrevented).toBe(false);
  });

  it("an editor SWAP mid-press ends it", () => {
    const { rerender } = mountWithHandle();
    press();
    const pressed = handleEl()!;
    rerender(<TextObjectGrabHandle editor={fakeEditor()} />);
    expect(pressed.classList.contains("is-pressed")).toBe(false);
    release();
    moveFar();
    expect(menuOpen).not.toHaveBeenCalled();
    expect(beginLift).not.toHaveBeenCalled();
  });

  it("a DESTROYED editor ends the press on the next move — no lift, no throw", () => {
    const { ed } = mountWithHandle();
    press();
    (ed as unknown as { isDestroyed: boolean }).isDestroyed = true;
    expect(() => moveFar()).not.toThrow();
    release();
    expect(beginLift).not.toHaveBeenCalled();
    expect(menuOpen).not.toHaveBeenCalled();
  });

  it("an identity-addressed press survives an unrelated doc change (only a selection press is position-stale)", () => {
    const { ed } = mountWithHandle();
    press();
    act(() => { for (const fn of ed.handlers.update) fn({ transaction: { docChanged: true } }); });
    flushFrames();
    release();
    expect(menuOpen).toHaveBeenCalledTimes(1);
  });
});
