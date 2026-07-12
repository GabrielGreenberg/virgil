// @vitest-environment jsdom
//
// Pins the PaneFreeze drag-time content lock (plan §P3):
//
//   1. begin edge → the inner node is imperatively locked to its pre-drag
//      pixel width, glued to the pane's STATIONARY edge (`anchor` side).
//   2. end edge → every lock style is cleared (content re-adopts layout).
//   3. an already-in-flight drag is ADOPTED on mount (keep-alive remount /
//      StrictMode effect replay mid-drag), and effect cleanup unfreezes.
//   4. a 0-width measure (display:none keep-alive pane) is skipped — locking
//      to 0 would blank the pane if revealed mid-gesture.
//   5. the JSX style objects are CONSTANT, so a mid-gesture React re-render
//      never clobbers the imperative lock writes (React only diffs style
//      props that changed).
//   6. the outer clipper merges the consumer `style` prop but the freeze
//      contract keys (overflow/position/fill) always win.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { StrictMode } from "react";
import { render, cleanup } from "@testing-library/react";

import { PaneFreeze } from "../PaneFreeze";
import {
  beginPaneDrag,
  endPaneDrag,
  __resetPaneDragBusForTest,
  __paneDragListenerCountForTest,
  type PaneDragInfo,
} from "../pane-drag-bus";

const INFO: PaneDragInfo = { id: "gutter-under-test", axis: "x" };

// jsdom has no layout: the begin-edge width read comes from this knob.
let rectWidth = 480;

