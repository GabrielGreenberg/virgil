// @vitest-environment jsdom
// Task 438 — the four per-PANE DOM markers resolved under multi-pane keep-alive.
//
// Virgil mounts up to FOUR `EditorPane`s at once (3 keep-alive authored docs +
// the Library Reader's), one visible and the rest `display:none`. The doc block
// renders FIRST in `EditorLayout`, so whenever the Library pane is the visible
// one the first `[data-panel-column-side]` / `[data-dock-slot]` in DOM order
// belongs to a HIDDEN pane whose every rect reads zero.
//
// WHY NO PRE-438 SUITE COULD SEE THIS: every panel-column / dock / spawn fixture
// in the repo builds ONE column tree, where "first match" and "the visible
// pane's match" are the same element by construction — the divergence is
// unrepresentable in all of them. Each leg below therefore builds TWO panes and
// was measured to FAIL on the pre-fix source.
//
// jsdom reports `offsetHeight === 0` / `offsetParent === null` for EVERYTHING,
// so visibility is stubbed per element (the trick `dropctx-multipane-registry`
// already uses) and rects are stubbed per element.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// `panel-column.tsx` pulls in `panel-primitives` → `@/lib/storage`, whose
// backend is a bare `require` the bundler resolves and vitest does not.
vi.mock("@/lib/storage", () => ({ isDevStorage: false }));

import {
  isPaneMarkerVisible,
  paneColumn,
  paneColumns,
  paneDockSlot,
  paneFlexColumns,
  paneStrip,
  resolvePaneMarker,
} from "../pane-dom";
import { measureOmniGap } from "../panel-column";
import { computeColumnSpawnRect } from "../spawn-position";
import {
  readDockGeometry,
  resolveDockTargetByPanelProximity,
} from "../dock-drag";
import { findRowScroll } from "../layout-scroll";
import { render, cleanup } from "@testing-library/react";
import FloatingPanel from "@/components/FloatingPanel";
import { KeepAliveVisibilityProvider } from "@/lib/keep-alive/visibility-context";

type Rect = { left: number; top: number; width: number; height: number };

function stubVisible(el: HTMLElement, visible: boolean) {
  Object.defineProperty(el, "offsetParent", {
    configurable: true,
    get: () => (visible ? document.body : null),
  });
  Object.defineProperty(el, "offsetHeight", {
    configurable: true,
    get: () => (visible ? 100 : 0),
  });
}

function stubRect(el: HTMLElement, r: Rect) {
  el.getBoundingClientRect = () =>
    ({
      left: r.left,
      top: r.top,
      width: r.width,
      height: r.height,
      right: r.left + r.width,
      bottom: r.top + r.height,
      x: r.left,
      y: r.top,
      toJSON: () => ({}),
    }) as DOMRect;
}

/**
 * One pane's left column: the column, its sticky stack frame, and one docked
 * band anchor `left-<index>`. `visible` decides whether every element in it
 * reports rendered geometry — a hidden pane in production reports ZERO rects
 * because `display:none` is what `KeepAliveSlot` uses, so the hidden fixture's
 * rects are all zero too.
 */
function buildPane(opts: {
  id: string;
  visible: boolean;
  /** Column left edge when visible. */
  colLeft: number;
  /** Bands to render into the stack frame; [] ⇒ an empty (but present) frame. */
  bands: number[];
}) {
  const { id, visible, colLeft, bands } = opts;
  const pane = document.createElement("div");
  pane.setAttribute("data-test-pane", id);
  if (!visible) pane.style.display = "none";

  const row = document.createElement("div");
  row.setAttribute("data-virgil-row-scroll", "");
  stubVisible(row, visible);
  pane.appendChild(row);

  const strip = document.createElement("div");
  strip.setAttribute("data-strip-side", "left");
  stubVisible(strip, visible);
  stubRect(
    strip,
    visible
      ? { left: colLeft - 40, top: 32, width: 40, height: 700 }
      : { left: 0, top: 0, width: 0, height: 0 },
  );
  pane.appendChild(strip);

  const col = document.createElement("div");
  col.setAttribute("data-panel-column-side", "left");
  // The SAME element carries `[data-flex-col]` in production
  // (panel-column.tsx) — which is why a census keyed on attribute NAMES had to
  // grow this member rather than inheriting it.
  col.setAttribute("data-flex-col", "left");
  stubVisible(col, visible);
  stubRect(
    col,
    visible
      ? { left: colLeft, top: 32, width: 320, height: 700 }
      : { left: 0, top: 0, width: 0, height: 0 },
  );
  pane.appendChild(col);

  const frame = document.createElement("div");
  frame.setAttribute("data-stack-frame", "left");
  stubVisible(frame, visible);
  stubRect(
    frame,
    visible
      ? { left: colLeft + 4, top: 40, width: 300, height: 600 }
      : { left: 0, top: 0, width: 0, height: 0 },
  );
  col.appendChild(frame);

  bands.forEach((index) => {
    const band = document.createElement("div");
    band.setAttribute("data-dock-slot", `left-${index}`);
    band.setAttribute("data-test-pane-of-band", id);
    stubVisible(band, visible);
    stubRect(
      band,
      visible
        ? { left: colLeft + 4, top: 40 + index * 200, width: 300, height: 200 }
        : { left: 0, top: 0, width: 0, height: 0 },
    );
    frame.appendChild(band);
  });

  document.body.appendChild(pane);
  return { pane, col, frame };
}

