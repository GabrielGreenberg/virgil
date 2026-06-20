"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Editor } from "@tiptap/react";

interface Props {
  editor: Editor | null;
  /** The overflow:auto element wrapping the editor pod. Used to read
   *  scrollTop / clientHeight and to anchor the lozenge. May be null on
   *  first render. */
  scrollContainer: HTMLElement | null;
}

interface PageMark {
  /** Page label, e.g. "525". */
  label: string;
  /** Y of the chip in the scroll container's content coordinates
   *  (0 = top of scrollable content). Stable under scroll. */
  docY: number;
}

// Match the overlay-scrollbar idle-fade cadence (editor-scrollbar.tsx):
// the lozenge appears on scroll, then fades after FADE_DELAY ms of stillness.
const FADE_DELAY = 1000;

/**
 * A small floating pill pinned near the right scrollbar that shows the
 * current printed page (`p. N`) while the reader scrolls, then fades out
 * after ~1 s of idle. Replaces the old 24px PageScrollStrip rail.
 *
 * Data source: the `.pgmark-chip` inline decorations over the literal
 * `\pgmark{N}` text in the rendered doc — the same source the strip used.
 * Papers with no `\pgmark{N}` (DOCX / plain-tex sources) yield zero pages,
 * so the component renders nothing.
 *
 * Keystroke sanctity: pages are (re)collected only on the editor's
 * `create` event and on `docChanged` transactions — never per keystroke,
 * and the Reader is read-only so plain transactions don't fire anyway.
 * The current-page index is recomputed on scroll, RAF-coalesced to one
 * compute per frame.
 */
export default function PageScrollLozenge({ editor, scrollContainer }: Props) {
  const [pages, setPages] = useState<PageMark[]>([]);
  const [scrollTop, setScrollTop] = useState(0);
  const [containerH, setContainerH] = useState(0);
  const [visible, setVisible] = useState(false);
  const fadeTimer = useRef<number | null>(null);
  const scrollRaf = useRef<number | null>(null);

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
  // keystroke. Also recollect on layout/size changes via a ResizeObserver.
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

  useEffect(() => {
    if (!editor || editor.isDestroyed || !scrollContainer) return;
    const dom = (editor.view as { dom?: HTMLElement } | undefined)?.dom;
    if (!dom) return;
    const ro = new ResizeObserver(() => collectPages());
    ro.observe(dom);
    ro.observe(scrollContainer);
    return () => ro.disconnect();
  }, [editor, scrollContainer, collectPages]);

  // ── Idle-fade scheduler (mirrors editor-scrollbar.tsx) ────────────
  const scheduleFade = useCallback(() => {
    if (fadeTimer.current !== null) window.clearTimeout(fadeTimer.current);
    setVisible(true);
    fadeTimer.current = window.setTimeout(() => {
      setVisible(false);
      fadeTimer.current = null;
    }, FADE_DELAY);
  }, []);

  // ── Track scrollTop (RAF-coalesced) + reveal the lozenge on scroll ─
  useEffect(() => {
    if (!scrollContainer) return;
    const onScroll = () => {
      if (scrollRaf.current !== null) return;
      scrollRaf.current = requestAnimationFrame(() => {
        scrollRaf.current = null;
        setScrollTop(scrollContainer.scrollTop);
        setContainerH(scrollContainer.clientHeight);
      });
      scheduleFade();
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
  }, [scrollContainer, scheduleFade]);

  useEffect(
    () => () => {
      if (fadeTimer.current !== null) window.clearTimeout(fadeTimer.current);
    },
    [],
  );

  // ── Current page = the last pgmark whose docY is at or above the
  // viewport's near-top reference line (same probe the strip used). ──
  const currentLabel = useMemo(() => {
    if (pages.length === 0) return null;
    const probe = scrollTop + containerH * 0.35;
    let last = 0;
    for (let i = 0; i < pages.length; i++) {
      if (pages[i].docY <= probe) last = i;
      else break;
    }
    return pages[last].label;
  }, [pages, scrollTop, containerH]);

  // DOCX / plain-tex papers have no `\pgmark{N}` → render nothing.
  if (pages.length === 0 || currentLabel === null) return null;

  return (
    <div
      className={`page-scroll-lozenge${visible ? " is-visible" : ""}`}
      aria-hidden="true"
    >
      p. {currentLabel}
    </div>
  );
}
