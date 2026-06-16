// @vitest-environment jsdom
//
// Pins backlog #4: the create-mode \ref popover dropdown is keyboard-
// navigable — ArrowDown/Up move an active highlight across the combined
// [...headings, ...examples] list (crossing the group boundary), Enter
// commits the highlighted option, and Enter with nothing highlighted falls
// back to the typed value.

import { describe, it, expect, vi, beforeAll, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import LabelRefPopover, { type LabelInfo } from "../LabelRefPopover";

// scrollIntoView isn't implemented in jsdom.
beforeAll(() => {
  (HTMLElement.prototype as { scrollIntoView?: () => void }).scrollIntoView =
    () => undefined;
});

afterEach(cleanup);

const labels: LabelInfo[] = [
  { label: "sec:intro", kind: "heading", typeLabel: "Section 1", title: "Intro" },
  { label: "sec:method", kind: "heading", typeLabel: "Section 2", title: "Method" },
  { label: "ex:donkey", kind: "example", typeLabel: "Example (3)", title: "" },
];

function setup() {
  const onInsertRef = vi.fn();
  const onChangeLabel = vi.fn();
  const onClose = vi.fn();
  const anchorRect = {
    left: 100,
    top: 100,
    bottom: 120,
    width: 40,
    height: 20,
    right: 140,
    x: 100,
    y: 100,
    toJSON: () => ({}),
  } as DOMRect;
  render(
    <LabelRefPopover
      label="" // create mode
      anchorRect={anchorRect}
      labels={labels}
      onChangeLabel={onChangeLabel}
      onJumpToLabel={vi.fn()}
      onInsertRef={onInsertRef}
      onClose={onClose}
    />,
  );
  const input = screen.getByPlaceholderText("label key") as HTMLInputElement;
  return { input, onInsertRef, onChangeLabel, onClose };
}

describe("LabelRefPopover create-mode keyboard nav (#4)", () => {
  it("ArrowDown highlights the first row; Enter commits it", () => {
    const { input, onInsertRef } = setup();
    fireEvent.keyDown(input, { key: "ArrowDown" }); // index 0 → sec:intro
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onInsertRef).toHaveBeenCalledWith("sec:intro", "ref");
  });

  it("ArrowDown crosses the Sections→Examples boundary (combined index)", () => {
    const { input, onInsertRef } = setup();
    // 2 headings then 1 example. 3rd ArrowDown lands on the example.
    fireEvent.keyDown(input, { key: "ArrowDown" }); // sec:intro
    fireEvent.keyDown(input, { key: "ArrowDown" }); // sec:method
    fireEvent.keyDown(input, { key: "ArrowDown" }); // ex:donkey
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onInsertRef).toHaveBeenCalledWith("ex:donkey", "ref");
  });

  it("ArrowUp from the top wraps to the last row", () => {
    const { input, onInsertRef } = setup();
    fireEvent.keyDown(input, { key: "ArrowUp" }); // wraps to last (ex:donkey)
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onInsertRef).toHaveBeenCalledWith("ex:donkey", "ref");
  });

  it("ArrowDown wraps from the last row back to the first", () => {
    const { input, onInsertRef } = setup();
    fireEvent.keyDown(input, { key: "ArrowDown" }); // 0
    fireEvent.keyDown(input, { key: "ArrowDown" }); // 1
    fireEvent.keyDown(input, { key: "ArrowDown" }); // 2
    fireEvent.keyDown(input, { key: "ArrowDown" }); // wrap → 0
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onInsertRef).toHaveBeenCalledWith("sec:intro", "ref");
  });

  it("Enter with no active highlight commits the typed value", () => {
    const { input, onInsertRef } = setup();
    fireEvent.change(input, { target: { value: "sec:custom" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onInsertRef).toHaveBeenCalledWith("sec:custom", "ref");
  });

  it("typing resets the highlight (Enter falls back to typed value)", () => {
    const { input, onInsertRef } = setup();
    fireEvent.keyDown(input, { key: "ArrowDown" }); // highlight sec:intro
    fireEvent.change(input, { target: { value: "sec:meth" } }); // resets activeIndex
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onInsertRef).toHaveBeenCalledWith("sec:meth", "ref");
  });

  it("marks the active row with the .active class + aria-selected (combobox)", () => {
    const { input } = setup();
    fireEvent.keyDown(input, { key: "ArrowDown" }); // first enabled → sec:intro
    const active = document.querySelector(".label-ref-popover-option.active");
    expect(active).not.toBeNull();
    // The first row is sec:intro; it carries the option role + aria-selected,
    // and the input's aria-activedescendant points at it (no focus theft).
    expect(active?.getAttribute("role")).toBe("option");
    expect(active?.getAttribute("aria-selected")).toBe("true");
    expect(active?.textContent).toContain("sec:intro");
    expect(input.getAttribute("aria-activedescendant")).toBe(active?.id);
  });
});
