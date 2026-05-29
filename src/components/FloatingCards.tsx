"use client";

import { useEffect, useRef, type ReactNode } from "react";
import FloatingPanel, { type FloatingPanelHandle } from "./FloatingPanel";
import { usePoppedCards } from "@/hooks/usePoppedCards";
import { consumeCardLiftHandoff } from "./card-lift";

const DEFAULT_W = 360;
const DEFAULT_H = 280;

// Text floats (paragraph/heading/selection) auto-fit their height to content
// on first mount per session, capped at 40% of viewport height. Tracked here
// so user resizes after the initial fit aren't overwritten when the float
// closes and reopens.
const autoFittedKeys = new Set<string>();
const TEXT_FLOAT_HEADER_H = 24;
const TEXT_FLOAT_BORDERS = 2;
const TEXT_FLOAT_MAX_VH = 0.4;

/**
 * Wraps a popped-out card's JSX in a draggable/resizable `FloatingPanel`,
 * positioned from the shared popped-cards context.
 *
 * Usage (inside a wrapper card, when `popped.isPopped(key)` is true):
 *   return <FloatCard cardKey={key} indexHint={i}>{cardContent}</FloatCard>;
 *
 * The card itself is rendered once — here — and it never also appears in the
 * panel's list (the wrapper's early-return handles that). `FloatingPanel`
 * portals to `document.body`, so popped cards remain visible above every
 * layout layer.
 */
