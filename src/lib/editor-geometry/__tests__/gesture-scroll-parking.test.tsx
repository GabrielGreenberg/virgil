// @vitest-environment jsdom
/**
 * Task 416 — the IO half of the layout-gesture parking law.
 *
 * `onResize` has been gesture-gated since task 317. `onIntersection` never
 * was, and a CONTENT drag is the gesture that fires it: `auto-scroll.ts`
 * writes `scrollTop` once per RAF, so blocks cross the ±800 px near-zone
 * boundary for the whole of a long drag. Each crossing paid a `measureBlock`
 * (a forced-layout rect read) and a `notify()` — the marginalia deck's full
 * repack, the one O(markers) cost in that file — and each BATCH paid one
 * unconditional `host.getBoundingClientRect()` even when it measured nothing.
 *
 * Three rules pinned here:
 *   1. Mid-gesture the ENTER branch does its BOOKKEEPING and defers only the
 *      MEASUREMENT (onto `pendingRecompute`, the same work list `onResize`
 *      collects into). A whole-handler bail would leave the observed set
 *      permanently wrong after the drag.
 *   2. The deck settles ONCE, through ONE park, and the notify runs AFTER the
 *      measure — two parks settle on two different clocks (`scheduleRecompute`
 *      arms a RAF, `notify()` is synchronous), so a separate notify park
 *      publishes a HOLED cache one frame early.
 *   3. A forced-layout read sits behind the branch that needs it: the host
 *      rect is lazy, and memoized to one read per measuring batch.
 *
 * **No pre-416 suite could see any of this.** Every geometry suite in the repo
 * drives the observers with no gesture live, where the parked and unparked
 * paths are byte-identical by construction.
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
import type { AnchorNodeMetrics } from "@/lib/marginalia";
import {
  beginContentGesture,
  endContentGesture,
} from "@/lib/pane-resize/layout-gesture-bus";

// ── Observer fakes (the `wrap-cascade` harness shape) ───────────────────────
// Both fakes RECORD what they observe: the split rule 1 pins is "observe, but
// do not measure", and only a recorded observe can tell that from a bail.

type IOCallback = (entries: IntersectionObserverEntry[]) => void;
let liveIOs: FakeIntersectionObserver[] = [];
let liveROs: FakeResizeObserver[] = [];

class FakeIntersectionObserver {
  cb: IOCallback;
  observed: Element[] = [];
  constructor(cb: IOCallback) {
    this.cb = cb;
    liveIOs.push(this);
  }
  observe(el: Element) {
    this.observed.push(el);
  }
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
  observed: Element[] = [];
  constructor(cb: (entries: ResizeObserverEntry[]) => void) {
    this.cb = cb;
    liveROs.push(this);
  }
  observe(el: Element) {
    this.observed.push(el);
  }
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

interface Mounted {
  editor: Editor;
  els: HTMLElement[];
  /** `measureBlock` reads the node DOM's rect and the batch reads the host's,
   *  so counting BOTH is what tells a deferred batch (zero reads) from a live
   *  one — and the host counter is what pins the per-batch memo. */
  reads: { host: number; block: number };
  /** Simulated scroll: every block's reported top shifts by this. Without it
   *  a re-ENTER measures to a byte-identical value, `metricsWithinEpsilon`
   *  holds, `changed` stays false and every "did it notify?" assertion is
   *  vacuous — which is exactly how this file's first cut passed under its
   *  own neuter. */
  scrollBy: (px: number) => void;
}

function mount(): Mounted {
  const reads = { host: 0, block: 0 };
  let offset = 0;
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
      return rect(i * 40 - offset, i * 40 + 30 - offset);
    };
    els.push(el);
    pos += node.nodeSize;
  }
  return {
    editor,
    els,
    reads,
    scrollBy: (px: number) => {
      offset += px;
    },
  };
}

let realIO: typeof IntersectionObserver;
let realRO: typeof ResizeObserver;
let realRaf: typeof requestAnimationFrame;
let realCaf: typeof cancelAnimationFrame;
let teardown: Array<() => void> = [];

