"use client";

/**
 * Paragraph Back/Forward history — the ONE recorder behind the MenuBar's
 * paragraph-nav arrows, for the main editor (`EditorLayout`) and the Library
 * Reader (`reader-view-prefs.ts`) alike.
 *
 * The two used to be separate copies (the Reader's a "functional port" of
 * EditorLayout's inline recorder), and both carried the same defect (task
 * 1451): each press armed a bare `setTimeout` to clear the 1.5 s "navigating"
 * latch, and nothing held the handle. A second press inside the window was
 * unlatched early by the FIRST press's timer, so the recorder could read a
 * mid-scroll block, push it, and truncate Forward; and the timers outlived a
 * document switch / unmount. Now:
 *
 * - the latch is ONE owned slot on the component's `ViewLifetime` — each press
 *   clears the previous timer before arming, so the latch always ends
 *   `NAV_LATCH_MS` after the LAST press;
 * - a `resetKey` change (the document switch) clears history AND the latch;
 * - unmount disposes every timer (law: "A NodeView owns its timers' lifetime",
 *   React half).
 *
 * Keystroke-safe by construction: a WALL-CLOCK service (a 2 s interval + a
 * debounced passive `scroll` listener) that reads the active paragraph on its
 * own cadence, never an `editor.on(...)` subscriber — typing leaves
 * `__virgilBusStats().emitCount` flat. Per tick: O(1) plus one
 * `getActiveParagraphId` read; the stack is capped at 100.
 *
 * Model: the stack always includes the current position and `idx` points at
 * it. Back: idx--, Forward: idx++, a new position: truncate-forward + push.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { isLayoutGestureActive } from "@/lib/pane-resize";
import type { ViewTimer } from "@/lib/tiptap/view-lifetime";
import { useViewLifetime } from "@/hooks/useViewLifetime";

/** How long a Back/Forward press holds the recorder off while its scroll settles. */
export const NAV_LATCH_MS = 1500;
const POLL_MS = 2000;
const DEBOUNCE_MS = 1000;
const STACK_CAP = 100;

/** The four paragraph-nav values the MenuBar bundle needs. */
export interface ParaNavBundle {
  paraNavBack: () => void;
  paraNavForward: () => void;
  paraNavBackDisabled: boolean;
  paraNavForwardDisabled: boolean;
}

/**
 * What the recorder reads and drives. Held in a latest-ref, so a caller may
 * pass a fresh object each render: every read sees the LIVE source (task
 * 1451 — the editor's recorder used to close over a stale collab).
 */
export interface ParaNavSource {
  /** The paragraph at the reading position now, or null (hidden pane, no doc). */
  getActiveParagraphId(): string | null;
  /** Bring `uuid` (or the `__DOC_TOP__` sentinel) into view. */
  scrollToParagraph(uuid: string): void;
  /** Called once per newly recorded paragraph (collab cursor presence). */
  onParagraph?(uuid: string): void;
}

export interface ParaNavOptions {
  /** False → no recorder runs (no editor and no code view yet). */
  active: boolean;
  /** The scroll container whose scrolls trigger a (debounced) read; null → poll only. */
  scrollEl: HTMLElement | null;
  /** A change (the document switch) clears history and the latch. */
  resetKey?: unknown;
}

export function useParaNavHistory(
  source: ParaNavSource,
  { active, scrollEl, resetKey }: ParaNavOptions,
): ParaNavBundle {
  // Declared FIRST so its disposal precedes the effects below (useViewLifetime).
  const lifetime = useViewLifetime();
  const sourceRef = useRef(source);
  useEffect(() => {
    sourceRef.current = source;
  });

  const historyRef = useRef<{ stack: string[]; idx: number }>({ stack: [], idx: -1 });
  const currentParaRef = useRef<string | null>(null);
  const navigatingRef = useRef(false);
  const latchRef = useRef<ViewTimer | null>(null);

  // Disabled flags as STATE (not a ref read during render — react-hooks/refs).
  const [paraNavBackDisabled, setBackDisabled] = useState(true);
  const [paraNavForwardDisabled, setForwardDisabled] = useState(true);
  const syncDisabled = useCallback(() => {
    const h = historyRef.current;
    setBackDisabled(h.idx <= 0);
    setForwardDisabled(h.idx >= h.stack.length - 1);
  }, []);

  const endLatch = useCallback(() => {
    lifetime.clear(latchRef.current);
    latchRef.current = null;
    navigatingRef.current = false;
  }, [lifetime]);

  // Recorder: poll the active paragraph on a wall clock + on scroll.
  useEffect(() => {
    if (!active) return;
    let debounce: ViewTimer | null = null;

    const checkParagraph = () => {
      if (navigatingRef.current) return;
      // Wave-2b C6: a bare wall-clock poll — gate on page visibility and on
      // layout gestures (mid-drag geometry is in flux). Hidden keep-alive
      // PANES bail inside getActiveParagraphId itself.
      if (typeof document !== "undefined" && document.hidden) return;
      if (isLayoutGestureActive()) return;
      const paraId = sourceRef.current.getActiveParagraphId();
      if (!paraId || paraId === currentParaRef.current) return;
      currentParaRef.current = paraId;
      sourceRef.current.onParagraph?.(paraId);
      const h = historyRef.current;
      h.stack = h.stack.slice(0, h.idx + 1);
      h.stack.push(paraId);
      if (h.stack.length > STACK_CAP) h.stack.shift();
      h.idx = h.stack.length - 1;
      syncDisabled();
    };

    const debouncedCheck = () => {
      lifetime.clear(debounce);
      debounce = lifetime.setTimeout(checkParagraph, DEBOUNCE_MS);
    };

    scrollEl?.addEventListener("scroll", debouncedCheck, { passive: true });
    const interval = lifetime.setInterval(debouncedCheck, POLL_MS);
    return () => {
      scrollEl?.removeEventListener("scroll", debouncedCheck);
      lifetime.clear(interval);
      lifetime.clear(debounce);
    };
  }, [active, scrollEl, lifetime, syncDisabled]);

  // The document switch: history and any in-flight latch belong to the old doc.
  useEffect(() => {
    historyRef.current = { stack: [], idx: -1 };
    currentParaRef.current = null;
    endLatch();
    syncDisabled();
  }, [resetKey, endLatch, syncDisabled]);

  const navigate = useCallback(
    (delta: -1 | 1) => {
      const h = historyRef.current;
      const next = h.idx + delta;
      if (next < 0 || next > h.stack.length - 1) return;
      h.idx = next;
      const targetId = h.stack[next];
      // ONE latch slot: a second press re-arms it rather than leaving the
      // first press's timer to unlatch mid-scroll.
      lifetime.clear(latchRef.current);
      navigatingRef.current = true;
      latchRef.current = lifetime.setTimeout(() => {
        latchRef.current = null;
        navigatingRef.current = false;
      }, NAV_LATCH_MS);
      currentParaRef.current = targetId;
      sourceRef.current.scrollToParagraph(targetId);
      syncDisabled();
    },
    [lifetime, syncDisabled],
  );

  const paraNavBack = useCallback(() => navigate(-1), [navigate]);
  const paraNavForward = useCallback(() => navigate(1), [navigate]);

  return { paraNavBack, paraNavForward, paraNavBackDisabled, paraNavForwardDisabled };
}
