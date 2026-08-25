// @vitest-environment jsdom
//
// Pins EVERY hard behavior of the pane-resize gesture engine (.impl-notes.md):
//
//   1. pointer OWNERSHIP — setPointerCapture on the handle; move/up/cancel/
//      lostpointercapture listeners on the ELEMENT (window carries only the
//      gesture-scoped Escape keydown + the end-only removal failsafes below).
//      A capture FAILURE refuses the gesture outright (no listeners, no
//      shield, no bus edge) — without capture the shield would block its own
//      end events.
//   2. start gates — button 0 + isPrimary + !disabled + no drag already live.
//   3. RAF-coalesced apply() behind an equality bail; flush-before-commit.
//   4. commit() EXACTLY once per completed gesture that CHANGED the value, on
//      every end variant (pointerup, pointercancel, lostpointercapture,
//      buttons failsafe), and never twice when end variants stack (up →
//      lostpointercapture). A gesture with zero NET change takes restore()
//      and commits ZERO times (task 470) — so every leg below that merely
//      needs a gesture to END drives a real move, or it would be
//      unfalsifiable.
//   5. primary-button-up mid-move ((buttons & 1) === 0, incl. a chorded
//      second button still down) = missed release: ends with the last live
//      value, NOT the stray event's coordinate (the ghost-resume class).
//   6a. Escape is CLAIMED by the live gesture (preventDefault +
//      stopPropagation via `claimGestureKey`): a drag is the innermost
//      transient thing on screen, so one press ends exactly one thing. Before
//      task 471 the same press also reached margin-edit's window-BUBBLE
//      cancel (discarding every unsaved margin) and the dialog stack's
//      document-CAPTURE handler.
//   6. Escape restores the drag-start value and ends WITHOUT commit —
//      through spec.restore() when provided (store-truth re-sync), else
//      apply(startValue). Since task 470 that is one of TWO no-net-change
//      ends; the other is a completed gesture whose value never left the
//      getValue() snapshot, which takes restore() and no apply fallback.
//   7. bus edge discipline — one begin + one end per gesture, all variants.
//   8. drag shield mounted for the gesture (axis cursor), dragging class
//      toggled on the handle, both torn down on every end path incl. unmount.
//   9. getValue() called EXACTLY once per gesture, on the start edge — the
//      documented safe point for consumers' per-gesture snapshots.
//  10. captured-element REMOVAL mid-gesture (a conditionally rendered handle
//      unmounting while the owner stays mounted) cannot wedge: the UA fires
//      lostpointercapture at the DOCUMENT and later pointer events hit-test
//      to the shield, so gesture-scoped document/window failsafes end the
//      gesture on the same path.
//
// jsdom provides PointerEvent but NOT pointer-capture plumbing — the capture
// pair is shimmed on Element.prototype per the repo testing notes.

import {
  describe,
  it,
  expect,
  vi,
  beforeAll,
  afterAll,
  beforeEach,
  afterEach,
} from "vitest";
import { renderHook, render, cleanup } from "@testing-library/react";
import type * as React from "react";

import {
  usePaneResizeHandle,
  type PaneResizeSpec,
  type PaneResizeHandleProps,
} from "../use-pane-resize-handle";
import {
  isLayoutGestureActive,
  onLayoutGestureChange,
  __resetLayoutGestureBusForTest,
  type LayoutGestureInfo,
} from "../layout-gesture-bus";
import { isDragShieldMounted, unmountDragShield } from "../drag-shield";

// ── jsdom shims ─────────────────────────────────────────────────────────────

const setPointerCapture = vi.fn();
const releasePointerCapture = vi.fn();

beforeAll(() => {
  Object.assign(Element.prototype, {
    setPointerCapture,
    releasePointerCapture,
  });
});
afterAll(() => {
  // Shim-only members; jsdom has no native implementation to restore.
  delete (Element.prototype as Partial<Element>).setPointerCapture;
  delete (Element.prototype as Partial<Element>).releasePointerCapture;
});

// Deterministic RAF: callbacks queue until flushRaf(); cancel really cancels.
let rafSeq = 0;
let rafCallbacks = new Map<number, FrameRequestCallback>();
const flushRaf = () => {
  const cbs = [...rafCallbacks.values()];
  rafCallbacks.clear();
  for (const cb of cbs) cb(0);
};

