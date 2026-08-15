// @vitest-environment jsdom
//
// Task 330 — **a bespoke gesture buys a different SHAPE, not an exemption.**
//
// The float move is the one sanctioned bespoke window-level drag in `src/`
// (the pane-resize engine's `getValue/apply/commit(px)` shape genuinely doesn't
// fit a 2D free move), and for a year that bought it an exemption from the
// engine's whole discipline. Per raw `mousemove` — 120-240 Hz on a high-Hz
// mouse, with no RAF coalescing anywhere — the handler did BOTH:
//
//   1. `setPos(...)`, a React commit that rewrites the shell's `left`/`top`
//      (invalidating layout), and
//   2. a forced-layout DOM sweep for the dock proximity test:
//      `querySelectorAll("[data-panel-column-side]")` + `getComputedStyle(:root)`
//      + a rect per column — and, inside the 80px dock gate, a second
//      `querySelectorAll("[data-dock-slot]")` plus a rect PER BAND and per
//      stack frame.
//
// Write → read → write per event, with the read set GROWING near a dock: which
// is precisely the shape of Gabriel's report ("glitchy and draggy… some large
// geometry is being walked on every movement… especially laggy near the docking
// sites"). And the gesture imported neither pointer invariant, so a release it
// never observed (chorded second button, release outside the window) left the
// panel ghost-glued to the cursor.
//
// This suite drives the REAL gesture against the REAL shell and asserts the
// cost contract directly — what runs per EVENT versus per gesture EDGE. The
// guardrail allowlist can only see the `editor.on`-shaped call form and a
// justification sentence; it was green throughout, which is the task-140 lesson
// (a justification must describe the CALLBACK) restated inside the very file
// that records it.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { render, fireEvent, cleanup, act } from "@testing-library/react";
import FloatingPanel from "@/components/FloatingPanel";
import {
  readDockGeometry,
  resolveDockTargetByPanelProximity,
  getDockDragTarget,
  setDockDragTarget,
  AUTO_DOCK_PROXIMITY,
} from "@/components/editor-layout/dock-drag";
import { strip } from "@/lib/__tests__/_source-scan";

/* ── A dock fixture with real (stubbed) geometry ──────────────────────────
 * jsdom reports an all-zero rect for everything, so every element in the
 * fixture defines its own — the same technique `dropctx-multipane-registry`
 * uses for visibility. The numbers are chosen so each answer below is
 * unambiguous: `--pod-gap` is unset in jsdom, so the module's own fallback of
 * 10 applies and the snap corner sits at TOP_BAR + podGap = 42. */
const COL = { left: 900, top: 0, width: 300, height: 800 }; // right edge 1200
const FRAME = { left: 905, top: 45, width: 290, height: 700 };
const BAND0 = { left: 910, top: 50, width: 280, height: 200 }; // midpoint 150
const BAND1 = { left: 910, top: 260, width: 280, height: 200 }; // midpoint 360

/** Every forced-layout rect read the fixture serves. The fixture stubs each
 *  element's own `getBoundingClientRect` (jsdom answers all-zero), which
 *  shadows `Element.prototype` — so a prototype spy would report zero and the
 *  leg below would pass vacuously. Count them at the source instead. */
let rectReads = 0;

function stubRect(
  el: HTMLElement,
  r: { left: number; top: number; width: number; height: number },
) {
  el.getBoundingClientRect = () => {
    rectReads += 1;
    return {
      left: r.left,
      top: r.top,
      width: r.width,
      height: r.height,
      right: r.left + r.width,
      bottom: r.top + r.height,
      x: r.left,
      y: r.top,
      toJSON() {},
    } as DOMRect;
  };
}

