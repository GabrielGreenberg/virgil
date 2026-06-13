// @vitest-environment jsdom
//
// Pins backlog #1: the inline-math popover saves by default on EVERY
// dismissal (Enter, Escape, click-outside) and exposes a visible Cancel
// button as the only revert path.

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import MathPopover from "../MathPopover";

// katex.render touches the DOM heavily and isn't what we're testing.
vi.mock("katex", () => ({ default: { render: () => undefined } }));

afterEach(cleanup);

function setup(latex = "x^2") {
  const onSave = vi.fn();
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
    <MathPopover
      kind="inline"
      latex={latex}
      anchorRect={anchorRect}
      onSave={onSave}
      onClose={onClose}
    />,
  );
  const textarea = screen.getByRole("textbox") as HTMLTextAreaElement;
  return { onSave, onClose, textarea };
}

describe("MathPopover save-by-default (#1)", () => {
  it("commits the edited value on Escape (saving is the default)", () => {
    const { onSave, onClose, textarea } = setup("x^2");
    fireEvent.change(textarea, { target: { value: "y^3" } });
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onSave).toHaveBeenCalledWith("y^3");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("commits the edited value on Enter", () => {
    const { onSave, onClose, textarea } = setup("x^2");
    fireEvent.change(textarea, { target: { value: "z" } });
    fireEvent.keyDown(textarea, { key: "Enter" });
    expect(onSave).toHaveBeenCalledWith("z");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("does NOT call onSave when the value is unchanged (Escape closes)", () => {
    const { onSave, onClose } = setup("x^2");
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onSave).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("renders a Cancel button that reverts (closes without saving)", () => {
    const { onSave, onClose, textarea } = setup("x^2");
    fireEvent.change(textarea, { target: { value: "discarded" } });
    const cancel = screen.getByRole("button", { name: /cancel/i });
    fireEvent.mouseDown(cancel);
    expect(onSave).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