beforeEach(() => {
  rafCallbacks = new Map();
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    rafSeq += 1;
    rafCallbacks.set(rafSeq, cb);
    return rafSeq;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => {
    rafCallbacks.delete(id);
  });
  __resetLayoutGestureBusForTest();
  unmountDragShield();
  setPointerCapture.mockClear();
  releasePointerCapture.mockClear();
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

// ── Harness ─────────────────────────────────────────────────────────────────

type LogEntry = { op: "apply" | "commit" | "bus-begin" | "bus-end"; px: number };

function makeHarness(overrides: Partial<PaneResizeSpec> = {}) {
  const log: LogEntry[] = [];
  const spec: PaneResizeSpec = {
    id: "gutter-under-test",
    axis: "x",
    getValue: () => 200,
    apply: (px) => log.push({ op: "apply", px }),
    commit: (px) => log.push({ op: "commit", px }),
    ...overrides,
  };
  const hook = renderHook(
    (p: { spec: PaneResizeSpec }) => usePaneResizeHandle(p.spec),
    { initialProps: { spec } },
  );
  const el = document.createElement("div");
  document.body.appendChild(el);
  return {
    el,
    log,
    spec,
    props: () => hook.result.current,
    rerender: (s: PaneResizeSpec) => hook.rerender({ spec: s }),
    unmount: () => hook.unmount(),
    applied: () => log.filter((e) => e.op === "apply").map((e) => e.px),
    committed: () => log.filter((e) => e.op === "commit").map((e) => e.px),
  };
}

function pointerDown(
  props: PaneResizeHandleProps,
  el: HTMLElement,
  init: Partial<{
    button: number;
    buttons: number;
    isPrimary: boolean;
    pointerId: number;
    clientX: number;
    clientY: number;
  }> = {},
) {
  const preventDefault = vi.fn();
  props.onPointerDown({
    button: 0,
    buttons: 1,
    isPrimary: true,
    pointerId: 1,
    clientX: 100,
    clientY: 100,
    currentTarget: el,
    preventDefault,
    ...init,
  } as unknown as React.PointerEvent<HTMLElement>);
  return { preventDefault };
}

const pe = (type: string, init: PointerEventInit = {}) =>
  new PointerEvent(type, { pointerId: 1, bubbles: true, ...init });
const move = (el: HTMLElement, clientX: number, init: PointerEventInit = {}) =>
  el.dispatchEvent(pe("pointermove", { buttons: 1, clientX, clientY: 100, ...init }));
const up = (el: HTMLElement, init: PointerEventInit = {}) =>
  el.dispatchEvent(pe("pointerup", { buttons: 0, ...init }));
const escape = () =>
  window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));

/** A press dispatched from INSIDE the document, so the propagation path is the
 *  real one: window capture → document capture → target → document bubble →
 *  window bubble. `escape()` above targets `window` itself, whose path is just
 *  [window] — enough to reach the engine's own listener, and structurally
 *  unable to reach a `document` listener at all, which is exactly what the
 *  key-claim legs need to observe (task 471). */
const keyFromDocument = (key: string) =>
  document.body.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));

// ── Tests ───────────────────────────────────────────────────────────────────

describe("usePaneResizeHandle — pointer ownership", () => {
  it("captures the pointer on the handle and scopes the drag stream to the element (window/document carry only gesture-scoped edges: Escape + end-only removal failsafes, no pointermove)", () => {
    const h = makeHarness();
    const elSpy = vi.spyOn(h.el, "addEventListener");
    const winSpy = vi.spyOn(window, "addEventListener");
    const docSpy = vi.spyOn(document, "addEventListener");

    const { preventDefault } = pointerDown(h.props(), h.el, { pointerId: 7 });

    expect(preventDefault).toHaveBeenCalled();
    expect(setPointerCapture).toHaveBeenCalledExactlyOnceWith(7);

    const elTypes = elSpy.mock.calls.map((c) => c[0]);
    expect(elTypes).toEqual(
      expect.arrayContaining([
        "pointermove",
        "pointerup",
        "pointercancel",
        "lostpointercapture",
      ]),
    );
    // The per-frame stream (pointermove) is element-only; window/document get
    // end/cancel edges exclusively.
    const winTypes = winSpy.mock.calls.map((c) => c[0]);
    expect(winTypes).toEqual(["keydown", "pointerup", "pointercancel"]);
    const docTypes = docSpy.mock.calls.map((c) => c[0]);
    expect(docTypes).toEqual(["lostpointercapture"]);

    up(h.el, { pointerId: 7 });
    expect(releasePointerCapture).toHaveBeenCalledExactlyOnceWith(7);
    elSpy.mockRestore();
    winSpy.mockRestore();
    docSpy.mockRestore();
  });

  it("refuses the gesture when setPointerCapture throws — no listeners, no shield, no bus edge (a capture-less shield would block its own end events)", () => {
    const edges = vi.fn();
    onLayoutGestureChange(edges);
    const h = makeHarness();
    const elSpy = vi.spyOn(h.el, "addEventListener");
    setPointerCapture.mockImplementationOnce(() => {
      throw new DOMException("InvalidPointerId", "NotFoundError");
    });

    pointerDown(h.props(), h.el);

    expect(isLayoutGestureActive()).toBe(false);
    expect(isDragShieldMounted()).toBe(false);
    expect(h.el.classList.contains("dragging")).toBe(false);
    expect(elSpy).not.toHaveBeenCalled();
    expect(edges).not.toHaveBeenCalled();
    expect(h.log).toEqual([]); // getValue-side snapshots never taken either

    // A later pointerdown (capture healthy again) starts normally. The
    // witness is a REAL drag: since task 470 a zero-move end commits nothing,
    // so `committed()` after a bare click would be [] whether the gesture
    // started or not — which would make this leg unfalsifiable.
    pointerDown(h.props(), h.el);
    expect(isLayoutGestureActive()).toBe(true);
    move(h.el, 150);
    up(h.el);
    expect(h.committed()).toEqual([250]);
    elSpy.mockRestore();
  });

  it("ignores events from other pointerIds for the gesture's lifetime", () => {
    const h = makeHarness();
    pointerDown(h.props(), h.el, { pointerId: 1 });

    move(h.el, 999, { pointerId: 2 });
    flushRaf();
    expect(h.applied()).toEqual([]);

    up(h.el, { pointerId: 2 });
    expect(isLayoutGestureActive()).toBe(true);
    expect(h.committed()).toEqual([]);

    // The OWN pointer's move is what the gesture is allowed to see — and it
    // has to be a real one: a zero-move end commits nothing since task 470,
    // so a bare `up` would report [] for both the ignored and the honoured
    // pointer and prove nothing about the gating.
    move(h.el, 150, { pointerId: 1 });
    up(h.el, { pointerId: 1 });
    expect(isLayoutGestureActive()).toBe(false);
    expect(h.committed()).toEqual([250]);
  });
});