/** One right-side dock column holding two bands inside a stack frame. */
function mountDockFixture(): HTMLElement {
  const col = document.createElement("div");
  col.dataset.panelColumnSide = "right";
  stubRect(col, COL);
  const frame = document.createElement("div");
  frame.setAttribute("data-stack-frame", "");
  stubRect(frame, FRAME);
  for (const r of [BAND0, BAND1]) {
    const band = document.createElement("div");
    band.setAttribute("data-dock-slot", r === BAND0 ? "right-0" : "right-1");
    stubRect(band, r);
    frame.appendChild(band);
  }
  col.appendChild(frame);
  document.body.appendChild(col);
  return col;
}

/* ── RAF control ─────────────────────────────────────────────────────────
 * The move path's only DOM write is RAF-coalesced, so the suite owns the
 * frame clock: nothing is applied until `flushFrame()`, which is also how the
 * ≤1-schedule-per-frame property becomes observable. */
let frameQueue: FrameRequestCallback[] = [];
let rafCalls = 0;
let realRaf: typeof window.requestAnimationFrame;
let realCancelRaf: typeof window.cancelAnimationFrame;

function flushFrame() {
  const queued = frameQueue;
  frameQueue = [];
  act(() => {
    for (const cb of queued) cb(performance.now());
  });
}

beforeEach(() => {
  frameQueue = [];
  rafCalls = 0;
  realRaf = window.requestAnimationFrame;
  realCancelRaf = window.cancelAnimationFrame;
  window.requestAnimationFrame = ((cb: FrameRequestCallback) => {
    rafCalls += 1;
    frameQueue.push(cb);
    return frameQueue.length;
  }) as typeof window.requestAnimationFrame;
  window.cancelAnimationFrame = ((id: number) => {
    frameQueue.splice(id - 1, 1);
  }) as typeof window.cancelAnimationFrame;
});

afterEach(() => {
  cleanup();
  window.requestAnimationFrame = realRaf;
  window.cancelAnimationFrame = realCancelRaf;
  setDockDragTarget(null);
  document.body.style.userSelect = "";
  document.body.style.cursor = "";
  document.querySelectorAll("[data-panel-column-side]").forEach((el) => el.remove());
  vi.restoreAllMocks();
});

const INIT = { x: 800, y: 100, width: 320, height: 240 };

/** A dock-eligible floating panel (it declares `onMaybeRedock`). */
function mountFloat() {
  const onChange = vi.fn();
  const onMaybeRedock = vi.fn();
  render(
    <FloatingPanel
      panelId="notes"
      mode="floating"
      initialX={INIT.x}
      initialY={INIT.y}
      initialWidth={INIT.width}
      initialHeight={INIT.height}
      zIndex={1200}
      onChange={onChange}
      onMaybeRedock={onMaybeRedock}
    >
      <div data-testid="body">panel body</div>
    </FloatingPanel>,
  );
  const shell = document.querySelector<HTMLDivElement>('[data-floating-panel="true"]')!;
  return {
    shell,
    header: document.querySelector<HTMLElement>('[data-testid="body"]')!,
    onChange,
    onMaybeRedock,
  };
}

const HELD = { buttons: 1 };
const move = (x: number, y: number, buttons = 1) =>
  act(() => {
    fireEvent.mouseMove(window, { clientX: x, clientY: y, buttons });
  });
const up = (x: number, y: number) =>
  act(() => {
    fireEvent.mouseUp(window, { clientX: x, clientY: y });
  });

const geom = (shell: HTMLDivElement) => ({
  left: parseFloat(shell.style.left),
  top: parseFloat(shell.style.top),
  transform: shell.style.transform,
});

