"use client";

import { useEffect, useRef, useState } from "react";
import FloatingPanel, {
  type FloatingPanelHandle,
} from "@/components/FloatingPanel";
import { usePoppedCards } from "@/hooks/usePoppedCards";
import { consumeCardLiftHandoff } from "@/components/card-lift";
import { capPopoutHeight, FLOAT_DEFAULT_SIZE, FLOAT_Z_BASE } from "./float-policy";
import { FloatChrome } from "./FloatChrome";
import type { Floatable } from "./types";

// Text floats auto-fit their height to content on first mount per session,
// capped via the shared `capPopoutHeight` (POPOUT_MAX_VH fraction of viewport).
// Tracked here so user resizes after the initial fit aren't overwritten when
// the float closes and reopens. Only floats that opt in via
// `Floatable.autoFitBody` run the burst.
const autoFittedKeys = new Set<string>();
const TEXT_FLOAT_HEADER_H = 24;
const TEXT_FLOAT_BORDERS = 2;

/**
 * The window-layer presence shared by BOTH `Card` and `TextObject` floats.
 * Given a `Floatable`, mounts a draggable/resizable `FloatingPanel` and renders
 * the unified `FloatChrome` header above the domain `renderBody()`. Kind-blind:
 * it operates only on the `Floatable` contract (formerly `FloatCard`/`FloatingCards`).
 *
 * `FloatingPanel` portals to `document.body`, so floats stay above every layout
 * layer. A `bareWindow` floatable (today `bib`/`ai`, pending Stage-6 chrome
 * migration) renders its own header inside the body — FloatChrome is skipped.
 *
 * `windowKey` is the key under which this float is stored in
 * `prefs.poppedOutCards` / `cardFloatPositions` — the SSOT for position/close/
 * focus. It is the **dispatcher's iteration key**, NOT `floatable.key`: until
 * the Stage-4 grammar flip the stored keys are still legacy (`note:<id>` /
 * `textobject:…`) while `floatable.key` is already canonical `float:…`. Keying
 * window ops on `windowKey` keeps saved rects matched at every stage. After the
 * flip the two converge.
 */
export function FloatWindow({
  floatable,
  windowKey,
}: {
  floatable: Floatable;
  windowKey: string;
}) {
  const ctx = usePoppedCards();
  // Per-instance chrome title override (e.g. heading level → "Chapter").
  // Generalizes the text-object `setHeaderLabel`.
  const [titleOverride, setTitleOverride] = useState<string | null>(null);
  const panelHandleRef = useRef<FloatingPanelHandle>(null);
  const key = windowKey;

  // Drag handoff: when this float was just spawned by a lift-off gesture, the
  // user's mouse is still down — pick up that drag here so it continues
  // seamlessly until release. Run once on mount only.
  useEffect(() => {
    const handoff = consumeCardLiftHandoff(key);
    if (!handoff) return;
    panelHandleRef.current?.beginDragAt(handoff.clientX, handoff.clientY);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-fit opt-in floats (text) to content on first mount. Tiptap's deferred
  // mount means body.scrollHeight is wrong if measured too early, so we observe
  // the body's natural size during the first ~800ms and re-measure off the
  // panel's *current* DOM rect. Bounded by POPOUT_MAX_VH; overflow scrolls.
  useEffect(() => {
    if (!floatable.autoFitBody) return;
    if (!ctx) return;
    if (autoFittedKeys.has(key)) return;
    autoFittedKeys.add(key);
    let attempts = 0;
    let lastTarget = 0;
    let ro: ResizeObserver | null = null;
    let stopTimer: number | null = null;
    const tryFit = () => {
      const wrapper = document.querySelector(`[data-pristine-card-id="${floatable.id}"]`);
      const panel = wrapper?.closest<HTMLElement>('[data-floating-panel="true"]');
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
        const natural = body.scrollHeight + TEXT_FLOAT_HEADER_H + TEXT_FLOAT_BORDERS;
        const target = capPopoutHeight(natural, window.innerHeight);
        if (target <= currentH + 1) return;
        if (target === lastTarget) return;
        lastTarget = target;
        const maxY = window.innerHeight - target - 20;
        const adjustedY = Math.max(20, Math.min(panelRect.top, maxY));
        ctx.setFloatPosition(key, {
          x: panelRect.left,
          y: adjustedY,
          width: panelRect.width,
          height: target,
        });
      };
      measure();
      ro = new ResizeObserver(measure);
      ro.observe(body);
      stopTimer = window.setTimeout(() => ro?.disconnect(), 800);
    };
    // Don't cancel on cleanup — Strict Mode's mount→cleanup→mount would abort
    // the work, and autoFittedKeys prevents a re-schedule; measure() guards
    // against detachment.
    requestAnimationFrame(tryFit);
    return () => {
      ro?.disconnect();
      if (stopTimer) clearTimeout(stopTimer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!ctx) return null;

  const rect = ctx.getFloatPosition(key);
  const indexHint = Math.max(0, ctx.poppedKeys.indexOf(key));
  const size = floatable.defaultSize ?? { w: FLOAT_DEFAULT_SIZE.w, h: FLOAT_DEFAULT_SIZE.h };
  const vw = typeof window !== "undefined" ? window.innerWidth : 1200;
  const vh = typeof window !== "undefined" ? window.innerHeight : 800;
  const initialX = rect?.x ?? Math.max(40, vw / 2 - size.w / 2 + indexHint * 24);
  const initialY = rect?.y ?? Math.max(40, vh / 2 - size.h / 2 + indexHint * 24);
  const initialWidth = rect?.width ?? size.w;
  const initialHeight = rect?.height ?? size.h;

  const body = floatable.renderBody({ setTitle: setTitleOverride, windowKey: key });

  return (
    <FloatingPanel
      ref={panelHandleRef}
      cardKey={key}
      initialX={initialX}
      initialY={initialY}
      initialWidth={initialWidth}
      initialHeight={initialHeight}
      zIndex={ctx.floatZIndex?.(key) ?? FLOAT_Z_BASE + indexHint}
      surface={floatable.surface}
      onChange={(pos) => ctx.setFloatPosition(key, pos)}
      onFocus={() => ctx.recordFocus?.(key)}
    >
      {floatable.bareWindow ? (
        // Bib/AiRequest (Stage 6 migrates these): the body supplies its own
        // header; FloatChrome is skipped. Preserve the old wrapper so the
        // pristine-discard + auto-fit selectors still resolve.
        <div data-pristine-card-id={floatable.id} style={{ display: "contents" }}>
          {body}
        </div>
      ) : (
        <div
          data-pristine-card-id={floatable.id}
          className="h-full flex flex-col min-h-0 overflow-hidden"
        >
          <FloatChrome
            title={titleOverride ?? floatable.title}
            titleNode={floatable.chromeSlots?.title}
            trailing={floatable.chromeSlots?.trailing}
            canJump={floatable.canJump}
            onJump={floatable.jumpToSource}
            onClose={() => ctx.close(key)}
          />
          <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
            {body}
          </div>
        </div>
      )}
    </FloatingPanel>
  );
}