beforeEach(() => {
  liveIOs = [];
  liveROs = [];
  rafQueue = [];
  teardown = [];
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
  // A leaked gesture would silently park everything after it; a retained
  // service would leak an editor. Teardown belongs HERE, not at the end of a
  // body that a failing expectation never reaches.
  endContentGesture();
  for (const fn of teardown.reverse()) fn();
  teardown = [];
  globalThis.IntersectionObserver = realIO;
  globalThis.ResizeObserver = realRO;
  globalThis.requestAnimationFrame = realRaf;
  globalThis.cancelAnimationFrame = realCaf;
  document.body.innerHTML = "";
});

/**
 * Mount + prime the engine, then zero the counters.
 *
 * `primeAll: false` leaves the LAST block (b4) never-entered, so a mid-gesture
 * ENTER of an UNOBSERVED uuid is representable — the case that distinguishes
 * "defer the measurement" from "bail outright", and the one every leg in this
 * file's first cut was blind to.
 */
function primed(opts: { primeAll?: boolean } = {}) {
  const primeAll = opts.primeAll ?? true;
  const m = mount();
  const service = getOrCreateGeometry(m.editor);
  const release = service.retain();
  flushRaf();
  const io = liveIOs[0];
  io.fire(primeAll ? m.els : m.els.slice(0, 3), true);
  flushRaf();

  let notifies = 0;
  /** What `getMetrics` reported AT the moment of each notification — the only
   *  way to see that the deck was published COMPLETE rather than holed. */
  const seenAtNotify: Array<Record<string, AnchorNodeMetrics | null>> = [];
  const unsub = service.subscribe(() => {
    notifies++;
    const snap: Record<string, AnchorNodeMetrics | null> = {};
    for (const u of UUIDS) snap[u] = service.getMetrics(u);
    seenAtNotify.push(snap);
  });
  teardown.push(() => {
    unsub();
    release();
    m.editor.destroy();
  });

  m.reads.host = 0;
  m.reads.block = 0;
  io.observed.length = 0;
  liveROs[0].observed.length = 0;
  return {
    ...m,
    service,
    io,
    ro: liveROs[0],
    notifies: () => notifies,
    seenAtNotify,
  };
}

