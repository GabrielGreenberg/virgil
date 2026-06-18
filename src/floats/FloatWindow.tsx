"use client";

import { useLayoutEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
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
  collectClippedHeight,
} from "./float-policy";
import { FloatChrome } from "./FloatChrome";
import { useLiftHost } from "@/text-objects/LiftHost";
import type { TextObjectKind } from "@/text-objects/types";
import type { Floatable } from "./types";

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
  // Chip 2: the shared lifted-overlay ghost host. Called UNCONDITIONALLY
  // (hooks must be — `useLiftHost` is `useContext`, returns null when no
  // `LiftHost` is mounted, e.g. an isolated test/Reader). Only consumed below
  // for the text-object drop button; card floats never touch it.
  const liftHost = useLiftHost();
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
      const grow = (allowYClamp: boolean) => {
        const host = bodyHostRef.current;
        // Re-query the panel element on EVERY invocation - never capture it
        // in the closure. FloatingPanel only portals its DOM once its target
        // state resolves; a one-time lookup here null-captures forever and
        // silently kills both the pre-paint grow and the RAF correction
        // (the review-gate regression this guards against).
        const panelEl = host?.closest<HTMLElement>(
          '[data-floating-panel="true"]',
        );
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

  // Domain dispatch for the (re)anchor drop button (Chip 2). FloatChrome is
  // domain-blind: it calls `onDropPress` when supplied, else falls back to its
  // own `beginCardDropGesture(dropCardKey)`.
  //   - textobject → drive the shared lifted-overlay ghost via
  //     `LiftHost.beginLift({terminalPolicy:"float", …})`. If no `LiftHost` is
  //     mounted (`liftHost === null` — defensive; in practice always present),
  //     leave `onDropPress` undefined so FloatChrome falls back to
  //     `beginCardDropGesture`. That fallback is no-ghost and skips the
  //     linkedRange `removeTransientAnchor` cleanup — an accepted asymmetry
  //     because the null-host path is UNREACHABLE in the full editor: EditorPane
  //     wraps FloatHost (→ this FloatWindow) inside `<LiftHost>`, so
  //     `useLiftHost()` here always resolves non-null.
  //   - card → leave `onDropPress` undefined so FloatChrome takes its existing
  //     `beginCardDropGesture` path (zero card-behavior change). Cards are NOT
  //     routed through `beginLift`.
  const onDropPress =
    floatable.domain === "textobject" && liftHost
      ? (e: ReactMouseEvent) => {
          liftHost.beginLift({
            terminalPolicy: "float",
            // `floatable.kind` is `string` on the contract (CardKind |
            // TextObjectKind); in the textobject branch it is a
            // `TextObjectKind` by construction (`textObjectFloatable` builds it
            // from `ref.kind`). Narrow it for `beginLift`'s `TextObjectRef`.
            ref: { kind: floatable.kind as TextObjectKind, id: floatable.id },
            cardKey: floatable.key,
            origin: { x: e.clientX, y: e.clientY },
          });
        }
      : undefined;

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
      accentTint={floatable.accentTint}
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
            headerTint={floatable.headerTint}
            canJump={floatable.canJump}
            onJump={floatable.jumpToSource}
            // (Re)anchor drop button: gated on the Floatable's static
            // `canDrop` facet (cards derive it from `CARD_REGISTRY[*].droppable`
            // in `cardFloatable`; text-objects omit it). The button hands
            // `floatable.key` — the canonical `float:card:<kind>:<id>` string —
            // to `beginCardDropGesture`, so the drop controller resolves the
            // spec WITHOUT FloatChrome importing any card code.
            canDrop={floatable.canDrop}
            dropCardKey={floatable.key}
            // Domain dispatch (Chip 2): supplied for textobject floats (drives
            // the lifted-overlay ghost via LiftHost); undefined for card floats
            // and when no LiftHost is mounted → FloatChrome falls back to its
            // own `beginCardDropGesture(dropCardKey)`.
            onDropPress={onDropPress}
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
