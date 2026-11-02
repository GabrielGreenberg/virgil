/**
 * Task 1420 — a span marker's line rides its OWN clock.
 *
 * (a) Re-asking with unchanged inputs (a card-body keystroke rebuilt the
 *     `markers` array) performs zero `coordsAtPos` reads.
 * (b) A transaction that moves the span's `from` inside a same-height block
 *     (no RO, no structural event) re-reads that span's line on the next
 *     frame, and subscribers hear about it only when the line MOVED.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Editor } from "@tiptap/core";
import type { AnchorNodeMetrics } from "@/lib/marginalia";

// ── fakes ───────────────────────────────────────────────────────────────────
const structure = {
  anchors: new Map<string, { from: number }>(),
  blocks: new Map<string, { pos: number }>(),
};
const contentHandlers = new Map<string, Set<() => void>>();
const bus = {
  structure,
  onBlockContentChanged: (uuid: string, fn: () => void) => {
    const set = contentHandlers.get(uuid) ?? new Set();
    set.add(fn);
    contentHandlers.set(uuid, set);
    return () => set.delete(fn);
  },
};
vi.mock("@/lib/tiptap/doc-structure", () => ({ getBus: () => bus }));

/** pos → line-box top; the "layout". */
let tops: (pos: number) => number = () => 0;
const coordsAtPosCached = vi.fn((pos: number) => {
  const t = tops(pos);
  return { left: 0, right: 0, top: t, bottom: t + 20 };
});
vi.mock("@/lib/editor-geometry/registry", () => ({
  getOrCreateGeometry: () => ({
    coordsAtPosCached,
    getViewportFrame: () => ({ contentLeft: 100, editorRight: 700 }),
  }),
}));
vi.mock("@/lib/keep-alive/pane-visibility", () => ({ isPaneElementVisible: () => true }));

import { getSpanLines } from "@/lib/editor-geometry/span-line";

const fireContent = (uuid: string) => contentHandlers.get(uuid)?.forEach((fn) => fn());

const node: AnchorNodeMetrics = {
  id: "p1",
  top: 200,
  domTop: 196,
  height: 80,
  lineHeight: 20,
  lineCount: 4,
  isAtom: false,
};

let rafQueue: FrameRequestCallback[] = [];
const flushRaf = () => {
  const q = rafQueue;
  rafQueue = [];
  q.forEach((cb) => cb(0));
};

describe("span-line service (task 1420)", () => {
  let editor: Editor;
  beforeEach(() => {
    structure.anchors.clear();
    structure.blocks.clear();
    contentHandlers.clear();
    coordsAtPosCached.mockClear();
    rafQueue = [];
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
      rafQueue.push(cb);
      return rafQueue.length;
    });
    vi.stubGlobal("cancelAnimationFrame", () => {});
    editor = { isDestroyed: false, view: { dom: {} } } as unknown as Editor;
    structure.blocks.set("p1", { pos: 10 });
    structure.anchors.set("a1", { from: 50 });
    // Line 0 starts at pos 11; every 20 chars is one 20px line.
    tops = (pos) => Math.floor((pos - 11) / 20) * 20;
  });
  afterEach(() => vi.unstubAllGlobals());

  it("(a) a rebuild with equal inputs costs zero coordsAtPos reads", () => {
    const lines = getSpanLines(editor);
    const off = lines.subscribe(() => {});
    expect(lines.lineOf("a1", "p1", node)).toBe(1);
    expect(coordsAtPosCached).toHaveBeenCalledTimes(2);
    coordsAtPosCached.mockClear();
    // Card-body keystroke → new markers array → memo re-asks, same inputs.
    for (let i = 0; i < 5; i++) expect(lines.lineOf("a1", "p1", { ...node })).toBe(1);
    expect(coordsAtPosCached).not.toHaveBeenCalled();
    off();
  });

  it("(b) a same-height rewrap re-reads on the next frame and notifies once", () => {
    const lines = getSpanLines(editor);
    const notified = vi.fn();
    const off = lines.subscribe(notified);
    expect(lines.lineOf("a1", "p1", node)).toBe(1);

    // Typing earlier in the paragraph pushes the span's words to line 2;
    // the block's height (node metrics) is unchanged.
    structure.anchors.set("a1", { from: 70 });
    fireContent("p1");
    expect(notified).not.toHaveBeenCalled(); // deferred to a frame
    flushRaf();
    expect(notified).toHaveBeenCalledTimes(1);
    coordsAtPosCached.mockClear();
    expect(lines.lineOf("a1", "p1", node)).toBe(2); // served from the re-read
    expect(coordsAtPosCached).not.toHaveBeenCalled();

    // A keystroke that leaves the words on the same line notifies nothing.
    structure.anchors.set("a1", { from: 65 });
    fireContent("p1");
    flushRaf();
    expect(notified).toHaveBeenCalledTimes(1);
    off();
  });

  it("typing in a block holding no span is not watched", () => {
    const lines = getSpanLines(editor);
    const off = lines.subscribe(() => {});
    lines.lineOf("a1", "p1", node);
    expect(contentHandlers.get("p2")).toBeUndefined();
    fireContent("p2");
    expect(rafQueue).toHaveLength(0);
    off();
  });

  it("sweep and the last unsubscribe release the keyed watch", () => {
    const lines = getSpanLines(editor);
    const off = lines.subscribe(() => {});
    lines.lineOf("a1", "p1", node);
    expect(contentHandlers.get("p1")?.size).toBe(1);
    lines.sweep(new Set());
    expect(contentHandlers.get("p1")?.size).toBe(0);
    lines.lineOf("a1", "p1", node);
    expect(contentHandlers.get("p1")?.size).toBe(1);
    off();
    expect(contentHandlers.get("p1")?.size).toBe(0);
  });

  it("a metrics change (resize / height change) is a miss and reads fresh", () => {
    const lines = getSpanLines(editor);
    const off = lines.subscribe(() => {});
    lines.lineOf("a1", "p1", node);
    coordsAtPosCached.mockClear();
    lines.lineOf("a1", "p1", { ...node, height: 100, lineCount: 5 });
    expect(coordsAtPosCached).toHaveBeenCalledTimes(2);
    off();
  });
});