describe("the move path costs pointer arithmetic and one composited write", () => {
  it("moves the shell by translate3d and leaves React's left/top ALONE until release", () => {
    const { shell, header, onChange } = mountFloat();
    fireEvent.mouseDown(header, { clientX: 500, clientY: 500, ...HELD });

    move(540, 520); // dx +40, dy +20
    // Nothing is written before the frame: the handler only advanced a ref.
    expect(geom(shell).transform).toBe("");
    flushFrame();

    const g = geom(shell);
    expect(g.left, "React-owned left must not move per event").toBe(INIT.x);
    expect(g.top).toBe(INIT.y);
    expect(g.transform).toBe("translate3d(40px, 20px, 0)");
    expect(onChange, "no persistence mid-gesture").not.toHaveBeenCalled();

    up(540, 520);
    const after = geom(shell);
    expect(after.left, "the release commits the live rect").toBe(INIT.x + 40);
    expect(after.top).toBe(INIT.y + 20);
    expect(
      after.transform,
      "the transform is dropped in the SAME commit that writes left/top",
    ).toBe("");
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith({
      x: INIT.x + 40,
      y: INIT.y + 20,
      width: INIT.width,
      height: INIT.height,
    });
  });

  it("schedules at most ONE frame however many events arrive", () => {
    const { header } = mountFloat();
    fireEvent.mouseDown(header, { clientX: 500, clientY: 500, ...HELD });
    for (let i = 1; i <= 8; i += 1) move(500 + i, 500 + i);
    expect(rafCalls, "one frame queued for eight events").toBe(1);
    expect(frameQueue).toHaveLength(1);
    flushFrame();
    // The next event opens a new frame — and only one.
    move(520, 520);
    expect(rafCalls).toBe(2);
  });

  it("does ZERO DOM geometry reads per event (the sweep is ONE per gesture)", () => {
    mountDockFixture();
    const { header } = mountFloat();
    const qsa = vi.spyOn(document, "querySelectorAll");
    const computed = vi.spyOn(window, "getComputedStyle");
    rectReads = 0;

    fireEvent.mouseDown(header, { clientX: 500, clientY: 500, ...HELD });
    move(540, 520); // the gesture's one capture happens here
    flushFrame();
    const afterCapture = {
      qsa: qsa.mock.calls.length,
      computed: computed.mock.calls.length,
      rects: rectReads,
    };
    expect(afterCapture.qsa, "the capture really did sweep").toBeGreaterThan(0);
    expect(
      afterCapture.rects,
      "…including the per-column and per-BAND rects (the near-dock cliff)",
    ).toBeGreaterThanOrEqual(4); // column + frame(×2 lookups) + 2 bands

    // Twenty more events, including a pass right through the dock corner —
    // where the pre-fix handler grew a rect read PER BAND.
    for (let i = 0; i < 20; i += 1) {
      move(560 + i * 4, 460 - i * 8);
      flushFrame();
    }
    expect(qsa.mock.calls.length, "no querySelectorAll per move").toBe(afterCapture.qsa);
    expect(computed.mock.calls.length, "no getComputedStyle per move").toBe(
      afterCapture.computed,
    );
    expect(rectReads, "no forced-layout rect read per move").toBe(afterCapture.rects);
  });
});

describe("what the outline OFFERS is what the release ACCEPTS", () => {
  // Both halves read the ONE snapshot, so a stale viewport can make them both
  // stale together but can never make them DISAGREE — the affordance law this
  // subsystem has been drained of three times (tasks 258, 321, 332).
  it("the redock target on release is the target the outline previewed", () => {
    mountDockFixture();
    const { header, onMaybeRedock } = mountFloat();
    // Land the float's top-RIGHT corner on the right column's snap corner
    // (x + width = 1200, y = TOP_BAR + podGap = 42) with the cursor at y=300,
    // which sits below band0's midpoint and above band1's → insertion index 1.
    fireEvent.mouseDown(header, { clientX: 500, clientY: 500, ...HELD });
    move(500 + (880 - INIT.x), 500 + (42 - INIT.y)); // → nx 880, ny 42
    flushFrame();

    const previewed = getDockDragTarget();
    expect(previewed, "the outline previews a set-down target").not.toBeNull();
    expect(previewed!.side).toBe("right");

    up(500 + (880 - INIT.x), 500 + (42 - INIT.y));
    expect(onMaybeRedock).toHaveBeenCalledTimes(1);
    expect(onMaybeRedock).toHaveBeenCalledWith({
      side: previewed!.side,
      index: previewed!.index,
    });
    expect(getDockDragTarget(), "the outline is cleared on the end edge").toBeNull();
  });

  it("a float released away from every dock redocks nowhere", () => {
    mountDockFixture();
    const { header, onMaybeRedock } = mountFloat();
    fireEvent.mouseDown(header, { clientX: 500, clientY: 500, ...HELD });
    move(480, 600);
    flushFrame();
    up(480, 600);
    expect(onMaybeRedock).not.toHaveBeenCalled();
  });
});

