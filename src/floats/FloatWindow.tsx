"use client";

import { useLayoutEffect, useRef, useState } from "react";
import FloatingPanel, {
  type FloatingPanelHandle,
} from "@/components/FloatingPanel";
import { usePoppedCards } from "@/hooks/usePoppedCards";
import { consumeCardLiftHandoff } from "@/components/card-lift";
import {
  FLOAT_DEFAULT_SIZE,
  FLOAT_SPAWN_FIT_MARGIN,
  FLOAT_Z_BASE,
  capPopoutHeight,
} from "./float-policy";
import { FloatChrome } from "./FloatChrome";
import type { Floatable } from "./types";

/**
 * Height (px) currently clipped away inside `root`'s subtree — the sum of
 * `scrollHeight − clientHeight` over the clip containers (overflow ≠
 * visible). In the float's nested flex column every level either clips
 * (overflow-hidden/auto) or sits at natural height inside a clipping
 * parent, so `current float height + deficit` IS the float's natural
 * content height: each box's visible part is counted once by its parent
 * and its hidden remainder once by its own deficit. Overflow-visible
 * elements are skipped — their overflow already rides up into the
 * nearest clipping ancestor's scrollHeight (counting both would double).
 * One-shot O(subtree) walk; runs only on a collapsed-card lift.
 */
function collectClippedHeight(root: HTMLElement): number {
  let sum = Math.max(0, root.scrollHeight - root.clientHeight);
  for (const el of Array.from(root.querySelectorAll<HTMLElement>("*"))) {
    const deficit = el.scrollHeight - el.clientHeight;
    if (deficit <= 0) continue;
    if (getComputedStyle(el).overflowY === "visible") continue;
    sum += deficit;
  }
  return sum;
}

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
  // The body-side wrapper (`data-pristine-card-id`) — the measure root for
  // the collapsed-lift grow. In the bareWindow branch it's display:contents
  // (zero box), which still enumerates children and resolves `closest()`.
  const bodyHostRef = useRef<HTMLDivElement>(null);
  const key = windowKey;

  // Drag handoff: when this float was just spawned by a lift-off gesture, the
  // user's mouse is still down — pick up that drag here so it continues
  // seamlessly until release. Run once on mount only. A layout effect (not a
  // passive one) so the collapsed-lift grow below lands before first paint.
  useLayoutEffect(() => {
    const handoff = consumeCardLiftHandoff(key);
    if (!handoff) return;
    if (handoff.expandToContent) {
      // Collapsed-card lift (#20): the float spawned at the docked card's
      // collapsed, header-only rect; grow it to content height, capped by
      // the shared popout policy. ONE-SHOT, two ticks, then dead — no
      // ResizeObserver, no editor subscription (keystroke sanctity):
      //   1. pre-paint (here): measure + grow + clamp Y so the bottom
      //      stays on screen — invisible, the first paint is already
      //      grown. Catches plain-DOM bodies fully.
      //   2. one double-RAF correction: RichTextField mounts TipTap with
      //      `immediatelyRender: false`, so rich bodies enter the DOM a
      //      tick after mount; re-measure once and grow (never shrink,
      //      height only — the handed-off drag may be live, so Y stays
      //      under the cursor's control).
      const panelEl = bodyHostRef.current?.closest<HTMLElement>(
        '[data-floating-panel="true"]',
      );
      const grow = (allowYClamp: boolean) => {
        const host = bodyHostRef.current;
        if (!panelEl || !host || !panelEl.isConnected) return;
        const current = panelEl.getBoundingClientRect();
        const natural = current.height + collectClippedHeight(host);
        const target = capPopoutHeight(natural, window.innerHeight);
        if (target <= current.height + 1) return;
        const rect: Parameters<FloatingPanelHandle["setRect"]>[0] = {
          height: target,
        };
        if (allowYClamp) {
          rect.y = Math.max(
            FLOAT_SPAWN_FIT_MARGIN,
            Math.min(
              current.top,
              window.innerHeight - FLOAT_SPAWN_FIT_MARGIN - target,
            ),
          );
        }
        panelHandleRef.current?.setRect(rect);
      };
      grow(true);
      // Not cancelled on cleanup: Strict Mode's mount→cleanup→mount would
      // abort the one correction (the consumed handoff can't re-arm it);
      // `isConnected` inside grow() guards real unmounts. Mirrors the
      // retired autoFitBody burst's Strict-Mode note (commit 1f39ad4).
      requestAnimationFrame(() => {
        requestAnimationFrame(() => grow(false));
      });
    }
    panelHandleRef.current?.beginDragAt(handoff.clientX, handoff.clientY);
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
        <div
          ref={bodyHostRef}
          data-pristine-card-id={floatable.id}
          style={{ display: "contents" }}
        >
          {body}
        </div>
      ) : (
        <div
          ref={bodyHostRef}
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
