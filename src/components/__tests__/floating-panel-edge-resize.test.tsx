// @vitest-environment jsdom
//
// Edge-resize for FloatingPanel (the ONE shell every pop-out funnels through:
// cards, text-objects, and panels all float via FloatWindow → FloatingPanel or
// FloatingPanel directly). This pins the deep, single-file generalization of
// the old bottom-right-corner-only resize into an edge-descriptor model:
//
//   - right / bottom edges grow the window from a fixed top-left;
//   - the LEFT edge keeps the RIGHT edge pinned (x moves right as width
//     shrinks; right = x + width stays constant);
//   - min/max clamps (FLOAT_MIN_W / FLOAT_MAX_W / FLOAT_MIN_H) hold at the
//     bounds, and on the left edge the clamp freezes x (no separate x clamp);
//   - the old visible bottom-right corner GRIP (a diagonal linear-gradient
//     `aria-label="Resize"` div) is GONE — replaced by invisible hit-zones.
//
// The shell portals to document.body and positions itself via inline
// `position: fixed; left/top/width/height`, so we drive real window mouse
// events and read the live geometry straight off the shell's inline style.
//
// Since task 335 the resize branch is RAF-COALESCED (≤1 React commit per frame,
// equality-bailed) rather than committing per raw `mousemove`, so this suite
// owns the frame clock the way `float-move-gesture-cost` does: nothing is
// applied until `flushFrame()`. Every assertion's VALUE below is unchanged —
// the clamp math and the pinned-right-edge behaviour are what this file exists
// to pin, and neither moved.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Profiler } from "react";
import { render, fireEvent, cleanup, act } from "@testing-library/react";
import FloatingPanel, {
  FLOAT_MIN_W,
  FLOAT_MAX_W,
  FLOAT_MIN_H,
} from "@/components/FloatingPanel";

/* ── RAF control (mirrors float-move-gesture-cost.test.tsx) ─────────────── */
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
  // Reset body chrome the gesture sets so it can't leak between tests.
  document.body.style.userSelect = "";
  document.body.style.cursor = "";
});

const INIT = { x: 200, y: 150, width: 400, height: 300 };

function renderFloat(overrides: Partial<typeof INIT> = {}) {
  const onChange = vi.fn();
  const rect = { ...INIT, ...overrides };
  render(
    <FloatingPanel
      cardKey="note:n1"
      mode="floating"
      surface="card"
      initialX={rect.x}
      initialY={rect.y}
      initialWidth={rect.width}
      initialHeight={rect.height}
      zIndex={1200}
      onChange={onChange}
    >
      <div data-testid="body" style={{ padding: 20 }}>
        float body
      </div>
    </FloatingPanel>,
  );
  const shell = document.querySelector<HTMLDivElement>(
    '[data-floating-panel="true"]',
  )!;
  return { shell, onChange };
}

/** Same mount, wrapped in a `<Profiler>` so React COMMITS are countable — the
 *  only externally visible difference an equality bail makes. */
function renderProfiledFloat() {
  const onChange = vi.fn();
  const commits = { count: 0 };
  render(
    <Profiler id="float" onRender={() => { commits.count += 1; }}>
      <FloatingPanel
        cardKey="note:n1"
        mode="floating"
        surface="card"
        initialX={INIT.x}
        initialY={INIT.y}
        initialWidth={INIT.width}
        initialHeight={INIT.height}
        zIndex={1200}
        onChange={onChange}
      >
        <div data-testid="body">float body</div>
      </FloatingPanel>
    </Profiler>,
  );
  const shell = document.querySelector<HTMLDivElement>(
    '[data-floating-panel="true"]',
  )!;
  return { shell, onChange, commits };
}

/** Read the live geometry off the shell's inline `position: fixed` style. */
function geom(shell: HTMLDivElement) {
  return {
    x: parseFloat(shell.style.left),
    y: parseFloat(shell.style.top),
    width: parseFloat(shell.style.width),
    height: parseFloat(shell.style.height),
  };
}

function zone(shell: HTMLDivElement, edge: string) {
  return shell.querySelector<HTMLDivElement>(`[data-resize-edge="${edge}"]`)!;
}

