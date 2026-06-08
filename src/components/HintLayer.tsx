"use client";

/**
 * HintLayer — the single, app-wide controller + renderer for hover/focus
 * hints. Mounted ONCE near the root (see `src/app/page.tsx`). It is the
 * production replacement for native `title=""` tooltips and the engine
 * behind Helper Mode.
 *
 * How it works:
 *  - ONE set of delegated, capture-phase listeners on `document` resolves
 *    the hinted element under the pointer / focus via
 *    `closest('[data-hint],[data-helper]')`. No per-element listeners.
 *  - A shared open delay (default {@link OPEN_DELAY_MS}) gives the Notion-
 *    style "hover a beat, then it appears" feel. When Helper Mode is on
 *    (`body[data-helper-mode="on"]`) the delay is 0 — the instant
 *    educational callout. Keyboard focus shows instantly too (but only for
 *    `:focus-visible`, so a mouse click doesn't flash a tooltip).
 *  - ONE portal bubble is positioned with {@link useFloatingMenuPosition}
 *    (flip + viewport clamp), placement derived from `data-hint-pos` and the
 *    nearest `[data-strip-side]` ancestor.
 *  - Dismissed on Escape, scroll, pointerdown, pointer-leave, or focus-out.
 *
 * Attribute protocol (see `Hint.tsx`): `data-hint` (text), `data-hint-keys`
 * (portable shortcut, rendered by {@link Kbd}), `data-hint-pos`. Legacy
 * `data-helper` / `data-helper-pos` are read as aliases so the migration off
 * native `title` / Helper Mode can be incremental.
 *
 * Keystroke sanctity: the listeners are pointer/focus-driven and do O(ancestor
 * depth) work via `closest` — never document-size work, and not an
 * `editor.on` subscriber. Typing fires none of this.
 */

import { useCallback, useEffect, useRef, useState, type ReactElement } from "react";
import { createPortal } from "react-dom";
import {
  useFloatingMenuPosition,
  type FloatingMenuPlacement,
} from "@/hooks/useFloatingMenuPosition";
import { Kbd } from "./Kbd";

const OPEN_DELAY_MS = 550;
const BUBBLE_ID = "virgil-hint-bubble";

interface AnchorRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}

interface ActiveHint {
  rect: AnchorRect;
  label: string;
  keys: string | null;
  placements: FloatingMenuPlacement[];
}

function placementsFor(
  pos: string | null,
  stripSide: string | null,
): FloatingMenuPlacement[] {
  switch (pos) {
    case "above":
      return [
        { side: "above", align: "center" },
        { side: "below", align: "center" },
      ];
    case "below":
      return [
        { side: "below", align: "center" },
        { side: "above", align: "center" },
      ];
    case "left":
      return [
        { side: "left-of", align: "center" },
        { side: "right-of", align: "center" },
      ];
    case "right":
      return [
        { side: "right-of", align: "center" },
        { side: "left-of", align: "center" },
      ];
  }
  // No explicit pos: a left/right tool strip wants the callout beside it
  // (mirrors the old Helper-Mode `[data-strip-side]` variants).
  if (stripSide === "left") {
    return [
      { side: "right-of", align: "center" },
      { side: "left-of", align: "center" },
    ];
  }
  if (stripSide === "right") {
    return [
      { side: "left-of", align: "center" },
      { side: "right-of", align: "center" },
    ];
  }
  return [
    { side: "below", align: "center" },
    { side: "above", align: "center" },
  ];
}

function readHint(
  el: Element,
): { label: string; keys: string | null; placements: FloatingMenuPlacement[] } | null {
  const label = el.getAttribute("data-hint") ?? el.getAttribute("data-helper");
  const keys = el.getAttribute("data-hint-keys");
  if (!label && !keys) return null; // need at least a label or a shortcut
  const pos = el.getAttribute("data-hint-pos") ?? el.getAttribute("data-helper-pos");
  const stripSide =
    el.closest("[data-strip-side]")?.getAttribute("data-strip-side") ?? null;
  return { label: label ?? "", keys, placements: placementsFor(pos, stripSide) };
}

function closestHinted(node: EventTarget | null): HTMLElement | null {
  if (!(node instanceof Element)) return null;
  const el = node.closest("[data-hint],[data-hint-keys],[data-helper]");
  return el instanceof HTMLElement ? el : null;
}

