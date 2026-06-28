import { describe, it, expect, vi } from "vitest";
import {
  pdfPagesToPgmark,
  VIRTUAL_PAGE_HEIGHT,
} from "@library/lib/pdf-pgmark-adapter";

/**
 * Pure-seam test for F#11(a): synthesize a `PgmarkPages` from the live pdf.js
 * viewer page state so the SAME PaperHeader PagePicker drives the PDF-mode
 * picker at parity with text mode. The iframe/eventBus wiring is browser-only
 * (depends on F#10) and verified live; this guards the pure mapping.
 */
describe("pdfPagesToPgmark", () => {
  it("builds 1..N ordinal labels with monotonic docY", () => {
    const { pages } = pdfPagesToPgmark(3, 1, () => {});
    expect(pages.map((p) => p.label)).toEqual(["1", "2", "3"]);
    expect(pages.map((p) => p.docY)).toEqual([
      VIRTUAL_PAGE_HEIGHT,
      2 * VIRTUAL_PAGE_HEIGHT,
      3 * VIRTUAL_PAGE_HEIGHT,
    ]);
    // Strictly increasing, like the text-mode marks.
    for (let i = 1; i < pages.length; i++) {
      expect(pages[i].docY).toBeGreaterThan(pages[i - 1].docY);
    }
  });

  it("derives currentIndex (0-based) + currentLabel from the 1-based current page", () => {
    const r = pdfPagesToPgmark(10, 4, () => {});
    expect(r.currentIndex).toBe(3);
    expect(r.currentLabel).toBe("4");
  });

  it("scrollToPage(label string) navigates to that 1-based page via the callback", () => {
    const nav = vi.fn();
    const r = pdfPagesToPgmark(10, 1, nav);
    r.scrollToPage("7");
    expect(nav).toHaveBeenCalledTimes(1);
    expect(nav).toHaveBeenCalledWith(7);
  });

  it("scrollToPage(index number) maps a 0-based index to its 1-based page", () => {
    const nav = vi.fn();
    const r = pdfPagesToPgmark(10, 1, nav);
    r.scrollToPage(6); // index 6 → page 7
    expect(nav).toHaveBeenCalledWith(7);
  });

  it("scrollToPage ignores out-of-range / unparseable targets", () => {
    const nav = vi.fn();
    const r = pdfPagesToPgmark(5, 1, nav);
    r.scrollToPage("0"); // below range
    r.scrollToPage("6"); // above range
    r.scrollToPage("abc"); // unparseable
    r.scrollToPage(99); // index 99 → page 100, above range
    expect(nav).not.toHaveBeenCalled();
  });

  it("not-yet-ready (pagesCount 0) yields an empty, inert picker", () => {
    const nav = vi.fn();
    const r = pdfPagesToPgmark(0, 1, nav);
    expect(r.pages).toEqual([]);
    expect(r.currentIndex).toBe(-1);
    expect(r.currentLabel).toBeNull();
    r.scrollToPage("1"); // no-op, does not throw
    expect(nav).not.toHaveBeenCalled();
  });

  it("clamps a current page that overshoots the count", () => {
    // Defensive: pagechanging could momentarily report a page > pagesCount.
    const r = pdfPagesToPgmark(3, 9, () => {});
    expect(r.currentIndex).toBe(2);
    expect(r.currentLabel).toBe("3");
  });

  it("clamps a current page below 1", () => {
    const r = pdfPagesToPgmark(3, 0, () => {});
    expect(r.currentIndex).toBe(0);
    expect(r.currentLabel).toBe("1");
  });

  it("floors a fractional pagesCount and ignores non-finite counts", () => {
    expect(pdfPagesToPgmark(3.9, 1, () => {}).pages).toHaveLength(3);
    expect(pdfPagesToPgmark(Number.NaN, 1, () => {}).pages).toEqual([]);
    expect(pdfPagesToPgmark(-2, 1, () => {}).pages).toEqual([]);
  });
});