describe("usePaneResizeHandle — start gates", () => {
  it.each([
    ["secondary button", { button: 2 }],
    ["middle button", { button: 1 }],
    ["non-primary pointer", { isPrimary: false }],
  ])("refuses to start on %s", (_name, init) => {
    const h = makeHarness();
    pointerDown(h.props(), h.el, init);
    expect(isLayoutGestureActive()).toBe(false);
    expect(isDragShieldMounted()).toBe(false);
    expect(h.el.classList.contains("dragging")).toBe(false);
    expect(setPointerCapture).not.toHaveBeenCalled();
  });

  it("refuses to start when disabled", () => {
    const h = makeHarness({ disabled: true });
    pointerDown(h.props(), h.el);
    expect(isLayoutGestureActive()).toBe(false);
    expect(setPointerCapture).not.toHaveBeenCalled();
  });

  it("refuses a second gesture while one is already in flight", () => {
    const edges = vi.fn();
    onLayoutGestureChange(edges);
    const h = makeHarness();
    const el2 = document.createElement("div");
    document.body.appendChild(el2);

    pointerDown(h.props(), h.el, { pointerId: 1 });
    pointerDown(h.props(), el2, { pointerId: 2 });

    expect(el2.classList.contains("dragging")).toBe(false);
    expect(setPointerCapture).toHaveBeenCalledTimes(1);
    expect(edges).toHaveBeenCalledTimes(1); // just the first begin

    // Gesture 1 is driven for real: a zero-move end commits nothing since
    // task 470, so [] would be the answer whether or not gesture 2 had been
    // refused.
    move(h.el, 150, { pointerId: 1 });
    up(h.el, { pointerId: 1 });
    expect(edges).toHaveBeenCalledTimes(2);
    expect(h.committed()).toEqual([250]); // gesture 1 only
  });
});

describe("usePaneResizeHandle — RAF-coalesced apply", () => {
  it("coalesces a burst of moves into one apply per frame, keeping the last value", () => {
    const h = makeHarness();
    pointerDown(h.props(), h.el);

    move(h.el, 120);
    move(h.el, 150);
    move(h.el, 160);
    expect(h.applied()).toEqual([]); // nothing until the frame

    flushRaf();
    expect(h.applied()).toEqual([260]); // 200 + (160 − 100), last value only

    move(h.el, 170);
    move(h.el, 180);
    flushRaf();
    expect(h.applied()).toEqual([260, 280]);

    up(h.el);
  });

  it("equality-bails: a frame that lands on the already-applied value writes nothing", () => {
    const h = makeHarness();
    pointerDown(h.props(), h.el);

    move(h.el, 160);
    flushRaf();
    expect(h.applied()).toEqual([260]);

    move(h.el, 160); // same coordinate → same clamped value
    flushRaf();
    expect(h.applied()).toEqual([260]);

    up(h.el);
    expect(h.committed()).toEqual([260]);
  });

  it("clamps via spec.clamp before scheduling", () => {
    const h = makeHarness({
      clamp: (px) => Math.max(150, Math.min(240, px)),
    });
    pointerDown(h.props(), h.el);

    move(h.el, 200); // raw 300 → clamp 240
    flushRaf();
    move(h.el, 20); // raw 120 → clamp 150
    flushRaf();
    expect(h.applied()).toEqual([240, 150]);

    up(h.el);
    expect(h.committed()).toEqual([150]);
  });

  it("honors direction −1 and the y axis", () => {
    const h = makeHarness({ axis: "y", direction: -1 });
    pointerDown(h.props(), h.el, { clientY: 100 });

    // clientX is noise on a y-axis handle.
    h.el.dispatchEvent(
      pe("pointermove", { buttons: 1, clientX: 500, clientY: 130 }),
    );
    flushRaf();
    expect(h.applied()).toEqual([170]); // 200 + (−1)·(130 − 100)

    up(h.el);
    expect(h.committed()).toEqual([170]);
  });
});