export function HintLayer(): ReactElement | null {
  const [active, setActive] = useState<ActiveHint | null>(null);
  const candidateRef = useRef<HTMLElement | null>(null);
  const timerRef = useRef<number | null>(null);
  const describedElRef = useRef<HTMLElement | null>(null);

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const releaseAria = useCallback(() => {
    const prev = describedElRef.current;
    if (prev && prev.getAttribute("aria-describedby") === BUBBLE_ID) {
      prev.removeAttribute("aria-describedby");
    }
    describedElRef.current = null;
  }, []);

  const hide = useCallback(() => {
    clearTimer();
    candidateRef.current = null;
    releaseAria();
    setActive((a) => (a ? null : a));
  }, [clearTimer, releaseAria]);

  const show = useCallback(
    (el: HTMLElement) => {
      const data = readHint(el);
      if (!data) return;
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) return; // detached / collapsed
      // Don't clobber an element's own aria-describedby; only attach ours
      // when there's nothing there to lose.
      releaseAria();
      if (!el.hasAttribute("aria-describedby")) {
        el.setAttribute("aria-describedby", BUBBLE_ID);
        describedElRef.current = el;
      }
      setActive({
        rect: {
          left: r.left,
          top: r.top,
          right: r.right,
          bottom: r.bottom,
          width: r.width,
          height: r.height,
        },
        label: data.label,
        keys: data.keys,
        placements: data.placements,
      });
    },
    [releaseAria],
  );

  const schedule = useCallback(
    (el: HTMLElement) => {
      clearTimer();
      const instant =
        typeof document !== "undefined" &&
        document.body.getAttribute("data-helper-mode") === "on";
      if (instant) {
        show(el);
        return;
      }
      timerRef.current = window.setTimeout(() => {
        timerRef.current = null;
        // Re-confirm the pointer is still on this element before showing.
        if (candidateRef.current === el) show(el);
      }, OPEN_DELAY_MS);
    },
    [clearTimer, show],
  );

  useEffect(() => {
    const onOver = (e: PointerEvent) => {
      const el = closestHinted(e.target);
      if (!el) return;
      if (el === candidateRef.current) return; // already pending/shown
      candidateRef.current = el;
      schedule(el);
    };
    const onOut = (e: PointerEvent) => {
      const cand = candidateRef.current;
      if (!cand) return;
      const related = e.relatedTarget as Node | null;
      if (related && cand.contains(related)) return; // moved within the element
      hide();
    };
    const onFocusIn = (e: FocusEvent) => {
      const el = closestHinted(e.target);
      if (!el) return;
      // Only for keyboard focus, so a mouse click doesn't flash a tooltip.
      try {
        if (!el.matches(":focus-visible")) return;
      } catch {
        /* older engines: fall through and show */
      }
      candidateRef.current = el;
      show(el);
    };
    const onFocusOut = () => hide();
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") hide();
    };
    const onScroll = () => hide();
    const onPointerDown = () => hide();

    document.addEventListener("pointerover", onOver, true);
    document.addEventListener("pointerout", onOut, true);
    document.addEventListener("focusin", onFocusIn, true);
    document.addEventListener("focusout", onFocusOut, true);
    document.addEventListener("keydown", onKeyDown, true);
    document.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      document.removeEventListener("pointerover", onOver, true);
      document.removeEventListener("pointerout", onOut, true);
      document.removeEventListener("focusin", onFocusIn, true);
      document.removeEventListener("focusout", onFocusOut, true);
      document.removeEventListener("keydown", onKeyDown, true);
      document.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("scroll", onScroll, true);
      clearTimer();
    };
  }, [schedule, show, hide, clearTimer]);

  // Release the aria link if we unmount mid-show.
  useEffect(() => releaseAria, [releaseAria]);

  if (!active) return null;
  if (typeof document === "undefined") return null;
  return <HintBubble {...active} />;
}

function HintBubble({ rect, label, keys, placements }: ActiveHint) {
  const { ref, style } = useFloatingMenuPosition({
    anchorRect: rect,
    placements,
    gap: 6,
  });
  return createPortal(
    <div ref={ref} id={BUBBLE_ID} role="tooltip" className="hint-bubble" style={style}>
      {label ? <span className="hint-bubble__label">{label}</span> : null}
      {keys ? <Kbd keys={keys} /> : null}
    </div>,
    document.body,
  );
}
