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

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, fireEvent, cleanup } from "@testing-library/react";
import FloatingPanel, {
  FLOAT_MIN_W,
  FLOAT_MAX_W,
  FLOAT_MIN_H,
} from "@/components/FloatingPanel";

afterEach(() => {
  cleanup();
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

/** Press an edge zone at (sx,sy), move to (mx,my). Does NOT release. */
function dragEdge(
  shell: HTMLDivElement,
  edge: string,
  sx: number,
  sy: number,
  mx: number,
  my: number,
) {
  fireEvent.mouseDown(zone(shell, edge), { clientX: sx, clientY: sy });
  fireEvent(
    window,
    new MouseEvent("mousemove", { bubbles: true, clientX: mx, clientY: my }),
  );
}

function release(mx: number, my: number) {
  fireEvent(
    window,
    new MouseEvent("mouseup", { bubbles: true, clientX: mx, clientY: my }),
  );
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
