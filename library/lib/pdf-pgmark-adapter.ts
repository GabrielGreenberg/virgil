import type { PgmarkPages, PageMark } from "@library/hooks/usePgmarkPages";

/** Live page state lifted out of the pdf.js viewer (PDFViewerApplication).
 *  `pagesCount` is 0 until the viewer fires `pagesinit`; until then the
 *  synthesized picker is empty (renders nothing). */
export interface PdfPageState {
  /** Total page count, from `PDFViewerApplication.pagesCount`. 0 = not ready. */
  pagesCount: number;
  /** Current 1-based page, from `PDFViewerApplication.page`. */
  currentPage: number;
}

/** Notional per-page Y stride for the synthesized PageMark.docY values. PDF
 *  viewers don't expose document-space Y offsets per page, but the header
 *  PagePicker only displays the LABEL and calls `scrollToPage(label)` — it
 *  never reads docY. So a monotonic placeholder stride is sufficient to keep
 *  the PageMark[] well-formed (strictly increasing, like the text-mode marks).
 *  Exported for the test's sake. */
export const VIRTUAL_PAGE_HEIGHT = 1000;

/**
 * Pure adapter: synthesize a `PgmarkPages`-shaped object from the live pdf.js
 * viewer page state, so the SAME `PaperHeader` PagePicker that drives the
 * text-mode printed-page picker can drive the PDF-mode picker at parity.
 *
 * The PDF viewer uses 1..N ordinal page numbers as its labels (it has no
 * `\pgmark{N}` printed-page anchors), so `pages[i].label === String(i + 1)`.
 *
 * `onScrollToPage(page)` is the only viewer reference, supplied by the caller
 * (RightDetail) bound to the `PDFViewerApplication.page` setter — keeping this
 * function free of any iframe/DOM references and unit-testable in isolation.
 *
 * Not-yet-ready state (pagesCount === 0): returns an empty `pages[]` and a
 * null `currentLabel`, so the PagePicker renders nothing until `pagesinit`.
 *
 * @param pagesCount    total pages (0 until the viewer is ready)
 * @param currentPage   the viewer's current 1-based page
 * @param onScrollToPage navigate the viewer to a 1-based page
 */
export function pdfPagesToPgmark(
  pagesCount: number,
  currentPage: number,
  onScrollToPage: (page: number) => void,
): PgmarkPages {
  const count = Number.isFinite(pagesCount) && pagesCount > 0 ? Math.floor(pagesCount) : 0;

  if (count === 0) {
    return {
      pages: [],
      currentIndex: -1,
      currentLabel: null,
      // Bound but inert — no pages to scroll to.
      scrollToPage: () => {},
    };
  }

  const pages: PageMark[] = [];
  for (let i = 1; i <= count; i++) {
    pages.push({ label: String(i), docY: i * VIRTUAL_PAGE_HEIGHT });
  }

  // Clamp the current page into [1, count] before deriving the 0-based index.
  const clampedCurrent = Math.min(Math.max(currentPage, 1), count);
  const currentIndex = clampedCurrent - 1;

  return {
    pages,
    currentIndex,
    currentLabel: String(clampedCurrent),
    scrollToPage: (target: string | number) => {
      // PagePicker passes the typed LABEL (a string like "12"); the lozenge can
      // pass a numeric INDEX. Mirror usePgmarkPages: number → index, string →
      // label. For the PDF synth, label === String(ordinal), so a label maps to
      // its own 1-based page; a numeric index maps to (index + 1).
      const page =
        typeof target === "number"
          ? target + 1
          : Number.parseInt(target.trim(), 10);
      if (!Number.isFinite(page) || page < 1 || page > count) return;
      onScrollToPage(page);
    },
  };
}