describe("usePaneResizeHandle — commit exactly once, every end variant", () => {
  it("flushes the pending frame before committing on pointerup (apply and commit agree)", () => {
    const h = makeHarness();
    pointerDown(h.props(), h.el);

    move(h.el, 150); // scheduled, NOT flushed
    up(h.el);

    expect(h.log).toEqual([
      { op: "apply", px: 250 }, // flushed on the end edge…
      { op: "commit", px: 250 }, // …then committed with the same value
    ]);
  });

  // RENEGOTIATED IN PLACE (task 470). This leg used to read "a click with
  // zero movement still commits the start value exactly once" — it pinned the
  // DEFECT as the contract. Seven consumers each hand-wrote a four-line guard
  // against that commit and the three Library ones did not, and theirs commit
  // a CSS-CLAMPED rendered size: one accidental click on the nav / list /
  // papers divider on a narrow window wrote the clamped width into the store
  // permanently, forfeiting the grid template's re-expand-on-window-grow
  // guarantee. The rule now lives in the engine, which holds both halves it
  // needs (`startValue` and `spec.restore`).
  it("a click with zero movement commits NOTHING and takes restore() instead", () => {
    const restore = vi.fn();
    const h = makeHarness({ restore });
    pointerDown(h.props(), h.el);
    up(h.el);
    expect(h.applied()).toEqual([]);
    expect(h.committed()).toEqual([]);
    expect(restore).toHaveBeenCalledTimes(1);
  });

  it("a drag that WANDERS AND RETURNS to its start value commits nothing either — the rule is zero NET change, not zero movement", () => {
    // This is the leg with teeth for the engine's `lastApplied` bookkeeping:
    // the gesture really moved, really applied twice, and still has nothing
    // to persist. It is also the case restore() (rather than
    // apply(startValue)) exists for — the style now holds an imperative write
    // of the snapshot px, which for a clamp()'d track is a RENDERING of a
    // larger stored value, so only the consumer can re-sync from truth.
    const restore = vi.fn();
    const h = makeHarness({ restore });
    pointerDown(h.props(), h.el);
    move(h.el, 150);
    flushRaf();
    move(h.el, 100); // back to the start coordinate
    flushRaf();
    expect(h.applied()).toEqual([250, 200]);

    up(h.el);
    expect(h.committed()).toEqual([]);
    expect(restore).toHaveBeenCalledTimes(1);
  });

  it("a zero-move end on a consumer with NO restore() calls nothing at all (no apply, no commit)", () => {
    // LeftList's column boundary is this shape: a delta-valued gesture whose
    // getValue() returns 0 and whose commit was a redundant identical-widths
    // store write. The engine simply does nothing, which is strictly better.
    const h = makeHarness();
    pointerDown(h.props(), h.el);
    up(h.el);
    expect(h.log.filter((e) => e.op === "apply" || e.op === "commit")).toEqual([]);
  });

  it("pointercancel takes the same end path as pointerup", () => {
    const h = makeHarness();
    pointerDown(h.props(), h.el);
    move(h.el, 150);
    flushRaf();

    h.el.dispatchEvent(pe("pointercancel"));

    expect(h.committed()).toEqual([250]);
    expect(isLayoutGestureActive()).toBe(false);
    expect(isDragShieldMounted()).toBe(false);
    expect(h.el.classList.contains("dragging")).toBe(false);
  });

  it("lostpointercapture takes the same end path as pointerup", () => {
    const h = makeHarness();
    pointerDown(h.props(), h.el);
    move(h.el, 150);
    flushRaf();

    h.el.dispatchEvent(pe("lostpointercapture"));

    expect(h.committed()).toEqual([250]);
    expect(isLayoutGestureActive()).toBe(false);
  });

  it("stacked end variants (pointerup then lostpointercapture) commit only once", () => {
    const h = makeHarness();
    pointerDown(h.props(), h.el);
    move(h.el, 150);
    flushRaf();

    up(h.el);
    // Browsers auto-release capture after pointerup — the trailing
    // lostpointercapture must be swallowed by the ended gesture.
    h.el.dispatchEvent(pe("lostpointercapture"));

    expect(h.committed()).toEqual([250]);
  });

  it("buttons===0 mid-move is a missed release: ends with the last live value, ignoring the stray coordinate", () => {
    const h = makeHarness();
    pointerDown(h.props(), h.el);
    move(h.el, 150);
    flushRaf();
    expect(h.applied()).toEqual([250]);

    // The button is up — this movement happened after a release the handle
    // never saw (e.g. swallowed by an iframe pre-capture). Its coordinate
    // must NOT be incorporated (no ghost drag to 500).
    move(h.el, 400, { buttons: 0 });

    expect(h.applied()).toEqual([250]);
    expect(h.committed()).toEqual([250]);
    expect(isLayoutGestureActive()).toBe(false);
    expect(isDragShieldMounted()).toBe(false);

    // Gesture is over; further events are inert.
    move(h.el, 300);
    flushRaf();
    up(h.el);
    expect(h.applied()).toEqual([250]);
    expect(h.committed()).toEqual([250]);
  });

  it("releasing the PRIMARY button while a second button is chorded ends the gesture (buttons bit test, not === 0)", () => {
    const h = makeHarness();
    pointerDown(h.props(), h.el);

    // Right button pressed mid-drag: buttons 1|2 = 3 — still a live drag.
    move(h.el, 150, { buttons: 3 });
    flushRaf();
    expect(h.applied()).toEqual([250]);

    // LEFT button released with the right still down: per spec this fires
    // pointermove with buttons=2 (pointerup waits for the LAST button). The
    // drag button is up — end with the last live value, NOT the stray
    // coordinate.
    move(h.el, 400, { buttons: 2 });

    expect(h.applied()).toEqual([250]);
    expect(h.committed()).toEqual([250]);
    expect(isLayoutGestureActive()).toBe(false);
    expect(isDragShieldMounted()).toBe(false);
  });
});

