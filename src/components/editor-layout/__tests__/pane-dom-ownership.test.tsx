// @vitest-environment jsdom
// Task 1393 — per-pane DOM lookups resolve by OWNERSHIP, not visibility.
//
// The Library renders its left and right panels side by side, and each can
// host a live Reader `EditorPane`. Both pass the visibility rung, so the
// task-438 ladder (first VISIBLE match) answered the RIGHT Reader's docked
// band, strip, fit check and dock sweep with the LEFT Reader's DOM. Every
// fixture in `pane-dom-multipane.test.tsx` builds one visible + one hidden
// pane, where "first visible" and "mine" coincide by construction — so each
// leg here builds TWO VISIBLE panes and asks for the SECOND one's element.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// `panel-column.tsx` pulls in `panel-primitives` → `@/lib/storage`.
vi.mock("@/lib/storage", () => ({ isDevStorage: false }));

import {
  PANE_ROOT_ATTR,
  PaneRootContext,
  paneColumn,
  paneColumns,
  paneDockSlot,
  paneRootById,
  paneRootOf,
  paneStrip,
  resolvePaneMarker,
} from "../pane-dom";
import { measureOmniGap } from "../panel-column";
import { readDockGeometry } from "../dock-drag";
import { render, cleanup } from "@testing-library/react";
import FloatingPanel from "@/components/FloatingPanel";
import { KeepAliveVisibilityProvider } from "@/lib/keep-alive/visibility-context";

type Rect = { left: number; top: number; width: number; height: number };

function stubVisible(el: HTMLElement) {
  Object.defineProperty(el, "offsetParent", {
    configurable: true,
    get: () => document.body,
  });
  Object.defineProperty(el, "offsetHeight", { configurable: true, get: () => 100 });
}

function stubRect(el: HTMLElement, r: Rect) {
  el.getBoundingClientRect = () =>
    ({
      ...r,
      right: r.left + r.width,
      bottom: r.top + r.height,
      x: r.left,
      y: r.top,
      toJSON: () => ({}),
    }) as DOMRect;
}

function el(tag: string, attrs: Record<string, string>, rect?: Rect): HTMLElement {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  stubVisible(e);
  if (rect) stubRect(e, rect);
  return e;
}

/** One VISIBLE Reader pane: root, left strip, left column + frame, and the
 *  given left bands. `right` adds a right column (no bands). */
function buildPane(id: string, colLeft: number, bands: number[], right = false) {
  const root = el("div", { [PANE_ROOT_ATTR]: id });
  const strip = el("div", { "data-strip-side": "left" }, {
    left: colLeft - 40, top: 32, width: 40, height: 700,
  });
  const btn = el("button", { "data-panel-id": `notes-${id}` }, {
    left: colLeft - 36, top: 60, width: 32, height: 32,
  });
  strip.appendChild(btn);
  root.appendChild(strip);
  const col = el("div", { "data-panel-column-side": "left" }, {
    left: colLeft, top: 32, width: 320, height: 700,
  });
  const frame = el("div", { "data-stack-frame": "left" }, {
    left: colLeft + 4, top: 40, width: 300, height: 600,
  });
  col.appendChild(frame);
  for (const index of bands) {
    frame.appendChild(
      el("div", { "data-dock-slot": `left-${index}` }, {
        left: colLeft + 4, top: 40 + index * 200, width: 300, height: 200,
      }),
    );
  }
  root.appendChild(col);
  if (right) {
    root.appendChild(
      el("div", { "data-panel-column-side": "right" }, {
        left: colLeft + 400, top: 32, width: 320, height: 700,
      }),
    );
  }
  const input = document.createElement("input");
  root.appendChild(input);
  document.body.appendChild(root);
  return { root, strip, btn, col, input };
}

/** The Library at the moment of the bug: two Readers, BOTH visible. The LEFT
 *  one renders first in DOM order. */
function buildTwoReaders() {
  const left = buildPane("left-reader", 100, [0], true);
  const right = buildPane("right-reader", 900, [0, 1], false);
  return { left, right };
}

