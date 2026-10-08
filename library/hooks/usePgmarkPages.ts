"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Editor } from "@tiptap/react";
import { parkDuringLayoutGesture } from "@/lib/pane-resize/layout-gesture-park";

/** One printed-page anchor recovered from a `\pgmark{label}` decoration. */
export interface PageMark {
  /** Page label, e.g. "525". These are the literal printed page strings the
   *  source carries — NOT a 1..N ordinal. The page picker matches the typed
   *  LABEL against these, and the page COUNT is `pages.length`. */
  label: string;
  /** Y of the chip in the scroll container's content coordinates
   *  (0 = top of scrollable content). Stable under scroll. */
  docY: number;
}

export interface PgmarkPages {
  /** All printed-page anchors, in document order. Empty for DOCX / plain-tex
   *  sources with no `\pgmark{N}`. */
  pages: PageMark[];
  /** Index into `pages` of the page currently at the viewport's near-top
   *  reference line, or -1 when there are no pages. */
  currentIndex: number;
  /** Label of the current page, or null when there are no pages. */
  currentLabel: string | null;
  /** Scroll the container so the page with the given label (or index) is at
   *  the top of the viewport. No-op for an unknown label / out-of-range index. */
  scrollToPage: (target: string | number) => void;
}

/** Probe line as a fraction of the viewport height — the page whose anchor
 *  sits at or above this line is "current". Matches the legacy lozenge. */
const PROBE_FRACTION = 0.35;

/**
 * Shared printed-page derivation for the Library Reader. Owns the EXACT
 * `\pgmark{N}` collection + current-page logic that used to live inline in
 * `PageScrollLozenge`, so the lozenge ("p. N" pill) and the header's page
 * picker share ONE pages[]/current derivation (no double doc-scan).
 *
 * F#11: called ONCE — in `RightDetail`, the single ancestor that renders BOTH
 * consumers and already holds the live reader refs (editor + scroll container,
 * lifted from `PaperRender` via `onReaderRefs`). The resulting `PgmarkPages`
 * is threaded down as a prop to `PageScrollLozenge` AND `PaperHeader`'s
 * `PagePicker`, so there is exactly one ResizeObserver / scroll listener /
 * transaction listener / doc-scan for the whole reader. Do NOT add a second
 * call site in a consumer — pass the object down instead.
 *
 * Keystroke sanctity: pages are (re)collected ONLY on the editor's `create`
 * event and on `docChanged` transactions — never per keystroke (the Reader is
 * read-only anyway, so plain transactions don't fire). Layout changes go
 * through a RAF-coalesced ResizeObserver, which additionally PARKS during any
 * pane-resize gesture (app-wide LayoutGestureBus) and settles once on the end edge.
 * The current-page index is recomputed on scroll, RAF-coalesced to one compute
 * per frame. No work is proportional to document size on a plain keystroke.
 *
 * Scroll is a READING input, not React state (task 1010): the live scrollTop /
 * clientHeight are read inside the RAF callback and folded straight into the
 * current-page index, which is the only scroll-derived state — set behind an
 * equality bail, so a scroll frame that stays on the same page renders NOTHING.
 * The host (RightDetail → PaperHeader → PaperRender) re-renders only when the
 * page actually changes.
 *
 * Identity guarantee (R4): `pages` is equality-gated on the (label, docY)
 * sequence — ANY recompute that finds the same marks keeps the SAME array
 * reference. The returned `PgmarkPages` OBJECT is memoized on
 * `[pages, currentIndex, scrollToPage]`, so it too keeps its identity until the
 * marks or the current page change — consumers memoize on the object itself
 * (PaperRender's `pagePickerEl` does; it keeps EditorPane's memo() intact).
 */