describe("the IO half parks during a content gesture (task 416)", () => {
  it("an ENTER batch mid-gesture reads NO rects and notifies nobody", () => {
    const t = primed();
    beginContentGesture("drag-1");

    // The shape a drag's auto-scroll produces: content sliding (so a live
    // re-measure would produce a DIFFERENT Y and therefore a real notify —
    // without the shift this leg would pass under its own neuter) and blocks
    // crossing the near-zone boundary once per frame.
    for (let frame = 0; frame < 6; frame++) {
      t.scrollBy(12);
      t.io.fire([t.els[frame % t.els.length]], true);
      flushRaf();
    }

    expect(t.reads.block, "no per-block rect read mid-gesture").toBe(0);
    // The host rect was read UNCONDITIONALLY at the top of `onIntersection`
    // pre-416 — one forced layout per batch even when nothing was measured.
    expect(t.reads.host, "no host rect read mid-gesture").toBe(0);
    expect(t.notifies(), "the deck must not repack mid-gesture").toBe(0);
  });

  it("…and the deferred crossings settle in ONE pass, notifying EXACTLY once", () => {
    const t = primed();
    beginContentGesture("drag-1");
    for (let frame = 0; frame < 6; frame++) {
      t.scrollBy(12);
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
    expect(t.notifies(), "exactly one repack for the whole gesture").toBe(1);
  });

  it("the settle publishes a COMPLETE deck — notify runs AFTER the measure", () => {
    // The two-park defect: `notify()` is synchronous and `scheduleRecompute`
    // only ARMS a RAF, so a second park announces the deck one frame before
    // the measures it is announcing — against a cache holding the LEAVE
    // eviction and none of the deferred ENTER measurements. Every block that
    // left and re-entered during the drag would lose its marker for a painted
    // frame at drop time.
    const t = primed();
    beginContentGesture("drag-1");

    t.io.fire([t.els[3]], false); // b4 leaves the near zone …
    flushRaf();
    t.scrollBy(40);
    t.io.fire([t.els[3]], true); // … and comes back
    flushRaf();
    expect(t.notifies(), "still silent mid-gesture").toBe(0);

    endContentGesture();
    flushRaf();

    expect(t.notifies(), "exactly one repack").toBe(1);
    expect(
      t.seenAtNotify[0].b4,
      "b4 must already be measured when the deck is published",
    ).not.toBeNull();
  });

  it("a LEAVE mid-gesture keeps its bookkeeping and defers the repack", () => {
    const t = primed();
    beginContentGesture("drag-1");

    t.io.fire([t.els[2]], false);
    flushRaf();
    expect(t.notifies(), "no repack mid-gesture").toBe(0);
    // The eviction itself is NOT deferred — the cache is the engine's memory
    // and must stay truthful; only the subscriber notification waits.
    expect(t.service.getMetrics("b3")).toBeNull();

    endContentGesture();
    flushRaf();
    expect(t.notifies(), "a pure-LEAVE gesture still settles, exactly once").toBe(1);
  });

  it("BOOKKEEPING is not deferred: a mid-gesture ENTER of an unobserved block is OBSERVED but not measured", () => {
    // The rule's whole point, and unrepresentable in a fixture that primed
    // every block: a whole-handler bail would leave `observed` permanently
    // missing b4 after the drag.
    const t = primed({ primeAll: false });
    beginContentGesture("drag-1");

    t.io.fire([t.els[3]], true);
    flushRaf();

    expect(
      t.ro.observed,
      "the newly near block joins the size-observed set immediately",
    ).toContain(t.els[3]);
    expect(t.reads.block, "…but nothing is measured mid-gesture").toBe(0);
    expect(t.service.getMetrics("b4"), "…so it has no metrics yet").toBeNull();

    endContentGesture();
    flushRaf();
    expect(
      t.service.getMetrics("b4"),
      "the settle measures the block the gesture only bookkept",
    ).not.toBeNull();
  });

  it("a DETACH mid-gesture still arms the re-observe heal", () => {
    // ProseMirror redrawing an anchorable node swaps its outer element; the
    // heal must re-observe the FRESH one, or the marker is culled forever
    // after the drag. This is the half a whole-handler bail would swallow.
    const t = primed();
    beginContentGesture("drag-1");

    const stale = t.els[2];
    const fresh = document.createElement("p");
    fresh.setAttribute("data-uuid", "b3");
    fresh.getBoundingClientRect = () => rect(80, 110);
    stale.replaceWith(fresh);

    t.io.fire([stale], false); // !isIntersecting + !isConnected = a detach
    flushRaf();

    endContentGesture();
    flushRaf();

    expect(
      t.io.observed,
      "the heal re-observes the element ProseMirror substituted",
    ).toContain(fresh);
  });

  it("CONTROL — off-gesture the same batch measures and notifies inline", () => {
    const t = primed();

    t.scrollBy(40);
    t.io.fire([t.els[1]], true);

    expect(t.reads.block, "off-gesture the enter measures on this frame").toBeGreaterThan(0);
    expect(t.reads.host, "…and reads the host rect it needs").toBeGreaterThan(0);
    expect(t.notifies(), "…and publishes it inline, with no RAF in between").toBe(1);
  });

  it("CONTROL — a pure LEAVE batch off-gesture reads no host rect (the lazy read)", () => {
    const t = primed();

    t.io.fire([t.els[2]], false);

    // Pre-416 this paid one unconditional `host.getBoundingClientRect()` for
    // a batch that measures nothing — the scroll-away shape.
    expect(t.reads.host, "a leave-only batch measures nothing, so reads nothing").toBe(0);
    expect(t.reads.block).toBe(0);
  });

  it("CONTROL — a measuring batch reads the host rect ONCE, however many blocks it carries", () => {
    // The `??=` memo, which the laziness leg above cannot see: without it a
    // four-block batch pays four forced layouts for one unmoving host.
    const t = primed();

    t.scrollBy(40);
    t.io.fire(t.els, true);

    expect(t.reads.block, "one read per block").toBe(t.els.length);
    expect(t.reads.host, "one read per BATCH").toBe(1);
  });
});
