"use client";

/**
 * `useMenuDismiss` — the ONE deferred capture-phase click-outside +
 * Escape-dismissal effect that replaces the per-menu copies (design §3.2).
 *
 *   - A capture-phase `mousedown` listener installed on a `setTimeout(…, 0)`
 *     defer, so the click that OPENED the menu can't immediately self-close it.
 *   - "Inside" = `containerRef.contains(target)` OR any registered exclude
 *     element contains it (the lightning color popover, a combobox's external
 *     input, a nested provider's container). Exemptions are real refs, not
 *     `querySelector` strings.
 *   - Escape with a `stopPropagation` flag (default true for editor-anchored
 *     menus — reproduces `ActionsMenuPanel.tsx:338`) and an `onEscape?: () =>
 *     boolean` two-stage interceptor: return true to consume Escape WITHOUT
 *     closing (e.g. first clear a filter, then close on the next press).
 *
 * ── DISMISS is not CANCEL (task 687) ────────────────────────────────────────
 * This hook ends a menu through TWO doors that mean different things, and until
 * task 687 it spelled them with one prop. A click-outside is a DISMISS — the
 * user went somewhere else, and a deferred-commit surface may legitimately read
 * that as "keep what I staged". Escape is a CANCEL — the repo has already
 * settled this (task 555, "Escape MEANS cancel everywhere"), and a key the user
 * presses to abandon must never be the key that saves.
 *
 * For an ordinary menu the two coincide (nothing is staged, so there is nothing
 * to abandon), which is why `onCancel` DEFAULTS to `onClose` and every existing
 * call site is byte-identical. A surface that stages work passes both, and the
 * fork is then stated at the primitive rather than re-decided — or silently not
 * decided — by each popover. `src/panels/Citations/CitationCreatePopover.tsx`
 * is the live member; `escape-means-cancel-census.test.ts` pins the class.
 *
 * Keystroke sanctity: both listeners are mounted only while the menu is open
 * and bail O(1) on any non-Escape key / inside click. Neither touches the
 * editor transaction path.
 */

import { useEffect } from "react";
import type { RefObject } from "react";

export interface UseMenuDismissOptions {
  /** The menu container — clicks inside it never dismiss. */
  containerRef: RefObject<HTMLElement | null>;
  /** Live set of extra "inside" elements (nested popovers, external inputs).
   *  A getter so the set can grow/shrink while open without re-subscribing. */
  getExcludes?: () => readonly (HTMLElement | null)[];
  /** Called to close the menu — the DISMISS door (click-outside), and the
   *  Escape door too unless `onCancel` is supplied. */
  onClose: () => void;
  /**
   * Called instead of `onClose` when the user presses Escape — the CANCEL door.
   * Defaults to `onClose`, so a menu with nothing staged is unchanged. Supply
   * it only where dismissing and cancelling genuinely differ (a deferred-commit
   * popover that commits on click-away must still ABANDON on Escape).
   */
  onCancel?: () => void;
  /** Escape behavior. */
  escape?: {
    /** stopPropagation on the consumed Escape (default true). */
    stopPropagation?: boolean;
    /** Two-stage interceptor: return true to consume Escape WITHOUT closing. */
    onEscape?: () => boolean;
  };
  /** Whether the menu is open (listeners mount only while true). Default true. */
  open?: boolean;
  /** Whether THIS controller should own Escape (false for a non-top nested
   *  provider — R6). Default true. */
  ownsEscape?: boolean;
}

function isInside(
  target: Node | null,
  containerRef: RefObject<HTMLElement | null>,
  getExcludes?: () => readonly (HTMLElement | null)[],
): boolean {
  if (!target) return false;
  if (containerRef.current?.contains(target)) return true;
  for (const el of getExcludes?.() ?? []) {
    if (el?.contains(target)) return true;
  }
  return false;
}

export function useMenuDismiss(opts: UseMenuDismissOptions): void {
  const {
    containerRef,
    getExcludes,
    onClose,
    onCancel,
    escape,
    open = true,
    ownsEscape = true,
  } = opts;
  // Escape ends the menu through the CANCEL door; absent one, dismiss and
  // cancel are the same door (every plain menu).
  const endOnEscape = onCancel ?? onClose;
  const stopProp = escape?.stopPropagation ?? true;
  const onEscape = escape?.onEscape;

  useEffect(() => {
    if (!open) return;
    if (typeof window === "undefined") return;

    const onMouseDown = (e: MouseEvent) => {
      if (!isInside(e.target as Node | null, containerRef, getExcludes)) {
        onClose();
      }
    };
    // Defer so the opening click doesn't self-close.
    const t = window.setTimeout(() => {
      window.addEventListener("mousedown", onMouseDown, true);
    }, 0);
    return () => {
      window.clearTimeout(t);
      window.removeEventListener("mousedown", onMouseDown, true);
    };
    // getExcludes is a stable getter the caller controls.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, onClose, containerRef]);

  useEffect(() => {
    if (!open || !ownsEscape) return;
    if (typeof window === "undefined") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      // Two-stage: let an interceptor consume Escape without closing.
      if (onEscape && onEscape()) {
        e.preventDefault();
        if (stopProp) e.stopPropagation();
        return;
      }
      e.preventDefault();
      if (stopProp) e.stopPropagation();
      endOnEscape();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open, ownsEscape, endOnEscape, onEscape, stopProp]);
}
