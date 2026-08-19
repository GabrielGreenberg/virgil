"use client";

/**
 * `useMenuKeyboard` — the roving `aria-activedescendant` keyboard controller
 * (design §3.1/§3.4). It drives the registry's cursor over the ordered,
 * region-tagged snapshot with NO DOM focus move, so the editor caret never
 * shifts. Two keydown SOURCES (graft B):
 *
 *   - Editor-focused command menus (grab / lightning): ONE `window`-CAPTURE
 *     keydown installed only while open. It `preventDefault()` +
 *     `stopPropagation()` ONLY on consumed keys (Arrows / Home / End / Enter /
 *     Space / bare-letter shortcuts) so the editor caret never moves and those
 *     keys never reach PM's `handleKeyDown`; every other key passes through.
 *   - Input-bearing comboboxes (label-ref / bib-picker): NO window listener.
 *     The owned `<input>`'s `onKeyDown` is routed through `handleKeyDown` (real
 *     focus stays in the input). B1 ships the window source for the list menu;
 *     the combobox handler is returned so Phase C wires it without a refactor.
 *
 * Escape is NOT handled here — `useMenuDismiss` owns it (so the stopPropagation
 * + two-stage interceptor live in one place). This controller only consumes
 * navigation + activation + letter keys.
 *
 * Keystroke sanctity: O(1) per keypress, entirely off the editor transaction
 * path. The letter map + snapshot are memoized off the registry version, never
 * rebuilt per keystroke; this adds NO `editor.on(...)` subscriber.
 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { buildLetterMap } from "./nav-core";
import { isEditableEventTarget } from "@/lib/drag-blocklist";
import type { MenuRegistry } from "./registry";
import type { MenuLayout, MenuOrientation, NavDir } from "./types";

export interface UseMenuKeyboardOptions {
  registry: MenuRegistry;
  layout: MenuLayout;
  /** Whether the menu is open (the window listener mounts only while true). */
  open?: boolean;
  /** Enable the bare-letter O(1) fast-path. */
  letterShortcuts?: boolean;
  /**
   * The element whose `aria-activedescendant` mirrors the active node. For an
   * editor-focused command menu this is the PM view's contentEditable (or its
   * container); for a combobox it's the owned `<input>`. The controller writes
   * the attribute on active-id changes and clears it on close. A getter so the
   * caller can resolve a live element lazily.
   */
  getActiveDescendantHost?: () => HTMLElement | null;
  /**
   * Whether THIS controller is the live one (top of the provider stack — R6).
   * A non-top nested provider passes false so only the topmost menu captures
   * window keydown. Default true.
   */
  isTop?: boolean;
  /**
   * Source mode. `"window"` (default) installs the window-capture listener for
   * editor-focused command menus. `"input"` installs no window listener — the
   * caller wires the returned `handleKeyDown` onto the owned input's onKeyDown.
   */
  source?: "window" | "input";
  /**
   * List stepping axis. Default `"vertical"` (Up/Down step; Left/Right are
   * inert and available for `onArrowHorizontal`). `"horizontal"` makes Left/Right
   * the nav axis. Ignored for grid/composite/combobox layouts.
   */
  orientation?: MenuOrientation;
  /**
   * For a VERTICAL `list` menu, intercept a plain Left/Right (otherwise inert —
   * nav-core's `listMove` ignores them) and hand it to the caller (e.g. ViewMenu
   * group expand/collapse) instead of the no-op `reg.move`. Receives the active
   * node id. Has no effect on a horizontal list, grid, composite, or combobox.
   */
  onArrowHorizontal?: (dir: "left" | "right", activeId: string | null) => void;
}

const NAV_KEYS: Record<string, NavDir> = {
  ArrowUp: "up",
  ArrowDown: "down",
  ArrowLeft: "left",
  ArrowRight: "right",
  Home: "home",
  End: "end",
};

export interface UseMenuKeyboardResult {
  /** Wire onto a combobox input's onKeyDown (the `source: "input"` path). */
  handleKeyDown: (e: KeyboardEvent | React.KeyboardEvent) => void;
}

