"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { PgmarkPages } from "@library/hooks/usePgmarkPages";

interface Props {
  /** The SHARED printed-page derivation, owned by RightDetail (F#11) and
   *  threaded down via PaperRender. The lozenge only reads `currentLabel`
   *  off it — it no longer runs its own `usePgmarkPages`, so there is ONE
   *  doc-scan / ResizeObserver / page-scroll listener for the whole reader.
   *  May be undefined while the reader is still mounting / in PDF mode. */
  pages?: PgmarkPages;
  /** The overflow:auto element wrapping the editor pod. Used ONLY for the
   *  idle-fade scheduler's scroll listener (the lozenge's own behavior, not
   *  the page derivation). May be null on first render. */
  scrollContainer: HTMLElement | null;
}

// Match the overlay-scrollbar idle-fade cadence (editor-scrollbar.tsx):
// the lozenge appears on scroll, then fades after FADE_DELAY ms of stillness.
const FADE_DELAY = 1000;

/**
 * A small floating pill pinned near the right scrollbar that shows the
 * current printed page (`p. N`) while the reader scrolls, then fades out
 * after ~1 s of idle. Replaces the old 24px PageScrollStrip rail.
 *
 * Data source: the shared `PgmarkPages` object computed ONCE in RightDetail
 * (F#11) and threaded down — the SAME pages[]/current derivation the header's
 * page picker consumes, so there is exactly one doc-scan / ResizeObserver /
 * page-scroll listener for the whole reader (no double derivation). Papers
 * with no `\pgmark{N}` (DOCX / plain-tex sources) yield zero pages, so the
 * component renders nothing.
 *
 * Keystroke sanctity: the SHARED derivation (re)collects pages only on the
 * editor's `create` event and on `docChanged` transactions — never per
 * keystroke. This component only adds the idle-fade scheduler, which is O(1)
 * per scroll tick.
 */
export default function PageScrollLozenge({ pages, scrollContainer }: Props) {
  const currentLabel = pages?.currentLabel ?? null;
  const [visible, setVisible] = useState(false);
  const fadeTimer = useRef<number | null>(null);

  // ── Idle-fade scheduler (mirrors editor-scrollbar.tsx) ────────────
  const scheduleFade = useCallback(() => {
    if (fadeTimer.current !== null) window.clearTimeout(fadeTimer.current);
    setVisible(true);
    fadeTimer.current = window.setTimeout(() => {
      setVisible(false);
      fadeTimer.current = null;
    }, FADE_DELAY);
  }, []);

  // Reveal the lozenge on scroll, then fade after idle. The page derivation
  // itself rides the hook's RAF-coalesced scroll path; this listener only
  // toggles visibility (O(1) per tick).
  useEffect(() => {
    if (!scrollContainer) return;
    const onScroll = () => scheduleFade();
    scrollContainer.addEventListener("scroll", onScroll, { passive: true });
    return () => scrollContainer.removeEventListener("scroll", onScroll);
  }, [scrollContainer, scheduleFade]);

  useEffect(
    () => () => {
      if (fadeTimer.current !== null) window.clearTimeout(fadeTimer.current);
    },
    [],
  );

  // DOCX / plain-tex papers have no `\pgmark{N}` → render nothing.
  if (currentLabel === null) return null;

  return (
    <div
      className={`page-scroll-lozenge${visible ? " is-visible" : ""}`}
      aria-hidden="true"
    >
      p. {currentLabel}
    </div>
  );
}
