"use client";

/**
 * Zen Mode — suppress editor chrome for a distraction-free view
 * ==============================================================
 *
 * A global toggle that hides the editor's surrounding chrome (icon strips,
 * panel columns, floating MenuBar, marginalia margins, popped-out panels
 * and cards) while leaving the underlying layout state untouched. The top
 * bar stays visible so there's always an affordance to toggle Zen off.
 *
 * In Zen mode, empty adjustable "page margins" take the place of where
 * the panel columns would normally sit. Their widths are stored here
 * (leftMargin / rightMargin), independent of the panel column widths, so
 * a narrow reading margin doesn't force narrow panels when Zen is off.
 *
 * Architecture: module-scoped state, pub/sub via useSyncExternalStore,
 * localStorage persistence, and a body attribute mirror
 * (`data-zen-mode="on"`). `useWindowChrome.ts` mirrors the same shape.
 *
 * Storage key: "virgil-zen-mode" — JSON: { on: boolean, leftMargin: number, rightMargin: number }.
 * Legacy boolean values are migrated on load.
 */

import { useCallback, useEffect, useSyncExternalStore } from "react";

import { subscribeToStorageKey } from "@/lib/cross-window-storage";

const STORAGE_KEY = "virgil-zen-mode";
const DEFAULT_MARGIN = 160;
// Bounds are generous so Zen can preserve whatever margins the non-Zen
// layout currently has (icon strip alone ≈ 42px; strip + wide panel can
// easily exceed 600). Drag handle in ZenMargin has its own bounds.
const MIN_MARGIN = 0;
const MAX_MARGIN = 1200;

interface ZenState {
  on: boolean;
  leftMargin: number;
  rightMargin: number;
}

let _state: ZenState = { on: false, leftMargin: DEFAULT_MARGIN, rightMargin: DEFAULT_MARGIN };
const _ssrSnapshot: ZenState = { on: false, leftMargin: DEFAULT_MARGIN, rightMargin: DEFAULT_MARGIN };
let _loaded = false;
const _listeners = new Set<() => void>();

function _notify() {
  _listeners.forEach((l) => l());
}

/**
 * The ONE parse/validate path for the persisted blob — shared by the one-shot
 * hydrate and the cross-window re-sync below, so a peer's blob is filtered by
 * exactly the same rules (including the legacy-boolean migration) as a local
 * one. Returns the defaults when the key is absent or unreadable, which is
 * also what a peer's `clear()` must produce.
 */
function _readFromStorage(): ZenState {
  const base: ZenState = { on: false, leftMargin: DEFAULT_MARGIN, rightMargin: DEFAULT_MARGIN };
  if (typeof window === "undefined") return base;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw == null) return base;
    const parsed = JSON.parse(raw);
    if (typeof parsed === "boolean") {
      // Legacy format: just the on/off flag.
      return { ...base, on: parsed };
    }
    if (parsed && typeof parsed === "object") {
      return {
        on: parsed.on === true,
        leftMargin: typeof parsed.leftMargin === "number" ? parsed.leftMargin : DEFAULT_MARGIN,
        rightMargin: typeof parsed.rightMargin === "number" ? parsed.rightMargin : DEFAULT_MARGIN,
      };
    }
  } catch {
    /* ignore */
  }
  return base;
}

function _loadOnce() {
  if (_loaded) return;
  _loaded = true;
  if (typeof window === "undefined") return;
  _state = _readFromStorage();
}

// Cross-window re-sync (task 179, following 177). `_loaded` is a one-shot
// latch, so without this a second window's snapshot could never re-hydrate and
// its next whole-blob `_persist()` would silently drop the peer's zen state /
// margin widths. The `storage` event never fires in the writing window, so
// this is the peer channel only; the re-read runs the same validation as the
// hydrate, and `_notify()` re-renders every `useZenMode` consumer (which also
// re-runs the `data-zen-mode` body-attribute effect).
subscribeToStorageKey(STORAGE_KEY, () => {
  _state = _readFromStorage();
  _notify();
});

function _persist() {
  if (typeof window === "undefined") return;
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(_state)); } catch { /* ignore */ }
}

function _subscribe(listener: () => void) {
  _listeners.add(listener);
  return () => { _listeners.delete(listener); };
}

/**
 * Clamp a zen page-margin width.
 *
 * `floor` is the right-margin geometry min-floor (backlog #8): the smallest
 * margin that still fully reserves the marginalia marker lane. It is applied
 * ONLY WHEN MARKERS ARE VISIBLE. Zen mode is distraction-free reading and
 * always hides the marginalia margins (see this hook's docstring), so the
 * marker lane is never live here — the setters below pass the default
 * `MIN_MARGIN` (0) and zen keeps its full freedom down to a zero margin, the
 * regression the floor must NOT cause in reading modes. The parameter is
 * threaded so the gate is explicit (and so a future zen-with-markers mode
 * could opt in by passing the lane floor).
 */
function _clamp(n: number, floor: number = MIN_MARGIN) {
  return Math.max(floor, Math.min(MAX_MARGIN, n));
}

/**
 * Read/write the zen-mode state.
 *
 *   const { on, toggle, set, leftMargin, rightMargin, setLeftMargin, setRightMargin } = useZenMode();
 */
export function useZenMode() {
  _loadOnce();

  const state = useSyncExternalStore(
    _subscribe,
    () => _state,
    () => _ssrSnapshot,
  );

  useEffect(() => {
    if (typeof document === "undefined") return;
    if (state.on) {
      document.body.setAttribute("data-zen-mode", "on");
    } else {
      document.body.removeAttribute("data-zen-mode");
    }
  }, [state.on]);

  const set = useCallback((value: boolean) => {
    if (_state.on === value) return;
    _state = { ..._state, on: value };
    _persist();
    _notify();
  }, []);

  const toggle = useCallback(() => {
    _state = { ..._state, on: !_state.on };
    _persist();
    _notify();
  }, []);

  const setLeftMargin = useCallback((w: number) => {
    const next = _clamp(w);
    if (_state.leftMargin === next) return;
    _state = { ..._state, leftMargin: next };
    _persist();
    _notify();
  }, []);

  const setRightMargin = useCallback((w: number) => {
    const next = _clamp(w);
    if (_state.rightMargin === next) return;
    _state = { ..._state, rightMargin: next };
    _persist();
    _notify();
  }, []);

  return {
    on: state.on,
    toggle,
    set,
    leftMargin: state.leftMargin,
    rightMargin: state.rightMargin,
    setLeftMargin,
    setRightMargin,
  };
}
