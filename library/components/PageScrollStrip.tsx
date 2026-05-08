"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Editor } from "@tiptap/react";

interface Props {
  editor: Editor | null;
  /** The overflow:auto element wrapping the strip+pod row. Used both
   *  to size the strip (its visible height = the strip's height) and to
   *  scroll to the target page on click. May be null on first render. */
  scrollContainer: HTMLElement | null;
}

interface PageMark {
  /** Page label, e.g. "525". */
  label: string;
  /** Y of the chip in the scroll container's content coordinates
   *  (0 = top of scrollable content). Stable under scroll. Used as the
   *  scroll target on click; the strip's visual layout uses even
   *  spacing instead. */
  docY: number;
  /** Whether the chip was tagged \pgmark[low]{N}. */
  isLow: boolean;
}

const STRIP_WIDTH = 24;
const LABEL_H = 14;
const HEADER_H = 12;
// Gap between the strip's top edge (= top of editor pod) and page 1.
// Combined with HEADER_H lifted above the strip, this creates breathing
// room between "pg." and the first page number.
const PAGE_TOP_GAP = 8;
const MIN_LABEL_PX = 16;
const NICE_STEPS = [1, 2, 5, 10, 25, 50, 100, 250, 500, 1000];
const PGMARK_RED = "#c0392b";

/** Snap a raw step up to the next nice value. */
function niceStep(raw: number): number {
  for (const s of NICE_STEPS) if (s >= raw) return s;
  return NICE_STEPS[NICE_STEPS.length - 1];
}

/** Sticky vertical strip immediately to the left of the editor pod.
 *  Page numbers are distributed *evenly* across the visible viewport —
 *  first number at the top, last at the bottom, intermediate pages
 *  spaced uniformly between. Click jumps the parent scroll container to
 *  that page's actual position in the doc.
 *
 *  Density: when pages would overlap, only every Nth label renders;
 *  intermediate (thinned) pages render a small notch so they remain
 *  clickable. Labeled pages render the number alone (no notch). */
