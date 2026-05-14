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