function moveTo(mx: number, my: number) {
  act(() => {
    fireEvent(
      window,
      // `buttons: 1` — the primary button is HELD. Since task 330 the move
      // handler bails on `isMissedRelease`, so a move with jsdom's default
      // `buttons: 0` reads as a release this gesture never observed.
      new MouseEvent("mousemove", { bubbles: true, clientX: mx, clientY: my, buttons: 1 }),
    );
  });
}

/** Press an edge zone at (sx,sy), move to (mx,my), let the frame land. Does
 *  NOT release. */
function dragEdge(
  shell: HTMLDivElement,
  edge: string,
  sx: number,
  sy: number,
  mx: number,
  my: number,
) {
  fireEvent.mouseDown(zone(shell, edge), { clientX: sx, clientY: sy });
  moveTo(mx, my);
  flushFrame();
}

function release(mx: number, my: number) {
  act(() => {
    fireEvent(
      window,
      new MouseEvent("mouseup", { bubbles: true, clientX: mx, clientY: my }),
    );
  });
}

describe("FloatingPanel edge-resize math", () => {
  it("right edge grows width only; top-left stays fixed", () => {
    const { shell } = renderFloat();
    // right edge sits at x+width = 600.
    dragEdge(shell, "right", 600, 300, 700, 999);
    const g = geom(shell);
    expect(g.x).toBe(INIT.x); // top-left fixed
    expect(g.y).toBe(INIT.y);
    expect(g.width).toBe(INIT.width + 100); // grew by dx only
    expect(g.height).toBe(INIT.height); // height untouched by an x-axis edge
  });

  it("bottom edge grows height only; top-left stays fixed", () => {
    const { shell } = renderFloat();
    // bottom edge sits at y+height = 450.
    dragEdge(shell, "bottom", 999, 450, 999, 520);
    const g = geom(shell);
    expect(g.x).toBe(INIT.x);
    expect(g.y).toBe(INIT.y);
    expect(g.width).toBe(INIT.width); // width untouched by a y-axis edge
    expect(g.height).toBe(INIT.height + 70);
  });

  it("LEFT edge keeps the RIGHT edge fixed: x moves, right = x+width is constant", () => {
    const { shell } = renderFloat();
    const rightEdgeBefore = INIT.x + INIT.width; // 600
    // Drag the left edge 60px to the RIGHT (positive dx) → window narrows.
    dragEdge(shell, "left", 200, 300, 260, 300);
    const g = geom(shell);
    expect(g.width).toBe(INIT.width - 60); // 340
    expect(g.x).toBe(INIT.x + 60); // 260 — left side followed the cursor
    expect(g.x + g.width).toBe(rightEdgeBefore); // RIGHT EDGE PINNED
    expect(g.y).toBe(INIT.y); // y untouched
    expect(g.height).toBe(INIT.height);
  });

  it("LEFT edge dragged outward (negative dx) widens while the right edge stays pinned", () => {
    const { shell } = renderFloat();
    const rightEdgeBefore = INIT.x + INIT.width;
    dragEdge(shell, "left", 200, 300, 150, 300); // dx = -50
    const g = geom(shell);
    expect(g.width).toBe(INIT.width + 50); // 450
    expect(g.x).toBe(INIT.x - 50); // 150
    expect(g.x + g.width).toBe(rightEdgeBefore); // still pinned
  });

  it("right-edge clamp holds at FLOAT_MAX_W and FLOAT_MIN_W", () => {
    // Grow huge → clamp to MAX.
    const big = renderFloat();
    dragEdge(big.shell, "right", 600, 300, 600 + 5000, 300);
    expect(geom(big.shell).width).toBe(FLOAT_MAX_W);
    cleanup();
    // Shrink huge → clamp to MIN.
    const small = renderFloat();
    dragEdge(small.shell, "right", 600, 300, 600 - 5000, 300);
    expect(geom(small.shell).width).toBe(FLOAT_MIN_W);
  });

  it("left-edge clamp freezes x at the min-width bound (right edge still pinned)", () => {
    const { shell } = renderFloat();
    const rightEdgeBefore = INIT.x + INIT.width; // 600
    // Drag the left edge way past the right edge → width would go negative,
    // but clamps to FLOAT_MIN_W and x is re-derived so the right edge holds.
    dragEdge(shell, "left", 200, 300, 200 + 5000, 300);
    const g = geom(shell);
    expect(g.width).toBe(FLOAT_MIN_W);
    expect(g.x).toBe(rightEdgeBefore - FLOAT_MIN_W); // x frozen by the width clamp
    expect(g.x + g.width).toBe(rightEdgeBefore);
  });

  it("bottom-edge clamp holds at FLOAT_MIN_H", () => {
    const { shell } = renderFloat();
    dragEdge(shell, "bottom", 999, 450, 999, 450 - 5000);
    expect(geom(shell).height).toBe(FLOAT_MIN_H);
  });

  it("bottom-right corner combines both axes (width + height grow, top-left fixed)", () => {
    const { shell } = renderFloat();
    dragEdge(shell, "bottom-right", 600, 450, 680, 540);
    const g = geom(shell);
    expect(g.x).toBe(INIT.x);
    expect(g.y).toBe(INIT.y);
    expect(g.width).toBe(INIT.width + 80);
    expect(g.height).toBe(INIT.height + 90);
  });

  it("bottom-left corner narrows-from-left + grows height; right edge pinned", () => {
    const { shell } = renderFloat();
    const rightEdgeBefore = INIT.x + INIT.width;
    dragEdge(shell, "bottom-left", 200, 450, 250, 530); // dx=+50, dy=+80
    const g = geom(shell);
    expect(g.width).toBe(INIT.width - 50);
    expect(g.x).toBe(INIT.x + 50);
    expect(g.x + g.width).toBe(rightEdgeBefore); // right pinned
    expect(g.height).toBe(INIT.height + 80);
  });

  it("commits the final geometry via onChange on mouseup", () => {
    const { shell, onChange } = renderFloat();
    dragEdge(shell, "right", 600, 300, 700, 300);
    release(700, 300);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ width: INIT.width + 100, x: INIT.x, y: INIT.y }),
    );
  });

  it("each edge zone sets the matching body resize cursor on mousedown", () => {
    const { shell } = renderFloat();
    fireEvent.mouseDown(zone(shell, "left"), { clientX: 200, clientY: 300 });
    expect(document.body.style.cursor).toBe("ew-resize");
    release(200, 300);
    fireEvent.mouseDown(zone(shell, "bottom"), { clientX: 400, clientY: 450 });
    expect(document.body.style.cursor).toBe("ns-resize");
    release(400, 450);
    fireEvent.mouseDown(zone(shell, "bottom-right"), {
      clientX: 600,
      clientY: 450,
    });
    expect(document.body.style.cursor).toBe("nwse-resize");
    release(600, 450);
    fireEvent.mouseDown(zone(shell, "bottom-left"), {
      clientX: 200,
      clientY: 450,
    });
    expect(document.body.style.cursor).toBe("nesw-resize");
    release(200, 450);
  });
});

