"use client";

/**
 * Preference Mode — ctrl+click preference picker
 * ===============================================
 *
 * A global toggle that puts the UI into a "preferences-editable" state.
 * When `on === true`:
 *   1. The `<body>` element carries `data-pref-mode="on"`. That attribute is
 *      the single signal for CSS and other JS to adjust behaviour.
 *   2. A ctrl+click (⌘+click on macOS) on any element with `data-prefs`
 *      opens a floating picker showing the preferences that element exposes
 *      (implemented by PreferenceModePicker — see that file).
 *   3. Subtle hover outlines appear on annotated elements so the user can
 *      discover what's editable (implemented via a CSS rule keyed on the
 *      body attribute — see globals.css, section "Preference mode").
 *
 * This hook owns ONLY the on/off state. Rendering the toggle button,
 * rendering the picker, walking the DOM, and updating the <body> attribute
 * are separate concerns — see the "Threading" map below.
 *
 * ────────────────────────────────────────────────────────────────────────
 * Threading map — where each piece lives
 * ────────────────────────────────────────────────────────────────────────
 *
 *   ┌──────────────────────────────────┐
 *   │  usePreferenceMode()   (this)    │  on/off state + localStorage +
 *   │                                  │  pub/sub via useSyncExternalStore
 *   └──────────────┬───────────────────┘
 *                  │
 *         ┌────────┴────────┬─────────────────────┐
 *         ▼                 ▼                     ▼
 *   [top-bar button]   [<body> attr]         [picker + ctrl+click]
 *   EditorLayout.tsx   (this hook's          PreferenceModePicker.tsx
 *   (renders the       useEffect applies     (renders the popover; listens
 *   toggle button;     data-pref-mode="on"   for ctrl+click; walks up the
 *   uses isOn &        on document.body)     DOM from event.target
 *   toggle())                                collecting every data-prefs
 *                                            attribute; filters
 *                                            preferences-tree by those
 *                                            keys and renders the result
 *                                            using PreferenceTree rows).
 *
 *   data-prefs annotations live on individual components:
 *     - panel-primitives.tsx (cards, headers, badges, sub-pods)
 *     - Editor TipTap extensions (body text, headings, paragraph titles,
 *       inline markers: footnote/note/citation/math)
 *     - App chrome (EditorLayout.tsx top bar, strips, pods)
 *
 * ────────────────────────────────────────────────────────────────────────
 * How to extend
 * ────────────────────────────────────────────────────────────────────────
 *
 *  - Expose a new token via ctrl+click:
 *      1. Ensure the token is in preferences-tree.ts (PREFERENCES_TREE for
 *         UI entry, PREF_TO_CSS for the var mapping).
 *      2. Add `data-prefs="<key>"` to the DOM element that visually
 *         represents the token. Multiple keys separated by commas.
 *      3. That's it — the picker walks up the DOM collecting data-prefs and
 *         renders a filtered PreferenceTree, so no picker edits are needed.
 *
 *  - Per-panel colors (footnote, note, etc.) use a different mechanism:
 *      add `data-panel-theme="<PanelThemeKey>"` instead. The picker
 *      recognizes it and routes to PanelThemePicker, which edits via
 *      panel-theme.ts's setPanelColor (not preferences-tree).
 *
 *  - Change the activation modifier (e.g. ctrl+click → alt+click):
 *      edit the listener inside PreferenceModePicker.tsx. Keep the toggle
 *      separate from the modifier key so this hook stays reusable.
 *
 *  - Change the picker UI (layout, positioning, dismiss behaviour):
 *      edit PreferenceModePicker.tsx. Labels and descriptions come from
 *      preferences-tree.ts entries, which stay the single source of truth.
 *
 *  - Remove preference mode entirely:
 *      delete this file, PreferenceModePicker.tsx, the top-bar button,
 *      the body-attribute useEffect (grep for "data-pref-mode"), and the
 *      globals.css rule. `data-prefs` attributes on components can stay —
 *      they're harmless without the picker and would allow re-enabling the
 *      feature later.
 *
 * Storage key: "virgil-pref-mode" (boolean JSON-encoded in localStorage).
 */

import { useCallback, useEffect, useSyncExternalStore } from "react";

const STORAGE_KEY = "virgil-pref-mode";

// Module-scoped store so every consumer of this hook observes the same
// value without prop-drilling. Pattern mirrors panel-theme.ts.
let _on = false;
let _loaded = false;
const _listeners = new Set<() => void>();

function _notify() {
  _listeners.forEach((l) => l());
}

function _loadOnce() {
  if (_loaded) return;
  _loaded = true;
  if (typeof window === "undefined") return;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw != null) _on = JSON.parse(raw) === true;
  } catch {
    /* ignore */
  }
}

function _persist() {
  if (typeof window === "undefined") return;
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(_on)); } catch { /* ignore */ }
}

function _subscribe(listener: () => void) {
  _listeners.add(listener);
  return () => { _listeners.delete(listener); };
}

/**
 * Read/write the preference-mode toggle.
 *
 *   const { on, toggle, set } = usePreferenceMode();
 *
 *  - `on` is the current state (boolean).
 *  - `toggle()` flips it.
 *  - `set(value)` forces a specific state (useful for keyboard shortcuts).
 *
 * A module-level useEffect applies `data-pref-mode="on"` to document.body
 * whenever the state is on. Consumers don't need to do this themselves.
 */
export function usePreferenceMode() {
  _loadOnce();

  const on = useSyncExternalStore(
    _subscribe,
    () => _on,
    () => false, // SSR default
  );

  // Mirror the state onto <body> so CSS and the picker's ctrl+click
  // handler can gate on a single attribute. Placed here (rather than in
  // each consumer) so it runs exactly once per toggle event.
  useEffect(() => {
    if (typeof document === "undefined") return;
    if (on) {
      document.body.setAttribute("data-pref-mode", "on");
    } else {
      document.body.removeAttribute("data-pref-mode");
    }
    return () => {
      // On unmount we leave the attribute alone — other instances of the
      // hook may still want it set. _on is the source of truth.
    };
  }, [on]);

  const set = useCallback((value: boolean) => {
    if (_on === value) return;
    _on = value;
    _persist();
    _notify();
  }, []);

  const toggle = useCallback(() => {
    _on = !_on;
    _persist();
    _notify();
  }, []);

  return { on, toggle, set };
}
