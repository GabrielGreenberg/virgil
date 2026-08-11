// @vitest-environment jsdom
//
// Wave-2b C7 — the service viewport frame + coordsAtPos memo contracts.
//
// The frame's refresh discipline (RO/park wiring) is exercised live; what a
// unit test can and must pin is the PURE half plus the memo's invalidation
// rules, because each has a silent failure mode:
//   - a hidden editor measuring 0×0 must NOT commit (the stale-geometry
//     cascade guard the old hook carried — committing zeros would hide the
//     bolt/handles/pill on every keep-alive pane and "fix itself" on the
//     next real refresh, so nothing would ever look wrong in a demo);
//   - the equality bail must hold on unchanged geometry (a version bump per
//     RO burst frame re-runs every consumer placement effect);
//   - the coords memo must dedup WITHIN a frame at one doc, and must NOT
//     serve a cached line box across an edit (doc identity) or across a
//     frame (RAF clear) — a stale hit paints the bolt on the wrong line.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Editor } from "@tiptap/react";
import {
  computeViewportFrame,
  viewportFramesEqual,
  EMPTY_VIEWPORT_FRAME,
} from "../viewport-frame";
import { createEditorGeometryService } from "../service";

vi.mock("@/lib/storage", () => ({
  readTex: vi.fn(() => Promise.resolve("")),
}));

function rect(partial: Partial<DOMRect>): DOMRect {
  return {
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    width: 0,
    height: 0,
    x: 0,
    y: 0,
    toJSON: () => ({}),
    ...partial,
  } as DOMRect;
}

/** An editor element inside a pod/column/scroll scaffold with stubbed
 *  layout (jsdom has none). */
function makeEditorEl(opts?: { hidden?: boolean }) {
  const scroll = document.createElement("div");
  scroll.setAttribute("data-virgil-row-scroll", "");
  const col = document.createElement("div");
  col.setAttribute("data-editor-col", "true");
  const pod = document.createElement("div");
  pod.className = "editor-pane-pod";
  const editorEl = document.createElement("div");
  pod.appendChild(editorEl);
  col.appendChild(pod);
  scroll.appendChild(col);
  document.body.appendChild(scroll);

  Object.defineProperty(editorEl, "offsetHeight", {
    value: opts?.hidden ? 0 : 500,
    configurable: true,
  });
  editorEl.getBoundingClientRect = () =>
    rect({ left: 100, right: 700, top: 40, bottom: 540, width: 600, height: 500 });
  scroll.getBoundingClientRect = () =>
    rect({ left: 0, right: 800, top: 30, bottom: 630, width: 800, height: 600 });
  pod.getBoundingClientRect = () =>
    rect({ left: 90, right: 710, top: 35, bottom: 545 });
  col.getBoundingClientRect = () => rect({ left: 80, right: 720, top: 30 });
  return { editorEl, scroll, pod, col };
}

beforeEach(() => {
  // RAF → macrotask so the memo's frame-clear is drivable via fake timers.
  vi.useFakeTimers();
  globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) =>
    setTimeout(() => cb(0), 0) as unknown as number) as typeof requestAnimationFrame;
});

afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = "";
});

