// @vitest-environment jsdom
//
// Task 1028 — each Word Count breakdown row is an include/exclude toggle that
// decides what every word total in the app counts. It must say so to
// assistive tech (a real checkbox with `aria-checked`), and every count the
// panel prints must be spelled the same way.
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";

vi.mock("@/lib/storage", async () =>
  (await import("@/lib/__tests__/_mock-storage")).mockStorageModule(),
);

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= ResizeObserverStub;

import { render, cleanup, fireEvent, within } from "@testing-library/react";
import WordCountPanel from "@/panels/WordCount/WordCountPanel";
import { EMPTY_CATEGORY_COUNTS, type CategoryCounts } from "@/lib/word-count-core";
import { CATEGORY_LABELS } from "@/hooks/useWordCountConfig";

afterEach(cleanup);
beforeEach(() => localStorage.clear());

function counts(words: Partial<CategoryCounts["words"]>): CategoryCounts {
  const w = { ...EMPTY_CATEGORY_COUNTS.words, ...words };
  const c = { ...EMPTY_CATEGORY_COUNTS.characters };
  for (const k of Object.keys(words) as (keyof typeof w)[]) c[k] = w[k] * 5;
  return { words: w, characters: c };
}

const sep = (1000).toLocaleString().replace(/\d/g, "");

describe("WordCountPanel breakdown rows are checkboxes (task 1028)", () => {
  it("each row is a checkbox whose aria-checked follows config.include, and clicking flips it", () => {
    const { getByRole, getAllByRole } = render(
      <WordCountPanel
        counts={counts({ mainText: 11843, footnotes: 312, comments: 40 })}
        selection={null}
      />,
    );
    expect(getAllByRole("checkbox")).toHaveLength(3);

    const main = getByRole("checkbox", { name: new RegExp(CATEGORY_LABELS.mainText) });
    const notes = getByRole("checkbox", { name: new RegExp(CATEGORY_LABELS.footnotes) });
    // Comments are opt-in by default (DEFAULT_WORD_COUNT_CONFIG).
    const comments = getByRole("checkbox", { name: new RegExp(CATEGORY_LABELS.comments) });
    expect(main.getAttribute("aria-checked")).toBe("true");
    expect(notes.getAttribute("aria-checked")).toBe("true");
    expect(comments.getAttribute("aria-checked")).toBe("false");

    fireEvent.click(notes);
    expect(notes.getAttribute("aria-checked")).toBe("false");
    expect(within(notes).getByText("off")).toBeTruthy();
    fireEvent.click(notes);
    expect(notes.getAttribute("aria-checked")).toBe("true");
  });

  it("draws the shared CheckSquare, not a hand-drawn tick", () => {
    const { getAllByRole } = render(
      <WordCountPanel counts={counts({ mainText: 10 })} selection={null} />,
    );
    const row = getAllByRole("checkbox")[0];
    expect(row.querySelector("svg rect")).toBeTruthy();
    expect(row.textContent).not.toContain("✓");
  });

  it("formats every count ≥ 1000 the same way (headline, Selection, breakdown)", () => {
    const { container, getByRole } = render(
      <WordCountPanel
        counts={counts({ mainText: 11843 })}
        selection={counts({ mainText: 2500 })}
      />,
    );
    const text = container.textContent ?? "";
    // Headline words, Selection words + characters, breakdown row.
    expect(text).toContain(`11${sep}843`);
    expect(text).toContain(`2${sep}500`);
    expect(text).toContain(`12${sep}500`);
    expect(getByRole("checkbox").textContent).toContain(`11${sep}843`);
    if (sep) expect(text).not.toMatch(/(^|\D)(11843|2500|12500)(\D|$)/);
  });
});
