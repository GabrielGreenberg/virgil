// @vitest-environment jsdom
/**
 * Task 416 — the IO half of the layout-gesture parking law.
 *
 * `onResize` has been gesture-gated since task 317. `onIntersection` never
 * was, and a CONTENT drag is the gesture that fires it: `auto-scroll.ts`
 * writes `scrollTop` once per RAF, so blocks cross the ±800 px near-zone
 * boundary for the whole of a long drag. Each crossing paid a `measureBlock`
 * (a forced-layout rect read, plus one unconditional host-rect read per
 * batch) and a `notify()` — and `notify()` is the marginalia deck's full
 * repack, the one O(markers) cost in this file.
 *
 * The rule this pins: mid-gesture the ENTER branch does its BOOKKEEPING and
 * defers only the MEASUREMENT (onto `pendingRecompute`, the same work list
 * `onResize` collects into), and both exits route through a park so the deck
 * settles ONCE on the end edge.
 *
 * **No pre-416 suite could see this.** Every geometry suite in the repo
 * drives the observers with no gesture live, where the parked and the
 * unparked paths are byte-identical by construction — so the divergence is
 * unrepresentable in all of them.
 *
 * Every defect leg fails on the pre-416 handler (measured by neutering the
 * `gestureActive` branch).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

import { Editor } from "@tiptap/core";
import {
  buildEditorExtensions,
  type EditorExtensionsCtx,
} from "@/lib/editor-extensions";
import { getOrCreateGeometry } from "../registry";
import {
  beginContentGesture,
  endContentGesture,
} from "@/lib/pane-resize/layout-gesture-bus";

// ── Observer fakes (the `wrap-cascade` harness shape) ───────────────────────

type IOCallback = (entries: IntersectionObserverEntry[]) => void;
let liveIOs: FakeIntersectionObserver[] = [];
let liveROs: FakeResizeObserver[] = [];

class FakeIntersectionObserver {
  cb: IOCallback;
  constructor(cb: IOCallback) {
    this.cb = cb;
    liveIOs.push(this);
  }
  observe() {}
  unobserve() {}
  disconnect() {
    liveIOs = liveIOs.filter((io) => io !== this);
  }
  takeRecords() {
    return [];
  }
  fire(els: Element[], isIntersecting: boolean) {
    this.cb(
      els.map(
        (el) =>
          ({ target: el, isIntersecting }) as unknown as IntersectionObserverEntry,
      ),
    );
  }
}

class FakeResizeObserver {
  cb: (entries: ResizeObserverEntry[]) => void;
  constructor(cb: (entries: ResizeObserverEntry[]) => void) {
    this.cb = cb;
    liveROs.push(this);
  }
  observe() {}
  unobserve() {}
  disconnect() {
    liveROs = liveROs.filter((ro) => ro !== this);
  }
}

let rafQueue: FrameRequestCallback[] = [];
function flushRaf() {
  // Drain to a fixed point: a settle can schedule the next frame's pass.
  for (let i = 0; i < 8 && rafQueue.length > 0; i++) {
    const q = rafQueue;
    rafQueue = [];
    for (const cb of q) cb(0);
  }
}

function mainCtx(): EditorExtensionsCtx {
  return {
    surface: "main",
    editableRef: { current: true },
    cardContext: false,
    callbacks: {},
    docIdRef: { current: null },
    texBlockIsPoppedRef: { current: undefined },
    anchoredUuidsRef: { current: new Set() },
    host: null,
  };
}

function rect(top: number, bottom: number): DOMRect {
  return {
    top,
    bottom,
    left: 0,
    right: 100,
    width: 100,
    height: bottom - top,
    x: 0,
    y: top,
    toJSON: () => ({}),
  } as DOMRect;
}

const UUIDS = ["b1", "b2", "b3", "b4"];

/** Per-element + host rect-read counters — `measureBlock` reads the node
 *  DOM's rect and the batch reads the host's, so counting BOTH is what tells
 *  a deferred batch (zero reads) from a live one. */
interface Mounted {
  editor: Editor;
  els: HTMLElement[];
  reads: { host: number; block: number };
}

function mount(): Mounted {
  const reads = { host: 0, block: 0 };
  const host = document.createElement("div");
  host.setAttribute("data-marginalia-host", "");
  host.getBoundingClientRect = () => {
    reads.host++;
    return rect(0, 1000);
  };
  const element = document.createElement("div");
  host.appendChild(element);
  document.body.appendChild(host);
  const editor = new Editor({
    element,
    editable: true,
    extensions: buildEditorExtensions(mainCtx()),
    content: {
      type: "doc",
      content: UUIDS.map((uuid, i) => ({
        type: "paragraph",
        attrs: { uuid },
        content: [{ type: "text", text: `Para ${uuid} number ${i}.` }],
      })),
    },
  });
  let pos = 0;
  const els: HTMLElement[] = [];
  for (let i = 0; i < editor.state.doc.childCount; i++) {
    const node = editor.state.doc.child(i);
    const el = editor.view.nodeDOM(pos) as HTMLElement;
    el.getBoundingClientRect = () => {
      reads.block++;
      return rect(i * 40, i * 40 + 30);
    };
    els.push(el);
    pos += node.nodeSize;
  }
  return { editor, els, reads };
}

let realIO: typeof IntersectionObserver;
let realRO: typeof ResizeObserver;
let realRaf: typeof requestAnimationFrame;
let realCaf: typeof cancelAnimationFrame;

