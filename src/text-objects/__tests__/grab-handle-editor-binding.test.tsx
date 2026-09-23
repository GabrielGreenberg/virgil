// @vitest-environment jsdom
//
// Task 736 — the grab handle's editor binding is TRACKED.
//
// The handle used to receive its editor as a ref the parent (`Editor.tsx`)
// filled in an effect — i.e. AFTER this child rendered. React tracked none of
// it, so three bindings read `null` and never recovered on their own:
//
//   1. geometry — `useViewportFrame(editorRef.current)` during render bound the
//      viewport frame to null (whose `containsHoverZone` is `() => false`), so
//      hover never resolved; a 50 ms `poll()` re-subscribed but forced no
//      re-render, and handles appeared only when an UNRELATED parent re-render
//      happened to re-run the child;
//   2. swap — PM subscriptions were only reachable from that poll, which
//      stopped once the ref was non-null, so a swapped editor kept the old
//      instance's listeners (a leak) and the new one got none;
//   3. Reader — the read-only `selectionchange` sync was gated on the ref read
//      once at effect setup (null) and so never installed.
//
// Now `editor` is a PROP. These legs drive the arrival and the swap as the
// parent now delivers them — a re-render with a new value, nothing else — and
// the viewport-frame mock is keyed on the editor it is HANDED, exactly like
// the real hook (null editor → empty frame → no hover).
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

describe("the grab handle's editor binding is tracked (task 736)", () => {
  it("handles appear when the editor arrives strictly AFTER first render — no unrelated re-render, no poll", () => {
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    const { rerender } = render(<TextObjectGrabHandle editor={null} />);
    // Nothing is waited for: no retry timer is armed while the editor is absent.
    expect(vi.getTimerCount(), "no 50 ms poll while the editor is absent").toBe(0);
    hover();
    flushFrames();
    expect(handleCount()).toBe(0);

    // The editor's arrival is ONE re-render with the new value — the only
    // thing the parent now does. No other render rescues it.
    const ed = fakeEditor();
    rerender(<TextObjectGrabHandle editor={ed} />);
    hover();
    flushFrames();
    expect(handleCount(), "geometry + subscriptions bound to the arrived editor").toBe(1);
  });

  it("an editor SWAP re-subscribes: the old instance is released, the new one is heard", () => {
    const a = fakeEditor();
    const { rerender } = render(<TextObjectGrabHandle editor={a} />);
    expect(a.handlers.update.size).toBe(1);
    expect(a.handlers.selectionUpdate.size).toBe(1);

    const b = fakeEditor();
    rerender(<TextObjectGrabHandle editor={b} />);
    expect(a.handlers.update.size, "old editor's listeners released").toBe(0);
    expect(a.handlers.selectionUpdate.size).toBe(0);
    expect(b.handlers.update.size, "new editor subscribed").toBe(1);
    expect(b.handlers.selectionUpdate.size).toBe(1);

    // …and the new instance's events actually drive placement.
    flushFrames();
    act(() => { for (const fn of b.handlers.selectionUpdate) fn({}); });
    expect(rafQueue.length, "selectionUpdate on the NEW editor schedules a resolve").toBe(1);
    flushFrames();
    act(() => { for (const fn of b.handlers.update) fn({ transaction: { docChanged: true } }); });
    expect(rafQueue.length, "a doc update on the NEW editor schedules a resolve").toBe(1);
    flushFrames();
    hover();
    flushFrames();
    expect(handleCount(), "hover resolves against the swapped-in editor").toBe(1);
  });

  it("installs the read-only `selectionchange` sync for a non-editable editor that arrives late", () => {
    const add = vi.spyOn(document, "addEventListener");
    const remove = vi.spyOn(document, "removeEventListener");
    const { rerender, unmount } = render(<TextObjectGrabHandle editor={null} />);
    const installed = () => add.mock.calls.filter(([t]) => t === "selectionchange").length;
    expect(installed()).toBe(0);

    rerender(<TextObjectGrabHandle editor={fakeEditor({ editable: false })} />);
    expect(installed(), "the Reader's selection sync installs on arrival").toBe(1);

    unmount();
    expect(remove.mock.calls.filter(([t]) => t === "selectionchange").length).toBe(1);
  });
});