/** The shipped topology at the moment of the bug: a HIDDEN authored-doc pane
 *  rendered first, the VISIBLE Library Reader pane second. */
function buildTwoPanes(visibleBands = [0]) {
  const hidden = buildPane({
    id: "hidden-doc",
    visible: false,
    colLeft: 48,
    bands: [0],
  });
  const visible = buildPane({
    id: "visible-reader",
    visible: true,
    colLeft: 500,
    bands: visibleBands,
  });
  return { hidden, visible };
}

beforeEach(() => {
  document.body.innerHTML = "";
  document.documentElement.style.setProperty("--pod-gap", "10px");
  Object.defineProperty(window, "innerHeight", {
    configurable: true,
    value: 800,
  });
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    value: 1400,
  });
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

describe("the visibility rung", () => {
  // jsdom performs no layout: `offsetParent` is null and `offsetHeight` 0 for
  // EVERYTHING, so `display:none`'s effect on them cannot be represented here
  // and the fixture stubs it. That premise is a DOM-spec fact (and the one
  // `KeepAliveSlot`'s own docblock calls load-bearing), not something these
  // legs establish. What they DO establish is the shape of the disjunction.
  it("an unlaid-out element reports not-visible with no stub at all", () => {
    const bare = document.createElement("div");
    document.body.appendChild(bare);
    // The real jsdom values — offsetParent null AND offsetHeight 0, which is
    // exactly what a `display:none` subtree reports in a browser.
    expect(isPaneMarkerVisible(bare)).toBe(false);
  });

  it("offsetHeight is a BACKSTOP: a null offsetParent alone is not hidden", () => {
    // `position: fixed` reports a null offsetParent while being perfectly
    // visible, so the rung is a disjunction rather than the offsetParent test
    // `findRowScroll` used to carry alone.
    const fixed = document.createElement("div");
    Object.defineProperty(fixed, "offsetParent", { get: () => null });
    Object.defineProperty(fixed, "offsetHeight", { get: () => 120 });
    expect(isPaneMarkerVisible(fixed)).toBe(true);
  });

  it("resolves the fixture's visible pane over its hidden one", () => {
    const { hidden, visible } = buildTwoPanes();
    expect(isPaneMarkerVisible(hidden.col)).toBe(false);
    expect(isPaneMarkerVisible(visible.col)).toBe(true);
  });

  it("the two miss policies are different claims", () => {
    buildPane({ id: "only-hidden", visible: false, colLeft: 48, bands: [0] });
    // fail-open: hand back the first match anyway (the pre-438 status quo — a
    // needless measurement of the wrong column, never a feature that stops).
    expect(
      resolvePaneMarker('[data-panel-column-side="left"]', "fail-open"),
    ).not.toBeNull();
    // fail-closed: an invisible portal target is worse than the caller's own
    // fallback.
    expect(
      resolvePaneMarker('[data-panel-column-side="left"]', "fail-closed"),
    ).toBeNull();
  });
});

describe("M1 — the docked panel's portal anchor", () => {
  it("resolves the VISIBLE pane's band anchor, not the hidden pane's empty one", () => {
    buildTwoPanes();
    const el = paneDockSlot("left-0");
    expect(el).not.toBeNull();
    // Pre-fix this was the hidden doc pane's anchor: the Reader's panel
    // portaled into a display:none subtree, "open" in prefs with nothing on
    // screen anywhere.
    expect(el!.getAttribute("data-test-pane-of-band")).toBe("visible-reader");
  });

  it("answers null (⇒ the caller's body fallback) when no pane is visible", () => {
    buildPane({ id: "only-hidden", visible: false, colLeft: 48, bands: [0] });
    expect(paneDockSlot("left-0")).toBeNull();
  });

  it("answers null for a slot key no pane has docked", () => {
    buildTwoPanes();
    expect(paneDockSlot("right-2")).toBeNull();
  });
});

