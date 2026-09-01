// @vitest-environment jsdom
/**
 * TASK 529 M2 — the reader's `p. [__] / N` page box.
 *
 * The reported failure is the cancel affordance not existing: `Escape` ran
 * `scrollToPage(draft)` and JUMPED to the page it promised to abandon, losing
 * the reader's position. This is the one member of the class that writes
 * nothing durable, which is why it reads `normal` — but it is the same
 * mechanism, and the display reverting correctly is precisely what hid it.
 *
 * The legs count `scrollToPage` calls; there was no PagePicker suite anywhere
 * in the repo before this one.
 */

import { describe, it, expect, afterEach, vi } from "vitest";
import { render, cleanup, fireEvent } from "@testing-library/react";
import PagePicker from "@library/components/PagePicker";
import type { PgmarkPages } from "@library/hooks/usePgmarkPages";

afterEach(cleanup);

function renderPicker() {
  const scrollToPage = vi.fn();
  const pages = {
    pages: [
      { label: "12", pos: 0, docY: 0 },
      { label: "13", pos: 10, docY: 100 },
    ],
    currentLabel: "12",
    scrollToPage,
  } as unknown as PgmarkPages;
  const utils = render(<PagePicker pages={pages} />);
  const input = utils.container.querySelector("input") as HTMLInputElement;
  expect(input).toBeTruthy();
  return { scrollToPage, input, ...utils };
}

describe("page box — Escape cancels", () => {
  it("does NOT scroll, and restores the shown label", () => {
    const { scrollToPage, input } = renderPicker();
    fireEvent.focus(input);
    input.focus();
    fireEvent.change(input, { target: { value: "42" } });
    fireEvent.keyDown(input, { key: "Escape" });

    expect(scrollToPage).not.toHaveBeenCalled();
    expect(input.value).toBe("12");
  });

  it("the box still works immediately afterwards", () => {
    const { scrollToPage, input } = renderPicker();
    fireEvent.focus(input);
    input.focus();
    fireEvent.change(input, { target: { value: "42" } });
    fireEvent.keyDown(input, { key: "Escape" });
    expect(scrollToPage).not.toHaveBeenCalled();

    fireEvent.focus(input);
    input.focus();
    fireEvent.change(input, { target: { value: "13" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(scrollToPage).toHaveBeenCalledTimes(1);
    expect(scrollToPage).toHaveBeenCalledWith("13");
  });
});

describe("page box — Enter jumps, ONCE", () => {
  it("one Enter is one jump", () => {
    // Pre-529 the explicit `commit()` and the blur's own `onBlur` each ran it.
    const { scrollToPage, input } = renderPicker();
    fireEvent.focus(input);
    input.focus();
    fireEvent.change(input, { target: { value: "13" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(scrollToPage).toHaveBeenCalledTimes(1);
  });

  it("blurring away jumps once", () => {
    const { scrollToPage, input } = renderPicker();
    fireEvent.focus(input);
    input.focus();
    fireEvent.change(input, { target: { value: "13" } });
    fireEvent.blur(input);
    expect(scrollToPage).toHaveBeenCalledTimes(1);
  });

  it("an empty box jumps nowhere", () => {
    const { scrollToPage, input } = renderPicker();
    fireEvent.focus(input);
    input.focus();
    fireEvent.change(input, { target: { value: "   " } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(scrollToPage).not.toHaveBeenCalled();
  });
});