beforeEach(() => {
  document.body.innerHTML = "";
  document.documentElement.style.setProperty("--pod-gap", "10px");
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

describe("the pane root", () => {
  it("is found by id and by ownership", () => {
    const { right } = buildTwoReaders();
    expect(paneRootById("right-reader")).toBe(right.root);
    expect(paneRootOf(right.btn)).toBe(right.root);
    expect(paneRootById(null)).toBeNull();
    expect(paneRootOf(document.body)).toBeNull();
  });

  it("the visibility rung alone cannot tell two visible panes apart (the bug)", () => {
    const { left } = buildTwoReaders();
    expect(paneDockSlot("left-0")).toBe(left.col.querySelector('[data-dock-slot="left-0"]'));
  });
});

describe("a scoped lookup answers the OWNING pane", () => {
  it("dock slot", () => {
    const { right } = buildTwoReaders();
    expect(right.root.contains(paneDockSlot("left-0", right.root))).toBe(true);
  });

  it("strip", () => {
    const { right } = buildTwoReaders();
    expect(paneStrip("left", right.root)).toBe(right.strip);
  });

  it("column + the open-time fit check", () => {
    const { right } = buildTwoReaders();
    expect(paneColumn("left", right.root)).toBe(right.col);
    // Right Reader: frame bottom 640, last band (index 1) bottom 440 → 200.
    // The left Reader (one band, bottom 240) would answer 400.
    expect(measureOmniGap("left", right.root)).toBe(200);
  });

  it("dock sweep membership is the pane's own columns only", () => {
    const { right } = buildTwoReaders();
    expect(paneColumns(right.root)).toEqual([right.col]);
    const geom = readDockGeometry(right.root);
    expect(geom.columns.map((c) => c.left)).toEqual([900]);
  });

  it("is AUTHORITATIVE: a miss in my pane is a miss, never a neighbour's element", () => {
    const { left, right } = buildTwoReaders();
    // Only the LEFT Reader has a right column.
    expect(paneColumn("right")).toBe(left.root.querySelector('[data-panel-column-side="right"]'));
    expect(paneColumn("right", right.root)).toBeNull();
    expect(measureOmniGap("right", right.root)).toBeUndefined();
  });
});

describe("the focused rung (callers with no pane in hand)", () => {
  it("prefers the pane holding focus over the first visible one", () => {
    const { right } = buildTwoReaders();
    right.input.focus();
    expect(document.activeElement).toBe(right.input);
    const hit = resolvePaneMarker('[data-dock-slot="left-0"]', "fail-closed");
    expect(right.root.contains(hit)).toBe(true);
  });

  it("falls through to the visible rung when the focused pane has no match", () => {
    const { left, right } = buildTwoReaders();
    right.input.focus();
    expect(paneColumn("right")).toBe(
      left.root.querySelector('[data-panel-column-side="right"]'),
    );
  });
});

describe("member 1, end to end — the real FloatingPanel under its pane's context", () => {
  it("portals the RIGHT Reader's docked band into the right Reader's slot", () => {
    const { right } = buildTwoReaders();
    render(
      <PaneRootContext.Provider value="right-reader">
        <KeepAliveVisibilityProvider isVisible={true}>
          <FloatingPanel
            panelId={"outline" as never}
            mode="docked"
            slotKey={"left-0" as never}
            initialX={0}
            initialY={0}
            initialWidth={300}
            initialHeight={200}
            zIndex={10}
            onChange={vi.fn()}
          >
            <div data-testid="docked-body">docked body</div>
          </FloatingPanel>
        </KeepAliveVisibilityProvider>
      </PaneRootContext.Provider>,
    );
    const body = document.querySelector('[data-testid="docked-body"]');
    expect(body).not.toBeNull();
    // Pre-1393 this portaled into the LEFT Reader's `left-0` — the first
    // visible match — and the right Reader's band frame stood empty.
    expect(right.root.contains(body!)).toBe(true);
  });
});