describe("M2 — measureOmniGap", () => {
  it("measures the VISIBLE column, so a Reader strip-open can still stack", () => {
    buildTwoPanes();
    // Visible frame: top 40, height 600 ⇒ bottom 640. Its one band ends at 240.
    // Pre-fix this read the hidden column (every rect zero) and returned 0, so
    // `placeInStack`'s `fits = freeSpacePx >= MIN_BAND_PX` was false for EVERY
    // Reader strip-open and each new panel evicted the last.
    expect(measureOmniGap("left")).toBe(400);
  });

  it("returns the full frame height when the visible column has no bands", () => {
    buildTwoPanes([]);
    expect(measureOmniGap("left")).toBe(600);
  });

  it("fails open to the pre-438 answer when every pane is hidden", () => {
    buildPane({ id: "only-hidden", visible: false, colLeft: 48, bands: [0] });
    expect(measureOmniGap("left")).toBe(0);
  });
});

describe("M3 — the dock hit-test", () => {
  it("sweeps only visible columns", () => {
    buildTwoPanes();
    const geom = readDockGeometry();
    expect(geom.columns).toHaveLength(1);
    expect(geom.columns[0].left).toBe(500);
  });

  it("does not snap a float dragged to the viewport top-left onto a hidden column", () => {
    buildTwoPanes();
    const geom = readDockGeometry();
    // The hidden column's corner is (0, TOP_BAR + podGap) = (0, 42) — nearer
    // the top-left than any real column's, so pre-fix it won the proximity
    // test outright and answered a ZERO-SIZE outline rect at the bottom of a
    // stack the user was nowhere near.
    const target = resolveDockTargetByPanelProximity(
      geom,
      { x: 10, y: 50, width: 300, height: 400 },
      undefined,
      { x: 10, y: 50 },
    );
    expect(target).toBeNull();
  });

  it("still answers the VISIBLE column when the float is dragged to ITS corner", () => {
    buildTwoPanes();
    const geom = readDockGeometry();
    const target = resolveDockTargetByPanelProximity(
      geom,
      { x: 505, y: 45, width: 300, height: 400 },
      undefined,
      { x: 505, y: 45 },
    );
    expect(target).not.toBeNull();
    expect(target!.side).toBe("left");
    // A real band footprint, never a zero-size outline.
    expect(target!.rect.width).toBeGreaterThan(0);
    expect(target!.rect.height).toBeGreaterThan(0);
  });

  it("fails open to every column when none is visible", () => {
    buildPane({ id: "only-hidden", visible: false, colLeft: 48, bands: [0] });
    expect(readDockGeometry().columns).toHaveLength(1);
  });
});

describe("M4 — computeColumnSpawnRect", () => {
  it("spawns at the VISIBLE column's rect, not the generic fallback", () => {
    buildTwoPanes();
    const rect = computeColumnSpawnRect("left");
    expect(rect.x).toBe(500);
    expect(rect.width).toBe(320);
    expect(rect.height).toBe(700);
  });

  it("fails open to the pre-438 fallback rect when every pane is hidden", () => {
    // `colLeft: 7` deliberately differs from FALLBACK_STRIP_OFFSET (48), so the
    // leg cannot pass by reading the hidden column instead of the fallback.
    buildPane({ id: "only-hidden", visible: false, colLeft: 7, bands: [0] });
    const rect = computeColumnSpawnRect("left");
    expect(rect.x).toBe(48); // FALLBACK_STRIP_OFFSET
    expect(rect.width).toBe(320); // FALLBACK_COLUMN_WIDTH
  });
});

describe("findRowScroll reads the same rung", () => {
  it("prefers the visible pane's row scroll", () => {
    const { visible } = buildTwoPanes();
    expect(findRowScroll()).toBe(
      visible.pane.querySelector("[data-virgil-row-scroll]"),
    );
  });

  it("keeps its fail-open answer for a sole mid-transition pane", () => {
    const only = buildPane({
      id: "only-hidden",
      visible: false,
      colLeft: 48,
      bands: [],
    });
    expect(findRowScroll()).toBe(
      only.pane.querySelector("[data-virgil-row-scroll]"),
    );
  });

  it("answers null when there is no row scroll at all", () => {
    expect(findRowScroll()).toBeNull();
  });
});

describe("paneColumns", () => {
  it("keeps DOM order among the visible set", () => {
    const a = buildPane({ id: "vis-a", visible: true, colLeft: 10, bands: [] });
    buildPane({ id: "hid", visible: false, colLeft: 0, bands: [] });
    const b = buildPane({ id: "vis-b", visible: true, colLeft: 900, bands: [] });
    expect(paneColumns()).toEqual([a.col, b.col]);
  });

  it("answers [] when nothing is mounted", () => {
    expect(paneColumns()).toEqual([]);
    expect(paneColumn("left")).toBeNull();
  });
});