describe("usePaneResizeHandle — Escape cancel", () => {
  it("restores the drag-start value and ends WITHOUT commit", () => {
    const h = makeHarness();
    pointerDown(h.props(), h.el);
    move(h.el, 150);
    flushRaf();
    expect(h.applied()).toEqual([250]);

    escape();

    expect(h.applied()).toEqual([250, 200]); // restore
    expect(h.committed()).toEqual([]);
    expect(isLayoutGestureActive()).toBe(false);
    expect(isDragShieldMounted()).toBe(false);
    expect(h.el.classList.contains("dragging")).toBe(false);
  });

  it("cancels an unflushed pending frame (nothing applies after Escape)", () => {
    const h = makeHarness();
    pointerDown(h.props(), h.el);
    move(h.el, 150); // scheduled, not flushed — layout still shows 200

    escape();
    flushRaf(); // the cancelled frame must not fire

    expect(h.applied()).toEqual([]); // no stray apply, no redundant restore
    expect(h.committed()).toEqual([]);
    expect(isLayoutGestureActive()).toBe(false);
  });

  it("CLAIMS the press: a live gesture is the innermost thing on screen, so no other Escape owner fires from it (task 471)", () => {
    // The defect leg. The engine's Escape listener is `window` + CAPTURE and
    // used to neither preventDefault nor stopPropagation, so ONE press
    // cancelled the drag AND ran every other Escape owner in the app. The two
    // stand-ins below are the two real ones, at their real receiver+phase:
    //
    //   - `useMarginEdit`'s cancel — `window`, BUBBLE. Its `cancel()` drops
    //     `liveMargins`, i.e. every guide dragged this session and not yet
    //     Saved, and closes margin-edit mode under the user. Not a race: a
    //     window-capture listener always precedes a window-bubble one for the
    //     same event, so this fired on EVERY such press.
    //   - the modal/dialog stack — `document`, CAPTURE, and it deliberately
    //     ignores `defaultPrevented` ("a modal always has a way out"), so
    //     `preventDefault()` alone would not have stopped it. Only
    //     stopPropagation does — which is why the claim is the pair.
    const marginEditCancel = vi.fn();
    const dialogStackClose = vi.fn();
    window.addEventListener("keydown", marginEditCancel);
    document.addEventListener("keydown", dialogStackClose, true);
    try {
      const h = makeHarness();
      pointerDown(h.props(), h.el);
      move(h.el, 150);
      flushRaf();

      keyFromDocument("Escape");

      expect(h.applied()).toEqual([250, 200]); // the drag DID cancel…
      expect(h.committed()).toEqual([]);
      expect(marginEditCancel).not.toHaveBeenCalled(); // …and nothing else ran
      expect(dialogStackClose).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener("keydown", marginEditCancel);
      document.removeEventListener("keydown", dialogStackClose, true);
    }
  });

  it("claims ONLY while a gesture is live: with none in flight both other owners still get the press", () => {
    // The accepting control. Without it the leg above passes just as happily
    // on an engine that silences Escape app-wide — which would be a far worse
    // bug than the one being fixed (margin-edit's own Cancel, every dialog's
    // way out).
    const marginEditCancel = vi.fn();
    const dialogStackClose = vi.fn();
    window.addEventListener("keydown", marginEditCancel);
    document.addEventListener("keydown", dialogStackClose, true);
    try {
      makeHarness(); // mounted, but no pointerdown
      keyFromDocument("Escape");
      expect(marginEditCancel).toHaveBeenCalledTimes(1);
      expect(dialogStackClose).toHaveBeenCalledTimes(1);
    } finally {
      window.removeEventListener("keydown", marginEditCancel);
      document.removeEventListener("keydown", dialogStackClose, true);
    }
  });

  it("claims ONLY Escape: another key during a live gesture reaches both owners untouched", () => {
    // The second accepting control — the claim is scoped to the key the
    // gesture actually answers, so typing during a drag is unaffected (and
    // `input-modality`'s window-capture typing tracker, which AGENTS.md says
    // must never be silenced, still sees it).
    const marginEditCancel = vi.fn();
    const dialogStackClose = vi.fn();
    window.addEventListener("keydown", marginEditCancel);
    document.addEventListener("keydown", dialogStackClose, true);
    try {
      const h = makeHarness();
      pointerDown(h.props(), h.el);
      keyFromDocument("a");

      expect(marginEditCancel).toHaveBeenCalledTimes(1);
      expect(dialogStackClose).toHaveBeenCalledTimes(1);
      expect(isLayoutGestureActive()).toBe(true); // and the drag is untouched
      up(h.el);
    } finally {
      window.removeEventListener("keydown", marginEditCancel);
      document.removeEventListener("keydown", dialogStackClose, true);
    }
  });

  it("Escape with no drag in flight is inert", () => {
    const h = makeHarness();
    escape();
    expect(h.log).toEqual([]);
    expect(isLayoutGestureActive()).toBe(false);
  });

  it("prefers spec.restore() over apply(startValue) — cancel re-syncs from the source of truth, not the rendered snapshot", () => {
    // getValue() may return RENDERED geometry (a CSS-clamped track), which
    // can sit below the stored value; re-applying it on cancel would pin the
    // clamped px imperatively and diverge DOM from store (React never
    // rewrites the style while the store is unchanged). restore() lets the
    // consumer write the store value back instead.
    const restore = vi.fn();
    const h = makeHarness({ restore });
    pointerDown(h.props(), h.el);
    move(h.el, 150);
    flushRaf();
    expect(h.applied()).toEqual([250]);

    escape();

    expect(restore).toHaveBeenCalledTimes(1);
    expect(h.applied()).toEqual([250]); // no apply(startValue) fallback
    expect(h.committed()).toEqual([]);
    expect(isLayoutGestureActive()).toBe(false);
    expect(isDragShieldMounted()).toBe(false);
  });

  it("restore() runs even when the drag wandered back to the start value (the snapshot has still overwritten the style)", () => {
    const restore = vi.fn();
    const h = makeHarness({ restore });
    pointerDown(h.props(), h.el);
    move(h.el, 150);
    flushRaf();
    move(h.el, 100); // back to the start coordinate → applies startValue
    flushRaf();
    expect(h.applied()).toEqual([250, 200]);

    escape();

    expect(restore).toHaveBeenCalledTimes(1);
    expect(h.committed()).toEqual([]);
  });

  // RENEGOTIATED IN PLACE (task 470): restore() is no longer CANCEL-only —
  // it is the no-net-change end path, which Escape and a zero-move release
  // both take. What stays true, and is what this leg is actually for, is that
  // a gesture which CHANGED the value commits instead, and a detach unmount
  // does neither.
  it("restore() is never called on a commit end that changed the value, nor on a detach unmount", () => {
    const restore = vi.fn();
    const h = makeHarness({ restore });
    pointerDown(h.props(), h.el);
    move(h.el, 150);
    up(h.el);
    expect(h.committed()).toEqual([250]);
    expect(restore).not.toHaveBeenCalled();

    pointerDown(h.props(), h.el);
    move(h.el, 180);
    flushRaf();
    h.unmount();
    expect(restore).not.toHaveBeenCalled();
    expect(isLayoutGestureActive()).toBe(false);
  });
});