export function FloatCard({
  cardKey,
  surface,
  children,
}: {
  cardKey: string;
  surface?: "panel" | "card";
  children: ReactNode;
}) {
  const ctx = usePoppedCards();
  if (!ctx) return null;
  const rect = ctx.getFloatPosition(cardKey);
  const indexHint = Math.max(0, ctx.poppedKeys.indexOf(cardKey));
  const vw = typeof window !== "undefined" ? window.innerWidth : 1200;
  const vh = typeof window !== "undefined" ? window.innerHeight : 800;
  const initialX =
    rect?.x ?? Math.max(40, vw / 2 - DEFAULT_W / 2 + indexHint * 24);
  const initialY =
    rect?.y ?? Math.max(40, vh / 2 - DEFAULT_H / 2 + indexHint * 24);
  const initialWidth = rect?.width ?? DEFAULT_W;
  const initialHeight = rect?.height ?? DEFAULT_H;
  // Extract the card id from `cardKey` ("<kind>:<id>") so the floating
  // wrapper (including its chrome) counts as "inside" the pristine card —
  // clicks on the drag handle or resize grip shouldn't trip auto-discard.
  const pristineId = cardKey.includes(":") ? cardKey.slice(cardKey.indexOf(":") + 1) : cardKey;
  // Drag handoff: when this float was just spawned by a card lift-off
  // gesture, the user's mouse is still down. Pick up that drag here so
  // the gesture continues seamlessly until they release the mouse.
  const panelHandleRef = useRef<FloatingPanelHandle>(null);
  useEffect(() => {
    const handoff = consumeCardLiftHandoff(cardKey);
    if (!handoff) return;
    panelHandleRef.current?.beginDragAt(handoff.clientX, handoff.clientY);
    // Run once on mount only; subsequent re-renders never re-acquire a
    // drag (consumeCardLiftHandoff already cleared the one-shot signal).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-fit text floats to content on first mount. Tiptap's deferred
  // mount (immediatelyRender:false) means body.scrollHeight is wrong if
  // we measure too early — a fixed RAF count can't tell us "content is
  // ready." So we use ResizeObserver to react whenever the body's natural
  // size changes during the first ~800ms after mount, and re-measure
  // each time using the panel's *current* DOM rect (not the stale
  // closure-captured `rect`). Gated to text floats via the par-float-body
  // selector — other popouts have no .par-float-body and exit cleanly.
  // Bounded by 40% of viewport height; if content exceeds the cap, the
  // body's existing overflow:auto handles the scroll.
  useEffect(() => {
    if (autoFittedKeys.has(cardKey)) return;
    autoFittedKeys.add(cardKey);
    let attempts = 0;
    let lastTarget = 0;
    let ro: ResizeObserver | null = null;
    let stopTimer: number | null = null;
    const tryFit = () => {
      const wrapper = document.querySelector(
        `[data-pristine-card-id="${pristineId}"]`,
      );
      const panel = wrapper?.closest<HTMLElement>(
        '[data-floating-panel="true"]',
      );
      const body = panel?.querySelector<HTMLElement>(".par-float-body");
      if (!panel || !body) {
        if (attempts++ < 30) requestAnimationFrame(tryFit);
        return;
      }
      const measure = () => {
        if (!panel.isConnected || !body.isConnected) {
          ro?.disconnect();
          return;
        }
        const panelRect = panel.getBoundingClientRect();
        const currentH = panelRect.height;
        const natural =
          body.scrollHeight + TEXT_FLOAT_HEADER_H + TEXT_FLOAT_BORDERS;
        const cap = Math.floor(window.innerHeight * TEXT_FLOAT_MAX_VH);
        const target = Math.min(natural, cap);
        if (target <= currentH + 1) return;
        if (target === lastTarget) return;
        lastTarget = target;
        const maxY = window.innerHeight - target - 20;
        const adjustedY = Math.max(20, Math.min(panelRect.top, maxY));
        ctx.setFloatPosition(cardKey, {
          x: panelRect.left,
          y: adjustedY,
          width: panelRect.width,
          height: target,
        });
      };
      measure();
      ro = new ResizeObserver(measure);
      ro.observe(body);
      // Stop observing after the initial render burst so subsequent user
      // resizes don't fight us.
      stopTimer = window.setTimeout(() => ro?.disconnect(), 800);
    };
    // Schedule but don't cancel on cleanup — Strict Mode's mount→cleanup→
    // mount cycle would otherwise abort the work, and the autoFittedKeys
    // gate prevents the second mount from rescheduling. measure() guards
    // against the panel/body being detached.
    requestAnimationFrame(tryFit);

    // Shrink-to-fit once web fonts settle. The burst above only ever GROWS
    // (it bails when content is shorter than the window), so a float spawned
    // too tall keeps its excess height. Classic case: a list whose
    // `sourceHeight` was captured at threshold-cross before web fonts loaded
    // — the fallback font's taller line-height over-measures the source and
    // the per-item error accumulates across the list, spawning the popout
    // ~2-3 lines too tall. `document.fonts.ready` is the moment the
    // line-height corrects; on cold fonts (the bug) it resolves after the
    // content has rendered at its final shorter height, so we can measure
    // and hug it. Shrink-only + a >2px threshold makes this a no-op whenever
    // the spawned height was already right (warm fonts → no jump), so
    // paragraph/heading popouts and warm retries don't move. We measure the
    // content children's span, not body.scrollHeight — the latter collapses
    // to the container height when the window is too tall and can't see the
    // excess.
    const fonts =
      typeof document !== "undefined"
        ? (document as unknown as { fonts?: { ready?: Promise<unknown> } }).fonts
        : undefined;
    if (fonts?.ready && typeof fonts.ready.then === "function") {
      fonts.ready.then(() => {
        // Double rAF so the post-swap reflow is committed before we read.
        requestAnimationFrame(() =>
          requestAnimationFrame(() => {
            const wrapper = document.querySelector(
              `[data-pristine-card-id="${pristineId}"]`,
            );
            const panel = wrapper?.closest<HTMLElement>(
              '[data-floating-panel="true"]',
            );
            const body = panel?.querySelector<HTMLElement>(".par-float-body");
            if (!panel || !body || !panel.isConnected) return;
            const first = body.firstElementChild as HTMLElement | null;
            const last = body.lastElementChild as HTMLElement | null;
            if (!first || !last) return;
            const cs = window.getComputedStyle(body);
            const padV =
              (parseFloat(cs.paddingTop) || 0) +
              (parseFloat(cs.paddingBottom) || 0);
            const contentH =
              last.getBoundingClientRect().bottom -
              first.getBoundingClientRect().top +
              padV;
            if (contentH <= 0) return; // content not yet rendered — skip
            const natural = contentH + TEXT_FLOAT_HEADER_H + TEXT_FLOAT_BORDERS;
            const cap = Math.floor(window.innerHeight * TEXT_FLOAT_MAX_VH);
            const target = Math.min(natural, cap);
            const panelRect = panel.getBoundingClientRect();
            // Shrink-only: bail unless the window is meaningfully taller than
            // its content (settled case → no-op, no visible jump). Keeps x/
            // width/top so the bottom edge rises to meet the text.
            if (panelRect.height - target <= 2) return;
            ctx.setFloatPosition(cardKey, {
              x: panelRect.left,
              y: panelRect.top,
              width: panelRect.width,
              height: target,
            });
          }),
        );
      });
    }
    return () => {
      ro?.disconnect();
      if (stopTimer) clearTimeout(stopTimer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <FloatingPanel
      ref={panelHandleRef}
      cardKey={cardKey}
      initialX={initialX}
      initialY={initialY}
      initialWidth={initialWidth}
      initialHeight={initialHeight}
      zIndex={1200 + indexHint}
      surface={surface}
      onChange={(pos) => ctx.setFloatPosition(cardKey, pos)}
      onFocus={() => ctx.recordFocus?.(cardKey)}
    >
      <div data-pristine-card-id={pristineId} style={{ display: "contents" }}>
        {children}
      </div>
    </FloatingPanel>
  );
}
