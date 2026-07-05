// @vitest-environment jsdom
//
// NodeEditPopover — the unified caret-anchored node editor (task 033, merges
// the former MathPopover + FigurePopover). Pins the two per-family behavior
// forks that MUST survive the merge:
//
//   math   → save-by-default: EVERY dismissal (Enter, Escape, click-outside)
//            commits; the visible Cancel button is the only revert (backlog #1).
//   figure → Escape CANCELS (revert); click-outside COMMITS the latest edit
//            (closing a latent FigurePopover bug where the empty-dep
//            click-outside listener captured a stale first-render commit and
//            silently discarded figure edits on click-away).

import { describe, it, expect, vi, afterEach } from "vitest";
import {
  render,
  screen,
  fireEvent,
  cleanup,
  act,
} from "@testing-library/react";
import NodeEditPopover from "../NodeEditPopover";

// katex.render touches the DOM heavily and isn't what we're testing.
vi.mock("katex", () => ({ default: { render: () => undefined } }));

afterEach(cleanup);

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

function setupMath(latex = "x^2") {
  const onSave = vi.fn();
  const onClose = vi.fn();
  render(
    <NodeEditPopover
      family="math"
      kind="inline"
      value={latex}
      anchorRect={anchorRect}
      onSave={onSave}
      onClose={onClose}
    />,
  );
  const textarea = screen.getByRole("textbox", { hidden: true }) as HTMLTextAreaElement;
  return { onSave, onClose, textarea };
}

function setupFigure(raw: string, kind = "graphicsBlock") {
  const onSave = vi.fn();
  const onClose = vi.fn();
  render(
    <NodeEditPopover
      family="figure"
      kind={kind}
      value={raw}
      anchorRect={anchorRect}
      onSave={onSave}
      onClose={onClose}
    />,
  );
  const textarea = screen.getByRole("textbox", { hidden: true }) as HTMLTextAreaElement;
  return { onSave, onClose, textarea };
}

// The click-outside listener is attached inside a requestAnimationFrame; flush
// one frame so it (and the mount auto-focus rAF) run before we click away.
const flushRaf = () =>
  act(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => resolve());
      }),
  );

describe("NodeEditPopover — math save-by-default (#1)", () => {
  it("commits the edited value on Escape (saving is the default)", () => {
    const { onSave, onClose, textarea } = setupMath("x^2");
    fireEvent.change(textarea, { target: { value: "y^3" } });
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onSave).toHaveBeenCalledWith("y^3");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("commits the edited value on Enter", () => {
    const { onSave, onClose, textarea } = setupMath("x^2");
    fireEvent.change(textarea, { target: { value: "z" } });
    fireEvent.keyDown(textarea, { key: "Enter" });
    expect(onSave).toHaveBeenCalledWith("z");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("does NOT call onSave when the value is unchanged (Escape closes)", () => {
    const { onSave, onClose } = setupMath("x^2");
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onSave).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("renders a Cancel button that reverts (closes without saving)", () => {
    const { onSave, onClose, textarea } = setupMath("x^2");
    fireEvent.change(textarea, { target: { value: "discarded" } });
    // Under the initial visibility:hidden the accessible NAME computes empty,
    // so match by role alone — the math popover has exactly one button.
    const cancel = screen.getByRole("button", { hidden: true });
    fireEvent.mouseDown(cancel);
    expect(onSave).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe("NodeEditPopover — figure fork", () => {
  it("Escape CANCELS (reverts) — the figure fork, not save-by-default", () => {
    const { onSave, onClose, textarea } = setupFigure("\\includegraphics{a}");
    fireEvent.change(textarea, { target: { value: "\\includegraphics{b}" } });
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onSave).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("single-line graphics commits on plain Enter", () => {
    const { onSave, onClose, textarea } = setupFigure("\\includegraphics{a}");
    fireEvent.change(textarea, { target: { value: "\\includegraphics{b}" } });
    fireEvent.keyDown(textarea, { key: "Enter" });
    expect(onSave).toHaveBeenCalledWith("\\includegraphics{b}");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("multi-line figure body leaves plain Enter alone; commits on Mod+Enter", () => {
    const { onSave, onClose, textarea } = setupFigure(
      "\\centering",
      "figureBlock",
    );
    fireEvent.change(textarea, { target: { value: "\\centering more" } });
    // Plain Enter inserts a newline — does NOT commit.
    fireEvent.keyDown(textarea, { key: "Enter" });
    expect(onClose).not.toHaveBeenCalled();
    // Mod+Enter commits.
    fireEvent.keyDown(textarea, { key: "Enter", metaKey: true });
    expect(onSave).toHaveBeenCalledWith("\\centering more");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("click-outside COMMITS the latest figure edit (was silently discarded)", async () => {
    const { onSave, onClose, textarea } = setupFigure("\\includegraphics{a}");
    fireEvent.change(textarea, { target: { value: "\\includegraphics{edited}" } });
    await flushRaf(); // let the click-outside listener attach
    fireEvent.mouseDown(document.body);
    expect(onSave).toHaveBeenCalledWith("\\includegraphics{edited}");
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