describe("the resize branch coalesces (task 335)", () => {
  it("schedules at most ONE frame however many events arrive, and applies nothing before it", () => {
    const { shell } = renderFloat();
    fireEvent.mouseDown(zone(shell, "right"), { clientX: 600, clientY: 300 });
    for (let i = 1; i <= 8; i += 1) moveTo(600 + i * 5, 300);
    expect(rafCalls, "one frame queued for eight events").toBe(1);
    expect(frameQueue).toHaveLength(1);
    expect(
      geom(shell).width,
      "nothing is committed before the frame — the handler only advanced a ref",
    ).toBe(INIT.width);

    flushFrame();
    expect(geom(shell).width, "the frame applies the LAST event's geometry").toBe(
      INIT.width + 40,
    );

    // The next event opens a new frame — and only one.
    moveTo(700, 300);
    expect(rafCalls).toBe(2);
  });

  it("bails the COMMIT when a frame's geometry equals what React already rendered", () => {
    // The bail's only observable is React's commit itself — with equal values
    // React's own style diff writes nothing either way, so an inline-style
    // probe could not tell the two apart. `<Profiler>` can.
    const { shell, commits } = renderProfiledFloat();
    fireEvent.mouseDown(zone(shell, "right"), { clientX: 600, clientY: 300 });

    moveTo(700, 300);
    const before = commits.count;
    flushFrame();
    expect(commits.count, "a real geometry change commits (the control)").toBe(before + 1);
    expect(geom(shell).width).toBe(INIT.width + 100);

    // Frames whose geometry is unchanged: a held pointer re-reporting the same
    // coordinate, and a movement on the axis this edge does not own.
    moveTo(700, 300);
    flushFrame();
    moveTo(700, 999);
    flushFrame();
    expect(commits.count, "an unchanged geometry commits nothing").toBe(before + 1);
    expect(geom(shell).width).toBe(INIT.width + 100);
  });

  it("holds the commit at a clamp bound — a whole drag past MAX_W costs one", () => {
    const { shell, commits } = renderProfiledFloat();
    fireEvent.mouseDown(zone(shell, "right"), { clientX: 600, clientY: 300 });
    const before = commits.count;
    // Every one of these resolves to FLOAT_MAX_W; only the first can commit.
    for (const x of [600 + 5000, 600 + 6000, 600 + 7000]) {
      moveTo(x, 300);
      flushFrame();
    }
    expect(geom(shell).width).toBe(FLOAT_MAX_W);
    expect(commits.count).toBe(before + 1);
  });

  it("a release whose frame never ran still commits the geometry the user dragged to", () => {
    const { shell, onChange } = renderFloat();
    fireEvent.mouseDown(zone(shell, "bottom"), { clientX: 999, clientY: 450 });
    moveTo(999, 520); // queued, never flushed
    expect(frameQueue).toHaveLength(1);
    release(999, 520);
    expect(geom(shell).height).toBe(INIT.height + 70);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ height: INIT.height + 70 }),
    );
    // …and the stale frame, if it somehow ran, can no longer commit behind it.
    flushFrame();
    expect(geom(shell).height).toBe(INIT.height + 70);
  });

  it("a missed release ends the resize at the last observed geometry", () => {
    const { shell, onChange } = renderFloat();
    fireEvent.mouseDown(zone(shell, "right"), { clientX: 600, clientY: 300 });
    moveTo(700, 300);
    flushFrame();

    // The primary button is UP: a release we never observed.
    act(() => {
      fireEvent(
        window,
        new MouseEvent("mousemove", {
          bubbles: true,
          clientX: 2000,
          clientY: 300,
          buttons: 0,
        }),
      );
    });
    expect(onChange, "the missed release commits, exactly once").toHaveBeenCalledTimes(1);
    expect(
      geom(shell).width,
      "and it must NOT incorporate the stray coordinate",
    ).toBe(INIT.width + 100);
    expect(document.body.style.cursor, "chrome teardown runs on every end").toBe("");
    expect(document.body.style.userSelect).toBe("");

    // The gesture is really over.
    moveTo(3000, 300);
    flushFrame();
    expect(geom(shell).width).toBe(INIT.width + 100);
    expect(onChange).toHaveBeenCalledTimes(1);
  });
});

describe("FloatingPanel corner grip styling is removed", () => {
  it("renders no visible diagonal-line grip (the old aria-label='Resize' linear-gradient div is gone)", () => {
    const { shell } = renderFloat();
    // The deleted element was the ONLY one labeled exactly "Resize" and the
    // only one carrying a linear-gradient background.
    expect(shell.querySelector('[aria-label="Resize"]')).toBeNull();
    const gripWithGradient = Array.from(
      shell.querySelectorAll<HTMLElement>("*"),
    ).find((el) => el.style.background.includes("linear-gradient"));
    expect(gripWithGradient).toBeUndefined();
  });

  it("the resize hit-zones are present and carry NO background styling (invisible)", () => {
    const { shell } = renderFloat();
    for (const edge of ["left", "right", "bottom", "bottom-left", "bottom-right"]) {
      const z = zone(shell, edge);
      expect(z, `zone ${edge} should render`).not.toBeNull();
      expect(z.style.background).toBe(""); // no visible styling
    }
  });
});
