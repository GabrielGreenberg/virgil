"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useCardLiftTarget, type CardLiftTarget } from "./card-lift";

/** Snappy fade-in so the highlight registers immediately on lift-off. */
const FADE_IN_MS = 90;
/** Slow fade-out so the highlight visibly trails the user's drag. */
const FADE_OUT_MS = 360;

// Shared drag-outline chrome, tokenized in globals.css ("Drag glow/ring
// layers"). Both the border and the halo derive from --drag-highlight, which
// is a user preference — DockOutline reads the same two tokens, so the pair
// can't drift apart the way the old byte-identical rgba() copies did.
const OUTLINE_BORDER = "var(--drag-outline-border)";
const OUTLINE_GLOW = "var(--drag-glow-outline)";

/**
 * Body-portaled outline that flashes around a card when the user
 * initiates a lift-off drag. The border fades in fast, then fades out
 * slowly while the user is still dragging the spawned float. Cards
 * never dock anywhere, so unlike `DockOutline` this is a one-shot
 * "you've lifted off" affordance with no companion / proximity logic.
 */
export function CardLiftOutline() {
  const target = useCardLiftTarget();
  const ref = useRef<HTMLDivElement>(null);
  // displayed keeps the element rendered through the fade-out window
  // so WAAPI has something to animate after `target` clears.
  const [displayed, setDisplayed] = useState<CardLiftTarget | null>(target);
  const fadeOutTimer = useRef<number | null>(null);

  useEffect(() => {
    if (target) {
      if (fadeOutTimer.current) {
        clearTimeout(fadeOutTimer.current);
        fadeOutTimer.current = null;
      }
      setDisplayed(target);
      return;
    }
    if (!displayed) return;
    fadeOutTimer.current = window.setTimeout(() => {
      setDisplayed(null);
      fadeOutTimer.current = null;
    }, FADE_OUT_MS);
    return () => {
      if (fadeOutTimer.current) {
        clearTimeout(fadeOutTimer.current);
        fadeOutTimer.current = null;
      }
    };
  }, [target, displayed]);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.getAnimations().forEach((a) => a.cancel());
    if (target) {
      el.animate(
        [{ opacity: 0 }, { opacity: 1 }],
        { duration: FADE_IN_MS, easing: "ease-out", fill: "forwards" },
      );
    } else if (displayed) {
      el.animate(
        [{ opacity: 1 }, { opacity: 0 }],
        { duration: FADE_OUT_MS, easing: "ease-out", fill: "forwards" },
      );
    }
  }, [target, displayed]);

  if (!displayed || typeof document === "undefined") return null;
  return createPortal(
    <div
      ref={ref}
      aria-hidden="true"
      data-card-lift-outline
      style={{
        position: "fixed",
        inset: 0,
        pointerEvents: "none",
        // Sit below the floating cards (which use zIndex 1200+) so the
        // spawned float occludes the source-card outline as it lifts off.
        zIndex: 1100,
        opacity: 0,
      }}
    >
      <div
        aria-hidden="true"
        style={{
          position: "absolute",
          left: displayed.rect.left,
          top: displayed.rect.top,
          width: displayed.rect.width,
          height: displayed.rect.height,
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
