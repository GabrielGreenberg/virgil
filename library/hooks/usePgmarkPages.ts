"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Editor } from "@tiptap/react";

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
 * through a RAF-coalesced ResizeObserver. The current-page index is recomputed
 * on scroll, RAF-coalesced to one compute per frame. No work is proportional
 * to document size on a plain keystroke.
 */
export function usePgmarkPages(
  editor: Editor | null,
  scrollContainer: HTMLElement | null,
): PgmarkPages {
  const [pages, setPages] = useState<PageMark[]>([]);
  const [scrollTop, setScrollTop] = useState(0);
  const [containerH, setContainerH] = useState(0);
  const scrollRaf = useRef<number | null>(null);
  const roRaf = useRef<number | null>(null);

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
    setPages(next);
    setContainerH(scrollContainer.clientHeight);
  }, [editor, scrollContainer]);

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
  // must be RAF-guarded, unlike the legacy bare-callback lozenge RO).
  useEffect(() => {
    if (!editor || editor.isDestroyed || !scrollContainer) return;
    const dom = (editor.view as { dom?: HTMLElement } | undefined)?.dom;
    if (!dom) return;
    const ro = new ResizeObserver(() => {
      if (roRaf.current !== null) return;
      roRaf.current = requestAnimationFrame(() => {
        roRaf.current = null;
        collectPages();
      });
    });
    ro.observe(dom);
    ro.observe(scrollContainer);
    return () => {
      ro.disconnect();
      if (roRaf.current !== null) {
        cancelAnimationFrame(roRaf.current);
        roRaf.current = null;
      }
    };
  }, [editor, scrollContainer, collectPages]);

  // Track scrollTop (RAF-coalesced) so current-page recomputes once per frame.
  useEffect(() => {
    if (!scrollContainer) return;
    const onScroll = () => {
      if (scrollRaf.current !== null) return;
      scrollRaf.current = requestAnimationFrame(() => {
        scrollRaf.current = null;
        setScrollTop(scrollContainer.scrollTop);
        setContainerH(scrollContainer.clientHeight);
      });
    };
    setScrollTop(scrollContainer.scrollTop);
    setContainerH(scrollContainer.clientHeight);
    scrollContainer.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      scrollContainer.removeEventListener("scroll", onScroll);
      if (scrollRaf.current !== null) {
        cancelAnimationFrame(scrollRaf.current);
        scrollRaf.current = null;
      }
    };
  }, [scrollContainer]);

  // Current page = the last pgmark whose docY is at or above the viewport's
  // near-top reference line (same probe the strip used).
  const currentIndex = useMemo(() => {
    if (pages.length === 0) return -1;
    const probe = scrollTop + containerH * PROBE_FRACTION;
    let last = 0;
    for (let i = 0; i < pages.length; i++) {
      if (pages[i].docY <= probe) last = i;
      else break;
    }
    return last;
  }, [pages, scrollTop, containerH]);

  const currentLabel =
    currentIndex >= 0 && currentIndex < pages.length
      ? pages[currentIndex].label
      : null;

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

  return { pages, currentIndex, currentLabel, scrollToPage };
}
