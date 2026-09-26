// @vitest-environment jsdom
//
// Task 773 — the inline-atom drag ghost moves on the SHARED cursor-following
// channel (`@/lib/transform-channel`), driven through the REAL `InlineAtomGrab`
// gesture and the real `<InlineAtomGhost>` portal.
//
// The pre-773 shape emitted a new store state per RAW mousemove, so every event
// re-rendered the portal and wrote `left`/`top` on a `position:fixed` node — a
// render plus a layout write per event, the class the pane-drag law killed in
// its two sibling ghosts (the lift overlay, task 334; the strip button ghost,
// task 439). The legs: a burst of moves costs zero renders and zero writes until
// a frame runs, the frame writes ONE `transform` (never `left`/`top`), an
// unchanged cursor writes nothing, and no write lands behind the gesture's end.
//
// jsdom defaults `buttons` to 0 and `isMissedRelease` ends the gesture on a
// move without the primary button held, so every LIVE move passes `buttons: 1`.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/storage", async () =>
  (await import("@/lib/__tests__/_mock-storage")).mockStorageModule(),
);

import { Profiler } from "react";
import { act, cleanup, render } from "@testing-library/react";
import { Editor } from "@tiptap/core";
import {
  buildEditorExtensions,
  type EditorExtensionsCtx,
} from "@/lib/editor-extensions";
import { parseLatex } from "@/lib/latex-parser";
import {
  __resetDropCtxRegistry,
  cancelDropSession,
  getDropSession,
  setDropCtx,
} from "@/components/drop-mode/controller";
import type { DropCtx } from "@/components/drop-mode/types";
import { InlineAtomGhost } from "@/components/drop-mode/InlineAtomGhost";
import { ghostTransform } from "@/components/drop-mode/inline-atom-ghost";
import { createTransformChannel } from "@/lib/transform-channel";

// ── RAF harness: nothing is written until a frame runs. ──────────────────────
let rafSeq = 0;
let frameQueue: Map<number, FrameRequestCallback> = new Map();
const flushFrame = () => {
  const cbs = [...frameQueue.values()];
  frameQueue = new Map();
  for (const cb of cbs) cb(0);
};

// ── editor harness (the `atom-grab-session-lifetime` shape) ─────────────────
const BODY = "Some prose \\cite{smith2020} and a \\footnote{note} here.\n";
let editor: Editor | null = null;

function mount(): Editor {
  const element = document.createElement("div");
  document.body.appendChild(element);
  editor = new Editor({
    element,
    extensions: buildEditorExtensions({
      surface: "main",
      editableRef: undefined,
      cardContext: false,
      callbacks: {},
      docIdRef: { current: null },
      anchoredUuidsRef: { current: new Set<string>() },
      host: null,
    } as unknown as EditorExtensionsCtx),
    content: parseLatex(
      `\\documentclass{article}\n\\begin{document}\n${BODY}\\end{document}\n`,
    ) as never,
    editable: true,
  });
  setDropCtx({
    mainEditor: editor,
    closePopout: () => {},
    confirm: async () => true,
    requestAnchorFlush: () => {},
  } as unknown as DropCtx);
  return editor;
}

function press(ed: Editor): void {
  const atomEl = ed.view.dom.querySelector<HTMLElement>(
    `[data-type="footnote"]`,
  )!;
  const plugin = ed.state.plugins.find((pl) =>
    String((pl as unknown as { key?: string }).key ?? "").startsWith(
      "inlineAtomGrab",
    ),
  )!;
  const handlers = plugin.props.handleDOMEvents as unknown as Record<
    string,
    (view: unknown, event: MouseEvent) => boolean
  >;
  const event = new MouseEvent("mousedown", {
    bubbles: true,
    cancelable: true,
    button: 0,
    buttons: 1,
    clientX: 10,
    clientY: 10,
  });
  Object.defineProperty(event, "target", { value: atomEl });
  expect(handlers.mousedown(ed.view, event)).toBe(true);
}

function move(x: number, y: number, buttons = 1): void {
  window.dispatchEvent(
    new MouseEvent("mousemove", { bubbles: true, clientX: x, clientY: y, buttons }),
  );
}

/** Count every `style.transform` / `left` / `top` WRITE on one element. An own
 *  accessor on the style instance shadows jsdom's prototype accessor. */
function recordWrites(el: HTMLElement) {
  const writes = { transform: [] as string[], left: 0, top: 0 };
  let t = el.style.transform;
  Object.defineProperty(el.style, "transform", {
    configurable: true,
    get: () => t,
    set: (v: string) => {
      writes.transform.push(v);
      t = v;
    },
  });
  for (const prop of ["left", "top"] as const) {
    let v = el.style[prop];
    Object.defineProperty(el.style, prop, {
      configurable: true,
      get: () => v,
      set: (nv: string) => {
        writes[prop] += 1;
        v = nv;
      },
    });
  }
  return writes;
}

