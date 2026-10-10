"use client";

/**
 * The drag-outline family — the dock-target outline (a float being dragged
 * over a dock slot) and the card-lift flash (a card lifted off into a float).
 * Mounted ONCE, at app level (`src/app/page.tsx`, beside `DropModeOverlays`),
 * never per pane (task 1035).
 *
 * Both render from APP-GLOBAL module singletons (`useDockDragTarget`,
 * `useCardLiftTarget`) and portal to `document.body`. They used to be mounted
 * by every `EditorPane` — keep-alive capacity 3, the Library Reader's panes on
 * top — and a body portal escapes a hidden slot's `display:none`, so one drag
 * painted N identical outlines at the same rect, multiplying the translucent
 * accent glow. Same shape as the Stack chrome (task 589) and the drop overlays
 * (task 1027); `drag-outlines-single-mount.test.tsx` holds the count.
 *
 * The two were byte-twins differing only in timing, stacking and a data
 * attribute, so they are ONE primitive (`DragOutline`) with two configs —
 * one definition of the outline chrome, one fade rule.
 *
 * The fade rule: the outline fades on its APPEAR/DISAPPEAR edges only. A
 * target change mid-drag (hovering from one dock slot to the next) moves the
 * outline and SNAPS — it must not replay the 0→1 fade, which read as flicker
 * as a float crossed band gaps.
 *
 * Animation is driven by the Web Animations API on a ref instead of React-
 * state-driven CSS transitions — the latter raced React's batched commits in
 * dev (and Strict Mode's effect double-invoke canceled the priming rAF). WAAPI
 * runs the animation directly on the live element regardless of scheduling.
 */

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { DOCK_OUTLINE_Z, LIFT_OUTLINE_Z } from "@/floats/float-policy";
import { useDockDragTarget } from "@/components/editor-layout/dock-drag";
import { useCardLiftTarget } from "@/components/card-lift";

/** Shared drag-outline chrome, tokenized in globals.css ("Drag glow/ring
 *  layers"). Both outlines read these — one definition, so they can't drift. */
const OUTLINE_BORDER = "var(--drag-outline-border)";
const OUTLINE_GLOW = "var(--drag-glow-outline)";

interface OutlineRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

interface DragOutlineProps {
  /** The live target (null = no outline). Only its `rect` is read. */
  target: { rect: OutlineRect } | null;
  fadeInMs: number;
  fadeOutMs: number;
  zIndex: number;
  /** The data attribute naming this outline in the DOM. */
  marker: "data-dock-outline" | "data-card-lift-outline";
}

/**
 * One body-portaled outline at fixed viewport coordinates (the rect captured
 * by the gesture), so it stays put even after the source slot's DOM changes
 * shape or unmounts.
 */
export function DragOutline({
  target,
  fadeInMs,
  fadeOutMs,
  zIndex,
  marker,
}: DragOutlineProps) {
  const ref = useRef<HTMLDivElement>(null);
  // `lingering` keeps the last rect rendered through the fade-out window
  // after `target` clears, so WAAPI has something to animate.
  const [lingering, setLingering] = useState<{ rect: OutlineRect } | null>(target);
  const fadeOutTimer = useRef<number | null>(null);
  // The presence the element last animated TO. Only a flip of this fades.
  const shownRef = useRef(false);

  useEffect(() => {
    if (target) {
      if (fadeOutTimer.current) {
        clearTimeout(fadeOutTimer.current);
        fadeOutTimer.current = null;
      }
      setLingering(target);
      return;
    }
    if (!lingering) return;
    fadeOutTimer.current = window.setTimeout(() => {
      setLingering(null);
      fadeOutTimer.current = null;
    }, fadeOutMs);
    return () => {
      if (fadeOutTimer.current) {
        clearTimeout(fadeOutTimer.current);
        fadeOutTimer.current = null;
      }
    };
  }, [target, lingering, fadeOutMs]);

  // Synchronous after commit, before paint — the fade starts without a rAF
  // prime. Animates ONLY on a presence edge; a non-null → non-null target
  // change just re-renders the rect (snap).
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) {
      shownRef.current = false;
      return;
    }
    const shown = target !== null;
    if (shown === shownRef.current) return;
    shownRef.current = shown;
    el.getAnimations().forEach((a) => a.cancel());
    el.animate(
      shown ? [{ opacity: 0 }, { opacity: 1 }] : [{ opacity: 1 }, { opacity: 0 }],
      { duration: shown ? fadeInMs : fadeOutMs, easing: "ease-out", fill: "forwards" },
    );
  }, [target, lingering, fadeInMs, fadeOutMs]);

  // Live target first — the rect follows the gesture on the same commit;
  // `lingering` only covers the fade-out.
  const shown = target ?? lingering;
  if (!shown || typeof document === "undefined") return null;
  return createPortal(
    <div
      ref={ref}
      aria-hidden="true"
      {...{ [marker]: "" }}
      style={{
        position: "fixed",
        inset: 0,
        pointerEvents: "none",
        zIndex,
        // Initial opacity 0; WAAPI animates it to 1.
        opacity: 0,
      }}
    >
      <div
        aria-hidden="true"
        style={{
          position: "absolute",
          left: shown.rect.left,
          top: shown.rect.top,
          width: shown.rect.width,
          height: shown.rect.height,
          // Thin clear outline with a static glow, both in the live
          // --drag-highlight accent (user-retintable).
          border: OUTLINE_BORDER,
          borderRadius: "var(--pod-radius)",
          background: "transparent",
          boxShadow: OUTLINE_GLOW,
        }}
      />
    </div>,
    document.body,
  );
}

/** Dock-target outline: a quick symmetric fade. Sits at DOCK_OUTLINE_Z, just
 *  below the floating-panel layer, so the dragged panel occludes it. */
function DockOutline() {
  return (
    <DragOutline
      target={useDockDragTarget()}
      fadeInMs={120}
      fadeOutMs={120}
      zIndex={DOCK_OUTLINE_Z}
      marker="data-dock-outline"
    />
  );
}

/** Card-lift flash: a snappy fade-in so the lift registers, then a slow fade-
 *  out that visibly trails the drag. Sits below the float layer so the spawned
 *  float occludes the source-card outline. Cards never dock, so this is a
 *  one-shot affordance with no slot-to-slot motion. */
function CardLiftOutline() {
  return (
    <DragOutline
      target={useCardLiftTarget()}
      fadeInMs={90}
      fadeOutMs={360}
      zIndex={LIFT_OUTLINE_Z}
      marker="data-card-lift-outline"
    />
  );
}

export function DragOutlines() {
  return (
    <>
      <DockOutline />
      <CardLiftOutline />
    </>
  );
}