describe("usePaneResizeHandle — getValue snapshot contract", () => {
  it("calls getValue exactly once per gesture, on the start edge, for every end variant", () => {
    // Both Phase-2 consumers park per-gesture snapshots in getValue()
    // (LibraryView's clamp bound, LeftList's start-widths record) — a
    // mid-gesture re-read would silently corrupt them while every other
    // test stayed green. Pin the call count across commit, Escape, and the
    // buttons-failsafe ends.
    const getValue = vi.fn(() => 200);
    const h = makeHarness({ getValue });

    pointerDown(h.props(), h.el); // gesture 1: pointerup commit
    expect(getValue).toHaveBeenCalledTimes(1);
    move(h.el, 150);
    flushRaf();
    move(h.el, 170);
    up(h.el);
    expect(getValue).toHaveBeenCalledTimes(1);

    pointerDown(h.props(), h.el); // gesture 2: Escape cancel
    move(h.el, 260);
    flushRaf();
    escape();
    expect(getValue).toHaveBeenCalledTimes(2); // one fresh read per gesture

    pointerDown(h.props(), h.el); // gesture 3: buttons failsafe
    move(h.el, 150);
    flushRaf();
    move(h.el, 400, { buttons: 0 });
    expect(getValue).toHaveBeenCalledTimes(3);
    expect(isLayoutGestureActive()).toBe(false);
  });
});