describe("computeViewportFrame", () => {
  it("returns null for a hidden editor (keep-alive stale-geometry guard)", () => {
    const { editorEl } = makeEditorEl({ hidden: true });
    expect(computeViewportFrame(editorEl)).toBeNull();
  });

  it("returns null for a detached editor", () => {
    const el = document.createElement("div");
    Object.defineProperty(el, "offsetHeight", { value: 500 });
    expect(computeViewportFrame(el)).toBeNull();
  });

  it("measures edges, pod rect, scroll band and portal context", () => {
    const { editorEl, scroll, col } = makeEditorEl();
    const frame = computeViewportFrame(editorEl);
    expect(frame).not.toBeNull();
    expect(frame!.editorEl).toBe(editorEl);
    // jsdom computed style has no padding → text edges are the raw rect.
    expect(frame!.contentLeft).toBe(100);
    expect(frame!.editorRight).toBe(700);
    expect(frame!.scrollParent).toBe(scroll);
    expect(frame!.scrollTop).toBe(30);
    expect(frame!.scrollBottom).toBe(630);
    expect(frame!.podLeft).toBe(90);
    expect(frame!.podRight).toBe(710);
    expect(frame!.paperEl).toBe(col);
    expect(frame!.paperRect).toEqual({ top: 30, left: 80 });
    // Zone predicates close over the measured numbers.
    expect(frame!.containsContentZone(100, 100)).toBe(true);
    expect(frame!.containsContentZone(720, 100)).toBe(false);
    expect(frame!.containsHoverZone(150, 100)).toBe(true);
    expect(frame!.containsHoverZone(150, 700)).toBe(false);
    expect(frame!.toPortalCoords(100, 50)).toEqual({ x: 20, y: 20 });
  });

  it("equality: identical re-measures bail; a moved edge does not", () => {
    const { editorEl } = makeEditorEl();
    const a = computeViewportFrame(editorEl)!;
    const b = computeViewportFrame(editorEl)!;
    expect(viewportFramesEqual(a, b)).toBe(true);
    editorEl.getBoundingClientRect = () =>
      rect({ left: 120, right: 700, top: 40, bottom: 540 });
    const c = computeViewportFrame(editorEl)!;
    expect(viewportFramesEqual(a, c)).toBe(false);
    expect(viewportFramesEqual(a, EMPTY_VIEWPORT_FRAME)).toBe(false);
  });
});

describe("coordsAtPosCached (service memo)", () => {
  function makeServiceEditor() {
    const coordsAtPos = vi.fn((pos: number) => ({
      left: pos, right: pos + 1, top: 10, bottom: 20,
    }));
    let doc: object = { id: 1 };
    const { editorEl } = makeEditorEl();
    const editor = {
      isDestroyed: false,
      get state() {
        return { doc };
      },
      view: { dom: editorEl, coordsAtPos },
      schema: { nodes: {} },
      on: () => {},
      off: () => {},
    } as unknown as Editor;
    return {
      editor,
      coordsAtPos,
      editDoc: () => {
        doc = { id: (doc as { id: number }).id + 1 };
      },
    };
  }

  it("dedups within one frame at one doc", () => {
    const { editor, coordsAtPos } = makeServiceEditor();
    const svc = createEditorGeometryService(editor);
    const a = svc.coordsAtPosCached(15);
    const b = svc.coordsAtPosCached(15);
    expect(a).toEqual({ left: 15, right: 16, top: 10, bottom: 20 });
    expect(b).toEqual(a);
    expect(coordsAtPos).toHaveBeenCalledTimes(1);
    // A different pos is its own entry.
    svc.coordsAtPosCached(42);
    expect(coordsAtPos).toHaveBeenCalledTimes(2);
  });

  it("invalidates on doc change (never serves a pre-edit line box)", () => {
    const { editor, coordsAtPos, editDoc } = makeServiceEditor();
    const svc = createEditorGeometryService(editor);
    svc.coordsAtPosCached(15);
    editDoc();
    svc.coordsAtPosCached(15);
    expect(coordsAtPos).toHaveBeenCalledTimes(2);
  });

  it("invalidates on the next frame (never serves a pre-scroll line box)", () => {
    const { editor, coordsAtPos } = makeServiceEditor();
    const svc = createEditorGeometryService(editor);
    svc.coordsAtPosCached(15);
    vi.advanceTimersByTime(1); // the RAF-scheduled clear
    svc.coordsAtPosCached(15);
    expect(coordsAtPos).toHaveBeenCalledTimes(2);
  });

  it("returns null where coordsAtPos throws (the callers' catch path)", () => {
    const { editor, coordsAtPos } = makeServiceEditor();
    coordsAtPos.mockImplementation(() => {
      throw new RangeError("pos out of range");
    });
    const svc = createEditorGeometryService(editor);
    expect(svc.coordsAtPosCached(9999)).toBeNull();
  });
});