beforeEach(() => {
  liveIOs = [];
  liveROs = [];
  rafQueue = [];
  realIO = globalThis.IntersectionObserver;
  realRO = globalThis.ResizeObserver;
  realRaf = globalThis.requestAnimationFrame;
  realCaf = globalThis.cancelAnimationFrame;
  globalThis.IntersectionObserver =
    FakeIntersectionObserver as unknown as typeof IntersectionObserver;
  globalThis.ResizeObserver =
    FakeResizeObserver as unknown as typeof ResizeObserver;
  globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) => {
    rafQueue.push(cb);
    return rafQueue.length;
  }) as typeof requestAnimationFrame;
  globalThis.cancelAnimationFrame = (() => {}) as typeof cancelAnimationFrame;
});

afterEach(() => {
  // A leaked gesture would silently park every later suite in the file.
  endContentGesture();
  globalThis.IntersectionObserver = realIO;
  globalThis.ResizeObserver = realRO;
  globalThis.requestAnimationFrame = realRaf;
  globalThis.cancelAnimationFrame = realCaf;
  document.body.innerHTML = "";
});

/** Mount + prime the engine so every block is observed and measured, then
 *  zero the counters. Returns the primed handles. */
function primed() {
  const m = mount();
  const service = getOrCreateGeometry(m.editor);
  const release = service.retain();
  flushRaf();
  liveIOs[0].fire(m.els, true);
  flushRaf();
  let notifies = 0;
  const unsub = service.subscribe(() => {
    notifies++;
  });
  m.reads.host = 0;
  m.reads.block = 0;
  return {
    ...m,
    service,
    io: liveIOs[0],
    notifies: () => notifies,
    cleanup: () => {
      unsub();
      release();
      m.editor.destroy();
    },
  };
}

describe("the IO half parks during a content gesture (task 416)", () => {
  it("an ENTER batch mid-gesture reads NO rects and notifies nobody", () => {
    const t = primed();
    beginContentGesture("drag-1");

    // The shape a drag's auto-scroll produces: blocks crossing the near-zone
    // boundary, once per frame, for the length of the drag.
    for (let frame = 0; frame < 6; frame++) {
      t.io.fire([t.els[frame % t.els.length]], true);
      flushRaf();
    }

    expect(t.reads.block, "no per-block rect read mid-gesture").toBe(0);
    // The host rect was read UNCONDITIONALLY at the top of `onIntersection`
    // pre-416 — one forced layout per batch even when nothing was measured.
    expect(t.reads.host, "no host rect read mid-gesture").toBe(0);
    expect(t.notifies(), "the deck must not repack mid-gesture").toBe(0);

    t.cleanup();
  });

  it("…and the deferred crossings settle in ONE pass on the end edge", () => {
    const t = primed();
    beginContentGesture("drag-1");
    for (let frame = 0; frame < 6; frame++) {
      t.io.fire([t.els[frame % t.els.length]], true);
      flushRaf();
    }
    const recomputesBefore = t.service.stats().recomputes;

    endContentGesture();
    flushRaf();

    expect(
      t.service.stats().recomputes - recomputesBefore,
      "one settle for the whole gesture",
    ).toBe(1);
    expect(t.reads.block, "the settle DOES measure").toBeGreaterThan(0);

    t.cleanup();
  });

  it("a LEAVE mid-gesture keeps its bookkeeping and defers the repack", () => {
    const t = primed();
    beginContentGesture("drag-1");

    t.io.fire([t.els[3]], false);
    flushRaf();
    expect(t.notifies(), "no repack mid-gesture").toBe(0);
    // The eviction itself is NOT deferred — the cache is the engine's memory
    // and must stay truthful; only the subscriber notification waits.
    expect(t.service.getMetrics("b4")).toBeNull();

    endContentGesture();
    flushRaf();
    expect(t.notifies(), "exactly one settle notification").toBeGreaterThan(0);

    t.cleanup();
  });

  it("CONTROL — off-gesture the same batch measures and notifies inline", () => {
    const t = primed();

    t.io.fire([t.els[1]], true);

    expect(t.reads.block, "off-gesture the enter measures on this frame").toBeGreaterThan(0);
    expect(t.reads.host, "…and reads the host rect it needs").toBeGreaterThan(0);

    t.cleanup();
  });

  it("CONTROL — a pure LEAVE batch off-gesture reads no host rect (the lazy read)", () => {
    const t = primed();

    t.io.fire([t.els[2]], false);

    // Pre-416 this paid one unconditional `host.getBoundingClientRect()` for
    // a batch that measures nothing — the scroll-away shape.
    expect(t.reads.host, "a leave-only batch measures nothing, so reads nothing").toBe(0);
    expect(t.reads.block).toBe(0);

    t.cleanup();
  });

  it("the observed set stays honest across the gesture (bookkeeping is NOT deferred)", () => {
    const t = primed();
    beginContentGesture("drag-1");

    // A detach-shaped leave (the ProseMirror-redraw case) mid-gesture must
    // still run its heal, or the block is culled forever after the drag.
    const el = t.els[2];
    el.remove();
    t.io.fire([el], false);
    flushRaf();

    endContentGesture();
    flushRaf();

    // The uuid is still resolvable as a live block after the gesture — i.e.
    // the leave was processed rather than swallowed.
    expect(t.service.stats().version).toBeGreaterThan(0);

    t.cleanup();
  });
});
