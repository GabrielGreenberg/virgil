"use client";

import { useEffect } from "react";

/**
 * Global auto-hide scrollbars: tag each scrolled element with
 * `data-scroll-active` while it (or shortly after it) is being scrolled.
 * CSS in `globals.css` keys off this attribute to reveal the native
 * `::-webkit-scrollbar-thumb` (and Firefox `scrollbar-color`).
 *
 * One capture-phase listener catches scrolls on any descendant element.
 * Per-element idle timers via WeakMap, so detached containers are
 * garbage-collected without leak.
 *
 * **Deliberately LIVE through a layout gesture** (the one census exemption a
 * scroll follower can earn honestly): the visible thumb IS the feedback for
 * the scroll, so parking it would blank the scrollbar for the whole of a
 * drag's auto-scroll — which is exactly when the user most wants to see where
 * in the document they are. What it does NOT get to be is per-event WORK:
 * `setAttribute` marks the element's style dirty even when the value is
 * unchanged, so the write is now idempotence-gated (task 416) and a
 * continuous scroll costs ONE invalidation plus a timer reset per event. It
 * measures nothing and renders nothing.
 */
const IDLE_MS = 1000;

export function useScrollActivityTracker() {
  useEffect(() => {
    const timers = new WeakMap<Element, number>();
    const onScroll = (e: Event) => {
      const t = e.target;
      const el =
        t === document
          ? document.documentElement
          : t instanceof Element
            ? t
            : null;
      if (!el) return;
      // Idempotent: re-setting an attribute to the value it already has still
      // invalidates the element's style in Blink, and a continuous scroll
      // (a drag's auto-scroll above all) fires this every frame.
      if (!el.hasAttribute("data-scroll-active"))
        el.setAttribute("data-scroll-active", "");
      const prev = timers.get(el);
      if (prev !== undefined) window.clearTimeout(prev);
      const id = window.setTimeout(() => {
        el.removeAttribute("data-scroll-active");
        timers.delete(el);
      }, IDLE_MS);
      timers.set(el, id);
    };
    document.addEventListener("scroll", onScroll, {
      capture: true,
      passive: true,
    });
    return () => {
      document.removeEventListener("scroll", onScroll, { capture: true });
    };
  }, []);
}