/**
 * The leg with real teeth for M1: the DOOR was never the part that could
 * misbehave — a call site that never asks it is, and
 * `document.querySelector('[data-dock-slot="left-0"]')` type-checks perfectly.
 * So drive the SHIPPED component and ask where its portal actually landed.
 */
describe("M1, end to end — the real FloatingPanel's docked portal", () => {
  function DockedFloat() {
    return (
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
    );
  }

  it("portals into the VISIBLE pane's band anchor, not the hidden pane's", () => {
    const { visible } = buildTwoPanes();
    render(
      <KeepAliveVisibilityProvider isVisible={true}>
        <DockedFloat />
      </KeepAliveVisibilityProvider>,
    );
    const body = document.querySelector('[data-testid="docked-body"]');
    expect(body).not.toBeNull();
    // Pre-438 this resolved the hidden doc pane's EMPTY anchor (its own
    // FloatingPanel had already returned null under the isVisible gate, which
    // is exactly why the anchor was present and free), so the Reader's panel
    // rendered inside a `display:none` subtree: open in prefs, strip icon lit,
    // nothing on screen.
    expect(visible.pane.contains(body!)).toBe(true);
  });

  it("re-resolves on the VISIBLE edge, not only on a mode/slotKey change", () => {
    // A pane can MOUNT while hidden — clicking a tab while the PDF viewer is up
    // mounts the new doc pane one commit BEFORE `pdfView` flips off — and a
    // `dockStack` change made in pane A re-keys pane B's slot WHILE B IS
    // HIDDEN. With deps of `[mode, slotKey]` alone the effect never runs again,
    // so the resolution taken at the worst possible moment is the one that
    // stands for the life of the mount: fail-closed ⇒ a permanent body portal.
    //
    // The fixture is therefore a mount with NO visible pane anywhere, and the
    // visible one arrives after. (A fixture that already has a visible pane
    // passes on the pre-fix deps too — measured; the divergence needs the
    // mount-while-hidden order.)
    buildPane({ id: "only-hidden", visible: false, colLeft: 7, bands: [0] });
    function Harness({ shown }: { shown: boolean }) {
      return (
        <KeepAliveVisibilityProvider isVisible={shown}>
          <DockedFloat />
        </KeepAliveVisibilityProvider>
      );
    }
    const view = render(<Harness shown={false} />);
    expect(document.querySelector('[data-testid="docked-body"]')).toBeNull();

    const visible = buildPane({
      id: "now-visible",
      visible: true,
      colLeft: 500,
      bands: [0],
    });
    view.rerender(<Harness shown={true} />);

    const body = document.querySelector('[data-testid="docked-body"]');
    expect(body).not.toBeNull();
    expect(visible.pane.contains(body!)).toBe(true);
  });

  it("body-portals rather than portaling into a hidden anchor", () => {
    const hidden = buildPane({
      id: "only-hidden",
      visible: false,
      colLeft: 48,
      bands: [0],
    });
    render(
      <KeepAliveVisibilityProvider isVisible={true}>
        <DockedFloat />
      </KeepAliveVisibilityProvider>,
    );
    const body = document.querySelector('[data-testid="docked-body"]');
    expect(body).not.toBeNull();
    expect(hidden.pane.contains(body!)).toBe(false);
  });
});

describe("the two sweeps the first census pass missed", () => {
  it("paneFlexColumns skips a hidden pane, so a divider drag cannot persist its zero width", () => {
    // `syncPanelPrefsToRendered` PERSISTS each column's rendered width on every
    // divider drag-start, in keep-alive LRU order, last-write-wins per side —
    // so a hidden pane's zero rect could write `panelWidths[side] = 0` into the
    // user's prefs from a drag performed in a pane they can see.
    buildTwoPanes();
    const cols = paneFlexColumns();
    expect(cols).toHaveLength(1);
    expect(cols[0].getBoundingClientRect().width).toBe(320);
  });

  it("paneStrip answers the visible pane's strip", () => {
    const { hidden, visible } = buildTwoPanes();
    const strip = paneStrip("left");
    expect(strip).not.toBeNull();
    expect(visible.pane.contains(strip!)).toBe(true);
    expect(hidden.pane.contains(strip!)).toBe(false);
  });

  it("both fail open when nothing is visible", () => {
    buildPane({ id: "only-hidden", visible: false, colLeft: 7, bands: [] });
    expect(paneFlexColumns()).toHaveLength(1);
    expect(paneStrip("left")).not.toBeNull();
  });
});