export function useMenuKeyboard(
  opts: UseMenuKeyboardOptions,
): UseMenuKeyboardResult {
  const {
    registry,
    layout,
    open = true,
    letterShortcuts = false,
    getActiveDescendantHost,
    isTop = true,
    source = "window",
    orientation = "vertical",
    onArrowHorizontal,
  } = opts;

  // Keep options the listener reads in a ref so we don't re-subscribe the
  // window listener on every render (only on open/source/isTop change). The
  // ref is updated in a layout effect (NOT during render) so the listener
  // reads fresh values on the next commit.
  const stateRef = useRef({
    registry,
    layout,
    letterShortcuts,
    getActiveDescendantHost,
    orientation,
    onArrowHorizontal,
  });
  useLayoutEffect(() => {
    stateRef.current = {
      registry,
      layout,
      letterShortcuts,
      getActiveDescendantHost,
      orientation,
      onArrowHorizontal,
    };
  });

  // The letter-map memo, keyed on the registry version so it rebuilds ONLY on a
  // registration change (mount/unmount/disabled-flip), never per keystroke —
  // honoring the keystroke-sanctity claim in this file's header comment.
  const letterMapRef = useRef<{ version: number; map: Map<string, string> } | null>(
    null,
  );

  // The shared key handler. Returns true if it consumed the event (the window
  // source then prevents default + stops propagation).
  const consume = useCallback((e: KeyboardEvent | React.KeyboardEvent): boolean => {
    const {
      registry: reg,
      letterShortcuts: letters,
      layout: lay,
      orientation: orient,
      onArrowHorizontal: onHoriz,
    } = stateRef.current;

    // Only PLAIN nav/activation keys drive the menu — a MODIFIED combo
    // (Shift+Arrow to extend the editor selection, Cmd/Ctrl+Arrow line jumps,
    // Cmd+Enter, …) passes THROUGH to the editor untouched, matching the
    // bare-letter fast-path's modifier guard and the old menus' pass-through of
    // editor selection gestures.
    const plain = !e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey;

    if (plain && (e.key === "Enter" || e.key === " " || e.key === "Spacebar")) {
      reg.activate();
      return true;
    }

    const dir = NAV_KEYS[e.key];
    if (plain && dir) {
      // A VERTICAL `list` leaves Left/Right inert (nav-core's `listMove`
      // ignores them); hand them to the caller's `onArrowHorizontal` (e.g.
      // ViewMenu group expand/collapse) instead of the no-op move. A grid /
      // composite / horizontal list uses Left/Right for real nav → falls through.
      if (
        (dir === "left" || dir === "right") &&
        lay === "list" &&
        orient === "vertical" &&
        onHoriz
      ) {
        onHoriz(dir, reg.activeId());
      } else {
        reg.move(dir);
      }
      return true;
    }

    // Bare-letter fast-path: a single-char key with no meta/ctrl/alt, checked
    // BEFORE bailing. Disabled rows are excluded from the map (inert). The map
    // is rebuilt only when the registry version changes — not per keystroke.
    if (
      letters &&
      !e.metaKey &&
      !e.ctrlKey &&
      !e.altKey &&
      typeof e.key === "string" &&
      (e.key.length === 1 || e.key === "Backspace" || e.key === "Delete")
    ) {
      const ver = reg.getVersion();
      if (!letterMapRef.current || letterMapRef.current.version !== ver) {
        letterMapRef.current = { version: ver, map: buildLetterMap(reg.items()) };
      }
      const id = letterMapRef.current.map.get(e.key.toUpperCase());
      if (id) {
        reg.activateById(id);
        return true;
      }
    }
    return false;
  }, []);

  // The combobox-source handler (caller wires onto an input). It consumes the
  // event the same way but the caller owns whether to preventDefault for arrows
  // (single-line input → stop caret motion). We preventDefault on a consumed
  // event here for parity with the window source.
  const handleKeyDown = useCallback(
    (e: KeyboardEvent | React.KeyboardEvent) => {
      if (consume(e)) {
        e.preventDefault();
        // Do NOT stopPropagation in the input source — the input owns its own
        // event scope; the combobox's Escape is still handled by useMenuDismiss.
      }
    },
    [consume],
  );

  // The window-capture source (editor-focused command menus). Mounted only
  // while open AND this is the top-of-stack controller (R6).
  useEffect(() => {
    if (source !== "window") return;
    if (!open || !isTop) return;
    if (typeof window === "undefined") return;
    const onKey = (e: KeyboardEvent) => {
      // Leave Escape to useMenuDismiss; ignore modifier combos for nav keys.
      if (e.key === "Escape") return;
      // A window-CAPTURE listener sees keys the menu was never given. When the
      // caret sits in an editable control, every key this controller consumes
      // is a key that control needs: arrows move the caret, letters type, and
      // `Backspace`/`Delete` — which `buildLetterMap` accepts as aliases, and
      // which `DragHandleMenu` aliases onto its DESTRUCTIVE delete row — erase
      // a character. Un-guarded, one Backspace deleted the block instead
      // (task 386's sweep: the same missing-interactive-guard class as that
      // task's card-title loss, one layer up and worse, because capture phase
      // means the field never even sees the key). The COMBOBOX source needs no
      // such bail: its handler is wired by the caller onto the menu's OWN
      // input, which is a deliberate opt-in rather than a global reach — the
      // same `target === currentTarget` line `keyEventFromInteractiveControl`
      // draws.
      if (isEditableEventTarget(e.target)) return;
      if (consume(e)) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [source, open, isTop, consume]);

  // Mirror the active node's domId onto the focus-holding host's
  // aria-activedescendant — NO `.focus()` on items (the load-bearing choice).
  // Subscribe to the registry so this fires on every active-id change while
  // open; clears the attribute on close / unmount.
  useEffect(() => {
    if (!open) return;
    const sync = () => {
      const activeId = registry.activeId();
      // Built-in scroll-into-view of the active row (§3.5) — re-anchors the
      // active option as the cursor moves, replacing a combobox's bespoke
      // `scrollIntoView` effect. NO `.focus()` (roving aria-activedescendant
      // only), so the editor caret / combobox input keeps focus. `nearest`
      // matches the old hand-rolled behavior and is a no-op when in view.
      if (activeId) {
        const el = registry.refFor(activeId);
        el?.scrollIntoView?.({ block: "nearest" });
      }
      const host = stateRef.current.getActiveDescendantHost?.();
      if (!host) return;
      if (activeId) host.setAttribute("aria-activedescendant", registry.domIdFor(activeId));
      else host.removeAttribute("aria-activedescendant");
    };
    sync();
    const unsub = registry.subscribe(sync);
    return () => {
      unsub();
      const host = stateRef.current.getActiveDescendantHost?.();
      host?.removeAttribute("aria-activedescendant");
    };
  }, [open, registry]);

  return useMemo(() => ({ handleKeyDown }), [handleKeyDown]);
}