describe("the pointer invariants (imported from the engine's SSOT)", () => {
  it("a mid-move with the primary button UP ends the gesture at the last live rect", () => {
    const { shell, header, onChange } = mountFloat();
    fireEvent.mouseDown(header, { clientX: 500, clientY: 500, ...HELD });
    move(540, 520);
    flushFrame();

    // The release happened somewhere we never saw (over an iframe, outside the
    // window, or the drag button let go while a second was chorded — which
    // fires only a move with an updated mask).
    move(2000, 2000, /* buttons */ 0);

    expect(onChange, "the missed release still commits, exactly once").toHaveBeenCalledTimes(1);
    expect(
      onChange,
      "and it must NOT incorporate the stray coordinate (ghost movement)",
    ).toHaveBeenCalledWith({
      x: INIT.x + 40,
      y: INIT.y + 20,
      width: INIT.width,
      height: INIT.height,
    });
    expect(document.body.style.cursor, "chrome teardown runs on every end").toBe("");
    expect(document.body.style.userSelect).toBe("");
    expect(geom(shell).transform).toBe("");

    // And the gesture is really over: a later move moves nothing, where the
    // pre-fix handler kept ghost-tracking and committed on the next click.
    move(3000, 3000);
    flushFrame();
    expect(geom(shell)).toEqual({ left: INIT.x + 40, top: INIT.y + 20, transform: "" });
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("a non-primary press starts no gesture at all", () => {
    const { shell, header, onChange } = mountFloat();
    fireEvent.mouseDown(header, { button: 2, clientX: 500, clientY: 500 });
    expect(document.body.style.cursor).toBe("");
    move(540, 520);
    flushFrame();
    expect(geom(shell)).toEqual({ left: INIT.x, top: INIT.y, transform: "" });
    up(540, 520);
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe("dock geometry: ONE sweep, then pure arithmetic", () => {
  it("resolves the band insertion point from a snapshot the way the live DOM reads", () => {
    mountDockFixture();
    const snap = readDockGeometry();
    expect(snap.podGap).toBe(10); // jsdom leaves --pod-gap unset → module fallback
    expect(snap.columns).toHaveLength(1);
    expect(snap.columns[0]).toMatchObject({ side: "right", left: 900, right: 1200 });
    expect(snap.columns[0].bands).toEqual([BAND0, BAND1]);
    expect(snap.columns[0].frame).toEqual(FRAME);

    const panel = { x: 880, y: 42, width: 320, height: 240 }; // corner-on
    // Insertion index = bands whose midpoint is above the probe y.
    for (const [y, index, rect] of [
      [100, 0, BAND0],
      [300, 1, BAND1],
      [500, 2, BAND1], // past the last midpoint → hug the bottom band
    ] as const) {
      const t = resolveDockTargetByPanelProximity(snap, panel, undefined, { x: 1000, y });
      expect(t, `cursor y=${y}`).toEqual({ side: "right", index, rect });
    }
  });

  it("refuses a panel outside the proximity threshold", () => {
    mountDockFixture();
    const snap = readDockGeometry();
    const far = { x: 880, y: 42 + AUTO_DOCK_PROXIMITY + 1, width: 320, height: 240 };
    expect(resolveDockTargetByPanelProximity(snap, far)).toBeNull();
    // Falls back to the panel's vertical centre with no cursor — the shipped
    // behaviour when a release carries no trustworthy coordinate.
    const on = { x: 880, y: 42, width: 320, height: 40 }; // centre y = 62
    expect(resolveDockTargetByPanelProximity(snap, on)?.index).toBe(0);
  });

  it("a snapshot is immune to later DOM movement, and a re-capture sees it", () => {
    const col = mountDockFixture();
    const snap = readDockGeometry();
    // The columns slide (a pane resize, an external display) — the snapshot
    // must NOT silently follow, which is the property that makes the per-move
    // hit-test pure. Re-capturing is the only way to move it.
    stubRect(col, { ...COL, left: 400, width: 300 });
    expect(readDockGeometry().columns[0].left).toBe(400);
    expect(snap.columns[0].left).toBe(900);
  });

  it("answers with no columns off-screen of any dock (and never throws)", () => {
    const snap = readDockGeometry(); // no fixture mounted
    expect(snap.columns).toEqual([]);
    expect(
      resolveDockTargetByPanelProximity(snap, { x: 0, y: 0, width: 10, height: 10 }),
    ).toBeNull();
  });
});

describe("source contract: the MOVE branch reads no geometry and commits no state", () => {
  // The leg with teeth. The primitives were never the part that could
  // misbehave — a call site that reaches past them is, and neither the
  // pane-drag guardrail (which greps for the listener + chrome conjunction)
  // nor any behavioural leg above can see a live DOM read added beside a
  // correct one. So read the source of the one region that must stay pure.
  const src = readFileSync(resolve(__dirname, "../FloatingPanel.tsx"), "utf8");
  // Comments AND string literals blanked: every needle below is an
  // IDENTIFIER, so a name inside a doc comment or a message must not read as a
  // call (this file's comments name several of them on purpose).
  const code = strip(src, /* keepStrings */ false);

  /** The `onMove` handler's MOVE branch: its declaration through the start of
   *  the resize branch, which is deliberately allowed to commit per event. */
  function moveBranch(): string {
    const start = code.indexOf("const onMove = (e: MouseEvent)");
    expect(start, "onMove moved — re-aim this census").toBeGreaterThan(0);
    // The resize branch opens with this exact marker in the stripped source.
    const end = code.indexOf("if (s.edges.right)", start);
    expect(end, "the resize branch marker moved — re-aim this census").toBeGreaterThan(start);
    return code.slice(start, end);
  }

  it("names no DOM-measuring API", () => {
    const region = moveBranch();
    for (const needle of [
      "querySelectorAll",
      "querySelector(",
      "getBoundingClientRect",
      "getComputedStyle",
      // The WCO inset reader is a localStorage read (twice) plus a titlebar
      // rect — snapshot at the gesture edge, never per event.
      "getWindowInsetTopPx",
    ]) {
      expect(region.includes(needle), `move branch must not call ${needle}`).toBe(false);
    }
  });

  it("reaches the geometry only through the memoized per-gesture door", () => {
    const region = moveBranch();
    // `geometry()` captures at most once per gesture; naming either reader
    // directly here would sweep per event.
    expect(region.includes("readDockGeometry")).toBe(false);
    expect(region.includes("readMoveGeometry")).toBe(false);
    expect(region.includes("geometry()"), "…and it does ask the door").toBe(true);
  });

  it("commits React state only through the edge helper", () => {
    const region = moveBranch();
    // `commitPos` is the undock edge (once per gesture, and the drag's one
    // legitimate layout change). A bare `setPos(` here is the per-frame-commit
    // bug class AGENTS.md "Pane-drag stability" exists to kill.
    expect(region.includes("setPos(")).toBe(false);
    expect(region.includes("scheduleTranslate()"), "the shell moves by transform").toBe(true);
  });

  it("the census can SEE its needles (swallow self-check)", () => {
    // A stripper bug (or a mis-aimed region) would make every leg above pass
    // vacuously, so anchor on text that must exist in the region and on a
    // needle that must exist elsewhere in the file.
    const region = moveBranch();
    expect(region).toContain("isMissedRelease");
    expect(region.length).toBeGreaterThan(500);
    expect(code, "the file DOES read geometry — on the edges").toContain(
      "getBoundingClientRect",
    );
  });
});
