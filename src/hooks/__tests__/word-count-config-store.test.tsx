// @vitest-environment jsdom
//
// Task 1224 — the word-count config is ONE module store read by N panels.
// `setInclude` used to persist + broadcast from inside a setState updater (a
// render-phase side effect that set state in sibling panels mid-render); and
// the panel spelled "absent / non-boolean include key" as ON while the
// total's filter spelled it OFF.
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

import { StrictMode } from "react";
import { render, cleanup, fireEvent, act } from "@testing-library/react";
import WordCountPanel from "@/panels/WordCount/WordCountPanel";
import { EMPTY_CATEGORY_COUNTS, type CategoryCounts } from "@/lib/word-count-core";
import { CATEGORY_LABELS, useWordCountConfig } from "@/hooks/useWordCountConfig";

const KEY = "virgil-wordcount-config";

afterEach(cleanup);
beforeEach(() => localStorage.clear());

function counts(words: Partial<CategoryCounts["words"]>): CategoryCounts {
  const w = { ...EMPTY_CATEGORY_COUNTS.words, ...words };
  const c = { ...EMPTY_CATEGORY_COUNTS.characters };
  for (const k of Object.keys(words) as (keyof typeof w)[]) c[k] = w[k] * 5;
  return { words: w, characters: c };
}

/** A sibling reader, standing in for the Outline / Cutter panels. */
const seen: Record<string, Record<string, boolean>> = {};
function Reader({ id }: { id: string }) {
  const { config } = useWordCountConfig();
  seen[id] = config.include;
  return null;
}

describe("word-count config store (task 1224)", () => {
  it("a toggle writes storage once, sets no state mid-render, and every reader sees it", () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    const { getByRole } = render(
      <StrictMode>
        <WordCountPanel counts={counts({ mainText: 100, footnotes: 7 })} selection={null} />
        <Reader id="outline" />
        <Reader id="cutter" />
      </StrictMode>,
    );
    const notes = getByRole("checkbox", { name: new RegExp(CATEGORY_LABELS.footnotes) });

    // Two toggles inside one batch — the case that forced the old updater to
    // run during render.
    act(() => {
      fireEvent.click(notes);
      fireEvent.click(getByRole("checkbox", { name: new RegExp(CATEGORY_LABELS.mainText) }));
    });

    const writes = setItem.mock.calls.filter(([k]) => k === KEY);
    expect(writes).toHaveLength(2); // one per toggle, never doubled
    expect(JSON.parse(localStorage.getItem(KEY)!).include).toMatchObject({
      footnotes: false,
      mainText: false,
    });
    for (const id of ["outline", "cutter"]) {
      expect(seen[id].footnotes).toBe(false);
      expect(seen[id].mainText).toBe(false);
    }
    expect(
      err.mock.calls.some(([m]) => String(m).includes("Cannot update a component")),
    ).toBe(false);
    err.mockRestore();
    setItem.mockRestore();
  });

  it("a non-boolean stored include value reads OFF in the row AND in the total (one spelling)", () => {
    localStorage.setItem(KEY, JSON.stringify({ include: { mainText: null } }));
    const { getByRole, container } = render(
      <WordCountPanel counts={counts({ mainText: 4321, footnotes: 7 })} selection={null} />,
    );
    const main = getByRole("checkbox", { name: new RegExp(CATEGORY_LABELS.mainText) });
    expect(main.getAttribute("aria-checked")).toBe("false");
    // The headline counts footnotes only.
    const headline = container.textContent ?? "";
    expect(headline).toMatch(/(^|\D)7(\D|$)/);
    const sep = (1000).toLocaleString().replace(/\d/g, "");
    expect(main.textContent).toContain(`4${sep}321`); // row still shows its own count
  });

  it("an absent key takes its default", () => {
    localStorage.setItem(KEY, JSON.stringify({ include: { headings: false } }));
    render(<Reader id="solo" />);
    expect(seen.solo.headings).toBe(false);
    expect(seen.solo.mainText).toBe(true);
    expect(seen.solo.comments).toBe(false);
  });
});