describe("usePaneResizeHandle — bus + chrome edges", () => {
  it("publishes exactly one begin and one end edge per gesture, with kind + id + axis", () => {
    const calls: Array<[boolean, LayoutGestureInfo]> = [];
    onLayoutGestureChange((active, info) => calls.push([active, info]));
    const h = makeHarness();

    pointerDown(h.props(), h.el);
    move(h.el, 120);
    flushRaf();
    move(h.el, 140);
    flushRaf();
    up(h.el);

    expect(calls).toEqual([
      [true, { kind: "pane", id: "gutter-under-test", axis: "x" }],
      [false, { kind: "pane", id: "gutter-under-test", axis: "x" }],
    ]);
  });

  it("orders bus edges around the geometry writes: begin BEFORE the first apply; final flushed apply + commit BEFORE the end edge, all synchronous", () => {
    // Both PaneFreeze ordering contracts hang on this interleaving
    // (PaneFreeze.tsx): freeze() reads the TRUE pre-drag width because begin
    // fires from pointerdown, before any RAF apply(); and unfreeze() lands in
    // the same style/layout flush as the final geometry because the end path
    // flushes the pending apply and commits BEFORE publishing the end edge.
    // A threshold-begin (emitted after the first apply) or a deferred/async
    // bus emission (queueMicrotask/RAF) would break the freeze — one frame
    // painted frozen at the new pane size, parks settling on pre-final
    // geometry — with no other engine test failing. Pin the full sequence in
    // ONE log so relative order is the assertion.
    const h = makeHarness();
    onLayoutGestureChange((active) =>
      h.log.push({ op: active ? "bus-begin" : "bus-end", px: -1 }),
    );

    pointerDown(h.props(), h.el);
    move(h.el, 120);
    flushRaf();
    move(h.el, 150); // scheduled, NOT flushed — the end path must flush it
    up(h.el);

    // Complete by the time pointerup returns (synchronous emission), in
    // exactly this order.
    expect(h.log).toEqual([
      { op: "bus-begin", px: -1 },
      { op: "apply", px: 220 },
      { op: "apply", px: 250 }, // end-path flush of the pending frame…
      { op: "commit", px: 250 }, // …commit agrees…
      { op: "bus-end", px: -1 }, // …and only THEN the end edge publishes
    ]);
  });

  it("mounts the shield with the axis cursor and toggles .dragging for the gesture", () => {
    const h = makeHarness();
    pointerDown(h.props(), h.el);

    expect(h.el.classList.contains("dragging")).toBe(true);
    expect(isDragShieldMounted()).toBe(true);
    const shield = document.querySelector<HTMLDivElement>(
      "[data-pane-drag-shield]",
    );
    expect(shield?.style.cursor).toBe("col-resize");
    expect(document.body.style.userSelect).toBe("none");

    up(h.el);

    expect(h.el.classList.contains("dragging")).toBe(false);
    expect(isDragShieldMounted()).toBe(false);
    expect(document.querySelector("[data-pane-drag-shield]")).toBeNull();
    expect(document.body.style.userSelect).toBe("");
  });

  it("uses the row-resize cursor for a y-axis handle", () => {
    const h = makeHarness({ axis: "y" });
    pointerDown(h.props(), h.el);
    expect(
      document.querySelector<HTMLDivElement>("[data-pane-drag-shield]")?.style
        .cursor,
    ).toBe("row-resize");
    up(h.el);
  });

  it("unmounting the owner mid-gesture detaches: bus ends, shield unmounts, nothing commits", () => {
    const h = makeHarness();
    pointerDown(h.props(), h.el);
    move(h.el, 150);
    flushRaf();
    expect(h.applied()).toEqual([250]);

    h.unmount();

    expect(isLayoutGestureActive()).toBe(false);
    expect(isDragShieldMounted()).toBe(false);
    expect(h.el.classList.contains("dragging")).toBe(false);
    expect(h.committed()).toEqual([]);
    // No restore either — the pane keeps its last applied geometry.
    expect(h.applied()).toEqual([250]);
  });
});

