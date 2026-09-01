// @vitest-environment jsdom
/**
 * TASK 529 M1 — the figure width box. `Escape` must restore the previous width
 * and DISPATCH NOTHING.
 *
 * The assertion is the CALL COUNT of `onScale`, not the rendered value, and
 * that is the whole design of this suite. Pre-529 the box rendered the reverted
 * number while `commitDraft` had already fired with the typed one — three
 * separate writes converge on the typed value, and the revert `setDraft` is one
 * of them — so a rendered-value assertion passes on the broken implementation.
 * `onScale` is what reaches `applyFigureExtrasEdit` / `applyGraphicsCommandEdit`,
 * each of which calls `editor.view.dispatch(tr.setNodeMarkup(…))`: an ordinary
 * undoable transaction that arms the 1500 ms autosave and reaches the `.tex`.
 *
 * No suite anywhere exercised `FigureChrome` before this one.
 */

import { describe, it, expect, afterEach, vi } from "vitest";
import { render, cleanup, fireEvent } from "@testing-library/react";

vi.mock("@/lib/storage", () => ({
  getDocWriteHandle: () => null,
  importFigureFile: async () => "",
  readFigureSource: async () => null,
  readFigureRaster: async () => null,
  writeFigureRaster: async () => {},
  deleteFigureRaster: async () => {},
  writeFigureIndex: async () => {},
  readFigureIndex: async () => ({}),
}));

import { FigureChrome } from "@/components/FigureBlockNodeView";

afterEach(cleanup);

function renderChrome(currentPercent = 40) {
  const onScale = vi.fn();
  const utils = render(
    <FigureChrome
      currentPercent={currentPercent}
      canScale
      onScale={onScale}
      onPickFile={vi.fn()}
      onRefresh={vi.fn()}
    />,
  );
  const input = utils.container.querySelector(
    "input.figure-scale-input",
  ) as HTMLInputElement;
  expect(input).toBeTruthy();
  return { onScale, input, ...utils };
}

describe("figure width box — Escape cancels", () => {
  it("dispatches NOTHING and restores the previous width", () => {
    const { onScale, input } = renderChrome(40);
    input.focus();
    fireEvent.change(input, { target: { value: "80" } });
    fireEvent.keyDown(input, { key: "Escape" });

    // The leg with teeth: not one transaction.
    expect(onScale).not.toHaveBeenCalled();
    expect(input.value).toBe("40");
  });

  it("…and the field is immediately usable again — the cancel window closed", () => {
    const { onScale, input } = renderChrome(40);
    input.focus();
    fireEvent.change(input, { target: { value: "80" } });
    fireEvent.keyDown(input, { key: "Escape" });
    expect(onScale).not.toHaveBeenCalled();

    // A session flag that outlived its blur would swallow this one too.
    input.focus();
    fireEvent.change(input, { target: { value: "60" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onScale).toHaveBeenCalledTimes(1);
    expect(onScale).toHaveBeenCalledWith(60);
  });

  it("Escape after NO edit is inert", () => {
    const { onScale, input } = renderChrome(40);
    input.focus();
    fireEvent.keyDown(input, { key: "Escape" });
    expect(onScale).not.toHaveBeenCalled();
  });
});

describe("figure width box — Enter commits, ONCE", () => {
  // Pre-529 `commitDraft(); blur();` ran the commit and then the blur's own
  // `onBlur` ran it AGAIN from the identical stale closure — where
  // `clamped !== currentPercent` still held, so it did not bail. Two
  // byte-identical `setNodeMarkup` transactions: two undo steps for one resize.
  it("one Enter is one transaction", () => {
    const { onScale, input } = renderChrome(40);
    input.focus();
    fireEvent.change(input, { target: { value: "80" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onScale).toHaveBeenCalledTimes(1);
    expect(onScale).toHaveBeenCalledWith(80);
  });

  it("blurring away commits once", () => {
    const { onScale, input } = renderChrome(40);
    input.focus();
    fireEvent.change(input, { target: { value: "75" } });
    fireEvent.blur(input);
    expect(onScale).toHaveBeenCalledTimes(1);
    expect(onScale).toHaveBeenCalledWith(75);
  });

  it("Enter clamps to the legal range, once", () => {
    const { onScale, input } = renderChrome(40);
    input.focus();
    fireEvent.change(input, { target: { value: "9999" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onScale).toHaveBeenCalledTimes(1);
    expect(onScale).toHaveBeenCalledWith(100);
  });
});