/** label+docY sequence equality — the `pages` identity gate above. */
function pageMarksEqual(a: PageMark[], b: PageMark[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i].label !== b[i].label || a[i].docY !== b[i].docY) return false;
  }
  return true;
}
export function usePgmarkPages(
  editor: Editor | null,
  scrollContainer: HTMLElement | null,
): PgmarkPages {
  const [pages, setPages] = useState<PageMark[]>([]);
  const [currentIndex, setCurrentIndex] = useState(-1);
  // The latest marks, readable from the RAF callbacks without a re-render.
  const pagesRef = useRef<PageMark[]>(pages);
  const currentIndexRef = useRef(currentIndex);
  const scrollRaf = useRef<number | null>(null);
  const roRaf = useRef<number | null>(null);

  // Fold the container's LIVE scroll position into the current-page index.
  // The ref-side equality bail means a same-page call never reaches setState
  // (React's own same-value bail can still render the host once).
  const syncCurrentIndex = useCallback(() => {
    if (!scrollContainer) return;
    const next = currentIndexAt(
      pagesRef.current,
      scrollContainer.scrollTop,
      scrollContainer.clientHeight,
    );
    if (next === currentIndexRef.current) return;
    currentIndexRef.current = next;
    setCurrentIndex(next);
  }, [scrollContainer]);

  // ── Collect pgmarks from the rendered DOM ─────────────────────────
  // Each `.pgmark-chip` is the inline decoration over the literal
  // `\pgmark{N}` text; its visible argument (the page that begins there)
  // lives in its raw text content even when CSS hides the first chip.
  const collectPages = useCallback(() => {
    if (!editor || editor.isDestroyed || !scrollContainer) return;
    const dom = (editor.view as { dom?: HTMLElement } | undefined)?.dom;
    if (!dom) return;
    const containerRect = scrollContainer.getBoundingClientRect();
    const top = scrollContainer.scrollTop;
    const chips = Array.from(dom.querySelectorAll<HTMLElement>(".pgmark-chip"));
    const next: PageMark[] = [];
    for (const chip of chips) {
      const raw = chip.textContent ?? "";
      const m = raw.match(/\\pgmark(?:\[[a-z]+\])?\{([^}]*)\}/i);
      const label = (m?.[1] ?? chip.dataset.label ?? "").trim();
      // Skip empties (e.g. `\verb|\pgmark{}|` literals quoted as code).
      if (!label) continue;
      const isHidden = getComputedStyle(chip).display === "none";
      const target: HTMLElement | null = isHidden ? chip.parentElement : chip;
      if (!target) continue;
      const rect = target.getBoundingClientRect();
      // Y in scrollable content coords (independent of current scroll).
      const docY = rect.top - containerRect.top + top;
      next.push({ label, docY });
    }
    // Equality gate (R4): keep the previous array's IDENTITY when nothing
    // changed, so downstream memos keyed on `pages` (PaperRender's
    // pagePickerEl → EditorPane memo()) bail instead of re-rendering the
    // reader subtree on every no-op re-scan.
    if (!pageMarksEqual(pagesRef.current, next)) {
      pagesRef.current = next;
      setPages(next);
    }
    // Marks and/or the viewport height may have moved — re-derive the page.
    syncCurrentIndex();
  }, [editor, scrollContainer, syncCurrentIndex]);

  // Recollect on editor `create` (first run after the view mounts) and on
  // docChanged transactions only — NOT on every transaction. The Reader is
  // read-only so structural changes are rare, and this never runs per
  // keystroke.
  useEffect(() => {
    if (!editor) return;
    collectPages();
    const onTransaction = ({
      transaction,
    }: {
      transaction: import("@tiptap/pm/state").Transaction;
    }) => {
      if (!transaction.docChanged) return;
      collectPages();
    };
    const onCreate = () => collectPages();
    editor.on("transaction", onTransaction);
    editor.on("create", onCreate);
    return () => {
      editor.off("transaction", onTransaction);
      editor.off("create", onCreate);
    };
  }, [editor, collectPages]);

  // Layout/size changes → recollect, RAF-coalesced so a resize storm can't
  // thrash the doc-scan (keystroke-sanctity / AGENTS.md: a width-watching RO
  // must be RAF-guarded, unlike the legacy bare-callback lozenge RO) — and
  // PARKED during any pane-resize gesture: collectPages does O(chips)
  // forced-layout reads (getComputedStyle + getBoundingClientRect per chip),
  // so it must never ride a pointer frame. Mid-drag the reader content is
  // width-frozen (PaneFreeze in RightDetail) so this RO shouldn't fire at all;
  // the park is defense-in-depth — a mid-gesture fire stashes dirty and the
  // end edge reconciles ONCE (the equality gate then usually keeps `pages`
  // identity anyway).
  useEffect(() => {
    if (!editor || editor.isDestroyed || !scrollContainer) return;
    const dom = (editor.view as { dom?: HTMLElement } | undefined)?.dom;
    if (!dom) return;
    const park = parkDuringLayoutGesture(() => {
      if (roRaf.current !== null) return;
      roRaf.current = requestAnimationFrame(() => {
        roRaf.current = null;
        collectPages();
      });
    });
    const ro = new ResizeObserver(() => park.fire());
    ro.observe(dom);
    ro.observe(scrollContainer);
    return () => {
      ro.disconnect();
      park.dispose();
      if (roRaf.current !== null) {
        cancelAnimationFrame(roRaf.current);
        roRaf.current = null;
      }
    };
  }, [editor, scrollContainer, collectPages]);

  // Recompute the current page on scroll, RAF-coalesced to once per frame. The
  // scroll position is read live in the callback, never held as state.
  useEffect(() => {
    if (!scrollContainer) return;
    const onScroll = () => {
      if (scrollRaf.current !== null) return;
      scrollRaf.current = requestAnimationFrame(() => {
        scrollRaf.current = null;
        syncCurrentIndex();
      });
    };
    syncCurrentIndex();
    scrollContainer.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      scrollContainer.removeEventListener("scroll", onScroll);
      if (scrollRaf.current !== null) {
        cancelAnimationFrame(scrollRaf.current);
        scrollRaf.current = null;
      }
    };
  }, [scrollContainer, syncCurrentIndex]);

  const scrollToPage = useCallback(
    (target: string | number) => {
      if (!scrollContainer || pages.length === 0) return;
      let page: PageMark | undefined;
      if (typeof target === "number") {
        page = pages[target];
      } else {
        const wanted = target.trim();
        page = pages.find((p) => p.label === wanted);
      }
      if (!page) return;
      scrollContainer.scrollTo({ top: page.docY });
    },
    [scrollContainer, pages],
  );

  return useMemo(() => {
    // Clamp: `pages` and `currentIndex` are set together, but never index past
    // the marks this render actually holds.
    const index =
      pages.length === 0
        ? -1
        : Math.min(Math.max(currentIndex, 0), pages.length - 1);
    return {
      pages,
      currentIndex: index,
      currentLabel: index >= 0 ? pages[index].label : null,
      scrollToPage,
    };
  }, [pages, currentIndex, scrollToPage]);
}

/** Current page = the last pgmark whose docY is at or above the viewport's
 *  near-top reference line (same probe the strip used); -1 with no pages. */
function currentIndexAt(
  pages: PageMark[],
  scrollTop: number,
  containerH: number,
): number {
  if (pages.length === 0) return -1;
  const probe = scrollTop + containerH * PROBE_FRACTION;
  let last = 0;
  for (let i = 0; i < pages.length; i++) {
    if (pages[i].docY <= probe) last = i;
    else break;
  }
  return last;
}