beforeEach(() => {
  __resetPaneDragBusForTest();
  rectWidth = 480;
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(
    () =>
      ({
        width: rectWidth,
        height: 300,
        top: 0,
        left: 0,
        right: rectWidth,
        bottom: 300,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      }) as DOMRect,
  );
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const inner = (container: HTMLElement) =>
  container.querySelector<HTMLElement>("[data-pane-freeze-inner]")!;
const outer = (container: HTMLElement) =>
  container.querySelector<HTMLElement>("[data-pane-freeze]")!;

const expectFrozen = (el: HTMLElement, anchor: "left" | "right") => {
  expect(el.style.position).toBe("absolute");
  expect(el.style.top).toBe("0px");
  expect(el.style.bottom).toBe("0px");
  expect(el.style[anchor]).toBe("0px");
  expect(el.style[anchor === "right" ? "left" : "right"]).toBe("");
  expect(el.style.width).toBe(`${rectWidth}px`);
};

const expectFree = (el: HTMLElement) => {
  expect(el.style.position).toBe("");
  expect(el.style.top).toBe("");
  expect(el.style.bottom).toBe("");
  expect(el.style.left).toBe("");
  expect(el.style.right).toBe("");
  expect(el.style.width).toBe("");
};

describe("PaneFreeze", () => {
  it("freezes the inner node to its pre-drag width on the begin edge, glued to the anchor edge", () => {
    const { container } = render(
      <PaneFreeze anchor="right">
        <div>content</div>
      </PaneFreeze>,
    );
    expectFree(inner(container));

    beginPaneDrag(INFO);
    expectFrozen(inner(container), "right");
  });

  it("anchor='left' glues the frozen box to the left edge instead", () => {
    const { container } = render(
      <PaneFreeze anchor="left">
        <div>content</div>
      </PaneFreeze>,
    );
    beginPaneDrag(INFO);
    expectFrozen(inner(container), "left");
  });

  it("unfreezes on the end edge — every lock style cleared", () => {
    const { container } = render(
      <PaneFreeze anchor="right">
        <div>content</div>
      </PaneFreeze>,
    );
    beginPaneDrag(INFO);
    expectFrozen(inner(container), "right");

    endPaneDrag(INFO);
    expectFree(inner(container));
  });

  it("adopts an already-in-flight drag on mount (keep-alive remount mid-gesture), incl. under StrictMode's effect replay", () => {
    beginPaneDrag(INFO);
    const { container } = render(
      <StrictMode>
        <PaneFreeze anchor="right">
          <div>content</div>
        </PaneFreeze>
      </StrictMode>,
    );
    // StrictMode ran mount → cleanup(unfreeze) → re-mount; the re-run's
    // isPaneDragging check must have re-frozen.
    expectFrozen(inner(container), "right");

    endPaneDrag(INFO);
    expectFree(inner(container));
  });

  it("skips the lock when the pane measures 0 wide (hidden keep-alive pane)", () => {
    rectWidth = 0;
    const { container } = render(
      <PaneFreeze anchor="right">
        <div>content</div>
      </PaneFreeze>,
    );
    beginPaneDrag(INFO);
    expectFree(inner(container));
    endPaneDrag(INFO);
    expectFree(inner(container));
  });

  it("unmount unsubscribes from the bus — listener count returns to its pre-mount baseline", () => {
    // The invariant is the SUBSCRIPTION COUNT, not the discarded node's
    // style: on a real unmount React nulls innerRef before a leaked listener
    // could run, so freeze() bails on the null ref and node assertions pass
    // whether or not off() was called (empirically verified — a PaneFreeze
    // with the unsubscribe deleted keeps the node inert). Only the count
    // catches a leak: without off(), every paper close/open would strand one
    // listener closure on the module-singleton bus Set for the session.
    const baseline = __paneDragListenerCountForTest();
    const { container, unmount } = render(
      <PaneFreeze anchor="right">
        <div>content</div>
      </PaneFreeze>,
    );
    expect(__paneDragListenerCountForTest()).toBe(baseline + 1);
    const node = inner(container);
    unmount();
    expect(__paneDragListenerCountForTest()).toBe(baseline);

    // And later gesture edges never touch the discarded node.
    beginPaneDrag(INFO);
    expectFree(node);
    endPaneDrag(INFO);
    expectFree(node);
  });

  it("a mid-gesture re-render (new children, new consumer style object) never clobbers the imperative lock", () => {
    const { container, rerender } = render(
      <PaneFreeze anchor="right" style={{ background: "red" }}>
        <div>before</div>
      </PaneFreeze>,
    );
    beginPaneDrag(INFO);
    expectFrozen(inner(container), "right");

    // The engine's single end-edge store commit re-renders consumers while
    // the drag is still visually settling — the constant style objects mean
    // React finds no style diff and leaves the lock writes alone.
    rerender(
      <PaneFreeze anchor="right" style={{ background: "blue" }}>
        <div>after</div>
      </PaneFreeze>,
    );
    expectFrozen(inner(container), "right");
    expect(inner(container).textContent).toBe("after");

    endPaneDrag(INFO);
    expectFree(inner(container));
  });

  it("a new gesture after an anchor flip freezes to the NEW anchor without re-subscribing", () => {
    const { container, rerender } = render(
      <PaneFreeze anchor="right">
        <div>content</div>
      </PaneFreeze>,
    );
    beginPaneDrag(INFO);
    expectFrozen(inner(container), "right");
    endPaneDrag(INFO);

    rerender(
      <PaneFreeze anchor="left">
        <div>content</div>
      </PaneFreeze>,
    );
    beginPaneDrag(INFO);
    expectFrozen(inner(container), "left");
    endPaneDrag(INFO);
  });

  it("merges the consumer style onto the outer clipper but the freeze contract keys win", () => {
    const { container } = render(
      <PaneFreeze
        anchor="right"
        style={{ background: "red", overflow: "visible", flex: "0 0 auto" }}
      >
        <div>content</div>
      </PaneFreeze>,
    );
    const el = outer(container);
    expect(el.dataset.paneFreeze).toBe("right");
    expect(el.style.background).toBe("red"); // consumer styling honored
    // Contract keys (clip + task-054 fill) always win over the style prop.
    expect(el.style.overflow).toBe("hidden");
    expect(el.style.position).toBe("relative");
    expect(el.style.flexGrow).toBe("1");
    expect(el.style.minWidth).toBe("0px");
    expect(el.style.height).toBe("100%");
  });
});