beforeEach(() => {
  rafSeq = 0;
  frameQueue = new Map();
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    rafSeq += 1;
    frameQueue.set(rafSeq, cb);
    return rafSeq;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => {
    frameQueue.delete(id);
  });
  // The controller's own coalesced move pass shares the frame and hit-tests;
  // jsdom has no hit-test, and nothing under the cursor is what we want.
  (document as unknown as { elementsFromPoint: () => Element[] }).elementsFromPoint =
    () => [];
  __resetDropCtxRegistry();
});

afterEach(() => {
  cancelDropSession();
  cleanup();
  editor?.destroy();
  editor = null;
  __resetDropCtxRegistry();
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** Lift a real ghost; returns its portal node, a render counter, and its
 *  write recorder (installed AFTER the mount placement). */
function liftGhost() {
  const ed = mount();
  let renders = 0;
  render(
    <Profiler id="ghost" onRender={() => (renders += 1)}>
      <InlineAtomGhost />
    </Profiler>,
  );
  press(ed);
  act(() => move(200, 200));
  expect(getDropSession()).not.toBeNull();
  const node = document.body.querySelector<HTMLElement>(".inline-atom-ghost");
  expect(node, "the ghost did not mount").toBeTruthy();
  return { node: node!, renders: () => renders, writes: recordWrites(node!) };
}

describe("the inline-atom ghost moves on the shared transform channel", () => {
  it("mounts already placed — by transform, from the base box at the viewport origin", () => {
    const { node } = liftGhost();
    // grab offset = press point − atom rect (jsdom rects are 0) = 10.
    expect(node.style.transform).toBe(ghostTransform(200, 200, 10));
    expect(node.style.left).toBe("0px");
    expect(node.style.top).toBe("0px");
  });

  it("a burst of moves costs no render and no write until ONE frame writes the last cursor", () => {
    const { renders, writes } = liftGhost();
    const before = renders();
    act(() => {
      for (let i = 1; i <= 8; i++) move(200 + i, 200 + i);
    });
    expect(renders() - before, "a mousemove re-rendered the ghost").toBe(0);
    expect(writes.transform, "written per event, not per frame").toEqual([]);
    act(() => flushFrame());
    expect(writes.transform).toEqual([ghostTransform(208, 208, 10)]);
    expect(writes.left + writes.top, "moved by left/top").toBe(0);
    expect(renders() - before).toBe(0);
  });

  it("a frame at an unchanged cursor writes nothing", () => {
    const { writes } = liftGhost();
    act(() => move(230, 230));
    act(() => flushFrame());
    expect(writes.transform).toHaveLength(1);
    act(() => move(230, 230));
    act(() => flushFrame());
    expect(writes.transform, "rewrote an unchanged transform").toHaveLength(1);
  });

  it("the off-cursor flip rides the same transform", () => {
    const { writes } = liftGhost();
    act(() => move(230, 30));
    act(() => flushFrame());
    expect(writes.transform).toEqual([ghostTransform(230, 30, 10)]);
    expect(writes.transform[0]).toContain("translateY(14px)");
  });

  it("no stale write lands behind the missed-release end", () => {
    const { writes } = liftGhost();
    act(() => move(260, 260)); // queued, not yet applied
    act(() => move(270, 270, 0)); // the release nobody saw — controller ends it
    expect(getDropSession()).toBeNull();
    expect(document.body.querySelector(".inline-atom-ghost")).toBeNull();
    act(() => flushFrame());
    expect(writes.transform, "a frame wrote after the gesture ended").toEqual([]);
  });
});

describe("createTransformChannel", () => {
  it("queues ONE frame for many sets, and records nothing while no target is mounted", () => {
    const el = document.createElement("div");
    let target: HTMLElement | null = null;
    const ch = createTransformChannel({
      targets: () => [target],
      format: (x, y) => `translate3d(${x}px, ${y}px, 0)`,
    });
    for (let i = 0; i < 8; i++) ch.set(i, i);
    expect(frameQueue.size).toBe(1);
    flushFrame(); // no target yet — must not claim the value as applied
    target = el;
    ch.set(7, 7); // same value, now with a node
    flushFrame();
    expect(el.style.transform).toBe("translate3d(7px, 7px, 0)");
  });

  it("writes a SWAPPED node at an unchanged value", () => {
    const a = document.createElement("div");
    const b = document.createElement("div");
    let target: HTMLElement = a;
    const ch = createTransformChannel({
      targets: () => [target],
      format: (x, y) => `translate3d(${x}px, ${y}px, 0)`,
    });
    ch.set(5, 5);
    flushFrame();
    target = b;
    ch.set(5, 5);
    flushFrame();
    expect(b.style.transform).toBe("translate3d(5px, 5px, 0)");
  });
});
