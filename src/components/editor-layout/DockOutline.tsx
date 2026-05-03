"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useDockDragTarget, type DockDragTarget } from "./dock-drag";

/** Quick fade — snappy, but readable as a transition. */
const FADE_MS = 120;

/** Outline color: thin clear blue with a static blue glow. */
const OUTLINE_BORDER = "1.5px solid var(--drag-highlight, #3b82f6)";
const OUTLINE_GLOW =
  "0 0 10px rgba(59, 130, 246, 0.45), 0 0 2px rgba(59, 130, 246, 0.7)";

/**
 * Body-portaled hard-black outline that marks the active dock target
 * during a drag. Body-portaling lets the outline:
 *   - Render at fixed viewport coordinates (the rect captured at
 *     mousedown), so it stays put even after the panel undocks and
 *     the underlying slot DOM changes shape or unmounts.
 *   - Sit above any floating panel shells (z-index 9999 vs the shell's
 *     ~1000-range), so floating pop-outs never occlude it.
 *
 * The outline crossfades in when a target appears and out when it
 * clears. Position changes mid-drag (hovering from one slot to
 * another) snap; only appearance/disappearance fade.
 *
 * Animation is driven by the Web Animations API on a ref instead of
 * React-state-driven CSS transitions — the latter raced React's
 * batched commits in dev (and Strict Mode's effect double-invoke
 * canceled the priming rAF). WAAPI runs the animation directly on
 * the live element regardless of React's scheduling.
 */
export function DockOutline() {
  const target = useDockDragTarget();
  const ref = useRef<HTMLDivElement>(null);
  // displayedTarget keeps the element rendered through the fade-out
  // transition after `target` flips to null.
  const [displayed, setDisplayed] = useState<DockDragTarget | null>(target);
  const fadeOutTimer = useRef<number | null>(null);

  // Manage the displayed element's mount lifecycle: keep it mounted
  // through the fade-out window so WAAPI has something to animate.
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
    }, FADE_MS);
    return () => {
      if (fadeOutTimer.current) {
        clearTimeout(fadeOutTimer.current);
        fadeOutTimer.current = null;
      }
    };
  }, [target, displayed]);

  // Drive the opacity animation directly on the DOM element. Runs in
  // useLayoutEffect (synchronous after commit, before paint) so the
  // animation kicks off immediately without relying on a rAF prime.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.getAnimations().forEach((a) => a.cancel());
    if (target) {
      el.animate(
        [{ opacity: 0 }, { opacity: 1 }],
        { duration: FADE_MS, easing: "ease-out", fill: "forwards" },
      );
    } else if (displayed) {
      el.animate(
        [{ opacity: 1 }, { opacity: 0 }],
        { duration: FADE_MS, easing: "ease-out", fill: "forwards" },
      );
    }
  }, [target, displayed]);

  if (!displayed || typeof document === "undefined") return null;
  return createPortal(
    <div
      ref={ref}
      aria-hidden="true"
      data-dock-outline
      style={{
        position: "fixed",
        left: displayed.rect.left,
        top: displayed.rect.top,
        width: displayed.rect.width,
        height: displayed.rect.height,
        // Thin clear-blue outline with a static blue glow. The 1.5px
        // border keeps it visually crisp without weighing the panel
        // down; the layered box-shadow gives a soft outer halo plus a
        // tighter inner highlight, both blue, both static.
        border: OUTLINE_BORDER,
        borderRadius: "var(--pod-radius)",
        pointerEvents: "none",
        zIndex: 9999,
        background: "transparent",
        boxShadow: OUTLINE_GLOW,
        // Initial opacity 0; WAAPI animates it to 1.
        opacity: 0,
      }}
    />,
    document.body,
  );
}
