"use client";

import { useEffect, useRef, type ReactNode } from "react";
import FloatingPanel, { type FloatingPanelHandle } from "./FloatingPanel";
import { usePoppedCards } from "@/hooks/usePoppedCards";
import { consumeCardLiftHandoff } from "./card-lift";
import {
  capPopoutHeight,
  parseTextObjectPopoutKey,
} from "@/text-objects/text-object-registry";

const DEFAULT_W = 360;
const DEFAULT_H = 280;

// Text floats (paragraph/heading/selection) auto-fit their height to content
// on first mount per session, capped via the shared `capPopoutHeight`
// (POPOUT_MAX_VH fraction of viewport) — Issue-13 unified this with the
// lifted-overlay capture cap into one "how tall can a popout be" policy (was a
// separate local 0.4 here). Tracked here so user resizes after the initial fit
// aren't overwritten when the float closes and reopens.
const autoFittedKeys = new Set<string>();
const TEXT_FLOAT_HEADER_H = 24;
const TEXT_FLOAT_BORDERS = 2;

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
    // Textobject lift popouts spawn at the source's authoritative full-content
    // height (captured at threshold-cross), so they skip this auto-fit "grow
    // burst" — it was built for default-size spawns and would over-grow them
    // (the float editor's editable area includes ~43px of trailing cursor space
    // below the content node that inflates body.scrollHeight beyond the real
    // content). Every textobject float lifts (L4a retired the per-kind
    // staging), so the gate is simply "is this a textobject key." The burst now
    // only ever runs for NON-textobject floats — which carry no
    // `.par-float-body`, so in practice it's inert there too.
    const parsed = parseTextObjectPopoutKey(cardKey);
    if (parsed) {
      return; // textobject float: honor the authoritative spawn height; no auto-fit
    }
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
        const target = capPopoutHeight(natural, window.innerHeight);
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