describe("usePaneResizeHandle — captured-element removal failsafes", () => {
  // The one case element-scoped listeners can't see: the captured handle is
  // REMOVED from the DOM mid-gesture (a conditionally rendered handle —
  // SplitWithCode's `{open && …}` branch — flipping while the owner stays
  // mounted, so the unmount detach never fires). Per Pointer Events implicit
  // release the UA fires lostpointercapture at the DOCUMENT, and later
  // pointer events hit-test to the shield (which has no listeners) — without
  // the document/window failsafes the shield would wedge ALL app input.

  it("ends the gesture when the captured handle is removed mid-drag (UA fires lostpointercapture at the document)", () => {
    const h = makeHarness();
    pointerDown(h.props(), h.el);
    move(h.el, 150);
    flushRaf();
    expect(h.applied()).toEqual([250]);

    h.el.remove();
    // jsdom doesn't implement implicit capture release — dispatch the
    // document-targeted lostpointercapture the spec mandates for a removed
    // capture node.
    document.dispatchEvent(pe("lostpointercapture"));

    expect(h.committed()).toEqual([250]);
    expect(isLayoutGestureActive()).toBe(false);
    expect(isDragShieldMounted()).toBe(false);
    expect(document.body.style.userSelect).toBe("");
  });

  it("a window-level pointerup after the handle detached still ends the gesture (the release hit-tests to the shield, never the element)", () => {
    const h = makeHarness();
    pointerDown(h.props(), h.el);
    move(h.el, 150);
    flushRaf();

    h.el.remove();
    window.dispatchEvent(pe("pointerup", { buttons: 0 }));

    expect(h.committed()).toEqual([250]);
    expect(isLayoutGestureActive()).toBe(false);
    expect(isDragShieldMounted()).toBe(false);
  });

  it("failsafes are pointerId-gated and gesture-scoped: foreign pointers are ignored, post-end strays are inert", () => {
    const h = makeHarness();
    pointerDown(h.props(), h.el);
    document.dispatchEvent(pe("lostpointercapture", { pointerId: 9 }));
    window.dispatchEvent(pe("pointerup", { buttons: 0, pointerId: 9 }));
    expect(isLayoutGestureActive()).toBe(true); // foreign pointer never ends it

    // Driven for real: a zero-move end commits nothing since task 470, so a
    // bare click would report [] before AND after the strays and could not
    // tell a double-commit from no commit at all.
    move(h.el, 150);
    up(h.el);
    expect(h.committed()).toEqual([250]);

    // Removed on the end edge — stray document/window events can't re-enter
    // finish() (no double commit, no bus/shield churn).
    document.dispatchEvent(pe("lostpointercapture"));
    window.dispatchEvent(pe("pointerup", { buttons: 0 }));
    expect(h.committed()).toEqual([250]);
    expect(isLayoutGestureActive()).toBe(false);
  });
});

describe("usePaneResizeHandle — handle props", () => {
  it("returns touch-action:none + probe data attrs, stable across re-renders", () => {
    const h = makeHarness();
    const first = h.props();
    expect(first.style.touchAction).toBe("none");
    expect(first["data-pane-resize-id"]).toBe("gutter-under-test");
    expect(first["data-pane-resize-axis"]).toBe("x");

    // Same id/axis in a fresh spec object → identical props (memoized), so
    // spreading onto the handle never churns attributes per render.
    h.rerender({ ...h.spec, getValue: () => 999 });
    expect(Object.is(h.props(), first)).toBe(true);
  });

  // Task 189 — the engine owns the divider's SEMANTIC surface, not just its
  // gesture. A gutter is pointer-only (no tabIndex, no arrow keys anywhere in
  // the engine), so it states that once here instead of leaving four of ten
  // consumers to hand-roll `role="separator"` + `aria-label="Resize …"` — a
  // named, valueless, non-operable splitter promising an interaction the app
  // does not implement. Posture recorded in STYLE_GUIDE "Resize gutters".
  it("hides the handle from the a11y tree on BOTH axes — a pointer-only affordance announces nothing", () => {
    for (const axis of ["x", "y"] as const) {
      const h = makeHarness({ axis });
      expect(h.props()["aria-hidden"]).toBe(true);
      expect(h.props()["data-pane-resize-axis"]).toBe(axis);
    }
  });

  it("emits no role, tabIndex or key handler — nothing that would read as operable", () => {
    const keys = Object.keys(makeHarness().props());
    expect(keys).not.toContain("role");
    expect(keys).not.toContain("tabIndex");
    expect(keys.filter((k) => /^on(Key|Focus|Blur)/.test(k))).toEqual([]);
  });

  it("reaches the DOM as aria-hidden when spread the documented way", () => {
    // The props object is one thing; what React renders is another — and what
    // an AT sees is the rendered attribute. Spread exactly as the engine's
    // docblock prescribes, then read the DOM.
    function Gutter() {
      const handle = usePaneResizeHandle({
        id: "dom-check",
        axis: "y",
        getValue: () => 0,
        apply: () => {},
        commit: () => {},
      });
      return <div data-testid="gutter" className="drag-gap drag-gap-h band-grip" {...handle} />;
    }
    const { getByTestId } = render(<Gutter />);
    const el = getByTestId("gutter");
    expect(el.getAttribute("aria-hidden")).toBe("true");
    expect(el.getAttribute("role")).toBeNull();
    expect(el.getAttribute("aria-label")).toBeNull();
    expect(el.tabIndex).toBe(-1); // not focusable
  });
});