export default function PageScrollStrip({ editor, scrollContainer }: Props) {
  const stripRef = useRef<HTMLElement | null>(null);
  const [pages, setPages] = useState<PageMark[]>([]);
  const [containerH, setContainerH] = useState(0);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const [scrollTop, setScrollTop] = useState(0);

  // ── Collect pgmarks from rendered DOM ─────────────────────────────
  // Each `.pgmark-chip` is the inline decoration over the literal
  // `\pgmark{N}` text. The FIRST chip is hidden via CSS — we fall back
  // to its containing block, which lays out at the same Y. The chip's
  // visible argument (the page that *begins* there) is in its raw text
  // content even though CSS hides it.
  const collectPages = useCallback(() => {
    const strip = stripRef.current;
    if (!editor || editor.isDestroyed || !strip || !scrollContainer) return;
    const dom = (editor.view as { dom?: HTMLElement } | undefined)?.dom;
    if (!dom) return;
    const containerRect = scrollContainer.getBoundingClientRect();
    const scrollTop = scrollContainer.scrollTop;
    const chips = Array.from(dom.querySelectorAll<HTMLElement>(".pgmark-chip"));
    const next: PageMark[] = [];
    for (const chip of chips) {
      const raw = chip.textContent ?? "";
      const m = raw.match(/\\pgmark(?:\[[a-z]+\])?\{([^}]*)\}/i);
      const label = (m?.[1] ?? chip.dataset.label ?? "").trim();
      // Skip empties (from `\verb|\pgmark{}|` literals quoted as code).
      if (!label) continue;
      const isLow = chip.classList.contains("pgmark-chip-low");
      const isHidden = getComputedStyle(chip).display === "none";
      const target: HTMLElement | null = isHidden ? chip.parentElement : chip;
      if (!target) continue;
      const rect = target.getBoundingClientRect();
      // Y in scrollable content coords (independent of current scroll).
      const docY = rect.top - containerRect.top + scrollTop;
      next.push({ label, docY, isLow });
    }
    setPages(next);
    setContainerH(scrollContainer.clientHeight);
  }, [editor, scrollContainer]);

  // Recollect on doc changes, on editor "create" (so the first run
  // happens after the view is mounted), and on layout/size changes.
  useEffect(() => {
    if (!editor) return;
    collectPages();
    const handler = () => collectPages();
    editor.on("transaction", handler);
    editor.on("create", handler);
    return () => {
      editor.off("transaction", handler);
      editor.off("create", handler);
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

  // Track scrollTop for the current-page lozenge.
  useEffect(() => {
    if (!scrollContainer) return;
    const onScroll = () => setScrollTop(scrollContainer.scrollTop);
    scrollContainer.addEventListener("scroll", onScroll, { passive: true });
    setScrollTop(scrollContainer.scrollTop);
    return () => scrollContainer.removeEventListener("scroll", onScroll);
  }, [scrollContainer]);

  // ── Current page = the last pgmark whose docY is at or above the
  // viewport's near-top reference line. The lozenge highlights this
  // index so the user can see where they are in the doc.
  const currentIdx = useMemo(() => {
    if (pages.length === 0) return -1;
    const probe = scrollTop + containerH * 0.35;
    let last = 0;
    for (let i = 0; i < pages.length; i++) {
      if (pages[i].docY <= probe) last = i;
      else break;
    }
    return last;
  }, [pages, scrollTop, containerH]);

  // ── Density thinning (labels only — notches always render) ───────
  const step = useMemo(() => {
    if (pages.length <= 1 || containerH <= 0) return 1;
    const raw = Math.ceil((pages.length * MIN_LABEL_PX) / containerH);
    return niceStep(raw);
  }, [pages.length, containerH]);

  // ── Click handler ─────────────────────────────────────────────────
  const jumpTo = useCallback(
    (docY: number) => {
      if (!scrollContainer) return;
      const target = Math.max(0, docY - scrollContainer.clientHeight * 0.18);
      // Instant jump (no smooth-scroll animation) — clicking a page
      // number teleports to it.
      scrollContainer.scrollTo({ top: target, behavior: "auto" });
    },
    [scrollContainer],
  );

  // ── Per-tick visual Y on the strip ────────────────────────────────
  // Maps page indices uniformly across the strip's interior. The "pg."
  // header sits above the strip's top edge (negative top), so the
  // interior starts at PAGE_TOP_GAP for breathing room between header
  // and page 1; page N-1 sits at the bottom (label fully visible).
  const stripYFor = useCallback(
    (i: number): number => {
      const denom = Math.max(pages.length - 1, 1);
      const usable = Math.max(0, containerH - LABEL_H - PAGE_TOP_GAP);
      return PAGE_TOP_GAP + (i / denom) * usable;
    },
    [pages.length, containerH],
  );

  return (
    <nav
      ref={stripRef}
      className="page-scroll-strip"
      aria-label="Page numbers"
      style={{
        position: "sticky",
        top: 0,
        alignSelf: "flex-start",
        width: STRIP_WIDTH,
        height: containerH || "100%",
        flexShrink: 0,
        userSelect: "none",
      }}
    >
      {/* Column header — small "pg." caption sitting just *above* the
       *  strip's top edge (and therefore just above the editor pod's
       *  top edge). Negative `top` lifts it out of the strip's interior
       *  so page 1 has clear breathing room below it. */}
      {pages.length > 0 && (
        <span
          aria-hidden="true"
          style={{
            position: "absolute",
            top: -HEADER_H,
            left: 0,
            right: 0,
            height: HEADER_H,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontFamily: "var(--mono)",
            fontSize: 9,
            letterSpacing: "0.05em",
            color: "var(--muted)",
            opacity: 0.65,
            pointerEvents: "none",
            userSelect: "none",
          }}
        >
          pg.
        </span>
      )}
      {pages.length === 0 && (
        <div
          style={{
            position: "absolute",
            top: 12,
            left: 0,
            right: 0,
            textAlign: "center",
            color: "var(--muted)",
            fontSize: 9,
            fontFamily: "var(--mono)",
            opacity: 0.5,
            writingMode: "vertical-rl",
            transform: "rotate(180deg)",
            whiteSpace: "nowrap",
          }}
        >
          no page anchors
        </div>
      )}
      {/* Current-position lozenge — faded red vertical pill behind the
       *  page number/notch at the user's current scroll position. Sits
       *  beneath the buttons so the number stays readable on top.
       *  Horizontally centered on the strip so it aligns with the
       *  centered page numbers and notches. */}
      {currentIdx >= 0 && (() => {
        const lozengeW = 16;
        const lozengeH = 28;
        return (
          <span
            aria-hidden="true"
            style={{
              position: "absolute",
              // Center vertically on the label's mid-line, horizontally
              // on the strip itself.
              top: stripYFor(currentIdx) + LABEL_H / 2 - lozengeH / 2,
              left: (STRIP_WIDTH - lozengeW) / 2,
              width: lozengeW,
              height: lozengeH,
              background: "rgba(192, 57, 43, 0.18)",
              borderRadius: lozengeW / 2,
              pointerEvents: "none",
            }}
          />
        );
      })()}
      {pages.map((p, i) => {
        const isLabeled = i % step === 0 || i === hoverIdx || i === currentIdx;
        const isHover = i === hoverIdx;
        const tone = isHover ? PGMARK_RED : "var(--muted)";
        return (
          <button
            key={`${i}-${p.label}`}
            type="button"
            aria-label={`Jump to page ${p.label}`}
            onClick={() => jumpTo(p.docY)}
            onMouseEnter={() => setHoverIdx(i)}
            onMouseLeave={() => setHoverIdx((cur) => (cur === i ? null : cur))}
            onFocus={() => setHoverIdx(i)}
            onBlur={() => setHoverIdx((cur) => (cur === i ? null : cur))}
            style={{
              position: "absolute",
              top: stripYFor(i),
              left: 0,
              width: STRIP_WIDTH,
              height: LABEL_H,
              border: "none",
              background: "transparent",
              cursor: "pointer",
              padding: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontFamily: "var(--mono)",
              fontSize: 10,
              fontWeight: isHover ? 600 : 400,
              color: tone,
              opacity: p.isLow && !isHover ? 0.55 : 1,
            }}
          >
            {isLabeled ? (
              <span style={{ whiteSpace: "nowrap" }}>{p.label}</span>
            ) : (
              <span
                aria-hidden="true"
                style={{
                  width: 10,
                  height: 1,
                  background: tone,
                  flexShrink: 0,
                }}
              />
            )}
          </button>
        );
      })}
    </nav>
  );
}
